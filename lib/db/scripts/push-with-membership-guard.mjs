#!/usr/bin/env node

import { spawn } from "node:child_process";
import { Client } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const triggerName = "clientguard_membership_upgrade_guard";
const functionName = "clientguard_membership_upgrade_guard_fn";
const indexName = "clientguard_membership_user_unique";

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function membershipIndexExistsQuery() {
  return `
    SELECT EXISTS (
      SELECT 1
      FROM pg_index AS index
      JOIN pg_class AS index_relation
        ON index_relation.oid = index.indexrelid
      JOIN pg_namespace AS index_schema
        ON index_schema.oid = index_relation.relnamespace
      JOIN pg_class AS table_relation
        ON table_relation.oid = index.indrelid
      JOIN pg_namespace AS table_schema
        ON table_schema.oid = table_relation.relnamespace
      JOIN pg_attribute AS membership_user
        ON membership_user.attrelid = table_relation.oid
       AND membership_user.attname = 'clerk_user_id'
      WHERE index_schema.nspname = $1
        AND table_schema.nspname = $1
        AND index_relation.relname = $2
        AND table_relation.relname = 'clientguard_memberships'
        AND index.indisunique
        AND index.indisvalid
        AND index.indnkeyatts = 1
        AND index.indkey[0] = membership_user.attnum
    ) AS exists
  `;
}

export async function installMembershipGuard(client, schemaName) {
  const schema = quoteIdentifier(schemaName);
  const table = `${schema}.${quoteIdentifier("clientguard_memberships")}`;

  await client.query(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);

  const { rows: conflicts } = await client.query(`
    SELECT
      membership.clerk_user_id,
      COUNT(*)::integer AS membership_count,
      COUNT(DISTINCT membership.workspace_id)::integer AS firm_count,
      json_agg(
        json_build_object(
          'membershipId', membership.id,
          'workspaceId', membership.workspace_id,
          'workspaceName', workspace.name,
          'role', membership.role
        )
        ORDER BY workspace.name, membership.workspace_id, membership.id
      ) AS firms
    FROM ${table} AS membership
    LEFT JOIN ${schema}.${quoteIdentifier("clientguard_workspaces")} AS workspace
      ON workspace.id = membership.workspace_id
    GROUP BY membership.clerk_user_id
    HAVING COUNT(*) > 1
    ORDER BY membership.clerk_user_id
  `);

  if (conflicts.length > 0) {
    const details = conflicts
      .map((conflict) => {
        const memberships = conflict.firms
          .map(
            (firm) =>
              `  - ${firm.workspaceName ?? "(unknown firm)"} (workspace ${firm.workspaceId}, membership ${firm.membershipId}, role ${firm.role})`,
          )
          .join("\n");
        return `- Clerk user ${conflict.clerk_user_id}: ${conflict.membership_count} memberships across ${conflict.firm_count} firm(s)\n${memberships}`;
      })
      .join("\n");
    throw new Error(
      `Preflight blocked: ${conflicts.length} Clerk identity group(s) have duplicate membership rows.\n${details}\nResolve each conflict and retry; no membership rows were changed.`,
    );
  }

  const { rows: indexRows } = await client.query(membershipIndexExistsQuery(), [
    schemaName,
    indexName,
  ]);
  if (indexRows[0]?.exists) {
    await client.query(`
      DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName)} ON ${table}
    `);
    await client.query(`
      DROP FUNCTION IF EXISTS ${schema}.${quoteIdentifier(functionName)}()
    `);
    return { guarded: false, schemaName };
  }

  await client.query(`
    CREATE OR REPLACE FUNCTION ${schema}.${quoteIdentifier(functionName)}()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $guard$
    BEGIN
      IF NEW.clerk_user_id IS NULL THEN
        RETURN NEW;
      END IF;

      IF TG_OP = 'UPDATE'
         AND NEW.clerk_user_id IS NOT DISTINCT FROM OLD.clerk_user_id THEN
        RETURN NEW;
      END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.clerk_user_id, 0));

      IF EXISTS (
        SELECT 1
        FROM ${table} AS membership
        WHERE membership.clerk_user_id = NEW.clerk_user_id
          AND membership.id IS DISTINCT FROM NEW.id
      ) THEN
        RAISE EXCEPTION 'duplicate membership for Clerk user %', NEW.clerk_user_id
          USING ERRCODE = '23505',
                CONSTRAINT = '${indexName}';
      END IF;

      RETURN NEW;
    END
    $guard$
  `);
  await client.query(`
    DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName)} ON ${table}
  `);
  await client.query(`
    CREATE TRIGGER ${quoteIdentifier(triggerName)}
    BEFORE INSERT OR UPDATE OF clerk_user_id ON ${table}
    FOR EACH ROW
    EXECUTE FUNCTION ${schema}.${quoteIdentifier(functionName)}()
  `);

  return { guarded: true, schemaName };
}

