import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import express, { type Request } from "express";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import type { Server } from "node:http";

const originalDatabaseUrl = process.env.DATABASE_URL;
const schemaName = `clientguard_trust_${randomUUID().replaceAll("-", "")}`;
const users = {
  owner: `trust-owner-${randomUUID()}`,
  approver: `trust-approver-${randomUUID()}`,
  concurrentApprover: `trust-concurrent-${randomUUID()}`,
  otherFirmOwner: `trust-other-owner-${randomUUID()}`,
  auditFailure: "trust-audit-failure-user",
};
let bootstrapPool: Pool | undefined;
let appPool: Pool | undefined;
let schemaCreated = false;
let server: Server | undefined;
let baseUrl = "";
let db: typeof import("@workspace/db").db;
let workspacesTable: typeof import("@workspace/db").workspacesTable;
let membershipsTable: typeof import("@workspace/db").membershipsTable;
let clientsTable: typeof import("@workspace/db").clientsTable;
let mattersTable: typeof import("@workspace/db").mattersTable;
let trustAccountsTable: typeof import("@workspace/db").trustAccountsTable;
let trustLedgerEntriesTable: typeof import("@workspace/db").trustLedgerEntriesTable;
let trustStatementsTable: typeof import("@workspace/db").trustStatementsTable;
let trustStatementLinesTable: typeof import("@workspace/db").trustStatementLinesTable;
let primaryWorkspaceId = 0;
let otherWorkspaceId = 0;
let accountId = 0;
let matterId = 0;
let otherMatterId = 0;
let otherAccountId = 0;
let otherMatterForeignEntryId = 0;
let exportOnlyOtherMatterEntryId = 0;

