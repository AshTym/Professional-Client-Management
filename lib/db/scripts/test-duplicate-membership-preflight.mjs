#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import {
  installMembershipGuard,
  removeMembershipGuard,
} from "./push-with-membership-guard.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required to run membership preflight tests.",
  );
}

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const schemaPrefix = `membership_preflight_${randomUUID().replaceAll("-", "")}`;
const schemas = {
  absent: `${schemaPrefix}_absent`,
  clean: `${schemaPrefix}_clean`,
  duplicate: `${schemaPrefix}_duplicate`,
};
const pool = new Pool({ connectionString: databaseUrl });

function isolatedUrl(schemaName) {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schemaName}`);
  return url.toString();
}

function runPackageScript(
  scriptName,
  schemaName,
  targetDatabaseUrl = isolatedUrl(schemaName),
) {
  const env = {
    ...process.env,
    DATABASE_URL: targetDatabaseUrl,
  };
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
  assert.deepEqual(
    await pool
      .query(`SELECT to_regclass($1) AS table_name`, [
        `"${schemas.absent}".clientguard_memberships`,
      ])
      .then(({ rows }) => rows[0].table_name),
    null,
  );

  // A clean, existing membership table passes without modifying its rows.
  await createMembershipTables(schemas.clean);
  await seedMemberships(schemas.clean, false);
  const cleanBefore = await membershipSnapshot(schemas.clean);
  assertScriptPassed("preflight:memberships", schemas.clean);
  assert.deepEqual(await membershipSnapshot(schemas.clean), cleanBefore);

  // The push guard closes the gap after the preflight and before index creation.
  const guardClient = new Client({
    connectionString: isolatedUrl(schemas.clean),
  });
  await guardClient.connect();
  await guardClient.query("BEGIN");
  await guardClient.query(
    `LOCK TABLE "${schemas.clean}".clientguard_memberships IN SHARE ROW EXCLUSIVE MODE`,
  );
  const guard = await installMembershipGuard(guardClient, schemas.clean);
  await guardClient.query("COMMIT");

  const concurrentAttempts = await Promise.allSettled([
    pool.query(
      `INSERT INTO "${schemas.clean}".clientguard_memberships
        (id, workspace_id, clerk_user_id, role)
       VALUES (10, 1, 'upgrade-race-user', 'professional')`,
    ),
    pool.query(
      `INSERT INTO "${schemas.clean}".clientguard_memberships
        (id, workspace_id, clerk_user_id, role)
       VALUES (11, 2, 'upgrade-race-user', 'professional')`,
    ),
  ]);
  assert.equal(
    concurrentAttempts.filter((result) => result.status === "fulfilled").length,
    1,
    "Exactly one concurrent duplicate membership write should succeed before index creation.",
  );
  const rejectedAttempt = concurrentAttempts.find(
    (result) => result.status === "rejected",
  );
  assert.equal(rejectedAttempt?.reason?.code, "23505");
  assert.equal(
    await pool
      .query(
        `SELECT COUNT(*)::integer AS count
           FROM "${schemas.clean}".clientguard_memberships
          WHERE clerk_user_id = 'upgrade-race-user'`,
      )
      .then(({ rows }) => rows[0].count),
    1,
  );

  // This represents the schema upgrade completing while writes continue.
  await pool.query(
    `CREATE UNIQUE INDEX clientguard_membership_user_unique
       ON "${schemas.clean}".clientguard_memberships (clerk_user_id)`,
  );
  assert.equal(
    await removeMembershipGuard(guardClient, guard.schemaName),
    true,
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO "${schemas.clean}".clientguard_memberships
        (id, workspace_id, clerk_user_id, role)
       VALUES (12, 2, 'upgrade-race-user', 'professional')`,
    ),
    (error) => error.code === "23505",
  );
  await guardClient.end();

  // Both package-level push commands must stop at preflight for conflicts.
  await createMembershipTables(schemas.duplicate);
  await seedMemberships(schemas.duplicate, true);
  const duplicateBefore = await membershipSnapshot(schemas.duplicate);
  for (const scriptName of ["push", "push-force"]) {
    const result = runPackageScript(scriptName, schemas.duplicate);
    assert.equal(
      result.status,
      1,
      `${scriptName} did not block:\n${result.output}`,
    );
    assert.match(result.output, /Preflight blocked:/);
    assert.deepEqual(
      await membershipSnapshot(schemas.duplicate),
      duplicateBefore,
      `${scriptName} changed membership rows.`,
    );
  }

  // A server that refuses connections simulates an unavailable database.
  for (const scriptName of ["push", "push-force"]) {
    const unavailableDatabaseServer = await import("node:net").then(
      ({ createServer }) =>
        new Promise((resolve, reject) => {
          const server = createServer();
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close((error) => {
              if (error) reject(error);
              else resolve(address);
            });
          });
        }),
    );
    if (
      !unavailableDatabaseServer ||
      typeof unavailableDatabaseServer === "string"
    ) {
      throw new Error(
        "Could not determine the unavailable database test port.",
      );
    }
    const unavailableDatabaseUrl = new URL(databaseUrl);
    unavailableDatabaseUrl.hostname = "127.0.0.1";
    unavailableDatabaseUrl.port = String(unavailableDatabaseServer.port);
    unavailableDatabaseUrl.searchParams.set("connect_timeout", "2");
    const result = runPackageScript(
      scriptName,
      schemas.duplicate,
      unavailableDatabaseUrl.toString(),
    );
    assert.equal(
      result.status,
      2,
      `${scriptName} did not fail closed when the membership check could not connect:\n${result.output}`,
    );
    assert.match(result.output, /Membership preflight could not complete/);
    assert.match(result.output, /No schema changes were attempted/);
    assert.deepEqual(
      await membershipSnapshot(schemas.duplicate),
      duplicateBefore,
      `${scriptName} changed membership rows after a failed membership check.`,
    );
  }

  console.log(
    "Membership upgrade tests passed: conflict preflights fail closed; concurrent duplicate writes are serialized and rejected during upgrade; the unique index protects writes after the temporary guard is removed.",
  );
} finally {
  for (const schemaName of Object.values(schemas)) {
    await pool
      .query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      .catch(() => {});
  }
  await pool.end();
}