export async function removeMembershipGuard(client, schemaName) {
  const schema = quoteIdentifier(schemaName);
  const table = `${schema}.${quoteIdentifier("clientguard_memberships")}`;

  await client.query("BEGIN");
  try {
    const { rows } = await client.query(membershipIndexExistsQuery(), [
      schemaName,
      indexName,
    ]);
    if (!rows[0]?.exists) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(`
      DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName)} ON ${table}
    `);
    await client.query(`
      DROP FUNCTION IF EXISTS ${schema}.${quoteIdentifier(functionName)}()
    `);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

function runDrizzlePush(force) {
  return new Promise((resolve) => {
    const drizzleKit = path.join(
      packageDirectory,
      "node_modules/.bin/drizzle-kit",
    );
    const args = ["push", "--config", "./drizzle.config.ts"];
    if (force) args.push("--force");

    const child = spawn(drizzleKit, args, {
      cwd: packageDirectory,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      console.error(`Could not start Drizzle schema push: ${error.message}`);
      resolve(2);
    });
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal ? 2 : 1));
    });
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL is required to safely push the database schema.",
    );
    process.exitCode = 2;
    return;
  }

  const client = new Client({
    connectionString: databaseUrl,
    application_name: "clientguard-membership-schema-push",
  });
  let transactionOpen = false;
  let guard;

  try {
    await client.connect();
    await client.query("BEGIN");
    transactionOpen = true;

    const { rows } = await client.query(`
      SELECT current_schema() AS schema_name,
             to_regclass('clientguard_memberships') IS NOT NULL AS table_exists
    `);
    const { schema_name: schemaName, table_exists: tableExists } =
      rows[0] ?? {};

    if (!schemaName) {
      throw new Error("Could not determine the active database schema.");
    }

    if (!tableExists) {
      console.log(
        "Membership table does not exist yet; proceeding with the initial schema creation.",
      );
      await client.query("COMMIT");
      transactionOpen = false;
    } else {
      guard = await installMembershipGuard(client, schemaName);
      await client.query("COMMIT");
      transactionOpen = false;

      if (guard.guarded) {
        console.log(
          "Membership preflight passed. A database guard is active until the unique index is installed.",
        );
      } else {
        console.log(
          "Membership preflight passed. The unique membership index already protects writes during this schema push.",
        );
      }
    }
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => {});
    }
    await client.end().catch(() => {});
    if (
      error instanceof Error &&
      error.message.startsWith("Preflight blocked:")
    ) {
      console.error(error.message);
      process.exitCode = 1;
    } else {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unknown";
      console.error(
        `Membership preflight could not complete (database error ${code}). No schema changes were attempted.`,
      );
      process.exitCode = 2;
    }
    return;
  }

  try {
    const pushStatus = await runDrizzlePush(process.argv.includes("--force"));
    if (pushStatus !== 0) {
      if (guard?.guarded) {
        console.error(
          "Schema push did not finish. The membership guard remains active so duplicate writes stay blocked; rerun the supported push command after resolving the failure.",
        );
      }
      process.exitCode = pushStatus;
      return;
    }

    if (guard?.guarded) {
      const removed = await removeMembershipGuard(client, guard.schemaName);
      if (removed) {
        console.log(
          "Schema push completed. The unique membership index is active and the temporary membership guard was removed.",
        );
      } else {
        console.warn(
          "Schema push completed, but the unique membership index was not found. The database membership guard remains active.",
        );
      }
    }
  } catch (error) {
    console.error(
      `Schema push completed, but membership-guard cleanup failed. The guard remains in place: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 2;
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
