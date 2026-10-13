#!/usr/bin/env node

import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required to check for duplicate memberships.");
  process.exitCode = 2;
} else {
  const client = new Client({
    connectionString: databaseUrl,
    application_name: "clientguard-membership-preflight",
  });
  let transactionOpen = false;

  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;

    const { rows: relationRows } = await client.query(
      "SELECT to_regclass('clientguard_memberships') IS NOT NULL AS exists",
    );

    if (!relationRows[0]?.exists) {
      console.log(
        "Preflight passed: clientguard_memberships does not exist in the target schema, so there are no existing memberships to conflict.",
      );
      await client.query("COMMIT");
      transactionOpen = false;
      process.exitCode = 0;
    } else {
      const { rows } = await client.query(`
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
        FROM clientguard_memberships AS membership
        LEFT JOIN clientguard_workspaces AS workspace
          ON workspace.id = membership.workspace_id
        GROUP BY membership.clerk_user_id
        HAVING COUNT(*) > 1
        ORDER BY membership.clerk_user_id
      `);

      await client.query("COMMIT");
      transactionOpen = false;

      if (rows.length === 0) {
        console.log(
          "Preflight passed: no duplicate Clerk identities are present in clientguard_memberships.",
        );
        process.exitCode = 0;
      } else {
        console.error(
          `Preflight blocked: ${rows.length} Clerk identity group(s) have duplicate membership rows. No schema changes were attempted.`,
        );
        for (const conflict of rows) {
          console.error(
            `- Clerk user ${conflict.clerk_user_id}: ${conflict.membership_count} memberships across ${conflict.firm_count} firm(s)`,
          );
          for (const firm of conflict.firms) {
            console.error(
              `  - ${firm.workspaceName} (workspace ${firm.workspaceId}, membership ${firm.membershipId}, role ${firm.role})`,
            );
          }
        }
        console.error(
          "Resolve each identity with the affected firm administrators, then rerun this check. Memberships were not moved or deleted.",
        );
        process.exitCode = 1;
      }
    }
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original preflight failure.
      }
    }
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "unknown";
    console.error(
      `Membership preflight could not complete (database error ${code}). No schema changes were attempted.`,
    );
    process.exitCode = 2;
  } finally {
    await client.end();
  }
}