async function request(
  path: string,
  userId: string,
  init: { method?: string; body?: unknown } = {},
) {
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "x-test-user": userId,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

async function insertApprovedEntry(input: {
  workspaceId: number;
  accountId: number;
  matterId: number;
  entryType: "deposit" | "disbursement";
  amountCents: number;
  entryDate: string;
  description: string;
  creator?: string;
}) {
  const [entry] = await db.insert(trustLedgerEntriesTable).values({
    workspaceId: input.workspaceId,
    accountId: input.accountId,
    matterId: input.matterId,
    entryType: input.entryType,
    amountCents: input.amountCents,
    entryDate: input.entryDate,
    description: input.description,
    status: "approved",
    createdByClerkUserId: input.creator ?? users.owner,
    approvedByClerkUserId: users.approver,
    approvedAt: new Date("2026-01-01T12:00:00Z"),
  }).returning();
  return entry;
}

before(async () => {
  if (!originalDatabaseUrl) {
    throw new Error("DATABASE_URL is required to run trust-ledger API tests.");
  }
  bootstrapPool = new Pool({ connectionString: originalDatabaseUrl });
  await bootstrapPool.query(`CREATE SCHEMA "${schemaName}"`);
  schemaCreated = true;
  await bootstrapPool.query(`
    CREATE TABLE "${schemaName}".clientguard_workspaces (
      id serial PRIMARY KEY,
      name text NOT NULL,
      practice_type text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_memberships (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      clerk_user_id text NOT NULL,
      email text NOT NULL DEFAULT '',
      display_name text NOT NULL DEFAULT 'Firm user',
      role text NOT NULL DEFAULT 'professional',
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (clerk_user_id)
    );
    CREATE TABLE "${schemaName}".clientguard_clients (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      name text NOT NULL,
      client_type text NOT NULL DEFAULT 'individual',
      email text,
      phone text,
      industry text,
      status text NOT NULL DEFAULT 'prospect',
      owner text NOT NULL DEFAULT 'Firm user',
      owner_member_id integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_matters (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      client_id integer NOT NULL REFERENCES "${schemaName}".clientguard_clients(id) ON DELETE CASCADE,
      title text NOT NULL,
      reference text NOT NULL DEFAULT '',
      matter_type text NOT NULL DEFAULT 'general',
      status text NOT NULL DEFAULT 'open',
      risk_level text NOT NULL DEFAULT 'medium',
      responsible text NOT NULL DEFAULT 'Firm user',
      responsible_member_id integer,
      due_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_practice_settings (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL UNIQUE REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      supported_jurisdictions text[] NOT NULL DEFAULT '{}'
    );
    CREATE TABLE "${schemaName}".clientguard_trust_accounts (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      name text NOT NULL,
      jurisdiction text NOT NULL,
      currency text NOT NULL,
      account_reference text,
      require_second_approval boolean NOT NULL DEFAULT true,
      active boolean NOT NULL DEFAULT true,
      created_by_clerk_user_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_trust_ledger_entries (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      account_id integer NOT NULL REFERENCES "${schemaName}".clientguard_trust_accounts(id) ON DELETE RESTRICT,
      matter_id integer NOT NULL REFERENCES "${schemaName}".clientguard_matters(id) ON DELETE RESTRICT,
      entry_type text NOT NULL,
      amount_cents bigint NOT NULL,
      entry_date date NOT NULL,
      description text NOT NULL,
      reference text,
      status text NOT NULL DEFAULT 'pending_approval',
      created_by_clerk_user_id text NOT NULL,
      approved_by_clerk_user_id text,
      approved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_trust_statements (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      account_id integer NOT NULL REFERENCES "${schemaName}".clientguard_trust_accounts(id) ON DELETE RESTRICT,
      source_type text NOT NULL,
      source_name text NOT NULL,
      period_start date NOT NULL,
      period_end date NOT NULL,
      opening_balance_cents bigint NOT NULL,
      closing_balance_cents bigint NOT NULL,
      status text NOT NULL DEFAULT 'open',
      imported_by_clerk_user_id text NOT NULL,
      reconciled_by_clerk_user_id text,
      reconciled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_trust_statement_lines (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      statement_id integer NOT NULL REFERENCES "${schemaName}".clientguard_trust_statements(id) ON DELETE CASCADE,
      line_date date NOT NULL,
      description text NOT NULL,
      reference text,
      amount_cents bigint NOT NULL,
      matched_entry_id integer REFERENCES "${schemaName}".clientguard_trust_ledger_entries(id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'unmatched',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX clientguard_trust_statement_line_entry_unique
      ON "${schemaName}".clientguard_trust_statement_lines (matched_entry_id);
    CREATE TABLE "${schemaName}".clientguard_audit_events (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      clerk_user_id text NOT NULL,
      actor text NOT NULL,
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id integer,
      entity_label text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}',
      occurred_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION "${schemaName}".reject_trust_audit_for_test_user()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.clerk_user_id = '${users.auditFailure}' AND left(NEW.action, 6) = 'trust_' THEN
          RAISE EXCEPTION 'simulated trust audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    CREATE TRIGGER reject_trust_audit_for_test_user
      BEFORE INSERT ON "${schemaName}".clientguard_audit_events
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_trust_audit_for_test_user();
  `);

  const isolatedUrl = new URL(originalDatabaseUrl);
  isolatedUrl.searchParams.set("options", `-c search_path=${schemaName}`);
  process.env.DATABASE_URL = isolatedUrl.toString();
  const database = await import("@workspace/db");
  ({
    db,
    pool: appPool,
    workspacesTable,
    membershipsTable,
    clientsTable,
    mattersTable,
    trustAccountsTable,
    trustLedgerEntriesTable,
    trustStatementsTable,
    trustStatementLinesTable,
  } = database);

  const [primary] = await db.insert(workspacesTable).values({
    name: `Trust test firm ${randomUUID()}`,
    practiceType: "law",
  }).returning();
  primaryWorkspaceId = primary.id;
  const [other] = await db.insert(workspacesTable).values({
    name: `Other trust test firm ${randomUUID()}`,
    practiceType: "financial",
  }).returning();
  otherWorkspaceId = other.id;
  await db.insert(membershipsTable).values([
    { workspaceId: primary.id, clerkUserId: users.owner, role: "owner", displayName: "Trust Owner" },
    { workspaceId: primary.id, clerkUserId: users.approver, role: "admin", displayName: "Approver" },
    { workspaceId: primary.id, clerkUserId: users.concurrentApprover, role: "admin", displayName: "Concurrent Approver" },
    { workspaceId: primary.id, clerkUserId: users.auditFailure, role: "admin", displayName: "Audit Failure User" },
    { workspaceId: other.id, clerkUserId: users.otherFirmOwner, role: "owner", displayName: "Other Firm Owner" },
  ]);

  const [client] = await db.insert(clientsTable).values({
    workspaceId: primary.id,
    name: "Matter Client",
    owner: "Trust Owner",
  }).returning();
  const [matter] = await db.insert(mattersTable).values({
    workspaceId: primary.id,
    clientId: client.id,
    title: "Primary client matter",
    reference: "TRUST-1",
    matterType: "general",
    responsible: "Trust Owner",
  }).returning();
  const [primaryOtherMatter] = await db.insert(mattersTable).values({
    workspaceId: primary.id,
    clientId: client.id,
    title: "Different client matter",
    reference: "TRUST-2",
    matterType: "general",
    responsible: "Trust Owner",
  }).returning();
  matterId = matter.id;
  otherMatterId = primaryOtherMatter.id;

  const [account] = await db.insert(trustAccountsTable).values({
    workspaceId: primary.id,
    name: "Client Trust",
    jurisdiction: "Australia",
    currency: "AUD",
    requireSecondApproval: true,
    createdByClerkUserId: users.owner,
  }).returning();
  accountId = account.id;
  const [otherAccount] = await db.insert(trustAccountsTable).values({
    workspaceId: other.id,
    name: "Other Firm Trust",
    jurisdiction: "USA",
    currency: "USD",
    createdByClerkUserId: users.otherFirmOwner,
  }).returning();
  otherAccountId = otherAccount.id;
  const [otherClient] = await db.insert(clientsTable).values({
    workspaceId: other.id,
    name: "Other Firm Client",
    owner: "Other Firm Owner",
  }).returning();
  const [foreignMatter] = await db.insert(mattersTable).values({
    workspaceId: other.id,
    clientId: otherClient.id,
    title: "Other firm matter",
    reference: "OTHER-1",
    matterType: "general",
    responsible: "Other Firm Owner",
  }).returning();
  const foreignEntry = await insertApprovedEntry({
    workspaceId: other.id,
    accountId: otherAccount.id,
    matterId: foreignMatter.id,
    entryType: "deposit",
    amountCents: 12345,
    entryDate: "2026-01-10",
    description: "Foreign trust deposit",
    creator: users.otherFirmOwner,
  });
  otherMatterForeignEntryId = foreignEntry.id;

  await insertApprovedEntry({
    workspaceId: primary.id,
    accountId: account.id,
    matterId: matter.id,
    entryType: "deposit",
    amountCents: 10000,
    entryDate: "2025-12-15",
    description: "Opening deposit",
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user") ?? "";
    const authHandler = Object.assign(
      () => ({
        tokenType: "session_token",
        userId,
        sessionClaims: { sub: userId, email: `${userId}@example.test`, name: "Trust Test User" },
      }),
      { [Symbol.for("@clerk/express.auth")]: true },
    );
    (req as Request & { auth: typeof authHandler }).auth = authHandler;
    next();
  });
  const { default: router } = await import("../src/routes/clientguard-trust.ts");
  const { apiErrorHandler } = await import("../src/middlewares/apiErrorHandler.ts");
  app.use("/api", router);
  app.use(apiErrorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server?.once("listening", resolve);
    server?.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  }
  if (appPool) await appPool.end();
  if (bootstrapPool) {
    if (schemaCreated) await bootstrapPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await bootstrapPool.end();
  }
  if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
});

test("trust routes isolate firms and require a different approver; approval retries apply once", async () => {
  const foreignExport = await request(
    `/trust/statement?accountId=${otherAccountId}&matterId=1&from=2026-01-01&to=2026-01-31`,
    users.owner,
  );
  assert.equal(foreignExport.status, 404);
  const foreignDecision = await request(
    `/trust/entries/${otherMatterForeignEntryId}/decision`,
    users.owner,
    { method: "PATCH", body: { decision: "approve", note: "Must not cross firms" } },
  );
  assert.equal(foreignDecision.status, 404);
  const foreignEntry = await request("/trust/entries", users.owner, {
    method: "POST",
    body: {
      accountId: otherAccountId,
      matterId: matterId,
      entryType: "deposit",
      amountCents: 1000,
      entryDate: "2026-01-10",
      description: "Invalid cross-firm entry",
    },
  });
  assert.equal(foreignEntry.status, 404);

  const createdResponse = await request("/trust/entries", users.owner, {
    method: "POST",
    body: {
      accountId,
      matterId,
      entryType: "deposit",
      amountCents: 20000,
      entryDate: "2026-01-10",
      description: "Approved January deposit",
      reference: "JAN-DEP",
    },
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { id: number; status: string };
  assert.equal(created.status, "pending_approval");

  const selfApproval = await request(`/trust/entries/${created.id}/decision`, users.owner, {
    method: "PATCH",
    body: { decision: "approve", note: "Second-person approval required" },
  });
  assert.equal(selfApproval.status, 409);
  const approvedResponse = await request(`/trust/entries/${created.id}/decision`, users.approver, {
    method: "PATCH",
    body: { decision: "approve", note: "Reviewed against supporting record" },
  });
  assert.equal(approvedResponse.status, 200);
  const approved = await approvedResponse.json() as { status: string };
  assert.equal(approved.status, "approved");

  const retryResponses = await Promise.all([
    request(`/trust/entries/${created.id}/decision`, users.approver, {
      method: "PATCH",
      body: { decision: "approve", note: "Retry one" },
    }),
    request(`/trust/entries/${created.id}/decision`, users.concurrentApprover, {
      method: "PATCH",
      body: { decision: "approve", note: "Concurrent stale decision" },
    }),
  ]);
  assert.ok(retryResponses.every((response) => response.status === 409));

  const concurrentEntryResponse = await request("/trust/entries", users.owner, {
    method: "POST",
    body: {
      accountId,
      matterId,
      entryType: "deposit",
      amountCents: 5000,
      entryDate: "2026-01-12",
      description: "Concurrent approval deposit",
    },
  });
  assert.equal(concurrentEntryResponse.status, 201);
  const concurrentEntry = await concurrentEntryResponse.json() as { id: number };
  const decisions = await Promise.all([
    request(`/trust/entries/${concurrentEntry.id}/decision`, users.approver, {
      method: "PATCH",
      body: { decision: "approve", note: "Approved by first reviewer" },
    }),
    request(`/trust/entries/${concurrentEntry.id}/decision`, users.concurrentApprover, {
      method: "PATCH",
      body: { decision: "approve", note: "Stale concurrent reviewer" },
    }),
  ]);
  assert.deepEqual(decisions.map((response) => response.status).sort(), [200, 409]);

  const overview = await request("/trust/overview", users.owner);
  assert.equal(overview.status, 200);
  const overviewBody = await overview.json() as {
    accounts: Array<{ id: number; balanceCents: number }>;
  };
  assert.equal(overviewBody.accounts.find((account) => account.id === accountId)?.balanceCents, 35000);
});

test("CSV statement lines reconcile against signed approved entries and matter exports exclude unrelated records", async () => {
  const disbursement = await insertApprovedEntry({
    workspaceId: primaryWorkspaceId,
    accountId,
    matterId,
    entryType: "disbursement",
    amountCents: 2500,
    entryDate: "2026-01-15",
    description: "January filing disbursement",
  });
  const futureMatterEntry = await insertApprovedEntry({
    workspaceId: primaryWorkspaceId,
    accountId,
    matterId: otherMatterId,
    entryType: "deposit",
    amountCents: 900,
    entryDate: "2026-02-05",
    description: "Other matter deposit",
  });
  exportOnlyOtherMatterEntryId = futureMatterEntry.id;
  const februaryTargetEntry = await insertApprovedEntry({
    workspaceId: primaryWorkspaceId,
    accountId,
    matterId,
    entryType: "deposit",
    amountCents: 800,
    entryDate: "2026-02-06",
    description: "February client deposit",
  });
  await db.insert(trustLedgerEntriesTable).values({
    workspaceId: primaryWorkspaceId,
    accountId,
    matterId,
    entryType: "deposit",
    amountCents: 700,
    entryDate: "2026-02-07",
    description: "Pending February deposit",
    status: "pending_approval",
    createdByClerkUserId: users.owner,
  });
  await db.insert(trustLedgerEntriesTable).values({
    workspaceId: primaryWorkspaceId,
    accountId,
    matterId,
    entryType: "deposit",
    amountCents: 600,
    entryDate: "2026-02-08",
    description: "Rejected February deposit",
    status: "rejected",
    createdByClerkUserId: users.owner,
    approvedByClerkUserId: users.approver,
    approvedAt: new Date("2026-02-09T00:00:00Z"),
  });

  const statementResponse = await request("/trust/statements", users.owner, {
    method: "POST",
    body: {
      accountId,
      sourceType: "csv",
      sourceName: "January trust statement.csv",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      openingBalanceCents: 10000,
      closingBalanceCents: 32500,
      lines: [
        { lineDate: "2026-01-10", description: "Approved January deposit", reference: "JAN-DEP", amountCents: 20000 },
        { lineDate: "2026-01-12", description: "Concurrent approval deposit", amountCents: 5000 },
        { lineDate: "2026-01-15", description: "January filing disbursement", amountCents: -2500 },
      ],
    },
  });
  assert.equal(statementResponse.status, 201);
  const statement = await statementResponse.json() as {
    id: number;
    movementDifferenceCents: number;
    openingBalanceCents: number;
    closingBalanceCents: number;
    lines: Array<{ id: number; amountCents: number }>;
  };
  assert.equal(statement.openingBalanceCents, 10000);
  assert.equal(statement.closingBalanceCents, 32500);
  assert.equal(statement.movementDifferenceCents, 0);
  assert.equal(statement.lines.length, 3);

  const approvedJanuaryDeposit = await db.select({ id: trustLedgerEntriesTable.id })
    .from(trustLedgerEntriesTable)
    .where(and(
      eq(trustLedgerEntriesTable.workspaceId, primaryWorkspaceId),
      eq(trustLedgerEntriesTable.accountId, accountId),
      eq(trustLedgerEntriesTable.description, "Approved January deposit"),
    ));
  const approvedConcurrentDeposit = await db.select({ id: trustLedgerEntriesTable.id })
    .from(trustLedgerEntriesTable)
    .where(and(
      eq(trustLedgerEntriesTable.workspaceId, primaryWorkspaceId),
      eq(trustLedgerEntriesTable.accountId, accountId),
      eq(trustLedgerEntriesTable.description, "Concurrent approval deposit"),
      eq(trustLedgerEntriesTable.status, "approved"),
    ));
  const matchPairs = [
    [statement.lines[0]!.id, approvedJanuaryDeposit[0]!.id],
    [statement.lines[1]!.id, approvedConcurrentDeposit[0]!.id],
    [statement.lines[2]!.id, disbursement.id],
  ];
  for (const [lineId, matchedEntryId] of matchPairs) {
    const matchedResponse = await request(
      `/trust/statements/${statement.id}/lines/${lineId}`,
      users.owner,
      { method: "PATCH", body: { matchedEntryId } },
    );
    assert.equal(matchedResponse.status, 200);
    const matchedBody = await matchedResponse.json() as {
      id: number;
      status: string;
      matchedLines: number;
      movementDifferenceCents: number;
    };
    assert.equal(matchedBody.id, statement.id);
    assert.equal(matchedBody.movementDifferenceCents, 0);
    if (lineId === matchPairs.at(-1)![0]) {
      assert.equal(matchedBody.status, "reconciled");
      assert.equal(matchedBody.matchedLines, 3);
    }
  }
  const duplicateMatch = await request(
    `/trust/statements/${statement.id}/lines/${statement.lines[0]!.id}`,
    users.owner,
    { method: "PATCH", body: { matchedEntryId: approvedJanuaryDeposit[0]!.id } },
  );
  assert.equal(duplicateMatch.status, 409);

  const exportResponse = await request(
    "/trust/statement?accountId=" + accountId + "&matterId=" + matterId + "&from=2026-02-01&to=2026-02-28",
    users.owner,
  );
  assert.equal(exportResponse.status, 200);
  const exported = await exportResponse.json() as {
    openingBalanceCents: number;
    closingBalanceCents: number;
    entries: Array<{ id: number; amountCents: number; balanceCents: number }>;
  };
  assert.equal(exported.openingBalanceCents, 32500);
  assert.equal(exported.closingBalanceCents, 33300);
  assert.deepEqual(exported.entries.map((entry) => entry.id), [februaryTargetEntry.id]);
  assert.ok(!exported.entries.some((entry) => entry.id === exportOnlyOtherMatterEntryId));
});

test("trust changes roll back when their audit record cannot be saved", async () => {
  const entryResponse = await request("/trust/entries", users.auditFailure, {
    method: "POST",
    body: {
      accountId,
      matterId,
      entryType: "deposit",
      amountCents: 1200,
      entryDate: "2026-03-01",
      description: "Must roll back when audit fails",
    },
  });
  assert.equal(entryResponse.status, 500);
  const failedEntry = await db.select({ id: trustLedgerEntriesTable.id })
    .from(trustLedgerEntriesTable)
    .where(eq(trustLedgerEntriesTable.description, "Must roll back when audit fails"));
  assert.equal(failedEntry.length, 0);

  const [pendingEntry] = await db.insert(trustLedgerEntriesTable).values({
    workspaceId: primaryWorkspaceId,
    accountId,
    matterId,
    entryType: "deposit",
    amountCents: 1300,
    entryDate: "2026-03-02",
    description: "Approval must remain pending after audit failure",
    status: "pending_approval",
    createdByClerkUserId: users.owner,
  }).returning();
  const failedApproval = await request(`/trust/entries/${pendingEntry.id}/decision`, users.auditFailure, {
    method: "PATCH",
    body: { decision: "approve", note: "Audit failure must block approval" },
  });
  assert.equal(failedApproval.status, 500);
  const [storedEntry] = await db.select().from(trustLedgerEntriesTable)
    .where(eq(trustLedgerEntriesTable.id, pendingEntry.id));
  assert.equal(storedEntry.status, "pending_approval");
  assert.equal(storedEntry.approvedAt, null);

  const beforeFailedImport = await db.select({ id: trustStatementsTable.id })
    .from(trustStatementsTable)
    .where(eq(trustStatementsTable.workspaceId, primaryWorkspaceId));
  const importResponse = await request("/trust/statements", users.auditFailure, {
    method: "POST",
    body: {
      accountId,
      sourceType: "csv",
      sourceName: "Must not persist",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      openingBalanceCents: 0,
      closingBalanceCents: 100,
      lines: [{ lineDate: "2026-03-10", description: "Unposted statement line", amountCents: 100 }],
    },
  });
  assert.equal(importResponse.status, 500);
  const afterFailedImport = await db.select({ id: trustStatementsTable.id })
    .from(trustStatementsTable)
    .where(eq(trustStatementsTable.workspaceId, primaryWorkspaceId));
  assert.equal(afterFailedImport.length, beforeFailedImport.length);

  const [newStatement] = await db.insert(trustStatementsTable).values({
    workspaceId: primaryWorkspaceId,
    accountId,
    sourceType: "csv",
    sourceName: "Audit rollback match statement",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    openingBalanceCents: 0,
    closingBalanceCents: 1000,
    importedByClerkUserId: users.owner,
  }).returning();
  const [line] = await db.insert(trustStatementLinesTable).values({
    workspaceId: primaryWorkspaceId,
    statementId: newStatement.id,
    lineDate: "2026-03-10",
    description: "Deposit on statement",
    amountCents: 1000,
  }).returning();
  const [entry] = await db.insert(trustLedgerEntriesTable).values({
    workspaceId: primaryWorkspaceId,
    accountId,
    matterId,
    entryType: "deposit",
    amountCents: 1000,
    entryDate: "2026-03-10",
    description: "Approved entry for audit failure",
    status: "approved",
    createdByClerkUserId: users.owner,
    approvedByClerkUserId: users.approver,
    approvedAt: new Date("2026-03-11T00:00:00Z"),
  }).returning();
  const matchResponse = await request(
    `/trust/statements/${newStatement.id}/lines/${line.id}`,
    users.auditFailure,
    { method: "PATCH", body: { matchedEntryId: entry.id } },
  );
  assert.equal(matchResponse.status, 500);
  const [storedLine] = await db.select().from(trustStatementLinesTable)
    .where(eq(trustStatementLinesTable.id, line.id));
  assert.equal(storedLine.status, "unmatched");
  assert.equal(storedLine.matchedEntryId, null);
});
