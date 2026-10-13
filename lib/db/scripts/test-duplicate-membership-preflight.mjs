#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run membership preflight tests.");
}

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPrefix = `membership_preflight_${randomUUID().replaceAll("-", "")}`;
const schemas = {
  absent: `${schemaPrefix}_absent`,
  clean: `${schemaPrefix}_clean`,
  duplicate: `${schemaPrefix}_duplicate`,
};
const pool = new Pool({ connectionString: databaseUrl });
const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "membership-preflight-"));
const invocationMarker = path.join(tempDirectory, "drizzle-invoked");
const drizzleStub = path.join(tempDirectory, "drizzle-kit");
const shellWrapper = path.join(tempDirectory, "test-shell");
const unavailableDatabaseServer = createServer();
await new Promise((resolve, reject) => {
  unavailableDatabaseServer.once("error", reject);
  unavailableDatabaseServer.listen(0, "127.0.0.1", resolve);
});
const unavailableDatabaseAddress = unavailableDatabaseServer.address();
if (!unavailableDatabaseAddress || typeof unavailableDatabaseAddress === "string") {
  throw new Error("Could not determine the unavailable database test port.");
}
await new Promise((resolve) => unavailableDatabaseServer.close(resolve));
const unavailableDatabaseUrl = new URL(databaseUrl);
unavailableDatabaseUrl.hostname = "127.0.0.1";
unavailableDatabaseUrl.port = String(unavailableDatabaseAddress.port);
unavailableDatabaseUrl.searchParams.set("connect_timeout", "2");

await writeFile(
  drizzleStub,
  `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.PREFLIGHT_TEST_DRIZZLE_MARKER, JSON.stringify(process.argv.slice(2)) + "\\\\n");
`,
);
await chmod(drizzleStub, 0o755);

await writeFile(
  shellWrapper,
  `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const command = process.argv[3];
if (process.argv[2] !== "-c" || typeof command !== "string") {
  console.error("Unexpected package script shell invocation.");
  process.exit(2);
}
const stub = JSON.stringify(process.env.PREFLIGHT_TEST_DRIZZLE_STUB);
const rewritten = command.replace(/\\\\bdrizzle-kit\\\\b/g, stub);
const result = spawnSync("/bin/sh", ["-c", rewritten], { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}
process.exit(result.status ?? 2);
`,
);
await chmod(shellWrapper, 0o755);

function isolatedUrl(schemaName) {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schemaName}`);
  return url.toString();
}

function runPackageScript(
  scriptName,
  schemaName,
  testShell = false,
  targetDatabaseUrl = isolatedUrl(schemaName),
) {
  const env = {
    ...process.env,
    DATABASE_URL: targetDatabaseUrl,
  };
  if (testShell) {
    env.npm_config_script_shell = shellWrapper;
    env.PREFLIGHT_TEST_DRIZZLE_STUB = drizzleStub;
    env.PREFLIGHT_TEST_DRIZZLE_MARKER = invocationMarker;
  }
  const result = spawnSync("pnpm", ["run", scriptName], {
    cwd: packageDirectory,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

async function assertDrizzleWasNotInvoked(scriptName, reason) {
  assert.equal(
    await import("node:fs/promises").then(({ access }) =>
      access(invocationMarker).then(() => true, () => false),
    ),
    false,
    `${scriptName} invoked Drizzle ${reason}.`,
  );
}

async function createMembershipTables(schemaName) {
  await pool.query(`
    CREATE TABLE "${schemaName}".clientguard_workspaces (
      id integer PRIMARY KEY,
      name text NOT NULL
    );
    CREATE TABLE "${schemaName}".clientguard_memberships (
      id integer PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id),
      clerk_user_id text NOT NULL,
      role text NOT NULL
    );
  `);
}

async function seedMemberships(schemaName, duplicate) {
  await pool.query(
    `INSERT INTO "${schemaName}".clientguard_workspaces (id, name) VALUES
      (1, 'Preflight Firm One'),
      (2, 'Preflight Firm Two')`,
  );
  await pool.query(
    `INSERT INTO "${schemaName}".clientguard_memberships
      (id, workspace_id, clerk_user_id, role)
     VALUES
      (1, 1, 'preflight-user-one', 'owner'),
      (2, 2, $1, 'professional')`,
    [duplicate ? "preflight-user-one" : "preflight-user-two"],
  );
}

async function membershipSnapshot(schemaName) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, clerk_user_id, role
       FROM "${schemaName}".clientguard_memberships
      ORDER BY id`,
  );
  return rows;
}

function assertScriptPassed(scriptName, schemaName) {
  const result = runPackageScript(scriptName, schemaName);
  assert.equal(result.status, 0, `${scriptName} failed:\n${result.output}`);
  assert.match(result.output, /Preflight passed:/);
}

try {
  for (const schemaName of Object.values(schemas)) {
    await pool.query(`CREATE SCHEMA "${schemaName}"`);
  }

  // A schema without the membership table is a valid pre-migration target.
  assertScriptPassed("preflight:memberships", schemas.absent);
  assert.deepEqual(await pool.query(
    `SELECT to_regclass($1) AS table_name`,
    [`"${schemas.absent}".clientguard_memberships`],
  ).then(({ rows }) => rows[0].table_name), null);

  // A clean, existing membership table passes without modifying its rows.
  await createMembershipTables(schemas.clean);
  await seedMemberships(schemas.clean, false);
  const cleanBefore = await membershipSnapshot(schemas.clean);
  assertScriptPassed("preflight:memberships", schemas.clean);
  assert.deepEqual(await membershipSnapshot(schemas.clean), cleanBefore);

  // Both package-level push commands must stop at preflight for conflicts.
  await createMembershipTables(schemas.duplicate);
  await seedMemberships(schemas.duplicate, true);
  const duplicateBefore = await membershipSnapshot(schemas.duplicate);
  for (const scriptName of ["push", "push-force"]) {
    await rm(invocationMarker, { force: true });
    const result = runPackageScript(scriptName, schemas.duplicate, true);
    assert.equal(result.status, 1, `${scriptName} did not block:\n${result.output}`);
    assert.match(result.output, /Preflight blocked:/);
    await assertDrizzleWasNotInvoked(scriptName, "despite duplicate memberships");
    assert.deepEqual(
      await membershipSnapshot(schemas.duplicate),
      duplicateBefore,
      `${scriptName} changed membership rows.`,
    );
  }

  // A server that drops database connections simulates an unavailable database.
  // Both package-level push commands must fail closed before invoking Drizzle.
  for (const scriptName of ["push", "push-force"]) {
    await rm(invocationMarker, { force: true });
    const result = runPackageScript(
      scriptName,
      schemas.duplicate,
      true,
      unavailableDatabaseUrl.toString(),
    );
    assert.equal(
      result.status,
      2,
      `${scriptName} did not fail closed when the membership check could not connect:\n${result.output}`,
    );
    assert.match(result.output, /Membership preflight could not complete/);
    assert.match(result.output, /No schema changes were attempted/);
    await assertDrizzleWasNotInvoked(
      scriptName,
      "after the membership check could not connect",
    );
    assert.deepEqual(
      await membershipSnapshot(schemas.duplicate),
      duplicateBefore,
      `${scriptName} changed membership rows after a failed membership check.`,
    );
  }

  console.log(
    "Membership preflight tests passed: absent and clean schemas pass; push and push-force block conflicts and unavailable databases without invoking Drizzle or changing memberships.",
  );
} finally {
  for (const schemaName of Object.values(schemas)) {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => {});
  }
  await pool.end();
  await rm(tempDirectory, { recursive: true, force: true });
}
