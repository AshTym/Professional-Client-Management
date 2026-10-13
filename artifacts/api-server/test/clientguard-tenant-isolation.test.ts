import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import express, { type Request } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { Readable } from "node:stream";
import type { Server } from "node:http";
import { clerkClient } from "@clerk/express";

const originalDatabaseUrl = process.env.DATABASE_URL;
const schemaName = `clientguard_test_${randomUUID().replaceAll("-", "")}`;
const firms = {
  primary: {
    ownerId: `owner-${randomUUID()}`,
    workspaceId: 0,
    clientId: 0,
    matterId: 0,
    activityId: 0,
  },
  other: {
    ownerId: `owner-${randomUUID()}`,
    workspaceId: 0,
    clientId: 0,
    matterId: 0,
    activityId: 0,
  },
};
const emptyDashboardUserId = `empty-dashboard-${randomUUID()}`;

let bootstrapPool: Pool | undefined;
let appPool: Pool | undefined;
let schemaCreated = false;
let server: Server | undefined;
let baseUrl = "";
let db: typeof import("@workspace/db").db;
let workspacesTable: typeof import("@workspace/db").workspacesTable;
let membershipsTable: typeof import("@workspace/db").membershipsTable;
let invitationsTable: typeof import("@workspace/db").invitationsTable;
let clientsTable: typeof import("@workspace/db").clientsTable;
let mattersTable: typeof import("@workspace/db").mattersTable;
let intakesTable: typeof import("@workspace/db").intakesTable;
let intakeDraftsTable: typeof import("@workspace/db").intakeDraftsTable;
let activitiesTable: typeof import("@workspace/db").activitiesTable;
let portalAccessTable: typeof import("@workspace/db").portalAccessTable;
let portalMessagesTable: typeof import("@workspace/db").portalMessagesTable;
let portalRequestsTable: typeof import("@workspace/db").portalRequestsTable;
let documentsTable: typeof import("@workspace/db").documentsTable;
let auditEventsTable: typeof import("@workspace/db").auditEventsTable;
let ObjectStorageServiceClass: typeof import("../src/lib/objectStorage.ts").ObjectStorageService;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

before(async () => {
  if (!originalDatabaseUrl) {
    throw new Error(
      "DATABASE_URL is required to run API tenant-isolation tests.",
    );
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
      display_name text NOT NULL DEFAULT 'User',
      role text NOT NULL DEFAULT 'professional',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX clientguard_membership_user_unique
      ON "${schemaName}".clientguard_memberships (clerk_user_id);
    CREATE TABLE "${schemaName}".clientguard_invitations (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      email text NOT NULL,
      role text NOT NULL,
      invited_by_clerk_user_id text NOT NULL,
      clerk_invitation_id text,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      accepted_at timestamptz,
      accepted_by_clerk_user_id text,
      revoked_at timestamptz,
      provider_revocation_failed boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
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
      owner text NOT NULL,
      owner_member_id integer REFERENCES "${schemaName}".clientguard_memberships(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_matters (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      client_id integer NOT NULL REFERENCES "${schemaName}".clientguard_clients(id) ON DELETE CASCADE,
      title text NOT NULL,
      reference text NOT NULL,
      matter_type text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      risk_level text NOT NULL DEFAULT 'medium',
      responsible text NOT NULL,
      responsible_member_id integer REFERENCES "${schemaName}".clientguard_memberships(id) ON DELETE SET NULL,
      due_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_activities (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      clerk_user_id text NOT NULL,
      actor text NOT NULL,
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id integer NOT NULL,
      entity_label text NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_billing_profiles (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL,
      matter_id integer NOT NULL,
      fee_type text NOT NULL DEFAULT 'hourly',
      currency text NOT NULL DEFAULT 'AUD',
      hourly_rate_cents integer,
      fixed_fee_cents integer,
      fee_description text NOT NULL DEFAULT 'Professional services',
      billing_cycle text NOT NULL DEFAULT 'monthly',
      tax_rate_bps integer NOT NULL DEFAULT 0,
      schedule_enabled boolean NOT NULL DEFAULT false,
      period_start_at timestamptz NOT NULL DEFAULT now(),
      next_draft_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, matter_id)
    );
    CREATE TABLE "${schemaName}".clientguard_billing_drafts (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL,
      matter_id integer NOT NULL,
      period_start_at timestamptz NOT NULL,
      period_end_at timestamptz NOT NULL,
      currency text NOT NULL,
      subtotal_cents integer NOT NULL,
      tax_cents integer NOT NULL,
      total_cents integer NOT NULL,
      narrative text NOT NULL,
      line_items jsonb NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      generated_at timestamptz NOT NULL DEFAULT now(),
      reviewed_at timestamptz,
      UNIQUE (workspace_id, matter_id, period_start_at, period_end_at)
    );
    CREATE TABLE "${schemaName}".clientguard_time_entries (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL,
      matter_id integer NOT NULL,
      clerk_user_id text NOT NULL,
      description text NOT NULL,
      work_date date NOT NULL,
      duration_minutes integer NOT NULL,
      billable boolean NOT NULL DEFAULT true,
      billing_draft_id integer,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_documents (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL,
      matter_id integer NOT NULL,
      uploaded_by_clerk_user_id text NOT NULL,
      object_path text NOT NULL,
      original_name text NOT NULL,
      content_type text NOT NULL,
      size_bytes integer NOT NULL,
      status text NOT NULL DEFAULT 'uploading',
      client_visible boolean NOT NULL DEFAULT false,
      uploaded_from_portal boolean NOT NULL DEFAULT false,
      last_analysis_error text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_document_suggestions (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL,
      document_id integer NOT NULL,
      matter_id integer NOT NULL,
      kind text NOT NULL,
      title text NOT NULL,
      details text NOT NULL DEFAULT '',
      due_at timestamptz,
      source_page integer NOT NULL,
      source_quote text NOT NULL,
      confidence real NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_planner_items (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL,
      matter_id integer NOT NULL,
      document_id integer NOT NULL,
      kind text NOT NULL,
      title text NOT NULL,
      details text NOT NULL DEFAULT '',
      due_at timestamptz,
      source_page integer NOT NULL,
      source_quote text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      confirmed_by_clerk_user_id text NOT NULL,
      confirmed_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_update_schedules (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL,
      matter_id integer NOT NULL,
      enabled boolean NOT NULL DEFAULT false,
      cadence text NOT NULL DEFAULT 'weekly',
      next_draft_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, matter_id)
    );
    CREATE TABLE "${schemaName}".clientguard_update_drafts (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL,
      matter_id integer NOT NULL,
      source_activity_ids integer[] NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      generated_by text NOT NULL DEFAULT 'user',
      generated_at timestamptz NOT NULL DEFAULT now(),
      reviewed_at timestamptz
    );
    CREATE TABLE "${schemaName}".clientguard_portal_updates (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL,
      client_id integer NOT NULL,
      matter_id integer NOT NULL,
      update_draft_id integer NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      published_by_clerk_user_id text NOT NULL,
      published_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_intake_settings (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL UNIQUE REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      checks jsonb NOT NULL DEFAULT '[]',
      updated_by_clerk_user_id text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_intake_drafts (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      data jsonb NOT NULL,
      created_by_clerk_user_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_intakes (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      client_id integer REFERENCES "${schemaName}".clientguard_clients(id) ON DELETE SET NULL,
      client_name text NOT NULL,
      client_type text NOT NULL DEFAULT 'individual',
      email text,
      phone text,
      industry text,
      matter_title text NOT NULL,
      matter_type text NOT NULL,
      responsible text NOT NULL,
      responsible_member_id integer REFERENCES "${schemaName}".clientguard_memberships(id) ON DELETE SET NULL,
      due_at timestamptz,
      party_names jsonb NOT NULL DEFAULT '[]',
      answers jsonb NOT NULL DEFAULT '{}',
      conflict_findings jsonb NOT NULL DEFAULT '[]',
      status text NOT NULL DEFAULT 'review_required',
      review_note text,
      reviewer_clerk_user_id text,
      opened_matter_id integer REFERENCES "${schemaName}".clientguard_matters(id) ON DELETE SET NULL,
      created_by_clerk_user_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
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
    CREATE TABLE "${schemaName}".clientguard_portal_access (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      client_id integer NOT NULL REFERENCES "${schemaName}".clientguard_clients(id) ON DELETE CASCADE,
      email text NOT NULL,
      clerk_user_id text,
      clerk_invitation_id text,
      status text NOT NULL DEFAULT 'invited',
      invited_by_clerk_user_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      activated_at timestamptz,
      revoked_at timestamptz
    );
    CREATE TABLE "${schemaName}".clientguard_portal_messages (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      client_id integer NOT NULL REFERENCES "${schemaName}".clientguard_clients(id) ON DELETE CASCADE,
      matter_id integer NOT NULL REFERENCES "${schemaName}".clientguard_matters(id) ON DELETE CASCADE,
      sender_clerk_user_id text NOT NULL,
      sender_type text NOT NULL,
      sender_name text NOT NULL,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_portal_requests (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      client_id integer NOT NULL REFERENCES "${schemaName}".clientguard_clients(id) ON DELETE CASCADE,
      matter_id integer NOT NULL REFERENCES "${schemaName}".clientguard_matters(id) ON DELETE CASCADE,
      title text NOT NULL,
      details text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      created_by_clerk_user_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      responded_at timestamptz,
      responded_by_clerk_user_id text,
      response_message_id integer REFERENCES "${schemaName}".clientguard_portal_messages(id) ON DELETE SET NULL,
      closed_at timestamptz,
      closed_by_clerk_user_id text
    );
  `);

  const isolatedUrl = new URL(originalDatabaseUrl);
  isolatedUrl.searchParams.set("options", `-c search_path=${schemaName}`);
  process.env.DATABASE_URL = isolatedUrl.toString();

  const database = await import("@workspace/db");
  ({ db, pool: appPool } = database);
  ({
    workspacesTable,
    membershipsTable,
    invitationsTable,
    clientsTable,
    mattersTable,
    intakesTable,
    intakeDraftsTable,
    activitiesTable,
    portalAccessTable,
    portalMessagesTable,
    portalRequestsTable,
    documentsTable,
    auditEventsTable,
  } = database);

  const [primaryWorkspace] = await db
    .insert(workspacesTable)
    .values({ name: `Primary ${randomUUID()}`, practiceType: "law" })
    .returning();
  const [otherWorkspace] = await db
    .insert(workspacesTable)
    .values({ name: `Other ${randomUUID()}`, practiceType: "law" })
    .returning();
  const [emptyDashboardWorkspace] = await db
    .insert(workspacesTable)
    .values({ name: `Empty Dashboard ${randomUUID()}`, practiceType: "law" })
    .returning();
  firms.primary.workspaceId = primaryWorkspace.id;
  firms.other.workspaceId = otherWorkspace.id;
  const readOnlyUserId = `viewer-${randomUUID()}`;
  const professionalUserId = `professional-${randomUUID()}`;

  await db.insert(membershipsTable).values([
    {
      workspaceId: primaryWorkspace.id,
      clerkUserId: firms.primary.ownerId,
      email: "owner-primary@example.test",
      displayName: "Primary Owner",
      role: "owner",
    },
    {
      workspaceId: primaryWorkspace.id,
      clerkUserId: readOnlyUserId,
      email: "viewer-primary@example.test",
      displayName: "Read Only User",
      role: "viewer",
    },
    {
      workspaceId: primaryWorkspace.id,
      clerkUserId: professionalUserId,
      email: "professional-primary@example.test",
      displayName: "Professional User",
      role: "professional",
    },
    {
      workspaceId: otherWorkspace.id,
      clerkUserId: firms.other.ownerId,
      email: "owner-other@example.test",
      displayName: "Other Firm Owner",
      role: "owner",
    },
    {
      workspaceId: emptyDashboardWorkspace.id,
      clerkUserId: emptyDashboardUserId,
      email: "empty-dashboard@example.test",
      displayName: "New Firm Owner",
      role: "owner",
    },
  ]);

  const [primaryClient] = await db
    .insert(clientsTable)
    .values({
      workspaceId: primaryWorkspace.id,
      name: `Primary Client ${randomUUID()}`,
      owner: "Primary Owner",
      status: "active",
    })
    .returning();
  const [otherClient] = await db
    .insert(clientsTable)
    .values({
      workspaceId: otherWorkspace.id,
      name: `Other Client ${randomUUID()}`,
      owner: "Other Firm Owner",
      status: "active",
    })
    .returning();
  firms.primary.clientId = primaryClient.id;
  firms.other.clientId = otherClient.id;

  const [primaryMatter] = await db
    .insert(mattersTable)
    .values({
      workspaceId: primaryWorkspace.id,
      clientId: primaryClient.id,
      title: `Primary Matter ${randomUUID()}`,
      reference: `PRIMARY-${randomUUID()}`,
      matterType: "advisory",
      responsible: "Primary Owner",
    })
    .returning();
  const [otherMatter] = await db
    .insert(mattersTable)
    .values({
      workspaceId: otherWorkspace.id,
      clientId: otherClient.id,
      title: `Other Matter ${randomUUID()}`,
      reference: `OTHER-${randomUUID()}`,
      matterType: "advisory",
      responsible: "Other Firm Owner",
    })
    .returning();
  firms.primary.matterId = primaryMatter.id;
  firms.other.matterId = otherMatter.id;

  const activities = await db
    .insert(activitiesTable)
    .values([
      {
        workspaceId: primaryWorkspace.id,
        clerkUserId: firms.primary.ownerId,
        actor: "Primary Owner",
        action: "primary-only activity",
        entityType: "client",
        entityId: primaryClient.id,
        entityLabel: primaryClient.name,
      },
      {
        workspaceId: otherWorkspace.id,
        clerkUserId: firms.other.ownerId,
        actor: "Other Firm Owner",
        action: "other-only activity",
        entityType: "client",
        entityId: otherClient.id,
        entityLabel: otherClient.name,
      },
    ])
    .returning();
  firms.primary.activityId = activities[0].id;
  firms.other.activityId = activities[1].id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user-id") || null;
    const authHandler = Object.assign(
      () => ({
        tokenType: "session_token",
        userId,
        sessionClaims: userId
          ? {
              sub: userId,
              email: `${userId}@example.test`,
              name: "Test User",
            }
          : null,
      }),
      { [Symbol.for("@clerk/express.auth")]: true },
    );
    (req as Request & { auth: typeof authHandler }).auth = authHandler;
    (
      req as Request & {
        log?: {
          error: (...args: unknown[]) => void;
          warn: (...args: unknown[]) => void;
        };
      }
    ).log = { error: () => {}, warn: () => {} };
    next();
  });
  const { default: router } = await import("../src/routes/clientguard.ts");
  const { default: workflowRouter } = await import(
    "../src/routes/clientguard-workflows.ts"
  );
  const { default: operationsRouter } = await import(
    "../src/routes/clientguard-operations.ts"
  );
  ({ ObjectStorageService: ObjectStorageServiceClass } = await import(
    "../src/lib/objectStorage.ts"
  ));
  app.use("/api", router);
  app.use("/api", workflowRouter);
  app.use("/api", operationsRouter);

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
    if (schemaCreated) {
      await bootstrapPool.query(
        `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
      );
    }
    await bootstrapPool.end();
  }
  if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
});

async function request(
  path: string,
  options: { userId?: string; method?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (options.userId) headers["x-test-user-id"] = options.userId;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return {
    response,
    body: response.status === 204 ? undefined : await response.json(),
  };
}

async function waitForBlockedMembershipQueries(expectedCount: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await bootstrapPool!.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%clientguard_memberships%'
    `);
    if (Number(result.rows[0]?.count ?? 0) >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Expected ${expectedCount} request(s) to wait for a teammate membership lock.`);
}

test("database rejects a second firm membership for the same signed-in identity", async () => {
  const [existingMembership] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId));

  assert.ok(existingMembership);
  await assert.rejects(
    db.insert(membershipsTable).values({
      workspaceId: firms.other.workspaceId,
      clerkUserId: firms.primary.ownerId,
      email: "duplicate-owner@example.test",
      displayName: "Duplicate Owner",
      role: "owner",
    }),
    (error: unknown) => {
      const databaseError = error as {
        code?: string;
        cause?: { code?: string };
      };
      assert.equal(
        databaseError.cause?.code ?? databaseError.code,
        "23505",
        "duplicate identity membership should fail with a unique-violation error",
      );
      return true;
    },
  );

  const memberships = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId));
  assert.deepEqual(memberships, [existingMembership]);
  assert.equal(existingMembership.workspaceId, firms.primary.workspaceId);
});

test("invalid workspace details leave no setup records and the owner can retry", async () => {
  const userId = `invalid-workspace-setup-${randomUUID()}`;
  const invalidWorkspaceName = "X";
  const validWorkspaceName = `Valid Workspace ${randomUUID()}`;

  const invalid = await request("/workspace", {
    userId,
    method: "POST",
    body: { name: invalidWorkspaceName, practiceType: "law" },
  });
  assert.equal(invalid.response.status, 400);

  const rejectedWorkspaces = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.name, invalidWorkspaceName));
  const rejectedMemberships = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, userId));
  const rejectedActivities = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.clerkUserId, userId));
  assert.equal(rejectedWorkspaces.length, 0);
  assert.equal(rejectedMemberships.length, 0);
  assert.equal(rejectedActivities.length, 0);

  const valid = await request("/workspace", {
    userId,
    method: "POST",
    body: { name: validWorkspaceName, practiceType: "law" },
  });
  assert.equal(valid.response.status, 201);

  const createdWorkspaces = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.name, validWorkspaceName));
  const ownerMemberships = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, userId));
  const setupActivities = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.clerkUserId, userId));
  assert.equal(createdWorkspaces.length, 1);
  assert.equal(ownerMemberships.length, 1);
  assert.equal(ownerMemberships[0].workspaceId, createdWorkspaces[0].id);
  assert.equal(ownerMemberships[0].role, "owner");
  assert.equal(setupActivities.length, 1);
  assert.equal(setupActivities[0].workspaceId, createdWorkspaces[0].id);
  assert.equal(setupActivities[0].action, "created the firm workspace");
});

test("concurrent workspace setup requests create one firm for the signed-in owner", async () => {
  const userId = `workspace-setup-${randomUUID()}`;
  const workspaceNames = Array.from(
    { length: 8 },
    (_, index) => `Concurrent Workspace ${index} ${randomUUID()}`,
  );
  const results = await Promise.all(
    workspaceNames.map((name) =>
      request("/workspace", {
        userId,
        method: "POST",
        body: { name, practiceType: "law" },
      }),
    ),
  );

  assert.deepEqual(
    results.map(({ response }) => response.status).sort(),
    [200, 200, 200, 200, 200, 200, 200, 201],
  );
  const workspaceIds = results.map(
    ({ body }) =>
      (body as { workspace: { id: number } }).workspace.id,
  );
  assert.equal(new Set(workspaceIds).size, 1);

  const createdWorkspaces = await db
    .select()
    .from(workspacesTable)
    .where(inArray(workspacesTable.name, workspaceNames));
  assert.equal(createdWorkspaces.length, 1);
  assert.equal(createdWorkspaces[0].id, workspaceIds[0]);

  const ownerMemberships = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, userId));
  assert.equal(ownerMemberships.length, 1);
  assert.equal(ownerMemberships[0].workspaceId, workspaceIds[0]);
  assert.equal(ownerMemberships[0].role, "owner");

  const setupActivities = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.clerkUserId, userId));
  assert.equal(setupActivities.length, 1);
  assert.equal(setupActivities[0].workspaceId, workspaceIds[0]);
  assert.equal(setupActivities[0].action, "created the firm workspace");
});

test("workspace setup returns a stable conflict when another writer adds the membership first", async () => {
  const userId = `workspace-setup-race-${randomUUID()}`;
  const attemptedWorkspaceName = `Losing Workspace ${randomUUID()}`;
  const competingWorkspaceName = `Winning Workspace ${randomUUID()}`;
  const functionName = `pause_workspace_setup_${randomUUID().replaceAll("-", "")}`;
  const triggerName = `pause_workspace_setup_${randomUUID().replaceAll("-", "")}`;
  const advisoryLockKey = 918273645;
  const lockClient = await bootstrapPool!.connect();
  let lockHeld = false;

  await lockClient.query("SELECT pg_advisory_lock($1, $2)", [advisoryLockKey, 0]);
  lockHeld = true;
  await bootstrapPool!.query(`
    CREATE FUNCTION "${schemaName}"."${functionName}"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.name = '${attemptedWorkspaceName}' THEN
        PERFORM pg_advisory_xact_lock(${advisoryLockKey}, 0);
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON "${schemaName}".clientguard_workspaces
    FOR EACH ROW
    EXECUTE FUNCTION "${schemaName}"."${functionName}"();
  `);

  try {
    const setupRequest = request("/workspace", {
      userId,
      method: "POST",
      body: { name: attemptedWorkspaceName, practiceType: "law" },
    });

    const deadline = Date.now() + 5_000;
    let requestBlockedOnWorkspaceInsert = false;
    while (Date.now() < deadline) {
      const result = await bootstrapPool!.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%clientguard_workspaces%'
      `);
      if (Number(result.rows[0]?.count ?? 0) > 0) {
        requestBlockedOnWorkspaceInsert = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(requestBlockedOnWorkspaceInsert, "workspace setup should reach the race window");

    const [competingWorkspace] = await db
      .insert(workspacesTable)
      .values({ name: competingWorkspaceName, practiceType: "law" })
      .returning();
    const [existingMembership] = await db
      .insert(membershipsTable)
      .values({
        workspaceId: competingWorkspace.id,
        clerkUserId: userId,
        email: "existing-owner@example.test",
        displayName: "Existing Firm Owner",
        role: "owner",
      })
      .returning();

    await lockClient.query("SELECT pg_advisory_unlock($1, $2)", [
      advisoryLockKey,
      0,
    ]);
    lockHeld = false;

    const result = await setupRequest;
    assert.equal(result.response.status, 409);
    assert.deepEqual(result.body, {
      error:
        "Your account joined a firm while setup was in progress. Refresh to continue.",
    });

    const losingWorkspaces = await db
      .select()
      .from(workspacesTable)
      .where(eq(workspacesTable.name, attemptedWorkspaceName));
    const memberships = await db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.clerkUserId, userId));
    const setupActivities = await db
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.clerkUserId, userId));

    assert.equal(losingWorkspaces.length, 0);
    assert.deepEqual(memberships, [existingMembership]);
    assert.equal(setupActivities.length, 0);
  } finally {
    if (lockHeld) {
      await lockClient.query("SELECT pg_advisory_unlock($1, $2)", [
        advisoryLockKey,
        0,
      ]);
    }
    lockClient.release();
    await bootstrapPool!.query(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "${schemaName}".clientguard_workspaces`,
    );
    await bootstrapPool!.query(
      `DROP FUNCTION IF EXISTS "${schemaName}"."${functionName}"()`,
    );
  }
});

test("failed workspace setup leaves no partial firm and can be retried", async () => {
  const userId = `workspace-setup-failure-${randomUUID()}`;
  const workspaceName = `Retryable Workspace ${randomUUID()}`;
  const functionName = `fail_workspace_setup_${randomUUID().replaceAll("-", "")}`;
  const triggerName = `fail_workspace_setup_${randomUUID().replaceAll("-", "")}`;

  await bootstrapPool!.query(`
    CREATE FUNCTION "${schemaName}"."${functionName}"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.clerk_user_id = '${userId}' THEN
        RAISE EXCEPTION 'Forced workspace setup activity failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON "${schemaName}".clientguard_activities
    FOR EACH ROW
    EXECUTE FUNCTION "${schemaName}"."${functionName}"();
  `);

  try {
    const failedResponse = await fetch(`${baseUrl}/workspace`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-user-id": userId,
      },
      body: JSON.stringify({ name: workspaceName, practiceType: "law" }),
    });
    assert.equal(failedResponse.status, 500);

    const failedWorkspaces = await db
      .select()
      .from(workspacesTable)
      .where(eq(workspacesTable.name, workspaceName));
    const failedMemberships = await db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.clerkUserId, userId));
    const failedActivities = await db
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.clerkUserId, userId));
    assert.equal(failedWorkspaces.length, 0);
    assert.equal(failedMemberships.length, 0);
    assert.equal(failedActivities.length, 0);

    await bootstrapPool!.query(
      `DROP TRIGGER "${triggerName}" ON "${schemaName}".clientguard_activities`,
    );
    await bootstrapPool!.query(
      `DROP FUNCTION "${schemaName}"."${functionName}"()`,
    );

    const retry = await request("/workspace", {
      userId,
      method: "POST",
      body: { name: workspaceName, practiceType: "law" },
    });
    assert.equal(retry.response.status, 201);

    const retriedWorkspaces = await db
      .select()
      .from(workspacesTable)
      .where(eq(workspacesTable.name, workspaceName));
    const retriedMemberships = await db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.clerkUserId, userId));
    const retriedActivities = await db
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.clerkUserId, userId));
    assert.equal(retriedWorkspaces.length, 1);
    assert.equal(retriedMemberships.length, 1);
    assert.equal(retriedMemberships[0].workspaceId, retriedWorkspaces[0].id);
    assert.equal(retriedMemberships[0].role, "owner");
    assert.equal(retriedActivities.length, 1);
    assert.equal(retriedActivities[0].workspaceId, retriedWorkspaces[0].id);
    assert.equal(retriedActivities[0].action, "created the firm workspace");
  } finally {
    await bootstrapPool!.query(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "${schemaName}".clientguard_activities`,
    );
    await bootstrapPool!.query(
      `DROP FUNCTION IF EXISTS "${schemaName}"."${functionName}"()`,
    );
  }
});

test("dashboard totals and recent activity include only the current firm's records", async () => {
  const now = Date.now();
  const overdueAt = new Date(now - 24 * 60 * 60 * 1000);
  const futureAt = new Date(now + 24 * 60 * 60 * 1000);
  const insertedClientIds: number[] = [];
  const insertedMatterIds: number[] = [];
  const insertedActivityIds: number[] = [];

  try {
    const [primaryActiveClient, primaryArchivedClient, otherProspectClient] =
      await db
        .insert(clientsTable)
        .values([
          {
            workspaceId: firms.primary.workspaceId,
            name: `Primary Dashboard Active ${randomUUID()}`,
            owner: "Primary Owner",
            status: "active",
          },
          {
            workspaceId: firms.primary.workspaceId,
            name: `Primary Dashboard Archived ${randomUUID()}`,
            owner: "Primary Owner",
            status: "archived",
          },
          {
            workspaceId: firms.other.workspaceId,
            name: `Other Dashboard Prospect ${randomUUID()}`,
            owner: "Other Firm Owner",
            status: "prospect",
          },
        ])
        .returning();
    insertedClientIds.push(
      primaryActiveClient.id,
      primaryArchivedClient.id,
      otherProspectClient.id,
    );

    const newMatters = await db
      .insert(mattersTable)
      .values([
        {
          workspaceId: firms.primary.workspaceId,
          clientId: primaryActiveClient.id,
          title: `Primary overdue matter ${randomUUID()}`,
          reference: `PRIMARY-OVERDUE-${randomUUID()}`,
          matterType: "advisory",
          status: "open",
          responsible: "Primary Owner",
          dueAt: overdueAt,
        },
        {
          workspaceId: firms.primary.workspaceId,
          clientId: primaryActiveClient.id,
          title: `Primary future matter ${randomUUID()}`,
          reference: `PRIMARY-FUTURE-${randomUUID()}`,
          matterType: "advisory",
          status: "open",
          responsible: "Primary Owner",
          dueAt: futureAt,
        },
        {
          workspaceId: firms.primary.workspaceId,
          clientId: primaryArchivedClient.id,
          title: `Primary closed matter ${randomUUID()}`,
          reference: `PRIMARY-CLOSED-${randomUUID()}`,
          matterType: "advisory",
          status: "closed",
          responsible: "Primary Owner",
          dueAt: overdueAt,
        },
        {
          workspaceId: firms.other.workspaceId,
          clientId: otherProspectClient.id,
          title: `Other overdue matter one ${randomUUID()}`,
          reference: `OTHER-OVERDUE-ONE-${randomUUID()}`,
          matterType: "advisory",
          status: "open",
          responsible: "Other Firm Owner",
          dueAt: overdueAt,
        },
        {
          workspaceId: firms.other.workspaceId,
          clientId: otherProspectClient.id,
          title: `Other overdue matter two ${randomUUID()}`,
          reference: `OTHER-OVERDUE-TWO-${randomUUID()}`,
          matterType: "advisory",
          status: "open",
          responsible: "Other Firm Owner",
          dueAt: overdueAt,
        },
        {
          workspaceId: firms.other.workspaceId,
          clientId: otherProspectClient.id,
          title: `Other closed matter ${randomUUID()}`,
          reference: `OTHER-CLOSED-${randomUUID()}`,
          matterType: "advisory",
          status: "closed",
          responsible: "Other Firm Owner",
          dueAt: overdueAt,
        },
      ])
      .returning({ id: mattersTable.id });
    insertedMatterIds.push(...newMatters.map(({ id }) => id));

    const newActivities = await db
      .insert(activitiesTable)
      .values([
        {
          workspaceId: firms.primary.workspaceId,
          clerkUserId: firms.primary.ownerId,
          actor: "Primary Owner",
          action: "primary dashboard event older",
          entityType: "client",
          entityId: primaryActiveClient.id,
          entityLabel: primaryActiveClient.name,
          occurredAt: new Date(now + 60_000),
        },
        {
          workspaceId: firms.primary.workspaceId,
          clerkUserId: firms.primary.ownerId,
          actor: "Primary Owner",
          action: "primary dashboard event newest",
          entityType: "matter",
          entityId: newMatters[0].id,
          entityLabel: "Primary dashboard matter",
          occurredAt: new Date(now + 120_000),
        },
        {
          workspaceId: firms.other.workspaceId,
          clerkUserId: firms.other.ownerId,
          actor: "Other Firm Owner",
          action: "other dashboard event oldest",
          entityType: "client",
          entityId: otherProspectClient.id,
          entityLabel: otherProspectClient.name,
          occurredAt: new Date(now + 180_000),
        },
        {
          workspaceId: firms.other.workspaceId,
          clerkUserId: firms.other.ownerId,
          actor: "Other Firm Owner",
          action: "other dashboard event newer",
          entityType: "matter",
          entityId: newMatters[3].id,
          entityLabel: "Other dashboard matter",
          occurredAt: new Date(now + 240_000),
        },
      ])
      .returning({ id: activitiesTable.id });
    insertedActivityIds.push(...newActivities.map(({ id }) => id));

    const primary = await request("/dashboard", {
      userId: firms.primary.ownerId,
    });
    assert.equal(primary.response.status, 200);
    assert.deepEqual(primary.body, {
      clientCount: 3,
      activeClientCount: 2,
      matterCount: 4,
      openMatterCount: 3,
      overdueMatterCount: 1,
      recentActivity: [
        {
          id: newActivities[1].id,
          actor: "Primary Owner",
          action: "primary dashboard event newest",
          entityType: "matter",
          entityId: newMatters[0].id,
          entityLabel: "Primary dashboard matter",
          occurredAt: new Date(now + 120_000).toISOString(),
        },
        {
          id: newActivities[0].id,
          actor: "Primary Owner",
          action: "primary dashboard event older",
          entityType: "client",
          entityId: primaryActiveClient.id,
          entityLabel: primaryActiveClient.name,
          occurredAt: new Date(now + 60_000).toISOString(),
        },
        {
          id: firms.primary.activityId,
          actor: "Primary Owner",
          action: "primary-only activity",
          entityType: "client",
          entityId: firms.primary.clientId,
          entityLabel: (await db
            .select({ name: clientsTable.name })
            .from(clientsTable)
            .where(eq(clientsTable.id, firms.primary.clientId))
            .limit(1))[0].name,
          occurredAt: (await db
            .select({ occurredAt: activitiesTable.occurredAt })
            .from(activitiesTable)
            .where(eq(activitiesTable.id, firms.primary.activityId))
            .limit(1))[0].occurredAt.toISOString(),
        },
      ],
    });

    const other = await request("/dashboard", { userId: firms.other.ownerId });
    assert.equal(other.response.status, 200);
    const otherDashboard = other.body as {
      clientCount: number;
      activeClientCount: number;
      matterCount: number;
      openMatterCount: number;
      overdueMatterCount: number;
      recentActivity: Array<{ action: string }>;
    };
    assert.equal(otherDashboard.clientCount, 2);
    assert.equal(otherDashboard.activeClientCount, 1);
    assert.equal(otherDashboard.matterCount, 4);
    assert.equal(otherDashboard.openMatterCount, 3);
    assert.equal(otherDashboard.overdueMatterCount, 2);
    assert.deepEqual(
      otherDashboard.recentActivity.map(({ action }) => action),
      [
        "other dashboard event newer",
        "other dashboard event oldest",
        "other-only activity",
      ],
    );
    assert(
      otherDashboard.recentActivity.every(({ action }) => !action.startsWith("primary")),
    );

    const noFirm = await request("/dashboard", {
      userId: `no-firm-${randomUUID()}`,
    });
    assert.equal(noFirm.response.status, 403);
    assert.deepEqual(noFirm.body, {
      error: "You do not have access to a firm workspace.",
      code: "firm_authorization_required",
    });
  } finally {
    if (insertedActivityIds.length) {
      await db
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, insertedActivityIds));
    }
    if (insertedMatterIds.length) {
      await db.delete(mattersTable).where(inArray(mattersTable.id, insertedMatterIds));
    }
    if (insertedClientIds.length) {
      await db.delete(clientsTable).where(inArray(clientsTable.id, insertedClientIds));
    }
  }
});

test("a new firm's dashboard starts with zero client and matter totals", async () => {
  const dashboard = await request("/dashboard", {
    userId: emptyDashboardUserId,
  });

  assert.equal(dashboard.response.status, 200);
  assert.deepEqual(dashboard.body, {
    clientCount: 0,
    activeClientCount: 0,
    matterCount: 0,
    openMatterCount: 0,
    overdueMatterCount: 0,
    recentActivity: [],
  });
});

test("dashboard returns only the six newest events for each firm in descending time order", async () => {
  const baseTime = Date.now() + 60 * 60 * 1000;
  const eventCount = 8;
  const insertedActivityIds: number[] = [];

  try {
    const events = await db
      .insert(activitiesTable)
      .values(
        (["primary", "other"] as const).flatMap((firmName) => {
          const firm = firms[firmName];
          return Array.from({ length: eventCount }, (_, index) => ({
            workspaceId: firm.workspaceId,
            clerkUserId: firm.ownerId,
            actor:
              firmName === "primary" ? "Primary Owner" : "Other Firm Owner",
            action: `${firmName} controlled dashboard event ${index}`,
            entityType: "client",
            entityId: firm.clientId,
            entityLabel: `${firmName} controlled dashboard client`,
            occurredAt: new Date(
              baseTime + index * 1_000 + (firmName === "other" ? 500 : 0),
            ),
          }));
        }),
      )
      .returning({ id: activitiesTable.id });
    insertedActivityIds.push(...events.map(({ id }) => id));

    for (const firmName of ["primary", "other"] as const) {
      const dashboard = await request("/dashboard", {
        userId: firms[firmName].ownerId,
      });
      assert.equal(dashboard.response.status, 200);

      const recentActivity = (
        dashboard.body as {
          recentActivity: Array<{ action: string; occurredAt: string }>;
        }
      ).recentActivity;
      assert.equal(recentActivity.length, 6);
      assert.deepEqual(
        recentActivity.map(({ action }) => action),
        Array.from(
          { length: 6 },
          (_, index) =>
            `${firmName} controlled dashboard event ${eventCount - index - 1}`,
        ),
      );
      assert.deepEqual(
        recentActivity.map(({ occurredAt }) => occurredAt),
        Array.from({ length: 6 }, (_, index) =>
          new Date(
            baseTime +
              (eventCount - index - 1) * 1_000 +
              (firmName === "other" ? 500 : 0),
          ).toISOString(),
        ),
      );
    }
  } finally {
    if (insertedActivityIds.length) {
      await db
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, insertedActivityIds));
    }
  }
});

test("dashboard orders equally timed events by id independently for each firm", async () => {
  const occurredAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const insertedActivityIds: number[] = [];

  try {
    const insertedEvents = await db
      .insert(activitiesTable)
      .values(
        (["primary", "other"] as const).flatMap((firmName) => {
          const firm = firms[firmName];
          return [0, 1].map((index) => ({
            workspaceId: firm.workspaceId,
            clerkUserId: firm.ownerId,
            actor:
              firmName === "primary" ? "Primary Owner" : "Other Firm Owner",
            action: `${firmName} tied dashboard event ${index}`,
            entityType: "client",
            entityId: firm.clientId,
            entityLabel: `${firmName} tied dashboard client`,
            occurredAt,
          }));
        }),
      )
      .returning({
        id: activitiesTable.id,
        workspaceId: activitiesTable.workspaceId,
      });
    insertedActivityIds.push(...insertedEvents.map(({ id }) => id));

    for (const firmName of ["primary", "other"] as const) {
      const dashboard = await request("/dashboard", {
        userId: firms[firmName].ownerId,
      });
      assert.equal(dashboard.response.status, 200);

      const recentActivity = (
        dashboard.body as {
          recentActivity: Array<{
            id: number;
            action: string;
            occurredAt: string;
          }>;
        }
      ).recentActivity;
      const tiedEvents = recentActivity.filter(({ action }) =>
        action.includes("tied dashboard event"),
      );
      const expectedIds = insertedEvents
        .filter(({ workspaceId }) => workspaceId === firms[firmName].workspaceId)
        .map(({ id }) => id)
        .sort((a, b) => b - a);

      assert.deepEqual(
        tiedEvents.map(({ id }) => id),
        expectedIds,
      );
      assert.deepEqual(
        tiedEvents.map(({ occurredAt: eventTime }) => eventTime),
        [occurredAt.toISOString(), occurredAt.toISOString()],
      );
    }
  } finally {
    if (insertedActivityIds.length) {
      await db
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, insertedActivityIds));
    }
  }
});

test("clients, matters, and activity lists and details stay inside the signed-in firm", async () => {
  const clients = await request("/clients", { userId: firms.primary.ownerId });
  assert.equal(clients.response.status, 200);
  assert.deepEqual(
    (clients.body as Array<{ id: number }>).map(({ id }) => id),
    [firms.primary.clientId],
  );
  const clientDetail = await request(`/clients/${firms.other.clientId}`, {
    userId: firms.primary.ownerId,
  });
  assert.equal(clientDetail.response.status, 404);
  const ownClientDetail = await request(`/clients/${firms.primary.clientId}`, {
    userId: firms.primary.ownerId,
  });
  assert.equal(ownClientDetail.response.status, 200);

  const matters = await request("/matters", { userId: firms.primary.ownerId });
  assert.equal(matters.response.status, 200);
  assert.deepEqual(
    (matters.body as Array<{ id: number }>).map(({ id }) => id),
    [firms.primary.matterId],
  );
  const clientMatters = await request(
    `/matters?clientId=${firms.primary.clientId}`,
    { userId: firms.primary.ownerId },
  );
  assert.equal(clientMatters.response.status, 200);
  assert.deepEqual(
    (clientMatters.body as Array<{ id: number }>).map(({ id }) => id),
    [firms.primary.matterId],
  );
  const otherFirmClientMatters = await request(
    `/matters?clientId=${firms.other.clientId}`,
    { userId: firms.primary.ownerId },
  );
  assert.equal(otherFirmClientMatters.response.status, 200);
  assert.deepEqual(otherFirmClientMatters.body, []);
  const invalidClientMatterFilter = await request("/matters?clientId=0", {
    userId: firms.primary.ownerId,
  });
  assert.equal(invalidClientMatterFilter.response.status, 400);
  const matterDetail = await request(`/matters/${firms.other.matterId}`, {
    userId: firms.primary.ownerId,
  });
  assert.equal(matterDetail.response.status, 404);
  const ownMatterDetail = await request(`/matters/${firms.primary.matterId}`, {
    userId: firms.primary.ownerId,
  });
  assert.equal(ownMatterDetail.response.status, 200);

  const activity = await request("/activity", {
    userId: firms.primary.ownerId,
  });
  assert.equal(activity.response.status, 200);
  assert.deepEqual(
    (activity.body.items as Array<{ action: string }>).map(({ action }) => action),
    ["primary-only activity"],
  );
  const ownActivityDetail = await request(
    `/activity/${firms.primary.activityId}`,
    { userId: firms.primary.ownerId },
  );
  assert.equal(ownActivityDetail.response.status, 200);
  assert.equal(
    (ownActivityDetail.body as { action: string }).action,
    "primary-only activity",
  );
  const otherActivityDetail = await request(
    `/activity/${firms.other.activityId}`,
    { userId: firms.primary.ownerId },
  );
  assert.equal(otherActivityDetail.response.status, 404);
});

test("activity CSV exports all events newest-first and stays inside the signed-in firm", async () => {
  const insertedIds: number[] = [];
  const actions = Array.from(
    { length: 105 },
    (_, index) => `activity export event ${index}`,
  );
  const baseTime = new Date("2099-02-01T00:00:00.000Z");

  try {
    const inserted = await db
      .insert(activitiesTable)
      .values([
        ...actions.map((action, index) => ({
          workspaceId: firms.primary.workspaceId,
          clerkUserId: firms.primary.ownerId,
          actor: "Primary Owner",
          action,
          entityType: "client",
          entityId: firms.primary.clientId,
          entityLabel: "Primary test client",
          occurredAt: new Date(baseTime.getTime() + index * 60_000),
        })),
        {
          workspaceId: firms.other.workspaceId,
          clerkUserId: firms.other.ownerId,
          actor: "Other Firm Owner",
          action: "other firm export event",
          entityType: "client",
          entityId: firms.other.clientId,
          entityLabel: "Other test client",
          occurredAt: new Date(baseTime.getTime() + 106 * 60_000),
        },
      ])
      .returning({ id: activitiesTable.id });
    insertedIds.push(...inserted.map(({ id }) => id));

    const response = await fetch(`${baseUrl}/activity/export.csv`, {
      headers: { "x-test-user-id": firms.primary.ownerId },
    });
    const csv = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/csv/);
    assert.match(
      response.headers.get("content-disposition") ?? "",
      /attachment; filename="clientguard-activity\.csv"/,
    );
    const lines = csv.trimEnd().split("\r\n");
    assert.equal(lines[0], '"id","actor","action","entityType","entityId","entityLabel","occurredAt"');
    assert.equal(lines.length, actions.length + 2);
    assert.match(lines[1], /"activity export event 104"/);
    assert.match(lines[actions.length], /"activity export event 0"/);
    assert.match(lines.at(-1) ?? "", /"primary-only activity"/);
    assert(!csv.includes("other firm export event"));
  } finally {
    if (insertedIds.length) {
      await db
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, insertedIds));
    }
  }
});

test("successful matter exports are recorded in the activity feed for only the exporting firm", async () => {
  const [additionalMatter] = await db
    .insert(mattersTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clientId: firms.primary.clientId,
      title: `Additional Export Matter ${randomUUID()}`,
      reference: `EXPORT-${randomUUID()}`,
      matterType: "advisory",
      responsible: "Primary Owner",
    })
    .returning();
  try {
    const exportRequestId = randomUUID();
    const exported = await request("/audit/exports", {
      userId: firms.primary.ownerId,
      method: "POST",
      body: {
        scope: "selected",
        matterIds: [firms.primary.matterId],
        exportRequestId,
      },
    });
    assert.equal(exported.response.status, 204);

    const retriedExport = await request("/audit/exports", {
      userId: firms.primary.ownerId,
      method: "POST",
      body: {
        scope: "selected",
        matterIds: [firms.primary.matterId],
        exportRequestId,
      },
    });
    assert.equal(retriedExport.response.status, 204);
    const concurrentRetries = await Promise.all([
      request("/audit/exports", {
        userId: firms.primary.ownerId,
        method: "POST",
        body: {
          scope: "selected",
          matterIds: [firms.primary.matterId],
          exportRequestId,
        },
      }),
      request("/audit/exports", {
        userId: firms.primary.ownerId,
        method: "POST",
        body: {
          scope: "selected",
          matterIds: [firms.primary.matterId],
          exportRequestId,
        },
      }),
    ]);
    assert.deepEqual(
      concurrentRetries.map((retry) => retry.response.status),
      [204, 204],
    );
    const reusedRequestId = await request("/audit/exports", {
      userId: firms.primary.ownerId,
      method: "POST",
      body: {
        scope: "selected",
        matterIds: [additionalMatter.id],
        exportRequestId,
      },
    });
    assert.equal(reusedRequestId.response.status, 409);

    const activity = await request("/activity", {
      userId: firms.primary.ownerId,
    });
    assert.equal(activity.response.status, 200);
    const events = activity.body.items as Array<{
      id: number;
      actor: string;
      action: string;
      entityType: string;
      entityId: number;
      entityLabel: string;
      occurredAt: string;
    }>;
    const exportEvent = events.find((event) =>
      event.action === "exported selected matters (1 record)",
    );
    assert.ok(exportEvent);
    assert.equal(exportEvent.actor, "Test User");
    assert.equal(exportEvent.entityType, "workspace");
    assert.equal(exportEvent.entityId, firms.primary.workspaceId);
    assert.equal(exportEvent.entityLabel, "Matter PDF");
    assert.ok(Number.isFinite(Date.parse(exportEvent.occurredAt)));
    const [storedExport] = await db
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.id, exportEvent.id));
    assert.equal(storedExport.clerkUserId, firms.primary.ownerId);

    const partialAllExport = await request("/audit/exports", {
      userId: firms.primary.ownerId,
      method: "POST",
      body: {
        scope: "all",
        matterIds: [firms.primary.matterId],
        exportRequestId: randomUUID(),
      },
    });
    assert.equal(partialAllExport.response.status, 400);

    const allMattersExport = await request("/audit/exports", {
      userId: firms.primary.ownerId,
      method: "POST",
      body: {
        scope: "all",
        matterIds: [firms.primary.matterId, additionalMatter.id],
        exportRequestId: randomUUID(),
      },
    });
    assert.equal(allMattersExport.response.status, 204);

    const otherFirmActivity = await request("/activity", {
      userId: firms.other.ownerId,
    });
    assert.equal(otherFirmActivity.response.status, 200);
    assert.equal(
      (otherFirmActivity.body.items as Array<{ action: string }>).some((event) =>
        event.action.includes("exported"),
      ),
      false,
    );

    const crossFirmExport = await request("/audit/exports", {
      userId: firms.primary.ownerId,
      method: "POST",
      body: {
        scope: "all",
        matterIds: [firms.other.matterId],
        exportRequestId: randomUUID(),
      },
    });
    assert.equal(crossFirmExport.response.status, 404);
    const activityAfterRejectedExport = await request("/activity", {
      userId: firms.primary.ownerId,
    });
    const exportEvents = (
      activityAfterRejectedExport.body.items as Array<{ action: string }>
    ).filter((event) => event.action.includes("exported"));
    assert.equal(exportEvents.length, 2);
    assert.ok(
      exportEvents.some(
        (event) => event.action === "exported all matters (2 records)",
      ),
    );
  } finally {
    const testEvents = await db
      .select({ id: activitiesTable.id })
      .from(activitiesTable)
      .where(
        and(
          eq(activitiesTable.workspaceId, firms.primary.workspaceId),
          inArray(activitiesTable.action, [
            "exported selected matters (1 record)",
            "exported all matters (2 records)",
          ]),
        ),
      );
    if (testEvents.length) {
      await db.delete(activitiesTable).where(
        inArray(
          activitiesTable.id,
          testEvents.map((event) => event.id),
        ),
      );
    }
    await db
      .delete(mattersTable)
      .where(eq(mattersTable.id, additionalMatter.id));
  }
});

test("activity pagination keeps page boundaries and firm isolation", async () => {
  const insertedActivityIds: number[] = [];
  const occurredAt = new Date("2099-01-01T00:00:00.000Z");
  const primaryActions = [
    `primary page event oldest ${randomUUID()}`,
    `primary page event middle ${randomUUID()}`,
    `primary page event newest ${randomUUID()}`,
  ];
  const otherActions = [
    `other page event oldest ${randomUUID()}`,
    `other page event newest ${randomUUID()}`,
  ];

  try {
    const inserted = await db
      .insert(activitiesTable)
      .values([
        ...primaryActions.map((action, index) => ({
          workspaceId: firms.primary.workspaceId,
          clerkUserId: firms.primary.ownerId,
          actor: "Primary Owner",
          action,
          entityType: "client",
          entityId: firms.primary.clientId,
          entityLabel: "Primary test client",
          occurredAt: new Date(occurredAt.getTime() + index * 60_000),
        })),
        ...otherActions.map((action, index) => ({
          workspaceId: firms.other.workspaceId,
          clerkUserId: firms.other.ownerId,
          actor: "Other Firm Owner",
          action,
          entityType: "client",
          entityId: firms.other.clientId,
          entityLabel: "Other test client",
          occurredAt: new Date(occurredAt.getTime() + index * 60_000),
        })),
      ])
      .returning({ id: activitiesTable.id });
    insertedActivityIds.push(...inserted.map(({ id }) => id));

    const firstPage = await request("/activity?limit=2&offset=0", {
      userId: firms.primary.ownerId,
    });
    assert.equal(firstPage.response.status, 200);
    assert.deepEqual(
      (firstPage.body.items as Array<{ action: string }>).map(({ action }) => action),
      [primaryActions[2], primaryActions[1]],
    );

    const snapshotId = firstPage.body.snapshotId as number;
    const lateActivity = await db
      .insert(activitiesTable)
      .values({
        workspaceId: firms.primary.workspaceId,
        clerkUserId: firms.primary.ownerId,
        actor: "Primary Owner",
        action: `primary page event added after snapshot ${randomUUID()}`,
        entityType: "client",
        entityId: firms.primary.clientId,
        entityLabel: "Primary test client",
        occurredAt: new Date(occurredAt.getTime() + 180_000),
      })
      .returning({ id: activitiesTable.id });
    insertedActivityIds.push(...lateActivity.map(({ id }) => id));

    const secondPage = await request(
      `/activity?limit=2&offset=2&snapshotId=${snapshotId}`,
      {
      userId: firms.primary.ownerId,
      },
    );
    assert.equal(secondPage.response.status, 200);
    assert.deepEqual(
      (secondPage.body.items as Array<{ action: string }>).map(({ action }) => action),
      [primaryActions[0], "primary-only activity"],
    );
    assert(
      (secondPage.body.items as Array<{ action: string }>).every(
        ({ action }) => !action.startsWith("other"),
      ),
    );

    const pastLastPage = await request(
      `/activity?limit=2&offset=4&snapshotId=${snapshotId}`,
      { userId: firms.primary.ownerId },
    );
    assert.equal(pastLastPage.response.status, 200);
    assert.deepEqual(pastLastPage.body.items, []);

    const otherFirmPage = await request("/activity?limit=2&offset=0", {
      userId: firms.other.ownerId,
    });
    assert.equal(otherFirmPage.response.status, 200);
    assert.deepEqual(
      (otherFirmPage.body.items as Array<{ action: string }>).map(({ action }) => action),
      [otherActions[1], otherActions[0]],
    );

    const invalidOffset = await request("/activity?offset=-1", {
      userId: firms.primary.ownerId,
    });
    assert.equal(invalidOffset.response.status, 400);
  } finally {
    if (insertedActivityIds.length) {
      await db
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, insertedActivityIds));
    }
  }
});

test("activity filters stay firm-scoped and apply before pagination", async () => {
  const insertedActivityIds: number[] = [];
  const occurredAt = new Date("2099-01-02T00:00:00.000Z");
  const ownerActions = [
    `filtered client event oldest ${randomUUID()}`,
    `filtered client event middle ${randomUUID()}`,
    `filtered client event newest ${randomUUID()}`,
  ];
  const unrelatedActions = [
    `filtered matter event ${randomUUID()}`,
    `filtered teammate event ${randomUUID()}`,
    `filtered other firm event ${randomUUID()}`,
  ];
  const formerActorId = `former-actor-${randomUUID()}`;
  const formerActorAction = `former teammate event ${randomUUID()}`;

  try {
    const [primaryTeammate] = await db
      .select({ clerkUserId: membershipsTable.clerkUserId })
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.workspaceId, firms.primary.workspaceId),
          eq(membershipsTable.displayName, "Read Only User"),
        ),
      );
    assert.ok(primaryTeammate);
    const [formerMembership] = await db
      .select({ id: membershipsTable.id })
      .from(membershipsTable)
      .where(eq(membershipsTable.clerkUserId, formerActorId));
    assert.equal(formerMembership, undefined);

    const inserted = await db
      .insert(activitiesTable)
      .values([
        ...ownerActions.map((action, index) => ({
          workspaceId: firms.primary.workspaceId,
          clerkUserId: firms.primary.ownerId,
          actor: "Primary Owner",
          action,
          entityType: "client",
          entityId: firms.primary.clientId,
          entityLabel: "Primary test client",
          occurredAt: new Date(occurredAt.getTime() + index * 60_000),
        })),
        {
          workspaceId: firms.primary.workspaceId,
          clerkUserId: firms.primary.ownerId,
          actor: "Primary Owner",
          action: unrelatedActions[0],
          entityType: "matter",
          entityId: firms.primary.matterId,
          entityLabel: "Primary test matter",
          occurredAt,
        },
        {
          workspaceId: firms.primary.workspaceId,
          clerkUserId: primaryTeammate.clerkUserId,
          actor: "Read Only User",
          action: unrelatedActions[1],
          entityType: "client",
          entityId: firms.primary.clientId,
          entityLabel: "Primary test client",
          occurredAt,
        },
        {
          workspaceId: firms.primary.workspaceId,
          clerkUserId: formerActorId,
          actor: "Former Teammate",
          action: formerActorAction,
          entityType: "client",
          entityId: firms.primary.clientId,
          entityLabel: "Primary test client",
          occurredAt: new Date(occurredAt.getTime() + 120_000),
        },
        {
          workspaceId: firms.other.workspaceId,
          clerkUserId: firms.other.ownerId,
          actor: "Other Firm Owner",
          action: unrelatedActions[2],
          entityType: "client",
          entityId: firms.other.clientId,
          entityLabel: "Other test client",
          occurredAt,
        },
      ])
      .returning({ id: activitiesTable.id });
    insertedActivityIds.push(...inserted.map(({ id }) => id));

    const actorOptions = await request("/activity/actors", {
      userId: firms.primary.ownerId,
    });
    assert.equal(actorOptions.response.status, 200);
    assert.deepEqual(actorOptions.body, [
      { name: "Former Teammate" },
      { name: "Primary Owner" },
      { name: "Read Only User" },
    ]);
    assert(!JSON.stringify(actorOptions.body).includes(formerActorId));
    assert(!JSON.stringify(actorOptions.body).includes(firms.other.ownerId));

    const firstPage = await request(
      `/activity?actorName=${encodeURIComponent("Primary Owner")}&entityType=client&entityId=${firms.primary.clientId}&limit=2&offset=0`,
      { userId: firms.primary.ownerId },
    );
    assert.equal(firstPage.response.status, 200);
    assert.deepEqual(
      (firstPage.body.items as Array<{ action: string }>).map(({ action }) => action),
      [ownerActions[2], ownerActions[1]],
    );

    const filteredSnapshotId = firstPage.body.snapshotId as number;
    const secondPage = await request(
      `/activity?actorName=${encodeURIComponent("Primary Owner")}&entityType=client&entityId=${firms.primary.clientId}&limit=2&offset=2&snapshotId=${filteredSnapshotId}`,
      { userId: firms.primary.ownerId },
    );
    assert.equal(secondPage.response.status, 200);
    assert.deepEqual(
      (secondPage.body.items as Array<{ action: string }>).map(({ action }) => action),
      [ownerActions[0], "primary-only activity"],
    );

    const formerActorFilter = await request(
      `/activity?actorName=${encodeURIComponent("Former Teammate")}`,
      { userId: firms.primary.ownerId },
    );
    assert.equal(formerActorFilter.response.status, 200);
    assert.deepEqual(
      (formerActorFilter.body.items as Array<{ action: string }>).map(({ action }) => action),
      [formerActorAction],
    );
    const formerActorCsvResponse = await fetch(
      `${baseUrl}/activity/export.csv?actorName=${encodeURIComponent("Former Teammate")}`,
      { headers: { "x-test-user-id": firms.primary.ownerId } },
    );
    const formerActorCsv = await formerActorCsvResponse.text();
    assert.equal(formerActorCsvResponse.status, 200);
    assert(formerActorCsv.includes(formerActorAction));
    assert(!formerActorCsv.includes(ownerActions[0]));

    const otherFirmActorFilter = await request(
      `/activity?actorName=${encodeURIComponent("Other Firm Owner")}`,
      { userId: firms.primary.ownerId },
    );
    assert.equal(otherFirmActorFilter.response.status, 200);
    assert.deepEqual(otherFirmActorFilter.body.items, []);

    const recordFilter = await request(
      `/activity?entityType=matter&entityId=${firms.primary.matterId}`,
      { userId: firms.primary.ownerId },
    );
    assert.equal(recordFilter.response.status, 200);
    assert.deepEqual(
      (recordFilter.body.items as Array<{ action: string }>).map(({ action }) => action),
      [unrelatedActions[0]],
    );

    const dateFilteredPage = await request(
      `/activity?startDate=2099-01-02&endDate=2099-01-02&actorName=${encodeURIComponent("Primary Owner")}&entityType=client&entityId=${firms.primary.clientId}&limit=2&offset=0`,
      { userId: firms.primary.ownerId },
    );
    assert.equal(dateFilteredPage.response.status, 200);
    assert.deepEqual(
      (dateFilteredPage.body.items as Array<{ action: string }>).map(({ action }) => action),
      [ownerActions[2], ownerActions[1]],
    );
    const dateFilteredSecondPage = await request(
      `/activity?startDate=2099-01-02&endDate=2099-01-02&actorName=${encodeURIComponent("Primary Owner")}&entityType=client&entityId=${firms.primary.clientId}&limit=2&offset=2&snapshotId=${dateFilteredPage.body.snapshotId}`,
      { userId: firms.primary.ownerId },
    );
    assert.equal(dateFilteredSecondPage.response.status, 200);
    assert.deepEqual(
      (dateFilteredSecondPage.body.items as Array<{ action: string }>).map(({ action }) => action),
      [ownerActions[0]],
    );
    assert(
      !(dateFilteredPage.body.items as Array<{ action: string }>).some(
        ({ action }) => action === unrelatedActions[2],
      ),
    );
    const emptyDateRange = await request(
      "/activity?startDate=2099-01-04&endDate=2099-01-04",
      { userId: firms.primary.ownerId },
    );
    assert.equal(emptyDateRange.response.status, 200);
    assert.deepEqual(emptyDateRange.body.items, []);

    const impossibleDate = await request("/activity?startDate=2099-02-30", {
      userId: firms.primary.ownerId,
    });
    assert.equal(impossibleDate.response.status, 400);
    assert.match(String(impossibleDate.body.error), /valid date/i);
    const reversedDateRange = await request(
      "/activity?startDate=2099-01-03&endDate=2099-01-02",
      { userId: firms.primary.ownerId },
    );
    assert.equal(reversedDateRange.response.status, 400);
    assert.match(String(reversedDateRange.body.error), /on or after/i);

    const dateFilteredCsvResponse = await fetch(
      `${baseUrl}/activity/export.csv?startDate=2099-01-02&endDate=2099-01-02`,
      { headers: { "x-test-user-id": firms.primary.ownerId } },
    );
    const dateFilteredCsv = await dateFilteredCsvResponse.text();
    assert.equal(dateFilteredCsvResponse.status, 200);
    assert(dateFilteredCsv.includes(ownerActions[0]));
    assert(!dateFilteredCsv.includes(unrelatedActions[2]));
  } finally {
    if (insertedActivityIds.length) {
      await db
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, insertedActivityIds));
    }
  }
});

test("activity orders events with tied timestamps by descending ID for each firm", async () => {
  const insertedActivityIds: number[] = [];
  const occurredAt = new Date("2099-01-01T00:00:00.000Z");
  const tiedEvents = [
    {
      workspaceId: firms.primary.workspaceId,
      clerkUserId: firms.primary.ownerId,
      actor: "Primary Owner",
      action: `primary tied event first ${randomUUID()}`,
      entityType: "client",
      entityId: firms.primary.clientId,
      entityLabel: "Primary test client",
    },
    {
      workspaceId: firms.other.workspaceId,
      clerkUserId: firms.other.ownerId,
      actor: "Other Firm Owner",
      action: `other tied event first ${randomUUID()}`,
      entityType: "client",
      entityId: firms.other.clientId,
      entityLabel: "Other test client",
    },
    {
      workspaceId: firms.primary.workspaceId,
      clerkUserId: firms.primary.ownerId,
      actor: "Primary Owner",
      action: `primary tied event second ${randomUUID()}`,
      entityType: "client",
      entityId: firms.primary.clientId,
      entityLabel: "Primary test client",
    },
    {
      workspaceId: firms.other.workspaceId,
      clerkUserId: firms.other.ownerId,
      actor: "Other Firm Owner",
      action: `other tied event second ${randomUUID()}`,
      entityType: "client",
      entityId: firms.other.clientId,
      entityLabel: "Other test client",
    },
  ];

  try {
    const inserted = await db
      .insert(activitiesTable)
      .values(tiedEvents.map((event) => ({ ...event, occurredAt })))
      .returning({ id: activitiesTable.id, action: activitiesTable.action });
    insertedActivityIds.push(...inserted.map(({ id }) => id));

    for (const [firm, expectedPrefix] of [
      [firms.primary, "primary tied event"],
      [firms.other, "other tied event"],
    ] as const) {
      const expectedActions = inserted
        .filter(({ action }) => action.startsWith(expectedPrefix))
        .sort((a, b) => b.id - a.id)
        .map(({ action }) => action);
      const response = await request("/activity?limit=2", {
        userId: firm.ownerId,
      });

      assert.equal(response.response.status, 200);
      assert.deepEqual(
        (response.body.items as Array<{ action: string }>).map(({ action }) => action),
        expectedActions,
      );
    }
  } finally {
    if (insertedActivityIds.length) {
      await db
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, insertedActivityIds));
    }
  }
});

test("firm owners and admins can manage teammate roles with scoped audit events", async () => {
  const adminId = `member-admin-${randomUUID()}`;
  const teammateId = `member-teammate-${randomUUID()}`;
  const teammateName = `Member Teammate ${randomUUID()}`;
  const [owner] = await db
    .select({ id: membershipsTable.id })
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId))
    .limit(1);
  const [foreignOwner] = await db
    .select({ id: membershipsTable.id })
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.other.ownerId))
    .limit(1);
  const [admin] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clerkUserId: adminId,
      email: "member-admin@example.test",
      displayName: "Member Admin",
      role: "admin",
    })
    .returning();
  const [teammate] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clerkUserId: teammateId,
      email: "member-teammate@example.test",
      displayName: teammateName,
      role: "professional",
    })
    .returning();
  const insertedActivityIds: number[] = [];

  try {
    const listed = await request("/workspace/members", {
      userId: firms.primary.ownerId,
    });
    assert.equal(listed.response.status, 200);
    assert((listed.body as Array<{ id: number; role: string }>).some(
      ({ id, role }) => id === teammate.id && role === "professional",
    ));
    assert(!(listed.body as Array<{ id: number }>).some(({ id }) => id === foreignOwner.id));

    const adminList = await request("/workspace/members", { userId: adminId });
    assert.equal(adminList.response.status, 200);
    const unauthorizedList = await request("/workspace/members", {
      userId: teammateId,
    });
    assert.equal(unauthorizedList.response.status, 403);

    const changed = await request(`/workspace/members/${teammate.id}`, {
      userId: adminId,
      method: "PATCH",
      body: { role: "advisor" },
    });
    assert.equal(changed.response.status, 200);
    assert.equal((changed.body as { role: string }).role, "advisor");

    const subsequentWorkspace = await request("/workspace", { userId: teammateId });
    assert.equal((subsequentWorkspace.body as { role: string }).role, "advisor");
    const subsequentRequest = await request("/dashboard", { userId: teammateId });
    assert.equal(subsequentRequest.response.status, 200);

    const unsupportedRole = await request(`/workspace/members/${teammate.id}`, {
      userId: firms.primary.ownerId,
      method: "PATCH",
      body: { role: "owner" },
    });
    assert.equal(unsupportedRole.response.status, 400);

    const protectedOwnerRole = await request(`/workspace/members/${owner.id}`, {
      userId: firms.primary.ownerId,
      method: "PATCH",
      body: { role: "professional" },
    });
    assert.equal(protectedOwnerRole.response.status, 404);
    const protectedOwnerRemoval = await request(`/workspace/members/${owner.id}`, {
      userId: firms.primary.ownerId,
      method: "DELETE",
    });
    assert.equal(protectedOwnerRemoval.response.status, 404);

    const crossFirmRemoval = await request(`/workspace/members/${foreignOwner.id}`, {
      userId: firms.primary.ownerId,
      method: "DELETE",
    });
    assert.equal(crossFirmRemoval.response.status, 404);

    const removed = await request(`/workspace/members/${teammate.id}`, {
      userId: firms.primary.ownerId,
      method: "DELETE",
    });
    assert.equal(removed.response.status, 204);
    const deniedAfterRemoval = await request("/dashboard", { userId: teammateId });
    assert.equal(deniedAfterRemoval.response.status, 403);

    const accessEvents = await db
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.workspaceId, firms.primary.workspaceId));
    const matchingEvents = accessEvents.filter((event) =>
      event.action.includes(teammateName),
    );
    assert.deepEqual(
      matchingEvents.map((event) => event.action),
      [
        `changed ${teammateName}'s role from professional to advisor`,
        `removed ${teammateName} from the firm workspace`,
      ],
    );
    insertedActivityIds.push(...matchingEvents.map(({ id }) => id));
  } finally {
    if (insertedActivityIds.length) {
      await db
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, insertedActivityIds));
    }
    await db
      .delete(membershipsTable)
      .where(inArray(membershipsTable.id, [admin.id, teammate.id]));
  }
});

test("only the current owner can transfer ownership to an active member and both owners are notified", async (t) => {
  const adminId = `ownership-admin-${randomUUID()}`;
  const successorId = `ownership-successor-${randomUUID()}`;
  const successorName = `Ownership Successor ${randomUUID()}`;
  const [currentOwner] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId))
    .limit(1);
  const [foreignOwner] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.other.ownerId))
    .limit(1);
  const [admin] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clerkUserId: adminId,
      email: "ownership-admin@example.test",
      displayName: "Ownership Admin",
      role: "admin",
    })
    .returning();
  const [successor] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clerkUserId: successorId,
      email: "ownership-successor@example.test",
      displayName: successorName,
      role: "professional",
    })
    .returning();
  const activityIds: number[] = [];
  const previousNotificationSender = process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL;
  process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL = "notifications@example.test";
  const sentNotifications: Array<{
    to: { userId?: string };
    subject: string;
    text: string;
  }> = [];
  const createEmail = t.mock.method(
    clerkClient.emails,
    "create",
    async (params) => {
      sentNotifications.push(params as typeof sentNotifications[number]);
      return {} as never;
    },
  );

  try {
    const adminTransfer = await request(
      `/workspace/members/${successor.id}/transfer-ownership`,
      { userId: adminId, method: "POST" },
    );
    assert.equal(adminTransfer.response.status, 403);

    const selfTransfer = await request(
      `/workspace/members/${currentOwner.id}/transfer-ownership`,
      { userId: firms.primary.ownerId, method: "POST" },
    );
    assert.equal(selfTransfer.response.status, 400);

    const foreignTransfer = await request(
      `/workspace/members/${foreignOwner.id}/transfer-ownership`,
      { userId: firms.primary.ownerId, method: "POST" },
    );
    assert.equal(foreignTransfer.response.status, 404);

    const transferred = await request(
      `/workspace/members/${successor.id}/transfer-ownership`,
      { userId: firms.primary.ownerId, method: "POST" },
    );
    assert.equal(transferred.response.status, 200);
    assert.equal((transferred.body as { id: number; role: string }).id, successor.id);
    assert.equal((transferred.body as { role: string }).role, "owner");
    assert.equal(createEmail.mock.callCount(), 2);
    assert.deepEqual(
      sentNotifications.map(({ to }) => to.userId).sort(),
      [currentOwner.clerkUserId, successorId].sort(),
    );
    assert(sentNotifications.some(({ subject, text }) =>
      subject.includes("role changed") && text.includes("Your role is now admin"),
    ));
    assert(sentNotifications.some(({ subject, text }) =>
      subject.includes("now the owner") && text.includes("You are now the owner"),
    ));

    const oldOwnerContext = await request("/workspace", {
      userId: firms.primary.ownerId,
    });
    assert.equal((oldOwnerContext.body as { role: string }).role, "admin");
    const newOwnerContext = await request("/workspace", {
      userId: successorId,
    });
    assert.equal((newOwnerContext.body as { role: string }).role, "owner");

    const workspaceMembers = await db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.workspaceId, firms.primary.workspaceId));
    assert.equal(
      workspaceMembers.filter((member) => member.role === "owner").length,
      1,
    );
    assert.equal(
      workspaceMembers.find((member) => member.id === currentOwner.id)?.role,
      "admin",
    );
    assert.equal(
      workspaceMembers.find((member) => member.id === successor.id)?.role,
      "owner",
    );

    const events = await db
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.workspaceId, firms.primary.workspaceId));
    const ownershipEvent = events.find((event) =>
      event.action.includes(successorName),
    );
    assert.equal(
      ownershipEvent?.action,
      `transferred firm ownership from ${currentOwner.displayName} to ${successorName}`,
    );
    assert.equal(ownershipEvent?.clerkUserId, firms.primary.ownerId);
    if (ownershipEvent) activityIds.push(ownershipEvent.id);

    const oldOwnerTransfer = await request(
      `/workspace/members/${admin.id}/transfer-ownership`,
      { userId: firms.primary.ownerId, method: "POST" },
    );
    assert.equal(oldOwnerTransfer.response.status, 403);
  } finally {
    if (activityIds.length) {
      await db
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, activityIds));
    }
    await db
      .delete(membershipsTable)
      .where(inArray(membershipsTable.id, [admin.id, successor.id]));
    await db
      .update(membershipsTable)
      .set({ role: "owner" })
      .where(eq(membershipsTable.id, currentOwner.id));
    if (previousNotificationSender === undefined) {
      delete process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL;
    } else {
      process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL = previousNotificationSender;
    }
  }
});

test("one failed ownership notice does not suppress the other owner's notice or transfer", async (t) => {
  const successorId = `ownership-partial-notice-${randomUUID()}`;
  const successorName = `Partial Notice Successor ${randomUUID()}`;
  const [currentOwner] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId))
    .limit(1);
  const [successor] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clerkUserId: successorId,
      email: "ownership-partial-notice@example.test",
      displayName: successorName,
      role: "professional",
    })
    .returning();
  const previousNotificationSender = process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL;
  process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL = "notifications@example.test";
  const sentRecipients: string[] = [];
  const createEmail = t.mock.method(
    clerkClient.emails,
    "create",
    async (params) => {
      const email = params as { to: { userId?: string } };
      const recipientId = email.to.userId ?? "";
      sentRecipients.push(recipientId);
      if (recipientId === successorId) {
        throw new Error("Email provider unavailable for new owner");
      }
      return {} as never;
    },
  );
  const activityIds: number[] = [];
  const auditIds: number[] = [];

  try {
    const transferred = await request(
      `/workspace/members/${successor.id}/transfer-ownership`,
      { userId: firms.primary.ownerId, method: "POST" },
    );
    assert.equal(transferred.response.status, 200);
    assert.equal(createEmail.mock.callCount(), 2);
    assert.deepEqual(
      sentRecipients.slice().sort(),
      [currentOwner.clerkUserId, successorId].sort(),
    );
    assert.equal(
      sentRecipients.filter((recipientId) => recipientId === currentOwner.clerkUserId).length,
      1,
    );
    assert.equal(
      sentRecipients.filter((recipientId) => recipientId === successorId).length,
      1,
    );

    const [formerOwner] = await db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.clerkUserId, currentOwner.clerkUserId))
      .limit(1);
    const [newOwner] = await db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.clerkUserId, successorId))
      .limit(1);
    assert.equal(formerOwner.role, "admin");
    assert.equal(newOwner.role, "owner");

    const noticeEvents = await db
      .select()
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.workspaceId, firms.primary.workspaceId),
          eq(auditEventsTable.action, "ownership_notice_delivery"),
        ),
      );
    const transferNoticeEvents = noticeEvents.filter(
      (event) => event.details.newOwnerName === successorName,
    );
    auditIds.push(...transferNoticeEvents.map(({ id }) => id));
    const transferNoticeRoles = transferNoticeEvents.map((event) => ({
      role: event.details.recipientRole,
      status: event.details.status,
    }));
    assert.deepEqual(
      transferNoticeRoles.sort((a, b) => String(a.role).localeCompare(String(b.role))),
      [
        { role: "former_owner", status: "sent" },
        { role: "new_owner", status: "failed" },
      ],
    );

    const transferEvents = await db
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.workspaceId, firms.primary.workspaceId));
    const ownershipEvent = transferEvents.find((event) =>
      event.action ===
      `transferred firm ownership from ${currentOwner.displayName || currentOwner.email} to ${successorName}`,
    );
    assert(ownershipEvent);
    activityIds.push(ownershipEvent.id);
  } finally {
    if (activityIds.length) {
      await db
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, activityIds));
    }
    if (auditIds.length) {
      await db
        .delete(auditEventsTable)
        .where(inArray(auditEventsTable.id, auditIds));
    }
    await db
      .update(membershipsTable)
      .set({ role: "owner" })
      .where(eq(membershipsTable.id, currentOwner.id));
    await db
      .delete(membershipsTable)
      .where(eq(membershipsTable.id, successor.id));
    if (previousNotificationSender === undefined) {
      delete process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL;
    } else {
      process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL = previousNotificationSender;
    }
  }
});

test("failed ownership notices can be retried separately without repeating the transfer", async (t) => {
  const successorId = `ownership-notice-failure-${randomUUID()}`;
  const viewerId = `ownership-notice-viewer-${randomUUID()}`;
  const [currentOwner] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId))
    .limit(1);
  const [successor] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clerkUserId: successorId,
      email: "ownership-notice-failure@example.test",
      displayName: "Notice Failure Successor",
      role: "professional",
    })
    .returning();
  const [viewer] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clerkUserId: viewerId,
      email: "ownership-notice-viewer@example.test",
      displayName: "Notice Viewer",
      role: "professional",
    })
    .returning();
  const previousNotificationSender = process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL;
  process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL = "notifications@example.test";
  const activityIds: number[] = [];
  const auditIds: number[] = [];
  const allowedRecipients = new Set<string>();
  const sentNotifications: Array<{ to: { userId?: string } }> = [];
  const createEmail = t.mock.method(
    clerkClient.emails,
    "create",
    async (params) => {
      const email = params as { to: { userId?: string } };
      sentNotifications.push(email);
      if (!email.to.userId || !allowedRecipients.has(email.to.userId)) {
        throw new Error("Email provider unavailable");
      }
      return {} as never;
    },
  );

  try {
    const transferred = await request(
      `/workspace/members/${successor.id}/transfer-ownership`,
      { userId: firms.primary.ownerId, method: "POST" },
    );
    assert.equal(transferred.response.status, 200);
    assert.equal(createEmail.mock.callCount(), 2);

    const listedAsFirmMember = await request("/workspace/ownership-notices", {
      userId: viewerId,
    });
    assert.equal(listedAsFirmMember.response.status, 200);
    const failedNotices = listedAsFirmMember.body as Array<{
      transferId: string;
      recipientRole: "former_owner" | "new_owner";
      recipientName: string;
      otherOwnerName: string;
    }>;
    assert.equal(failedNotices.length, 2);
    assert.deepEqual(
      failedNotices.map(({ recipientRole }) => recipientRole).sort(),
      ["former_owner", "new_owner"],
    );
    assert(failedNotices.every((notice) => notice.recipientName && notice.otherOwnerName));
    const transferId = failedNotices[0]!.transferId;
    const hiddenFromAnotherFirm = await request("/workspace/ownership-notices", {
      userId: firms.other.ownerId,
    });
    assert.equal(hiddenFromAnotherFirm.response.status, 200);
    assert.deepEqual(hiddenFromAnotherFirm.body, []);

    const forbiddenRetry = await request(
      `/workspace/ownership-notices/${transferId}/former_owner/retry`,
      { userId: viewerId, method: "POST" },
    );
    assert.equal(forbiddenRetry.response.status, 403);
    assert.equal(createEmail.mock.callCount(), 2);

    allowedRecipients.add(firms.primary.ownerId);
    const formerOwnerRetry = await request(
      `/workspace/ownership-notices/${transferId}/former_owner/retry`,
      { userId: firms.primary.ownerId, method: "POST" },
    );
    assert.equal(formerOwnerRetry.response.status, 200);
    assert.deepEqual(sentNotifications[2]?.to.userId, firms.primary.ownerId);
    const duplicateRetry = await request(
      `/workspace/ownership-notices/${transferId}/former_owner/retry`,
      { userId: firms.primary.ownerId, method: "POST" },
    );
    assert.equal(duplicateRetry.response.status, 409);
    assert.equal(createEmail.mock.callCount(), 3);

    const remainingNotice = await request("/workspace/ownership-notices", {
      userId: viewerId,
    });
    assert.equal(remainingNotice.response.status, 200);
    assert.deepEqual(
      (remainingNotice.body as Array<{ recipientRole: string }>).map(
        ({ recipientRole }) => recipientRole,
      ),
      ["new_owner"],
    );

    allowedRecipients.add(successorId);
    const newOwnerRetry = await request(
      `/workspace/ownership-notices/${transferId}/new_owner/retry`,
      { userId: firms.primary.ownerId, method: "POST" },
    );
    assert.equal(newOwnerRetry.response.status, 200);
    assert.deepEqual(sentNotifications[3]?.to.userId, successorId);
    const noRemainingNotices = await request("/workspace/ownership-notices", {
      userId: viewerId,
    });
    assert.deepEqual(noRemainingNotices.body, []);

    const [formerOwner] = await db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId))
      .limit(1);
    const [newOwner] = await db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.clerkUserId, successorId))
      .limit(1);
    assert.equal(formerOwner.role, "admin");
    assert.equal(newOwner.role, "owner");
    const allNoticeEvents = await db
      .select()
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.workspaceId, firms.primary.workspaceId),
          eq(auditEventsTable.action, "ownership_notice_delivery"),
        ),
      );
    auditIds.push(
      ...allNoticeEvents
        .filter((event) => event.details.transferId === transferId)
        .map(({ id }) => id),
    );
    const [noticeTransferEvent] = await db
      .select({ id: activitiesTable.id })
      .from(activitiesTable)
      .where(
        and(
          eq(activitiesTable.workspaceId, firms.primary.workspaceId),
          eq(
            activitiesTable.action,
            `transferred firm ownership from ${currentOwner.displayName || currentOwner.email} to Notice Failure Successor`,
          ),
        ),
      )
      .limit(1);
    if (noticeTransferEvent) activityIds.push(noticeTransferEvent.id);
  } finally {
    if (activityIds.length) {
      await db
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, activityIds));
    }
    if (auditIds.length) {
      await db
        .delete(auditEventsTable)
        .where(inArray(auditEventsTable.id, auditIds));
    }
    await db
      .update(membershipsTable)
      .set({ role: "owner" })
      .where(eq(membershipsTable.id, currentOwner.id));
    await db
      .delete(membershipsTable)
      .where(inArray(membershipsTable.id, [successor.id, viewer.id]));
    if (previousNotificationSender === undefined) {
      delete process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL;
    } else {
      process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL = previousNotificationSender;
    }
  }
});

test("simultaneous ownership transfers leave one owner and one matching audit event", async () => {
  const firstSuccessorName = `Ownership Candidate One ${randomUUID()}`;
  const secondSuccessorName = `Ownership Candidate Two ${randomUUID()}`;
  const [currentOwner] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId))
    .limit(1);
  const [firstSuccessor] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clerkUserId: `ownership-candidate-one-${randomUUID()}`,
      email: "ownership-candidate-one@example.test",
      displayName: firstSuccessorName,
      role: "professional",
    })
    .returning();
  const [secondSuccessor] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clerkUserId: `ownership-candidate-two-${randomUUID()}`,
      email: "ownership-candidate-two@example.test",
      displayName: secondSuccessorName,
      role: "professional",
    })
    .returning();
  const activityIds: number[] = [];

  try {
    const [firstTransfer, secondTransfer] = await Promise.all([
      request(
        `/workspace/members/${firstSuccessor.id}/transfer-ownership`,
        { userId: firms.primary.ownerId, method: "POST" },
      ),
      request(
        `/workspace/members/${secondSuccessor.id}/transfer-ownership`,
        { userId: firms.primary.ownerId, method: "POST" },
      ),
    ]);
    const transfers = [
      { response: firstTransfer, successor: firstSuccessor, name: firstSuccessorName },
      { response: secondTransfer, successor: secondSuccessor, name: secondSuccessorName },
    ];
    const committedTransfers = transfers.filter(({ response }) =>
      response.response.status === 200,
    );
    const rejectedTransfers = transfers.filter(({ response }) =>
      response.response.status === 403,
    );

    assert.equal(committedTransfers.length, 1);
    assert.equal(rejectedTransfers.length, 1);
    const committed = committedTransfers[0]!;
    assert.equal(
      (committed.response.body as { id: number; role: string }).id,
      committed.successor.id,
    );
    assert.equal(
      (committed.response.body as { role: string }).role,
      "owner",
    );
    assert.deepEqual(rejectedTransfers[0]!.response.body, {
      error: "Only the current firm owner can transfer ownership.",
    });

    const roster = await db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.workspaceId, firms.primary.workspaceId));
    assert.equal(roster.filter((member) => member.role === "owner").length, 1);
    assert.equal(
      roster.find((member) => member.id === currentOwner.id)?.role,
      "admin",
    );
    assert.equal(
      roster.find((member) => member.id === committed.successor.id)?.role,
      "owner",
    );
    const rejectedSuccessor = rejectedTransfers[0]!.successor;
    assert.equal(
      roster.find((member) => member.id === rejectedSuccessor.id)?.role,
      "professional",
    );

    const listedRoster = await request("/workspace/members", {
      userId: committed.successor.clerkUserId,
    });
    assert.equal(listedRoster.response.status, 200);
    const listedMembers = listedRoster.body as Array<{ id: number; role: string }>;
    assert.equal(
      listedMembers.filter(({ role }) => role === "owner").length,
      1,
    );
    assert.equal(
      listedMembers.find(({ id }) => id === committed.successor.id)?.role,
      "owner",
    );
    assert.equal(
      listedMembers.find(({ id }) => id === rejectedSuccessor.id)?.role,
      "professional",
    );

    const events = await db
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.workspaceId, firms.primary.workspaceId));
    const ownershipEvents = events.filter((event) =>
      event.action.startsWith("transferred firm ownership from "),
    );
    assert.equal(ownershipEvents.length, 1);
    assert.equal(
      ownershipEvents[0]?.action,
      `transferred firm ownership from ${currentOwner.displayName} to ${committed.name}`,
    );
    assert.equal(ownershipEvents[0]?.clerkUserId, firms.primary.ownerId);
    assert.equal(ownershipEvents[0]?.entityId, firms.primary.workspaceId);
    if (ownershipEvents[0]) activityIds.push(ownershipEvents[0].id);
  } finally {
    if (activityIds.length) {
      await db
        .delete(activitiesTable)
        .where(inArray(activitiesTable.id, activityIds));
    }
    await db
      .delete(membershipsTable)
      .where(inArray(membershipsTable.id, [firstSuccessor.id, secondSuccessor.id]));
    await db
      .update(membershipsTable)
      .set({ role: "owner" })
      .where(eq(membershipsTable.id, currentOwner.id));
  }
});

test("firm admins can create invitations for their firm", async (t) => {
  const adminId = `invitation-admin-${randomUUID()}`;
  const email = `admin-invite-${randomUUID()}@example.test`;
  await db.insert(membershipsTable).values({
    workspaceId: firms.primary.workspaceId,
    clerkUserId: adminId,
    email: `${adminId}@example.test`,
    displayName: "Invitation Admin",
    role: "admin",
  });
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async (params) => {
      assert.equal(params.emailAddress, email);
      return { id: "admin_created_clerk_invitation" } as never;
    },
  );

  const created = await request("/workspace/invitations", {
    userId: adminId,
    method: "POST",
    body: { email, role: "assistant" },
  });

  assert.equal(created.response.status, 201);
  assert.equal((created.body as { email: string }).email, email);
  assert.equal((created.body as { role: string }).role, "assistant");
  assert.equal(createInvitation.mock.callCount(), 1);

  const [invitation] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.email, email));
  assert.ok(invitation);
  assert.equal(invitation.workspaceId, firms.primary.workspaceId);
  assert.equal(invitation.invitedByClerkUserId, adminId);
  assert.equal(invitation.role, "assistant");
  assert.equal(invitation.clerkInvitationId, "admin_created_clerk_invitation");
});

test("firm admins cannot invite an email already used by another firm's member", async (t) => {
  const email = `cross-firm-invite-${randomUUID()}@example.test`;
  await db.insert(membershipsTable).values({
    workspaceId: firms.other.workspaceId,
    clerkUserId: `other-firm-member-${randomUUID()}`,
    email,
    displayName: "Other Firm Member",
    role: "professional",
  });
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async () => ({ id: "unexpected_cross_firm_clerk_invitation" }) as never,
  );

  const created = await request("/workspace/invitations", {
    userId: firms.primary.ownerId,
    method: "POST",
    body: { email, role: "assistant" },
  });

  assert.equal(created.response.status, 409);
  assert.deepEqual(created.body, {
    error: "That email address already belongs to a firm member.",
  });
  assert.equal(createInvitation.mock.callCount(), 0);
  const savedInvitations = await db
    .select({ id: invitationsTable.id })
    .from(invitationsTable)
    .where(eq(invitationsTable.email, email));
  assert.deepEqual(savedInvitations, []);
});

test("signed-in users without a firm cannot list or create invitations", async (t) => {
  const userId = `no-firm-invitations-${randomUUID()}`;
  const email = `no-firm-invite-${randomUUID()}@example.test`;
  const before = await db
    .select({ id: invitationsTable.id })
    .from(invitationsTable)
    .orderBy(asc(invitationsTable.id));
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async () => ({ id: "unexpected_clerk_invitation" }) as never,
  );

  const listed = await request("/workspace/invitations", { userId });
  assert.equal(listed.response.status, 403);
  assert.deepEqual(listed.body, {
    error: "You do not have access to a firm workspace.",
    code: "firm_authorization_required",
  });

  const created = await request("/workspace/invitations", {
    userId,
    method: "POST",
    body: { email, role: "assistant" },
  });
  assert.equal(created.response.status, 403);
  assert.deepEqual(created.body, {
    error: "You do not have access to a firm workspace.",
    code: "firm_authorization_required",
  });

  assert.equal(createInvitation.mock.callCount(), 0);
  const after = await db
    .select({ id: invitationsTable.id })
    .from(invitationsTable)
    .orderBy(asc(invitationsTable.id));
  assert.deepEqual(after, before);
});

test("firm viewers and professionals cannot list or create invitations", async (t) => {
  const members = await db
    .select({
      clerkUserId: membershipsTable.clerkUserId,
      role: membershipsTable.role,
    })
    .from(membershipsTable)
    .where(
      inArray(membershipsTable.role, ["viewer", "professional"]),
    );
  const ordinaryMembers = members.filter((member) =>
    ["viewer", "professional"].includes(member.role),
  );
  assert.deepEqual(
    ordinaryMembers.map((member) => member.role).sort(),
    ["professional", "viewer"],
  );

  const before = await db
    .select({ id: invitationsTable.id })
    .from(invitationsTable)
    .orderBy(asc(invitationsTable.id));
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async () => ({ id: "unexpected_clerk_invitation" }) as never,
  );

  for (const member of ordinaryMembers) {
    const listed = await request("/workspace/invitations", {
      userId: member.clerkUserId,
    });
    assert.equal(listed.response.status, 403);
    assert.deepEqual(listed.body, {
      error: "Only firm owners and admins can view invitations.",
    });

    const created = await request("/workspace/invitations", {
      userId: member.clerkUserId,
      method: "POST",
      body: {
        email: `${member.role}-${randomUUID()}@example.test`,
        role: "assistant",
      },
    });
    assert.equal(created.response.status, 403);
    assert.deepEqual(created.body, {
      error: "Only firm owners and admins can invite teammates.",
    });
  }

  assert.equal(createInvitation.mock.callCount(), 0);
  const after = await db
    .select({ id: invitationsTable.id })
    .from(invitationsTable)
    .orderBy(asc(invitationsTable.id));
  assert.deepEqual(after, before);
});

test("signed-in users without a firm cannot resend or withdraw invitations", async (t) => {
  const userId = `no-firm-invitation-actions-${randomUUID()}`;
  const token = randomUUID();
  const [pending] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email: `protected-invitation-${randomUUID()}@example.test`,
      role: "assistant",
      invitedByClerkUserId: firms.primary.ownerId,
      clerkInvitationId: `protected-clerk-invitation-${randomUUID()}`,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async () => ({ id: "unexpected_clerk_invitation" }) as never,
  );
  const revokeInvitation = t.mock.method(
    clerkClient.invitations,
    "revokeInvitation",
    async () => ({ id: pending.clerkInvitationId }) as never,
  );

  const before = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, pending.id));
  const attempts = await Promise.all([
    request(`/workspace/invitations/${pending.id}/resend`, {
      userId,
      method: "POST",
    }),
    request(`/workspace/invitations/${pending.id}`, {
      userId,
      method: "DELETE",
    }),
  ]);

  for (const { response, body } of attempts) {
    assert.equal(response.status, 403);
    assert.deepEqual(body, {
      error: "You do not have access to a firm workspace.",
      code: "firm_authorization_required",
    });
  }
  assert.equal(createInvitation.mock.callCount(), 0);
  assert.equal(revokeInvitation.mock.callCount(), 0);

  const after = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, pending.id));
  assert.deepEqual(after, before);
});

test("owners can email an invitation with the selected workspace role", async (t) => {
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async (params) => {
      assert.equal(params.emailAddress, "new-teammate@example.test");
      assert.equal(params.notify, true);
      assert.match(params.redirectUrl ?? "", /^\/invite\?token=/);
      return { id: "clerk_invitation_test" } as never;
    },
  );
  const result = await request("/workspace/invitations", {
    userId: firms.primary.ownerId,
    method: "POST",
    body: { email: "New-Teammate@example.test", role: "assistant" },
  });
  assert.equal(result.response.status, 201);
  assert.deepEqual(
    result.body,
    {
      id: (result.body as { id: number }).id,
      email: "new-teammate@example.test",
      role: "assistant",
      createdAt: (result.body as { createdAt: string }).createdAt,
      expiresAt: (result.body as { expiresAt: string }).expiresAt,
      expired: false,
      revoked: false,
      providerRevocationFailed: false,
    },
  );
  const [stored] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.email, "new-teammate@example.test"));
  assert.equal(stored.workspaceId, firms.primary.workspaceId);
  assert.equal(stored.role, "assistant");
  assert.equal(stored.clerkInvitationId, "clerk_invitation_test");
  assert.equal(createInvitation.mock.callCount(), 1);
});

test("a new invitation can be created after an older invitation expires", async (t) => {
  const email = `expired-then-created-${randomUUID()}@example.test`;
  const oldToken = randomUUID();
  const [expired] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email,
      role: "assistant",
      invitedByClerkUserId: firms.primary.ownerId,
      tokenHash: createHash("sha256").update(oldToken).digest("hex"),
      expiresAt: new Date(Date.now() - 60_000),
    })
    .returning();
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async () => ({ id: "after_expiration_clerk_invitation" }) as never,
  );

  const created = await request("/workspace/invitations", {
    userId: firms.primary.ownerId,
    method: "POST",
    body: { email: email.toUpperCase(), role: "assistant" },
  });

  assert.equal(created.response.status, 201);
  assert.equal(createInvitation.mock.callCount(), 1);
  const records = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.email, email));
  assert.equal(records.length, 2);
  assert(records.some(({ id }) => id === expired.id));
  const liveInvitations = records.filter(
    (invitation) =>
      !invitation.acceptedAt &&
      !invitation.revokedAt &&
      invitation.expiresAt > new Date(),
  );
  assert.equal(liveInvitations.length, 1);
  assert.equal(liveInvitations[0]?.clerkInvitationId, "after_expiration_clerk_invitation");
});

test("simultaneous invitations for one email create only one live invitation", async (t) => {
  const email = `simultaneous-invite-${randomUUID()}@example.test`;
  let createdCount = 0;
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async () => ({ id: `simultaneous_clerk_invitation_${++createdCount}` }) as never,
  );

  const results = await Promise.all([
    request("/workspace/invitations", {
      userId: firms.primary.ownerId,
      method: "POST",
      body: { email, role: "assistant" },
    }),
    request("/workspace/invitations", {
      userId: firms.primary.ownerId,
      method: "POST",
      body: { email: email.toUpperCase(), role: "assistant" },
    }),
  ]);

  assert.deepEqual(
    results.map(({ response }) => response.status).sort(),
    [201, 409],
  );
  assert.equal(createInvitation.mock.callCount(), 1);
  const records = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.email, email));
  assert.equal(records.length, 1);
});

test("firm admins can resend a pending invitation and invalidate its previous link", async (t) => {
  const adminId = `admin-${randomUUID()}`;
  await db.insert(membershipsTable).values({
    workspaceId: firms.primary.workspaceId,
    clerkUserId: adminId,
    email: "team-admin@example.test",
    displayName: "Team Admin",
    role: "admin",
  });
  const oldToken = randomUUID();
  const oldCreatedAt = new Date(Date.now() - 60_000);
  const [pending] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email: "resend-target@example.test",
      role: "professional",
      invitedByClerkUserId: firms.primary.ownerId,
      clerkInvitationId: "old_clerk_invitation",
      tokenHash: createHash("sha256").update(oldToken).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: oldCreatedAt,
    })
    .returning();
  let newToken = "";
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async (params) => {
      assert.equal(params.emailAddress, "resend-target@example.test");
      assert.equal(params.notify, true);
      const match = params.redirectUrl?.match(/[?&]token=([^&]+)/);
      assert(match);
      newToken = decodeURIComponent(match[1]);
      return { id: "new_clerk_invitation" } as never;
    },
  );
  const revokeInvitation = t.mock.method(
    clerkClient.invitations,
    "revokeInvitation",
    async () => ({ id: "old_clerk_invitation" }) as never,
  );

  const resent = await request(`/workspace/invitations/${pending.id}/resend`, {
    userId: adminId,
    method: "POST",
  });
  assert.equal(resent.response.status, 200);
  assert.equal(createInvitation.mock.callCount(), 1);
  assert.equal(revokeInvitation.mock.callCount(), 1);
  assert.equal(revokeInvitation.mock.calls[0].arguments[0], "old_clerk_invitation");
  assert.equal((resent.body as { id: number }).id, pending.id);
  assert.equal((resent.body as { email: string }).email, "resend-target@example.test");

  const [updated] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, pending.id));
  assert.notEqual(updated.tokenHash, createHash("sha256").update(oldToken).digest("hex"));
  assert.equal(updated.tokenHash, createHash("sha256").update(newToken).digest("hex"));
  assert.equal(updated.clerkInvitationId, "new_clerk_invitation");
  assert(updated.createdAt > oldCreatedAt);
  assert(updated.expiresAt > new Date(Date.now() + 6 * 24 * 60 * 60 * 1000));

  const listed = await request("/workspace/invitations", {
    userId: adminId,
  });
  assert.equal(listed.response.status, 200);
  const listedInvitation = (
    listed.body as Array<Record<string, unknown> & { id: number }>
  ).find(({ id }) => id === pending.id);
  assert.deepEqual(listedInvitation, {
    id: pending.id,
    email: "resend-target@example.test",
    role: "professional",
    createdAt: updated.createdAt.toISOString(),
    expiresAt: updated.expiresAt.toISOString(),
    expired: false,
    revoked: false,
    providerRevocationFailed: false,
  });
  assert.equal("tokenHash" in listedInvitation!, false);
  assert.equal("clerkInvitationId" in listedInvitation!, false);

  const oldLink = await request("/workspace/invitations/accept", {
    userId: `resend-target-${randomUUID()}`,
    method: "POST",
    body: { token: oldToken },
  });
  assert.equal(oldLink.response.status, 404);
});

test("a failed superseded Clerk revocation is visible and the old link cannot create membership", async (t) => {
  const adminId = `revocation-admin-${randomUUID()}`;
  const joiningUserId = `revocation-target-${randomUUID()}`;
  await db.insert(membershipsTable).values({
    workspaceId: firms.primary.workspaceId,
    clerkUserId: adminId,
    email: "revocation-admin@example.test",
    displayName: "Revocation Admin",
    role: "admin",
  });
  const oldToken = randomUUID();
  const [pending] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email: "revocation-target@example.test",
      role: "professional",
      invitedByClerkUserId: firms.primary.ownerId,
      clerkInvitationId: "unrevoked_superseded_clerk_invitation",
      tokenHash: createHash("sha256").update(oldToken).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  let newToken = "";
  t.mock.method(clerkClient.invitations, "createInvitation", async (params) => {
    const match = params.redirectUrl?.match(/[?&]token=([^&]+)/);
    assert(match);
    newToken = decodeURIComponent(match[1]);
    return { id: "replacement_clerk_invitation" } as never;
  });
  t.mock.method(clerkClient.invitations, "revokeInvitation", async () => {
    throw new Error("Simulated Clerk outage");
  });

  const resent = await request(`/workspace/invitations/${pending.id}/resend`, {
    userId: adminId,
    method: "POST",
  });
  assert.equal(resent.response.status, 200);
  assert.deepEqual(
    {
      email: (resent.body as { email: string }).email,
      revoked: (resent.body as { revoked: boolean }).revoked,
      providerRevocationFailed:
        (resent.body as { providerRevocationFailed: boolean }).providerRevocationFailed,
    },
    {
      email: "revocation-target@example.test",
      revoked: false,
      providerRevocationFailed: true,
    },
  );

  const listed = await request("/workspace/invitations", { userId: adminId });
  assert.equal(listed.response.status, 200);
  const flagged = (listed.body as Array<{
    id: number;
    providerRevocationFailed: boolean;
  }>).find(({ id }) => id === pending.id);
  assert.equal(flagged?.providerRevocationFailed, true);

  const oldLink = await request("/workspace/invitations/accept", {
    userId: joiningUserId,
    method: "POST",
    body: { token: oldToken },
  });
  assert.equal(oldLink.response.status, 404);
  const oldLinkMembership = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, joiningUserId));
  assert.equal(oldLinkMembership.length, 0);

  const [updated] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, pending.id));
  assert.equal(updated.tokenHash, createHash("sha256").update(newToken).digest("hex"));
  assert.equal(updated.providerRevocationFailed, true);
});

test("firm admins can renew expired invitations with a new seven-day link", async (t) => {
  const adminId = `expired-admin-${randomUUID()}`;
  await db.insert(membershipsTable).values({
    workspaceId: firms.primary.workspaceId,
    clerkUserId: adminId,
    email: "expired-admin@example.test",
    displayName: "Expired Admin",
    role: "admin",
  });
  const oldToken = randomUUID();
  const oldCreatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const [expired] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email: "expired-target@example.test",
      role: "professional",
      invitedByClerkUserId: firms.primary.ownerId,
      clerkInvitationId: "expired_clerk_invitation",
      tokenHash: createHash("sha256").update(oldToken).digest("hex"),
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      createdAt: oldCreatedAt,
    })
    .returning();
  const listed = await request("/workspace/invitations", { userId: adminId });
  assert.equal(listed.response.status, 200);
  const listedInvitation = (listed.body as Array<{ id: number; expired: boolean }>).find(
    ({ id }) => id === expired.id,
  );
  assert.equal(listedInvitation?.expired, true);

  let newToken = "";
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async (params) => {
      assert.equal(params.emailAddress, "expired-target@example.test");
      assert.equal(params.expiresInDays, 7);
      assert.equal(params.notify, true);
      const match = params.redirectUrl?.match(/[?&]token=([^&]+)/);
      assert(match);
      newToken = decodeURIComponent(match[1]);
      return { id: "renewed_clerk_invitation" } as never;
    },
  );
  const revokeInvitation = t.mock.method(
    clerkClient.invitations,
    "revokeInvitation",
    async () => ({ id: "expired_clerk_invitation" }) as never,
  );

  const renewed = await request(`/workspace/invitations/${expired.id}/resend`, {
    userId: adminId,
    method: "POST",
  });
  assert.equal(renewed.response.status, 200);
  assert.equal(createInvitation.mock.callCount(), 1);
  assert.equal(revokeInvitation.mock.callCount(), 1);
  assert.equal(revokeInvitation.mock.calls[0].arguments[0], "expired_clerk_invitation");
  assert.equal((renewed.body as { expired: boolean }).expired, false);

  const [updated] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, expired.id));
  assert.notEqual(updated.tokenHash, createHash("sha256").update(oldToken).digest("hex"));
  assert.equal(updated.tokenHash, createHash("sha256").update(newToken).digest("hex"));
  assert.equal(updated.clerkInvitationId, "renewed_clerk_invitation");
  assert(updated.createdAt > oldCreatedAt);
  assert(updated.expiresAt > new Date(Date.now() + 6 * 24 * 60 * 60 * 1000));

  const oldLink = await request("/workspace/invitations/accept", {
    userId: `expired-target-${randomUUID()}`,
    method: "POST",
    body: { token: oldToken },
  });
  assert.equal(oldLink.response.status, 404);

  const relisted = await request("/workspace/invitations", { userId: adminId });
  const renewedInvitation = (relisted.body as Array<{ id: number; expired: boolean }>).find(
    ({ id }) => id === expired.id,
  );
  assert.equal(renewedInvitation?.expired, false);
});

test("failed expired invitation renewal leaves it safe to retry", async (t) => {
  const oldToken = randomUUID();
  const oldCreatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const oldExpiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [expired] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email: `retry-expired-${randomUUID()}@example.test`,
      role: "professional",
      invitedByClerkUserId: firms.primary.ownerId,
      clerkInvitationId: "retry_old_clerk_invitation",
      tokenHash: createHash("sha256").update(oldToken).digest("hex"),
      expiresAt: oldExpiresAt,
      createdAt: oldCreatedAt,
    })
    .returning();
  const [before] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, expired.id));

  let newToken = "";
  let providerAttempts = 0;
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async (params) => {
      providerAttempts += 1;
      if (providerAttempts === 1) {
        throw new Error("Simulated email provider failure");
      }
      const match = params.redirectUrl?.match(/[?&]token=([^&]+)/);
      assert(match);
      newToken = decodeURIComponent(match[1]);
      return { id: "retry_new_clerk_invitation" } as never;
    },
  );
  const revokeInvitation = t.mock.method(
    clerkClient.invitations,
    "revokeInvitation",
    async () => ({ id: "retry_old_clerk_invitation" }) as never,
  );

  const failed = await request(`/workspace/invitations/${expired.id}/resend`, {
    userId: firms.primary.ownerId,
    method: "POST",
  });
  assert.equal(failed.response.status, 502);
  assert.equal(providerAttempts, 1);
  assert.deepEqual(failed.body, {
    error: "The invitation email could not be sent. Please try again.",
  });
  assert.equal(createInvitation.mock.callCount(), 1);

  const [afterFailure] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, expired.id));
  assert.deepEqual(afterFailure, before);
  assert.equal(afterFailure.tokenHash, createHash("sha256").update(oldToken).digest("hex"));
  assert.equal(afterFailure.clerkInvitationId, "retry_old_clerk_invitation");
  assert.equal(revokeInvitation.mock.callCount(), 0);

  const retried = await request(`/workspace/invitations/${expired.id}/resend`, {
    userId: firms.primary.ownerId,
    method: "POST",
  });
  assert.equal(retried.response.status, 200);
  assert.equal(providerAttempts, 2);
  assert.equal(createInvitation.mock.callCount(), 2);
  assert.equal(revokeInvitation.mock.callCount(), 1);
  assert.equal(revokeInvitation.mock.calls[0].arguments[0], "retry_old_clerk_invitation");

  const [renewed] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, expired.id));
  assert.equal(renewed.tokenHash, createHash("sha256").update(newToken).digest("hex"));
  assert.notEqual(renewed.tokenHash, before.tokenHash);
  assert.equal(renewed.clerkInvitationId, "retry_new_clerk_invitation");
  assert(renewed.createdAt > before.createdAt);
  assert(renewed.expiresAt > new Date(Date.now() + 6 * 24 * 60 * 60 * 1000));
});

test("renewing an expired invitation does not replace another live invitation", async (t) => {
  const email = `expired-renewal-conflict-${randomUUID()}@example.test`;
  const expiredToken = randomUUID();
  const liveToken = randomUUID();
  const [expired] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email,
      role: "professional",
      invitedByClerkUserId: firms.primary.ownerId,
      clerkInvitationId: "expired_conflict_clerk_invitation",
      tokenHash: createHash("sha256").update(expiredToken).digest("hex"),
      expiresAt: new Date(Date.now() - 60_000),
    })
    .returning();
  const [live] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email: email.toUpperCase(),
      role: "assistant",
      invitedByClerkUserId: firms.primary.ownerId,
      clerkInvitationId: "working_clerk_invitation",
      tokenHash: createHash("sha256").update(liveToken).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async () => ({ id: "unexpected_renewed_invitation" }) as never,
  );
  const revokeInvitation = t.mock.method(
    clerkClient.invitations,
    "revokeInvitation",
    async () => ({ id: "unexpected_revoked_invitation" }) as never,
  );

  const before = await db
    .select()
    .from(invitationsTable)
    .where(inArray(invitationsTable.id, [expired.id, live.id]))
    .orderBy(asc(invitationsTable.id));
  const renewed = await request(`/workspace/invitations/${expired.id}/resend`, {
    userId: firms.primary.ownerId,
    method: "POST",
  });

  assert.equal(renewed.response.status, 409);
  assert.deepEqual(renewed.body, {
    error: "A pending invitation already exists for that email address.",
  });
  assert.equal(createInvitation.mock.callCount(), 0);
  assert.equal(revokeInvitation.mock.callCount(), 0);
  const after = await db
    .select()
    .from(invitationsTable)
    .where(inArray(invitationsTable.id, [expired.id, live.id]))
    .orderBy(asc(invitationsTable.id));
  assert.deepEqual(after, before);
});

test("firm owners can renew expired invitations", async (t) => {
  const oldToken = randomUUID();
  const [expired] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email: "owner-renewal@example.test",
      role: "assistant",
      invitedByClerkUserId: firms.primary.ownerId,
      tokenHash: createHash("sha256").update(oldToken).digest("hex"),
      expiresAt: new Date(Date.now() - 60_000),
    })
    .returning();
  const createInvitation = t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async () => ({ id: "owner_renewed_clerk_invitation" }) as never,
  );

  const renewed = await request(`/workspace/invitations/${expired.id}/resend`, {
    userId: firms.primary.ownerId,
    method: "POST",
  });
  assert.equal(renewed.response.status, 200);
  assert.equal(createInvitation.mock.callCount(), 1);
  assert.equal((renewed.body as { expired: boolean }).expired, false);

  const [updated] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, expired.id));
  assert.notEqual(updated.tokenHash, createHash("sha256").update(oldToken).digest("hex"));
  assert(updated.expiresAt > new Date(Date.now() + 6 * 24 * 60 * 60 * 1000));
});

test("firm owners can withdraw a pending invitation and its link cannot be accepted", async (t) => {
  const token = randomUUID();
  const [pending] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email: "withdraw-target@example.test",
      role: "assistant",
      invitedByClerkUserId: firms.primary.ownerId,
      clerkInvitationId: "withdraw_clerk_invitation",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  const revokeInvitation = t.mock.method(
    clerkClient.invitations,
    "revokeInvitation",
    async () => ({ id: "withdraw_clerk_invitation" }) as never,
  );

  const wrongFirm = await request(`/workspace/invitations/${pending.id}`, {
    userId: firms.other.ownerId,
    method: "DELETE",
  });
  assert.equal(wrongFirm.response.status, 404);

  const withdrawn = await request(`/workspace/invitations/${pending.id}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
  });
  assert.equal(withdrawn.response.status, 200);
  assert.equal(revokeInvitation.mock.callCount(), 1);

  const [stored] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, pending.id));
  assert(stored.revokedAt);
  const listed = await request("/workspace/invitations", {
    userId: firms.primary.ownerId,
  });
  assert.equal(listed.response.status, 200);
  assert(!(listed.body as Array<{ id: number }>).some(({ id }) => id === pending.id));

  const acceptance = await request("/workspace/invitations/accept", {
    userId: `withdraw-target-${randomUUID()}`,
    method: "POST",
    body: { token },
  });
  assert.equal(acceptance.response.status, 410);
});

test("a failed Clerk revocation leaves a visible withdrawn invitation and the old link cannot create membership", async (t) => {
  const adminId = `withdraw-revocation-admin-${randomUUID()}`;
  const joiningUserId = `withdraw-revocation-target-${randomUUID()}`;
  await db.insert(membershipsTable).values({
    workspaceId: firms.primary.workspaceId,
    clerkUserId: adminId,
    email: "withdraw-revocation-admin@example.test",
    displayName: "Withdraw Revocation Admin",
    role: "admin",
  });
  const token = randomUUID();
  const [pending] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email: "withdraw-revocation-target@example.test",
      role: "assistant",
      invitedByClerkUserId: firms.primary.ownerId,
      clerkInvitationId: "unrevoked_withdrawn_clerk_invitation",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  t.mock.method(clerkClient.invitations, "revokeInvitation", async () => {
    throw new Error("Simulated Clerk outage");
  });

  const withdrawn = await request(`/workspace/invitations/${pending.id}`, {
    userId: adminId,
    method: "DELETE",
  });
  assert.equal(withdrawn.response.status, 200);
  assert.equal((withdrawn.body as { revoked: boolean }).revoked, true);
  assert.equal(
    (withdrawn.body as { providerRevocationFailed: boolean }).providerRevocationFailed,
    true,
  );

  const listed = await request("/workspace/invitations", { userId: adminId });
  assert.equal(listed.response.status, 200);
  const flagged = (listed.body as Array<{
    id: number;
    revoked: boolean;
    providerRevocationFailed: boolean;
  }>).find(({ id }) => id === pending.id);
  assert.equal(flagged?.revoked, true);
  assert.equal(flagged?.providerRevocationFailed, true);

  const oldLink = await request("/workspace/invitations/accept", {
    userId: joiningUserId,
    method: "POST",
    body: { token },
  });
  assert.equal(oldLink.response.status, 410);
  const oldLinkMembership = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, joiningUserId));
  assert.equal(oldLinkMembership.length, 0);

  const [stored] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, pending.id));
  assert(stored.revokedAt);
  assert.equal(stored.providerRevocationFailed, true);
});

test("acceptance can finish while a resend email is slow and the new Clerk invitation is revoked", async (t) => {
  const token = randomUUID();
  const email = `slow-resend-accept-${randomUUID()}@example.test`;
  const userId = `slow-resend-accept-${randomUUID()}`;
  const [pending] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email,
      role: "assistant",
      invitedByClerkUserId: firms.primary.ownerId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  t.mock.method(clerkClient.users, "getUser", async () => ({
    id: userId,
    firstName: "Slow",
    lastName: "Resend",
    primaryEmailAddress: { emailAddress: email },
    emailAddresses: [{ emailAddress: email, verification: { status: "verified" } }],
  }) as never);
  const emailCreationStarted = deferred<void>();
  const finishEmailCreation = deferred<void>();
  t.mock.method(clerkClient.invitations, "createInvitation", async () => {
    emailCreationStarted.resolve();
    await finishEmailCreation.promise;
    return { id: "slow_resend_lost_to_acceptance" } as never;
  });
  const revokeInvitation = t.mock.method(
    clerkClient.invitations,
    "revokeInvitation",
    async () => ({ id: "slow_resend_lost_to_acceptance" }) as never,
  );

  const resendPromise = request(`/workspace/invitations/${pending.id}/resend`, {
    userId: firms.primary.ownerId,
    method: "POST",
  });
  await emailCreationStarted.promise;
  const acceptancePromise = request("/workspace/invitations/accept", {
    userId,
    method: "POST",
    body: { token },
  });
  const acceptanceBeforeEmailFinishes = await Promise.race([
    acceptancePromise.then((result) => ({ completed: true as const, result })),
    new Promise<{ completed: false }>((resolve) =>
      setTimeout(() => resolve({ completed: false }), 2_000),
    ),
  ]);
  finishEmailCreation.resolve();

  const [acceptance, resent] = await Promise.all([acceptancePromise, resendPromise]);
  assert.equal(acceptanceBeforeEmailFinishes.completed, true);
  assert.equal(acceptance.response.status, 200);
  assert.equal(resent.response.status, 404);
  assert.equal(revokeInvitation.mock.callCount(), 1);
  assert.equal(revokeInvitation.mock.calls[0].arguments[0], "slow_resend_lost_to_acceptance");
  const [stored] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, pending.id));
  assert.equal(stored.tokenHash, createHash("sha256").update(token).digest("hex"));
  assert(stored.acceptedAt);
  assert.equal(stored.revokedAt, null);
  const [membership] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, userId));
  assert.ok(membership);
});

test("withdrawal can finish while a resend email is slow and the new Clerk invitation is revoked", async (t) => {
  const token = randomUUID();
  const email = `slow-resend-withdraw-${randomUUID()}@example.test`;
  const [pending] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email,
      role: "assistant",
      invitedByClerkUserId: firms.primary.ownerId,
      clerkInvitationId: "slow_resend_old_clerk_invitation",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  const emailCreationStarted = deferred<void>();
  const finishEmailCreation = deferred<void>();
  t.mock.method(clerkClient.invitations, "createInvitation", async () => {
    emailCreationStarted.resolve();
    await finishEmailCreation.promise;
    return { id: "slow_resend_lost_to_withdrawal" } as never;
  });
  const revokeInvitation = t.mock.method(
    clerkClient.invitations,
    "revokeInvitation",
    async () => ({ id: "revoked_invitation" }) as never,
  );

  const resendPromise = request(`/workspace/invitations/${pending.id}/resend`, {
    userId: firms.primary.ownerId,
    method: "POST",
  });
  await emailCreationStarted.promise;
  const withdrawalPromise = request(`/workspace/invitations/${pending.id}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
  });
  const withdrawalBeforeEmailFinishes = await Promise.race([
    withdrawalPromise.then((result) => ({ completed: true as const, result })),
    new Promise<{ completed: false }>((resolve) =>
      setTimeout(() => resolve({ completed: false }), 2_000),
    ),
  ]);
  finishEmailCreation.resolve();

  const [withdrawn, resent] = await Promise.all([withdrawalPromise, resendPromise]);
  assert.equal(withdrawalBeforeEmailFinishes.completed, true);
  assert.equal(withdrawn.response.status, 200);
  assert.equal(resent.response.status, 404);
  assert.equal(revokeInvitation.mock.callCount(), 2);
  assert.deepEqual(
    revokeInvitation.mock.calls.map((call) => call.arguments[0]).sort(),
    ["slow_resend_old_clerk_invitation", "slow_resend_lost_to_withdrawal"].sort(),
  );
  const [stored] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, pending.id));
  assert(stored.revokedAt);
  assert.equal(stored.acceptedAt, null);
  assert.equal(stored.tokenHash, createHash("sha256").update(token).digest("hex"));
});

test("a resend racing with acceptance rejects the superseded link without creating membership", async (t) => {
  const token = randomUUID();
  const email = `resend-race-${randomUUID()}@example.test`;
  const userId = `resend-race-${randomUUID()}`;
  const [pending] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email,
      role: "assistant",
      invitedByClerkUserId: firms.primary.ownerId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  const verificationStarted = deferred<void>();
  const finishVerification = deferred<void>();
  t.mock.method(clerkClient.users, "getUser", async () => {
    verificationStarted.resolve();
    await finishVerification.promise;
    return {
      id: userId,
      firstName: "Resend",
      lastName: "Race",
      primaryEmailAddress: { emailAddress: email },
      emailAddresses: [
        { emailAddress: email, verification: { status: "verified" } },
      ],
    } as never;
  });
  t.mock.method(
    clerkClient.invitations,
    "createInvitation",
    async () => ({ id: `resent-${randomUUID()}` }) as never,
  );

  const acceptancePromise = request("/workspace/invitations/accept", {
    userId,
    method: "POST",
    body: { token },
  });
  await verificationStarted.promise;

  const resent = await request(`/workspace/invitations/${pending.id}/resend`, {
    userId: firms.primary.ownerId,
    method: "POST",
  });
  assert.equal(resent.response.status, 200);
  finishVerification.resolve();

  const acceptance = await acceptancePromise;
  assert.equal(acceptance.response.status, 410);
  assert.equal(
    (acceptance.body as { error: string }).error,
    "This invitation was replaced and can no longer be accepted.",
  );

  const [stored] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, pending.id));
  assert.notEqual(stored.tokenHash, createHash("sha256").update(token).digest("hex"));
  assert.equal(stored.acceptedAt, null);
  assert.equal(stored.revokedAt, null);
  const [membership] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, userId));
  assert.equal(membership, undefined);
});

test("a withdrawal racing with acceptance rejects the withdrawn link without creating membership", async (t) => {
  const token = randomUUID();
  const email = `withdraw-race-${randomUUID()}@example.test`;
  const userId = `withdraw-race-${randomUUID()}`;
  const [pending] = await db
    .insert(invitationsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      email,
      role: "assistant",
      invitedByClerkUserId: firms.primary.ownerId,
      clerkInvitationId: `withdraw-race-${randomUUID()}`,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  const verificationStarted = deferred<void>();
  const finishVerification = deferred<void>();
  t.mock.method(clerkClient.users, "getUser", async () => {
    verificationStarted.resolve();
    await finishVerification.promise;
    return {
      id: userId,
      firstName: "Withdraw",
      lastName: "Race",
      primaryEmailAddress: { emailAddress: email },
      emailAddresses: [
        { emailAddress: email, verification: { status: "verified" } },
      ],
    } as never;
  });
  t.mock.method(
    clerkClient.invitations,
    "revokeInvitation",
    async () => ({ id: pending.clerkInvitationId }) as never,
  );

  const acceptancePromise = request("/workspace/invitations/accept", {
    userId,
    method: "POST",
    body: { token },
  });
  await verificationStarted.promise;

  const withdrawn = await request(`/workspace/invitations/${pending.id}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
  });
  assert.equal(withdrawn.response.status, 200);
  finishVerification.resolve();

  const acceptance = await acceptancePromise;
  assert.equal(acceptance.response.status, 410);
  assert.equal(
    (acceptance.body as { error: string }).error,
    "This invitation has expired, been withdrawn, or has already been used.",
  );

  const [stored] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.id, pending.id));
  assert(stored.revokedAt);
  assert.equal(stored.acceptedAt, null);
  const [membership] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, userId));
  assert.equal(membership, undefined);
});

test("invitation acceptance adds the verified invitee to the exact firm and role", async (t) => {
  const token = randomUUID();
  const email = "invited-user@example.test";
  const userId = `invitee-${randomUUID()}`;
  await db.insert(invitationsTable).values({
    workspaceId: firms.primary.workspaceId,
    email,
    role: "advisor",
    invitedByClerkUserId: firms.primary.ownerId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60_000),
  });
  t.mock.method(clerkClient.users, "getUser", async () => ({
    id: userId,
    firstName: "Invited",
    lastName: "Colleague",
    primaryEmailAddress: { emailAddress: email },
    emailAddresses: [
      {
        emailAddress: email,
        verification: { status: "verified" },
      },
    ],
  }) as never);

  const result = await request("/workspace/invitations/accept", {
    userId,
    method: "POST",
    body: { token },
  });
  assert.equal(result.response.status, 200);
  assert.equal(
    (result.body as { workspace: { id: number } }).workspace.id,
    firms.primary.workspaceId,
  );
  assert.equal((result.body as { role: string }).role, "advisor");
  const [membership] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, userId));
  assert.equal(membership.workspaceId, firms.primary.workspaceId);
  assert.equal(membership.email, email);
  assert.equal(membership.role, "advisor");
});

test("an invite cannot move a user from a different firm", async (t) => {
  const token = randomUUID();
  const email = "owner-other@example.test";
  await db.insert(invitationsTable).values({
    workspaceId: firms.primary.workspaceId,
    email,
    role: "professional",
    invitedByClerkUserId: firms.primary.ownerId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60_000),
  });
  t.mock.method(clerkClient.users, "getUser", async () => ({
    id: firms.other.ownerId,
    firstName: "Other",
    lastName: "Owner",
    primaryEmailAddress: { emailAddress: email },
    emailAddresses: [
      { emailAddress: email, verification: { status: "verified" } },
    ],
  }) as never);

  const result = await request("/workspace/invitations/accept", {
    userId: firms.other.ownerId,
    method: "POST",
    body: { token },
  });
  assert.equal(result.response.status, 409);
  assert.equal(
    (result.body as { error: string }).error,
    "This account already belongs to another firm workspace.",
  );
});

test("all permitted firm roles can create client records", async () => {
  const allowedRoles = [
    firms.primary.ownerId,
    `admin-${randomUUID()}`,
    `advisor-${randomUUID()}`,
    `professional-${randomUUID()}`,
  ];
  const [, ...additionalUsers] = allowedRoles;
  if (additionalUsers.length) {
    const [membership] = await db
      .select({ workspaceId: membershipsTable.workspaceId })
      .from(membershipsTable)
      .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId))
      .limit(1);
    assert(membership);
    await db.insert(membershipsTable).values(
      additionalUsers.map((userId, index) => ({
        workspaceId: membership.workspaceId,
        clerkUserId: userId,
        email: `${userId}@example.test`,
        displayName: "Allowed User",
        role: ["admin", "advisor", "professional"][index],
      })),
    );
  }

  for (const userId of allowedRoles) {
    const created = await request("/clients", {
      userId,
      method: "POST",
      body: { name: `Created by ${userId}`, clientType: "business" },
    });
    assert.equal(created.response.status, 201);
  }
});

test("intake drafts persist for firm teammates, stay out of review, and convert or discard safely", async () => {
  const suffix = randomUUID();
  const [teammate, viewer] = await db.insert(membershipsTable).values([
    {
      workspaceId: firms.primary.workspaceId,
      clerkUserId: `draft-teammate-${suffix}`,
      email: `draft-teammate-${suffix}@example.test`,
      displayName: `Draft Teammate ${suffix}`,
      role: "professional",
    },
    {
      workspaceId: firms.primary.workspaceId,
      clerkUserId: `draft-viewer-${suffix}`,
      email: `draft-viewer-${suffix}@example.test`,
      displayName: `Draft Viewer ${suffix}`,
      role: "viewer",
    },
  ]).returning();
  const incomplete = {
    clientId: null,
    clientName: "",
    clientType: "individual",
    email: "not-yet-a-valid-email",
    phone: null,
    industry: null,
    matterTitle: "",
    matterType: "",
    responsibleMemberId: null,
    dueAt: null,
    partyNames: [],
    answers: { identity: "Started identity check" },
  };
  const created = await request("/intake/drafts", {
    userId: firms.primary.ownerId,
    method: "POST",
    body: incomplete,
  });
  assert.equal(created.response.status, 201);
  const draftId = (created.body as { id: number }).id;
  assert.deepEqual(created.body.data, incomplete);

  const [intakeRowCount, primaryDrafts, teammateDrafts, otherFirmDrafts, viewerDrafts] = await Promise.all([
    db.select({ id: intakesTable.id }).from(intakesTable).where(eq(intakesTable.workspaceId, firms.primary.workspaceId)),
    request("/intake/drafts", { userId: firms.primary.ownerId }),
    request("/intake/drafts", { userId: teammate.clerkUserId }),
    request("/intake/drafts", { userId: firms.other.ownerId }),
    request("/intake/drafts", { userId: viewer.clerkUserId }),
  ]);
  assert.equal(intakeRowCount.some((row) => row.id === draftId), false);
  assert.equal(primaryDrafts.response.status, 200);
  assert.equal(teammateDrafts.response.status, 200);
  assert.equal(viewerDrafts.response.status, 200);
  assert(primaryDrafts.body.some((draft: { id: number }) => draft.id === draftId));
  assert(teammateDrafts.body.some((draft: { id: number }) => draft.id === draftId));
  assert.equal(otherFirmDrafts.response.status, 200);
  assert.equal(otherFirmDrafts.body.some((draft: { id: number }) => draft.id === draftId), false);

  const viewerCannotSave = await request("/intake/drafts", {
    userId: viewer.clerkUserId,
    method: "POST",
    body: incomplete,
  });
  assert.equal(viewerCannotSave.response.status, 403);
  const otherFirmCannotEdit = await request(`/intake/drafts/${draftId}`, {
    userId: firms.other.ownerId,
    method: "PUT",
    body: incomplete,
  });
  assert.equal(otherFirmCannotEdit.response.status, 404);

  const completeData = {
    clientId: null,
    clientName: `Resumed Intake Client ${suffix}`,
    clientType: "individual",
    email: null,
    phone: null,
    industry: "Advisory",
    matterTitle: `Resumed Intake Matter ${suffix}`,
    matterType: "advisory",
    responsibleMemberId: teammate.id,
    dueAt: null,
    partyNames: [`Related Party ${suffix}`],
    answers: {
      identity: "Identity confirmed",
      parties: "All parties captured",
      matter_scope: "Advisory scope recorded",
      conflicts: "Conflict search reviewed",
    },
  };
  const updated = await request(`/intake/drafts/${draftId}`, {
    userId: teammate.clerkUserId,
    method: "PUT",
    body: completeData,
  });
  assert.equal(updated.response.status, 200);
  assert.deepEqual(updated.body.data, completeData);
  const submitted = await request(`/intake/drafts/${draftId}/submit`, {
    userId: teammate.clerkUserId,
    method: "POST",
    body: {
      ...completeData,
      responsible: teammate.displayName,
    },
  });
  assert.equal(submitted.response.status, 201);
  assert.equal(submitted.body.status, "review_required");
  assert.equal(submitted.body.clientName, completeData.clientName);
  const [remainingDraft] = await db
    .select()
    .from(intakeDraftsTable)
    .where(eq(intakeDraftsTable.id, draftId));
  assert.equal(remainingDraft, undefined);
  const submittedIntake = await db
    .select()
    .from(intakesTable)
    .where(eq(intakesTable.id, submitted.body.id));
  assert.equal(submittedIntake.length, 1);

  const discardable = await request("/intake/drafts", {
    userId: teammate.clerkUserId,
    method: "POST",
    body: incomplete,
  });
  const discarded = await request(`/intake/drafts/${discardable.body.id}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
  });
  assert.equal(discarded.response.status, 204);
  const missingDraft = await request(`/intake/drafts/${discardable.body.id}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
  });
  assert.equal(missingDraft.response.status, 404);
});

test("client creation assigns a selected firm teammate and reflects their current name", async () => {
  const suffix = randomUUID();
  const [member] = await db.insert(membershipsTable).values({
    workspaceId: firms.primary.workspaceId,
    clerkUserId: `client-owner-${suffix}`,
    email: `client-owner-${suffix}@example.test`,
    displayName: `Initial Client Owner ${suffix}`,
    role: "professional",
  }).returning();
  const clientName = `Assigned Client ${suffix}`;
  const created = await request("/clients", {
    userId: firms.primary.ownerId,
    method: "POST",
    body: {
      name: clientName,
      clientType: "business",
      ownerMemberId: member.id,
    },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.ownerMemberId, member.id);
  assert.equal(created.body.owner, member.displayName);

  const renamed = `Renamed Client Owner ${suffix}`;
  await db.update(membershipsTable).set({ displayName: renamed }).where(eq(membershipsTable.id, member.id));
  const clientId = created.body.id as number;
  const [clientList, clientDetail] = await Promise.all([
    request("/clients", { userId: firms.primary.ownerId }),
    request(`/clients/${clientId}`, { userId: firms.primary.ownerId }),
  ]);
  assert.equal(clientList.body.find((row: { id: number }) => row.id === clientId).owner, renamed);
  assert.equal(clientDetail.body.owner, renamed);
  assert.equal(clientDetail.body.ownerMemberId, member.id);
});

test("client creation rejects a relationship owner from another firm", async () => {
  const [otherFirmMember] = await db.select().from(membershipsTable).where(
    eq(membershipsTable.clerkUserId, firms.other.ownerId),
  ).limit(1);
  assert(otherFirmMember);
  const name = `Cross-firm owner client ${randomUUID()}`;
  const created = await request("/clients", {
    userId: firms.primary.ownerId,
    method: "POST",
    body: {
      name,
      clientType: "individual",
      ownerMemberId: otherFirmMember.id,
    },
  });
  assert.equal(created.response.status, 400);
  assert.match(created.body.error, /active teammate in this firm/i);
  const persisted = await db.select().from(clientsTable).where(eq(clientsTable.name, name));
  assert.equal(persisted.length, 0);
});

test("owner can create, update, archive, and close records", async () => {
  const createdClient = await request("/clients", {
    userId: firms.primary.ownerId,
    method: "POST",
    body: { name: `Writable Client ${randomUUID()}`, clientType: "individual" },
  });
  assert.equal(createdClient.response.status, 201);
  const newClientId = (createdClient.body as { id: number }).id;

  const updatedClient = await request(`/clients/${newClientId}`, {
    userId: firms.primary.ownerId,
    method: "PATCH",
    body: { name: "Updated Client" },
  });
  assert.equal(updatedClient.response.status, 200);
  assert.equal((updatedClient.body as { name: string }).name, "Updated Client");
  const [existingClient] = await db
    .select({ name: clientsTable.name, clientType: clientsTable.clientType })
    .from(clientsTable)
    .where(eq(clientsTable.id, newClientId))
    .limit(1);
  assert(existingClient);
  const [primaryOwner] = await db
    .select({ id: membershipsTable.id })
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId))
    .limit(1);
  assert(primaryOwner);
  const intake = await request("/intakes", {
    userId: firms.primary.ownerId,
    method: "POST",
    body: {
      clientId: newClientId,
      clientName: existingClient.name,
      clientType: existingClient.clientType,
      matterTitle: "Writable Matter",
      matterType: "advisory",
      responsible: "Primary Owner",
      responsibleMemberId: primaryOwner.id,
      partyNames: [],
      answers: {
        identity: "Identity confirmed for test",
        parties: "Parties reviewed for test",
        matter_scope: "Test advisory scope",
        conflicts: "Conflict search reviewed",
      },
    },
  });
  assert.equal(intake.response.status, 201);
  const intakeId = (intake.body as { id: number }).id;
  const reviewedIntake = await request(`/intakes/${intakeId}/review`, {
    userId: firms.primary.ownerId,
    method: "PATCH",
    body: {
      decision: "cleared",
      note: "Test intake passed professional review.",
      conflictsResolved: false,
    },
  });
  assert.equal(reviewedIntake.response.status, 200);
  const createdMatter = await request(`/intakes/${intakeId}/open-matter`, {
    userId: firms.primary.ownerId,
    method: "POST",
  });
  assert.equal(createdMatter.response.status, 201);
  const newMatterId = (createdMatter.body as { id: number }).id;
  const updatedMatter = await request(`/matters/${newMatterId}`, {
    userId: firms.primary.ownerId,
    method: "PATCH",
    body: { title: "Updated Matter" },
  });
  assert.equal(updatedMatter.response.status, 200);
  assert.equal(
    (updatedMatter.body as { title: string }).title,
    "Updated Matter",
  );
  const closedMatter = await request(`/matters/${newMatterId}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
  });
  assert.equal(closedMatter.response.status, 204);
  const archivedClient = await request(`/clients/${newClientId}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
  });
  assert.equal(archivedClient.response.status, 204);

  const [clientRow] = await db
    .select({
      workspaceId: clientsTable.workspaceId,
      status: clientsTable.status,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, newClientId))
    .limit(1);
  const [matterRow] = await db
    .select({
      workspaceId: mattersTable.workspaceId,
      status: mattersTable.status,
    })
    .from(mattersTable)
    .where(eq(mattersTable.id, newMatterId))
    .limit(1);
  assert.equal(clientRow.status, "archived");
  assert.equal(matterRow.status, "closed");
  assert.equal(clientRow.workspaceId, matterRow.workspaceId);
});

test("read-only roles cannot create, update, archive, or close records", async () => {
  const viewerId = `viewer-${randomUUID()}`;
  const [membership] = await db
    .select({ workspaceId: membershipsTable.workspaceId })
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId))
    .limit(1);
  assert(membership);
  await db.insert(membershipsTable).values({
    workspaceId: membership.workspaceId,
    clerkUserId: viewerId,
    email: `${viewerId}@example.test`,
    displayName: "Read Only",
    role: "viewer",
  });

  const attempts = [
    request("/clients", {
      userId: viewerId,
      method: "POST",
      body: { name: "Blocked Client", clientType: "business" },
    }),
    request(`/clients/${firms.primary.clientId}`, {
      userId: viewerId,
      method: "PATCH",
      body: { name: "Must Not Change" },
    }),
    request(`/clients/${firms.primary.clientId}`, {
      userId: viewerId,
      method: "DELETE",
    }),
    request("/matters", {
      userId: viewerId,
      method: "POST",
      body: {
        clientId: firms.primary.clientId,
        title: "Blocked Matter",
        matterType: "advisory",
        responsible: "Read Only",
      },
    }),
    request(`/matters/${firms.primary.matterId}`, {
      userId: viewerId,
      method: "PATCH",
      body: { title: "Must Not Change" },
    }),
    request(`/matters/${firms.primary.matterId}`, {
      userId: viewerId,
      method: "DELETE",
    }),
  ];
  const results = await Promise.all(attempts);
  assert.deepEqual(
    results.map(({ response }) => response.status),
    [403, 403, 403, 403, 403, 403],
  );

  const [client] = await db
    .select({ name: clientsTable.name, status: clientsTable.status })
    .from(clientsTable)
    .where(eq(clientsTable.id, firms.primary.clientId))
    .limit(1);
  const [matter] = await db
    .select({ title: mattersTable.title, status: mattersTable.status })
    .from(mattersTable)
    .where(eq(mattersTable.id, firms.primary.matterId))
    .limit(1);
  assert.equal(client.status, "active");
  assert.notEqual(client.name, "Must Not Change");
  assert.equal(matter.status, "open");
  assert.notEqual(matter.title, "Must Not Change");
});

test("another firm cannot change or archive clients and matters or create a matter for their client", async () => {
  const [primaryOwner] = await db
    .select({ id: membershipsTable.id })
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId))
    .limit(1);
  assert(primaryOwner);
  const attempts = [
    request(`/clients/${firms.primary.clientId}`, {
      userId: firms.other.ownerId,
      method: "PATCH",
      body: { name: "Cross-firm change" },
    }),
    request(`/clients/${firms.primary.clientId}`, {
      userId: firms.other.ownerId,
      method: "DELETE",
    }),
    request(`/matters/${firms.primary.matterId}`, {
      userId: firms.other.ownerId,
      method: "PATCH",
      body: { title: "Cross-firm change" },
    }),
    request(`/matters/${firms.primary.matterId}`, {
      userId: firms.other.ownerId,
      method: "DELETE",
    }),
    request("/matters", {
      userId: firms.other.ownerId,
      method: "POST",
      body: {
        clientId: firms.primary.clientId,
        title: "Cross-firm matter",
        matterType: "advisory",
        responsible: "Other Firm Owner",
        responsibleMemberId: primaryOwner.id,
      },
    }),
  ];
  const results = await Promise.all(attempts);
  assert.deepEqual(
    results.map(({ response }) => response.status),
    [404, 404, 404, 404, 404],
  );

  const [client] = await db
    .select({ status: clientsTable.status })
    .from(clientsTable)
    .where(eq(clientsTable.id, firms.primary.clientId))
    .limit(1);
  const [matter] = await db
    .select({ status: mattersTable.status })
    .from(mattersTable)
    .where(eq(mattersTable.id, firms.primary.matterId))
    .limit(1);
  assert.equal(client.status, "active");
  assert.equal(matter.status, "open");
});

test("signed-in users without a firm cannot read or change firm records", async () => {
  const userId = `no-firm-${randomUUID()}`;
  const before = {
    clients: await db
      .select()
      .from(clientsTable)
      .orderBy(asc(clientsTable.id)),
    matters: await db
      .select()
      .from(mattersTable)
      .orderBy(asc(mattersTable.id)),
    activities: await db
      .select()
      .from(activitiesTable)
      .orderBy(asc(activitiesTable.id)),
  };

  const attempts = [
    request("/dashboard", { userId }),
    request("/clients", { userId }),
    request(`/clients/${firms.primary.clientId}`, { userId }),
    request("/clients", {
      userId,
      method: "POST",
      body: { name: "No Firm Client", clientType: "individual" },
    }),
    request(`/clients/${firms.primary.clientId}`, {
      userId,
      method: "PATCH",
      body: { name: "Must Not Change Client" },
    }),
    request(`/clients/${firms.primary.clientId}`, {
      userId,
      method: "DELETE",
    }),
    request("/matters", { userId }),
    request(`/matters/${firms.primary.matterId}`, { userId }),
    request("/matters", {
      userId,
      method: "POST",
      body: {
        clientId: firms.primary.clientId,
        title: "No Firm Matter",
        matterType: "advisory",
        responsible: "No Firm User",
      },
    }),
    request(`/matters/${firms.primary.matterId}`, {
      userId,
      method: "PATCH",
      body: { title: "Must Not Change Matter" },
    }),
    request(`/matters/${firms.primary.matterId}`, {
      userId,
      method: "DELETE",
    }),
    request("/activity", { userId }),
    request(`/activity/${firms.primary.activityId}`, { userId }),
  ];
  const results = await Promise.all(attempts);
  for (const { response, body } of results) {
    assert.equal(response.status, 403);
    assert.deepEqual(body, {
      error: "You do not have access to a firm workspace.",
      code: "firm_authorization_required",
    });
  }

  const after = {
    clients: await db
      .select()
      .from(clientsTable)
      .orderBy(asc(clientsTable.id)),
    matters: await db
      .select()
      .from(mattersTable)
      .orderBy(asc(mattersTable.id)),
    activities: await db
      .select()
      .from(activitiesTable)
      .orderBy(asc(activitiesTable.id)),
  };
  assert.deepEqual(after, before);
});

test("unauthenticated requests to client, matter, and activity routes remain rejected", async () => {
  const attempts = [
    request("/clients"),
    request(`/clients/${firms.primary.clientId}`),
    request("/matters"),
    request(`/matters/${firms.primary.matterId}`),
    request("/activity"),
    request("/activity/export.csv"),
    request(`/activity/${firms.primary.activityId}`),
    request("/clients", {
      method: "POST",
      body: { name: "Unauthenticated", clientType: "individual" },
    }),
    request("/matters", {
      method: "POST",
      body: {
        clientId: firms.primary.clientId,
        title: "Unauthenticated",
        matterType: "advisory",
        responsible: "Unknown",
      },
    }),
  ];
  const results = await Promise.all(attempts);
  assert.deepEqual(
    results.map(({ response }) => response.status),
    [401, 401, 401, 401, 401, 401, 401, 401, 401],
  );
  const noFirm = await request("/activity/export.csv", {
    userId: `activity-export-no-firm-${randomUUID()}`,
  });
  assert.equal(noFirm.response.status, 403);
});

test("workflow endpoints require firm membership before exposing or changing records", async () => {
  const attempts = [
    request("/billing"),
    request("/documents"),
    request("/updates"),
    request("/billing", { method: "PUT", body: {} }),
    request("/billing/time-entries", { method: "POST", body: {} }),
    request("/documents/upload-url", { method: "POST", body: {} }),
    request("/updates/drafts", { method: "POST", body: {} }),
    request("/documents/1/analyze", { method: "POST" }),
    request("/document-suggestions/1", {
      method: "PATCH",
      body: { status: "confirmed" },
    }),
  ];
  const results = await Promise.all(attempts);
  assert.deepEqual(
    results.map(({ response }) => response.status),
    Array(attempts.length).fill(401),
  );

  const noFirm = await request("/documents", {
    userId: `workflow-no-firm-${randomUUID()}`,
  });
  assert.equal(noFirm.response.status, 403);
  assert.deepEqual(noFirm.body, {
    error: "You do not have access to a firm workspace.",
    code: "firm_authorization_required",
  });
});

test("billing settings, time entries, and workflow overviews remain firm-scoped", async () => {
  const ownerId = firms.primary.ownerId;
  const nextDraftAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const firstProfile = await request("/billing", {
    userId: ownerId,
    method: "PUT",
    body: {
      matterId: firms.primary.matterId,
      feeType: "hourly",
      currency: "AUD",
      hourlyRateCents: 25_000,
      fixedFeeCents: null,
      feeDescription: "Matter advisory",
      billingCycle: "monthly",
      taxRateBps: 1_000,
      scheduleEnabled: false,
      nextDraftAt,
    },
  });
  assert.equal(firstProfile.response.status, 200);
  assert.equal(firstProfile.body.matterId, firms.primary.matterId);
  assert.match(firstProfile.body.clientName, /^Primary Client /);

  const revisedProfile = await request("/billing", {
    userId: ownerId,
    method: "PUT",
    body: {
      matterId: firms.primary.matterId,
      feeType: "hourly",
      currency: "AUD",
      hourlyRateCents: 30_000,
      fixedFeeCents: null,
      feeDescription: "Matter advisory",
      billingCycle: "monthly",
      taxRateBps: 1_000,
      scheduleEnabled: false,
      nextDraftAt,
    },
  });
  assert.equal(revisedProfile.response.status, 200);
  assert.equal(revisedProfile.body.id, firstProfile.body.id);
  assert.equal(revisedProfile.body.hourlyRateCents, 30_000);

  const entry = await request("/billing/time-entries", {
    userId: ownerId,
    method: "POST",
    body: {
      matterId: firms.primary.matterId,
      description: "Reviewed client materials",
      workDate: new Date().toISOString().slice(0, 10),
      durationMinutes: 60,
      billable: true,
    },
  });
  assert.equal(entry.response.status, 201);

  const [billing, documents, updates] = await Promise.all([
    request("/billing", { userId: ownerId }),
    request("/documents", { userId: ownerId }),
    request("/updates", { userId: ownerId }),
  ]);
  assert.equal(billing.response.status, 200);
  assert.equal(billing.body.profiles.length, 1);
  assert.equal(billing.body.timeEntries.length, 1);
  assert.equal(billing.body.timeEntries[0].description, "Reviewed client materials");
  assert.equal(documents.response.status, 200);
  assert.deepEqual(documents.body, {
    documents: [],
    suggestions: [],
    plannerItems: [],
  });
  assert.equal(updates.response.status, 200);
  assert.deepEqual(updates.body, { schedules: [], drafts: [] });

  const otherFirmBilling = await request("/billing", {
    userId: firms.other.ownerId,
  });
  assert.equal(otherFirmBilling.response.status, 200);
  assert.deepEqual(otherFirmBilling.body, {
    profiles: [],
    timeEntries: [],
    drafts: [],
  });
});

test("client-update schedules can be enabled and listed without generating a draft", async () => {
  const saved = await request("/updates/schedules", {
    userId: firms.primary.ownerId,
    method: "PUT",
    body: {
      matterId: firms.primary.matterId,
      enabled: true,
      cadence: "fortnightly",
    },
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.matterId, firms.primary.matterId);
  assert.equal(saved.body.cadence, "fortnightly");
  assert.equal(saved.body.enabled, true);
  assert.ok(saved.body.nextDraftAt);

  const overview = await request("/updates", {
    userId: firms.primary.ownerId,
  });
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.schedules.length, 1);
  assert.equal(overview.body.drafts.length, 0);
});

test("member assignments are listed and reassigned with removal in one audited change", async () => {
  const suffix = randomUUID();
  const departingName = `Departing Teammate ${suffix}`;
  const departingEmail = `departing-${suffix}@example.test`;
  const replacementName = `Replacement Teammate ${suffix}`;
  const [departing, replacement] = await db
    .insert(membershipsTable)
    .values([
      {
        workspaceId: firms.primary.workspaceId,
        clerkUserId: `departing-${suffix}`,
        email: departingEmail,
        displayName: departingName,
        role: "professional",
      },
      {
        workspaceId: firms.primary.workspaceId,
        clerkUserId: `replacement-${suffix}`,
        email: `replacement-${suffix}@example.test`,
        displayName: replacementName,
        role: "professional",
      },
    ])
    .returning();
  const [client] = await db
    .insert(clientsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      name: `Assigned Client ${suffix}`,
      owner: departingName,
    })
    .returning();
  const [otherFirmMember] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.other.workspaceId,
      clerkUserId: `other-intake-assignee-${suffix}`,
      email: `other-intake-assignee-${suffix}@example.test`,
      displayName: `Other Firm Assignee ${suffix}`,
      role: "professional",
    })
    .returning();
  const [reviewRequiredIntake, clearedIntake, otherFirmIntake] = await db
    .insert(intakesTable)
    .values([
      {
        workspaceId: firms.primary.workspaceId,
        clientName: `Intake Client ${suffix}`,
        matterTitle: `Review Required Intake ${suffix}`,
        matterType: "advisory",
        responsible: departingName,
        responsibleMemberId: departing.id,
        status: "review_required",
        createdByClerkUserId: firms.primary.ownerId,
      },
      {
        workspaceId: firms.primary.workspaceId,
        clientName: `Cleared Intake Client ${suffix}`,
        matterTitle: `Cleared Intake ${suffix}`,
        matterType: "advisory",
        responsible: departingName,
        responsibleMemberId: departing.id,
        status: "cleared",
        createdByClerkUserId: firms.primary.ownerId,
      },
      {
        workspaceId: firms.other.workspaceId,
        clientName: `Other Firm Intake Client ${suffix}`,
        matterTitle: `Other Firm Intake ${suffix}`,
        matterType: "advisory",
        responsible: otherFirmMember.displayName,
        responsibleMemberId: otherFirmMember.id,
        status: "review_required",
        createdByClerkUserId: firms.other.ownerId,
      },
    ])
    .returning();
  const [matter] = await db
    .insert(mattersTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clientId: client.id,
      title: `Assigned Matter ${suffix}`,
      reference: `ASSIGNED-${suffix}`,
      matterType: "advisory",
      responsible: departingEmail,
    })
    .returning();

  const assignments = await request(
    `/workspace/members/${departing.id}/assignments`,
    { userId: firms.primary.ownerId },
  );
  assert.equal(assignments.response.status, 200);
  assert.deepEqual(assignments.body, {
    clients: [{ id: client.id, name: client.name }],
    matters: [{
      id: matter.id,
      title: matter.title,
      reference: matter.reference,
      clientName: client.name,
    }],
    intakes: [
      {
        id: reviewRequiredIntake.id,
        clientName: reviewRequiredIntake.clientName,
        matterTitle: reviewRequiredIntake.matterTitle,
        status: "review_required",
      },
      {
        id: clearedIntake.id,
        clientName: clearedIntake.clientName,
        matterTitle: clearedIntake.matterTitle,
        status: "cleared",
      },
    ],
    unresolvedClients: [],
    unresolvedMatters: [],
  });
  const [backfilledClient] = await db.select().from(clientsTable).where(eq(clientsTable.id, client.id));
  const [backfilledMatter] = await db.select().from(mattersTable).where(eq(mattersTable.id, matter.id));
  assert.equal(backfilledClient.ownerMemberId, departing.id);
  assert.equal(backfilledMatter.responsibleMemberId, departing.id);
  const [viewer] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.role, "viewer"));
  const forbiddenAssignments = await request(
    `/workspace/members/${departing.id}/assignments`,
    { userId: viewer.clerkUserId },
  );
  assert.equal(forbiddenAssignments.response.status, 403);

  const missingReplacement = await request(`/workspace/members/${departing.id}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
  });
  assert.equal(missingReplacement.response.status, 409);
  const [unchangedIntake] = await db
    .select()
    .from(intakesTable)
    .where(eq(intakesTable.id, reviewRequiredIntake.id));
  assert.equal(unchangedIntake.responsibleMemberId, departing.id);

  const removed = await request(`/workspace/members/${departing.id}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
    body: { replacementMemberId: replacement.id },
  });
  assert.equal(removed.response.status, 204);

  const [updatedClient] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, client.id));
  const [updatedMatter] = await db
    .select()
    .from(mattersTable)
    .where(eq(mattersTable.id, matter.id));
  const remainingMembership = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.id, departing.id));
  assert.equal(updatedClient.owner, replacementName);
  assert.equal(updatedClient.ownerMemberId, replacement.id);
  assert.equal(updatedMatter.responsible, replacementName);
  assert.equal(updatedMatter.responsibleMemberId, replacement.id);
  const reassignedIntakes = await db
    .select()
    .from(intakesTable)
    .where(inArray(intakesTable.id, [reviewRequiredIntake.id, clearedIntake.id]));
  assert.equal(reassignedIntakes.length, 2);
  for (const intake of reassignedIntakes) {
    assert.equal(intake.responsible, replacementName);
    assert.equal(intake.responsibleMemberId, replacement.id);
  }
  const [untouchedOtherFirmIntake] = await db
    .select()
    .from(intakesTable)
    .where(eq(intakesTable.id, otherFirmIntake.id));
  assert.equal(untouchedOtherFirmIntake.workspaceId, firms.other.workspaceId);
  assert.equal(untouchedOtherFirmIntake.responsible, otherFirmMember.displayName);
  assert.equal(untouchedOtherFirmIntake.responsibleMemberId, otherFirmMember.id);

  const intakeOverview = await request("/intake", {
    userId: firms.primary.ownerId,
  });
  assert.equal(intakeOverview.response.status, 200);
  for (const intakeId of [reviewRequiredIntake.id, clearedIntake.id]) {
    const displayedIntake = intakeOverview.body.intakes.find(
      (intake: { id: number }) => intake.id === intakeId,
    );
    assert.equal(displayedIntake.responsible, replacementName);
  }
  assert.equal(remainingMembership.length, 0);

  const activity = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.workspaceId, firms.primary.workspaceId));
  const reassignmentEvents = activity.filter(
    (event) =>
      event.action.startsWith("reassigned ") &&
      (
        (event.entityType === "client" && event.entityId === client.id) ||
        (event.entityType === "matter" && event.entityId === matter.id) ||
        (event.entityType === "intake" &&
          [reviewRequiredIntake.id, clearedIntake.id].includes(event.entityId))
      ),
  );
  assert.equal(reassignmentEvents.length, 4);
  assert.ok(reassignmentEvents.some((event) => event.entityType === "client"));
  assert.ok(reassignmentEvents.some((event) => event.entityType === "matter"));
  assert.equal(reassignmentEvents.filter((event) => event.entityType === "intake").length, 2);
  assert.ok(activity.some((event) => event.action === `removed ${departingName} from the firm workspace`));
});

test("pending intake assignments alone require an active replacement before teammate removal", async () => {
  const suffix = randomUUID();
  const [departing, replacement] = await db
    .insert(membershipsTable)
    .values([
      {
        workspaceId: firms.primary.workspaceId,
        clerkUserId: `intake-only-departing-${suffix}`,
        email: `intake-only-departing-${suffix}@example.test`,
        displayName: `Intake Only Departing ${suffix}`,
        role: "professional",
      },
      {
        workspaceId: firms.primary.workspaceId,
        clerkUserId: `intake-only-replacement-${suffix}`,
        email: `intake-only-replacement-${suffix}@example.test`,
        displayName: `Intake Only Replacement ${suffix}`,
        role: "professional",
      },
    ])
    .returning();
  const [intake] = await db
    .insert(intakesTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clientName: `Intake Only Client ${suffix}`,
      matterTitle: `Intake Only Matter ${suffix}`,
      matterType: "advisory",
      responsible: departing.displayName,
      responsibleMemberId: departing.id,
      status: "review_required",
      createdByClerkUserId: firms.primary.ownerId,
    })
    .returning();

  const missingReplacement = await request(`/workspace/members/${departing.id}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
  });
  assert.equal(missingReplacement.response.status, 409);
  const stillActive = await db
    .select({ id: membershipsTable.id })
    .from(membershipsTable)
    .where(eq(membershipsTable.id, departing.id));
  assert.equal(stillActive.length, 1);

  const removed = await request(`/workspace/members/${departing.id}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
    body: { replacementMemberId: replacement.id },
  });
  assert.equal(removed.response.status, 204);
  const [reassigned] = await db
    .select()
    .from(intakesTable)
    .where(eq(intakesTable.id, intake.id));
  assert.equal(reassigned.responsible, replacement.displayName);
  assert.equal(reassigned.responsibleMemberId, replacement.id);
});

test("matter edits cannot restore assignment after concurrent teammate removal", async () => {
  const suffix = randomUUID();
  const departingName = `Race Departing ${suffix}`;
  const [departing] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clerkUserId: `race-departing-${suffix}`,
      email: `race-departing-${suffix}@example.test`,
      displayName: departingName,
      role: "professional",
    })
    .returning();
  const [matter] = await db
    .insert(mattersTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clientId: firms.primary.clientId,
      title: `Concurrent Assignment Matter ${suffix}`,
      reference: `RACE-${suffix}`,
      matterType: "advisory",
      responsible: "Primary Owner",
      responsibleMemberId: (
        await db
          .select({ id: membershipsTable.id })
          .from(membershipsTable)
          .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId))
          .limit(1)
      )[0].id,
    })
    .returning();

  const lockHolder = await bootstrapPool!.connect();
  await lockHolder.query("BEGIN");
  await lockHolder.query(
    `SELECT id FROM "${schemaName}".clientguard_memberships WHERE id = $1 FOR UPDATE`,
    [departing.id],
  );

  let lockReleased = false;
  try {
    const removal = request(`/workspace/members/${departing.id}`, {
      userId: firms.primary.ownerId,
      method: "DELETE",
    });
    await waitForBlockedMembershipQueries(1);

    const edit = request(`/matters/${matter.id}`, {
      userId: firms.primary.ownerId,
      method: "PATCH",
      body: { responsibleMemberId: departing.id },
    });
    await waitForBlockedMembershipQueries(2);

    await lockHolder.query("COMMIT");
    lockReleased = true;
    const [removed, edited] = await Promise.all([removal, edit]);

    assert.equal(removed.response.status, 204);
    assert.equal(edited.response.status, 409);
    assert.equal(edited.body.code, "matter_assignee_inactive");
    assert.match(edited.body.error, /Choose another teammate and try again/);

    const [savedMatter] = await db
      .select()
      .from(mattersTable)
      .where(eq(mattersTable.id, matter.id));
    const remainingMembership = await db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.id, departing.id));
    assert.notEqual(savedMatter.responsibleMemberId, departing.id);
    assert.equal(remainingMembership.length, 0);
  } finally {
    if (!lockReleased) await lockHolder.query("ROLLBACK");
    lockHolder.release();
  }
});

test("client creation and edits cannot restore ownership after concurrent teammate removal", async () => {
  const suffix = randomUUID();
  const departingName = `Client Race Departing ${suffix}`;
  const [departing] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clerkUserId: `client-race-departing-${suffix}`,
      email: `client-race-departing-${suffix}@example.test`,
      displayName: departingName,
      role: "professional",
    })
    .returning();
  const [primaryOwner] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.clerkUserId, firms.primary.ownerId))
    .limit(1);
  assert.ok(primaryOwner);
  const [client] = await db
    .insert(clientsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      name: `Concurrent Client Ownership ${suffix}`,
      owner: primaryOwner.displayName || primaryOwner.email,
      ownerMemberId: primaryOwner.id,
    })
    .returning();

  const lockHolder = await bootstrapPool!.connect();
  await lockHolder.query("BEGIN");
  await lockHolder.query(
    `SELECT id FROM "${schemaName}".clientguard_memberships WHERE id = $1 FOR UPDATE`,
    [departing.id],
  );

  let lockReleased = false;
  try {
    const removal = request(`/workspace/members/${departing.id}`, {
      userId: firms.primary.ownerId,
      method: "DELETE",
    });
    await waitForBlockedMembershipQueries(1);

    const edit = request(`/clients/${client.id}`, {
      userId: firms.primary.ownerId,
      method: "PATCH",
      body: { ownerMemberId: departing.id },
    });
    const newClientName = `Concurrent Client Creation ${suffix}`;
    const create = request("/clients", {
      userId: firms.primary.ownerId,
      method: "POST",
      body: {
        name: newClientName,
        clientType: "business",
        ownerMemberId: departing.id,
      },
    });
    await waitForBlockedMembershipQueries(3);

    await lockHolder.query("COMMIT");
    lockReleased = true;
    const [removed, edited, created] = await Promise.all([removal, edit, create]);

    assert.equal(removed.response.status, 204);
    assert.equal(edited.response.status, 409);
    assert.equal(edited.body.code, "client_owner_inactive");
    assert.match(edited.body.error, /Choose another teammate and try again/);
    assert.equal(created.response.status, 400);
    assert.match(created.body.error, /Choose an active teammate in this firm/);

    const [savedClient] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, client.id));
    const attemptedCreation = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.name, newClientName));
    const remainingMembership = await db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.id, departing.id));
    assert.equal(savedClient.ownerMemberId, primaryOwner.id);
    assert.equal(attemptedCreation.length, 0);
    assert.equal(remainingMembership.length, 0);
  } finally {
    if (!lockReleased) await lockHolder.query("ROLLBACK");
    lockHolder.release();
  }
});

test("duplicate teammate names require an explicit active member choice to resolve legacy assignments", async () => {
  const suffix = randomUUID();
  const duplicateName = `Shared Name ${suffix}`;
  const [first, second] = await db.insert(membershipsTable).values([
    {
      workspaceId: firms.primary.workspaceId,
      clerkUserId: `duplicate-a-${suffix}`,
      email: `duplicate-a-${suffix}@example.test`,
      displayName: duplicateName,
      role: "professional",
    },
    {
      workspaceId: firms.primary.workspaceId,
      clerkUserId: `duplicate-b-${suffix}`,
      email: `duplicate-b-${suffix}@example.test`,
      displayName: duplicateName,
      role: "professional",
    },
  ]).returning();
  const [replacement] = await db.insert(membershipsTable).values({
    workspaceId: firms.primary.workspaceId,
    clerkUserId: `duplicate-replacement-${suffix}`,
    email: `duplicate-replacement-${suffix}@example.test`,
    displayName: `Replacement ${suffix}`,
    role: "professional",
  }).returning();
  const [viewer] = await db.insert(membershipsTable).values({
    workspaceId: firms.primary.workspaceId,
    clerkUserId: `duplicate-viewer-${suffix}`,
    email: `duplicate-viewer-${suffix}@example.test`,
    displayName: `Viewer ${suffix}`,
    role: "viewer",
  }).returning();
  const [client] = await db.insert(clientsTable).values({
    workspaceId: firms.primary.workspaceId,
    name: `Ambiguous Client ${suffix}`,
    owner: duplicateName,
  }).returning();
  const [matter] = await db.insert(mattersTable).values({
    workspaceId: firms.primary.workspaceId,
    clientId: client.id,
    title: `Ambiguous Matter ${suffix}`,
    reference: `AMBIGUOUS-${suffix}`,
    matterType: "advisory",
    responsible: duplicateName,
  }).returning();

  const issues = await request("/workspace/assignment-issues", {
    userId: firms.primary.ownerId,
  });
  assert.equal(issues.response.status, 200);
  assert.ok(issues.body.clients.some((issue: { id: number; label: string }) =>
    issue.id === client.id && issue.label === duplicateName));
  assert.ok(issues.body.matters.some((issue: { id: number; label: string }) =>
    issue.id === matter.id && issue.label === duplicateName));
  const missingSelection = await request(
    `/workspace/assignment-issues/client/${client.id}/resolve`,
    { userId: firms.primary.ownerId, method: "PATCH", body: {} },
  );
  assert.equal(missingSelection.response.status, 400);
  const deniedResolution = await request(
    `/workspace/assignment-issues/client/${client.id}/resolve`,
    { userId: viewer.clerkUserId, method: "PATCH", body: { memberId: second.id } },
  );
  assert.equal(deniedResolution.response.status, 403);

  const foreignMember = (await db.select().from(membershipsTable).where(
    eq(membershipsTable.clerkUserId, firms.other.ownerId),
  ))[0];
  const foreignMemberResolution = await request(
    `/workspace/assignment-issues/client/${client.id}/resolve`,
    { userId: firms.primary.ownerId, method: "PATCH", body: { memberId: foreignMember.id } },
  );
  assert.equal(foreignMemberResolution.response.status, 400);

  const preview = await request(`/workspace/members/${first.id}/assignments`, {
    userId: firms.primary.ownerId,
  });
  assert.equal(preview.response.status, 200);
  assert.deepEqual(preview.body.clients, []);
  assert.deepEqual(preview.body.matters, []);
  assert.deepEqual(preview.body.unresolvedClients, [
    { id: client.id, name: client.name, label: duplicateName },
  ]);
  assert.deepEqual(preview.body.unresolvedMatters, [{
    id: matter.id,
    title: matter.title,
    reference: matter.reference,
    clientName: client.name,
    label: duplicateName,
  }]);

  const removal = await request(`/workspace/members/${first.id}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
    body: { replacementMemberId: replacement.id },
  });
  assert.equal(removal.response.status, 409);
  assert.equal(removal.body.code, "unresolved_assignments");
  const remaining = await db.select().from(membershipsTable).where(eq(membershipsTable.id, first.id));
  assert.equal(remaining.length, 1);
  assert.equal(second.displayName, duplicateName);

  const selectedName = `Confirmed Teammate ${suffix}`;
  await db.update(membershipsTable)
    .set({ displayName: selectedName })
    .where(eq(membershipsTable.id, second.id));

  const resolvedClient = await request(
    `/workspace/assignment-issues/client/${client.id}/resolve`,
    { userId: firms.primary.ownerId, method: "PATCH", body: { memberId: second.id } },
  );
  assert.equal(resolvedClient.response.status, 200);
  assert.deepEqual(resolvedClient.body, {
    entityType: "client",
    id: client.id,
    memberId: second.id,
    label: selectedName,
  });
  const resolvedMatter = await request(
    `/workspace/assignment-issues/matter/${matter.id}/resolve`,
    { userId: firms.primary.ownerId, method: "PATCH", body: { memberId: second.id } },
  );
  assert.equal(resolvedMatter.response.status, 200);
  assert.deepEqual(resolvedMatter.body, {
    entityType: "matter",
    id: matter.id,
    memberId: second.id,
    label: selectedName,
  });

  const [savedClient] = await db.select().from(clientsTable).where(eq(clientsTable.id, client.id));
  const [savedMatter] = await db.select().from(mattersTable).where(eq(mattersTable.id, matter.id));
  assert.equal(savedClient.ownerMemberId, second.id);
  assert.equal(savedClient.owner, selectedName);
  assert.equal(savedMatter.responsibleMemberId, second.id);
  assert.equal(savedMatter.responsible, selectedName);
  const resolutionActivity = await db.select().from(activitiesTable).where(
    eq(activitiesTable.workspaceId, firms.primary.workspaceId),
  );
  assert.ok(resolutionActivity.some((event) =>
    event.entityType === "client" &&
    event.entityId === client.id &&
    event.action === `resolved legacy client owner label to ${selectedName}`));
  assert.ok(resolutionActivity.some((event) =>
    event.entityType === "matter" &&
    event.entityId === matter.id &&
    event.action === `resolved legacy matter responsibility label to ${selectedName}`));

  const duplicateResolution = await request(
    `/workspace/assignment-issues/client/${client.id}/resolve`,
    { userId: firms.primary.ownerId, method: "PATCH", body: { memberId: first.id } },
  );
  assert.equal(duplicateResolution.response.status, 409);
  const hiddenForeignAssignment = await request(
    `/workspace/assignment-issues/client/${firms.other.clientId}/resolve`,
    { userId: firms.primary.ownerId, method: "PATCH", body: { memberId: second.id } },
  );
  assert.equal(hiddenForeignAssignment.response.status, 404);

  const refreshedIssues = await request("/workspace/assignment-issues", {
    userId: firms.primary.ownerId,
  });
  assert.equal(refreshedIssues.response.status, 200);
  assert.equal(refreshedIssues.body.clients.some((issue: { id: number }) => issue.id === client.id), false);
  assert.equal(refreshedIssues.body.matters.some((issue: { id: number }) => issue.id === matter.id), false);
});

test("renamed members keep their client and matter assignments and can transfer them safely", async () => {
  const suffix = randomUUID();
  const [member, replacement] = await db.insert(membershipsTable).values([
    {
      workspaceId: firms.primary.workspaceId,
      clerkUserId: `renamed-${suffix}`,
      email: `renamed-${suffix}@example.test`,
      displayName: `Old Name ${suffix}`,
      role: "professional",
    },
    {
      workspaceId: firms.primary.workspaceId,
      clerkUserId: `renamed-replacement-${suffix}`,
      email: `renamed-replacement-${suffix}@example.test`,
      displayName: `New Owner ${suffix}`,
      role: "professional",
    },
  ]).returning();
  const [client] = await db.insert(clientsTable).values({
    workspaceId: firms.primary.workspaceId,
    name: `Renamed Client ${suffix}`,
    owner: member.displayName,
    ownerMemberId: member.id,
  }).returning();
  const [matter] = await db.insert(mattersTable).values({
    workspaceId: firms.primary.workspaceId,
    clientId: client.id,
    title: `Renamed Matter ${suffix}`,
    reference: `RENAMED-${suffix}`,
    matterType: "advisory",
    responsible: member.displayName,
    responsibleMemberId: member.id,
  }).returning();
  const renamed = `Updated Name ${suffix}`;
  await db.update(membershipsTable).set({ displayName: renamed }).where(eq(membershipsTable.id, member.id));

  const clientList = await request("/clients", { userId: firms.primary.ownerId });
  const matterList = await request("/matters", { userId: firms.primary.ownerId });
  assert.equal(clientList.body.find((row: { id: number }) => row.id === client.id).owner, renamed);
  assert.equal(matterList.body.find((row: { id: number }) => row.id === matter.id).responsible, renamed);
  const preview = await request(`/workspace/members/${member.id}/assignments`, {
    userId: firms.primary.ownerId,
  });
  assert.ok(preview.body.clients.some((row: { id: number }) => row.id === client.id));
  assert.ok(preview.body.matters.some((row: { id: number }) => row.id === matter.id));

  const clientEdit = await request(`/clients/${client.id}`, {
    userId: firms.primary.ownerId,
    method: "PATCH",
    body: { ownerMemberId: replacement.id },
  });
  const matterEdit = await request(`/matters/${matter.id}`, {
    userId: firms.primary.ownerId,
    method: "PATCH",
    body: { responsibleMemberId: replacement.id },
  });
  assert.equal(clientEdit.response.status, 200);
  assert.equal(matterEdit.response.status, 200);
  assert.equal(clientEdit.body.ownerMemberId, replacement.id);
  assert.equal(matterEdit.body.responsibleMemberId, replacement.id);
  await request(`/clients/${client.id}`, {
    userId: firms.primary.ownerId,
    method: "PATCH",
    body: { ownerMemberId: member.id },
  });
  await request(`/matters/${matter.id}`, {
    userId: firms.primary.ownerId,
    method: "PATCH",
    body: { responsibleMemberId: member.id },
  });

  const removal = await request(`/workspace/members/${member.id}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
    body: { replacementMemberId: replacement.id },
  });
  assert.equal(removal.response.status, 204);
  const [updatedClient] = await db.select().from(clientsTable).where(eq(clientsTable.id, client.id));
  const [updatedMatter] = await db.select().from(mattersTable).where(eq(mattersTable.id, matter.id));
  assert.equal(updatedClient.ownerMemberId, replacement.id);
  assert.equal(updatedMatter.responsibleMemberId, replacement.id);
});

test("member access is not removed when assigned work has no replacement", async () => {
  const suffix = randomUUID();
  const [departing] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clerkUserId: `unreassigned-${suffix}`,
      email: `unreassigned-${suffix}@example.test`,
      displayName: `Unreassigned Teammate ${suffix}`,
      role: "professional",
    })
    .returning();
  const [client] = await db
    .insert(clientsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      name: `Protected Client ${suffix}`,
      owner: departing.displayName,
    })
    .returning();

  const removal = await request(`/workspace/members/${departing.id}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
  });
  assert.equal(removal.response.status, 409);

  const [stillActive] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.id, departing.id));
  const [stillAssigned] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, client.id));
  assert.ok(stillActive);
  assert.equal(stillAssigned.owner, departing.displayName);
});

test("client portal views stay scoped when a client is also a firm member", async () => {
  const suffix = randomUUID();
  const [clientPortalMatter] = await db
    .select()
    .from(mattersTable)
    .where(eq(mattersTable.id, firms.primary.matterId));
  assert.ok(clientPortalMatter);
  const [otherClient] = await db
    .insert(clientsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      name: `Other Portal Client ${suffix}`,
      owner: "Primary Owner",
    })
    .returning();
  const [otherClientMatter] = await db
    .insert(mattersTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clientId: otherClient.id,
      title: `Other Portal Matter ${suffix}`,
      reference: `PORTAL-${suffix.slice(0, 8)}`,
      matterType: "advisory",
      responsible: "Primary Owner",
    })
    .returning();
  await db.insert(portalAccessTable).values({
    workspaceId: firms.primary.workspaceId,
    clientId: firms.primary.clientId,
    email: "owner-primary@example.test",
    clerkUserId: firms.primary.ownerId,
    status: "active",
    invitedByClerkUserId: firms.primary.ownerId,
  });
  const [clientRequest] = await db.insert(portalRequestsTable).values({
    workspaceId: firms.primary.workspaceId,
    clientId: firms.primary.clientId,
    matterId: clientPortalMatter.id,
    title: `Client-only request ${suffix}`,
    details: "Only the granted client should see this.",
    createdByClerkUserId: firms.primary.ownerId,
  }).returning();
  await db.insert(portalRequestsTable).values({
    workspaceId: firms.primary.workspaceId,
    clientId: otherClient.id,
    matterId: otherClientMatter.id,
    title: `Different client request ${suffix}`,
    details: "This belongs to another client in the same firm.",
    createdByClerkUserId: firms.primary.ownerId,
  });

  const clientRequests = await request("/portal/requests?view=client", {
    userId: firms.primary.ownerId,
  });
  assert.equal(clientRequests.response.status, 200);
  assert.deepEqual(
    (clientRequests.body as Array<{ id: number }>).map((item) => item.id),
    [clientRequest.id],
  );
  const firmRequests = await request("/portal/requests?view=firm", {
    userId: firms.primary.ownerId,
  });
  assert.equal(firmRequests.response.status, 200);
  assert.equal((firmRequests.body as Array<{ id: number }>).length, 2);

  const clientMessage = await request("/portal/messages?view=client", {
    userId: firms.primary.ownerId,
    method: "POST",
    body: {
      matterId: clientPortalMatter.id,
      body: "Message from the client portal.",
    },
  });
  assert.equal(clientMessage.response.status, 201);
  assert.equal((clientMessage.body as { senderType: string }).senderType, "client");
  const crossClientMessage = await request("/portal/messages?view=client", {
    userId: firms.primary.ownerId,
    method: "POST",
    body: {
      matterId: otherClientMatter.id,
      body: "This must be rejected.",
    },
  });
  assert.equal(crossClientMessage.response.status, 404);

  const clientMessages = await request("/portal/messages?view=client", {
    userId: firms.primary.ownerId,
  });
  assert.equal(clientMessages.response.status, 200);
  assert.equal((clientMessages.body as Array<{ senderType: string }>).length, 1);
  assert.equal((clientMessages.body as Array<{ senderType: string }>)[0].senderType, "client");
});

test("client portal documents stay private across clients and audit upload, download, and denied access", async (t) => {
  const suffix = randomUUID();
  const portalUserId = `document-portal-${suffix}`;
  const [otherClient] = await db
    .insert(clientsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      name: `Document Test Other Client ${suffix}`,
      owner: "Primary Owner",
      status: "active",
    })
    .returning();
  const [otherClientMatter] = await db
    .insert(mattersTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      clientId: otherClient.id,
      title: `Document Test Other Matter ${suffix}`,
      reference: `DOCUMENT-${suffix.slice(0, 8)}`,
      matterType: "advisory",
      responsible: "Primary Owner",
    })
    .returning();
  await db.insert(portalAccessTable).values({
    workspaceId: firms.primary.workspaceId,
    clientId: firms.primary.clientId,
    email: `${portalUserId}@example.test`,
    clerkUserId: portalUserId,
    status: "active",
    invitedByClerkUserId: firms.primary.ownerId,
  });

  const [sharedDocument] = await db
    .insert(documentsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      matterId: firms.primary.matterId,
      uploadedByClerkUserId: firms.primary.ownerId,
      objectPath: `/objects/uploads/shared-${suffix}`,
      originalName: `Shared ${suffix}.txt`,
      contentType: "text/plain",
      sizeBytes: 23,
      status: "ready",
      clientVisible: true,
    })
    .returning();
  const [internalDocument] = await db
    .insert(documentsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      matterId: firms.primary.matterId,
      uploadedByClerkUserId: firms.primary.ownerId,
      objectPath: `/objects/uploads/internal-${suffix}`,
      originalName: `Internal ${suffix}.txt`,
      contentType: "text/plain",
      sizeBytes: 18,
      status: "ready",
      clientVisible: false,
    })
    .returning();
  const [otherClientDocument] = await db
    .insert(documentsTable)
    .values({
      workspaceId: firms.primary.workspaceId,
      matterId: otherClientMatter.id,
      uploadedByClerkUserId: firms.primary.ownerId,
      objectPath: `/objects/uploads/other-client-${suffix}`,
      originalName: `Other Client ${suffix}.txt`,
      contentType: "text/plain",
      sizeBytes: 20,
      status: "ready",
      clientVisible: true,
    })
    .returning();
  const [otherFirmDocument] = await db
    .insert(documentsTable)
    .values({
      workspaceId: firms.other.workspaceId,
      matterId: firms.other.matterId,
      uploadedByClerkUserId: firms.other.ownerId,
      objectPath: `/objects/uploads/other-firm-${suffix}`,
      originalName: `Other Firm ${suffix}.txt`,
      contentType: "text/plain",
      sizeBytes: 17,
      status: "ready",
      clientVisible: true,
    })
    .returning();

  const storedFile = (objectPath: string) => ({
    getMetadata: async () => [{
      size: objectPath.endsWith("portal-upload-test") ? "5" : "23",
      contentType: "text/plain",
    }],
    createReadStream: () => Readable.from(["shared private document"]),
  });
  t.mock.method(
    ObjectStorageServiceClass.prototype,
    "getObjectEntityUploadURL",
    async () => "https://storage.googleapis.com/test/uploads/portal-upload-test",
  );
  t.mock.method(
    ObjectStorageServiceClass.prototype,
    "normalizeObjectEntityPath",
    () => "/objects/uploads/portal-upload-test",
  );
  t.mock.method(
    ObjectStorageServiceClass.prototype,
    "getObjectEntityFile",
    async (objectPath: string) => storedFile(objectPath) as never,
  );

  const context = await request("/portal/context", { userId: portalUserId });
  assert.equal(context.response.status, 200);
  const listedDocuments = (
    context.body as { documents: Array<{ id: number; matterId: number }> }
  ).documents;
  assert.deepEqual(
    listedDocuments.map(({ id }) => id),
    [sharedDocument.id],
  );
  assert.equal(listedDocuments[0]?.matterId, firms.primary.matterId);

  const downloaded = await fetch(
    `${baseUrl}/portal/documents/${sharedDocument.id}/file`,
    { headers: { "x-test-user-id": portalUserId } },
  );
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), "shared private document");
  assert.equal(downloaded.headers.get("cache-control"), "private, no-store");

  for (const documentId of [
    internalDocument.id,
    otherClientDocument.id,
    otherFirmDocument.id,
  ]) {
    const denied = await request(`/portal/documents/${documentId}/file`, {
      userId: portalUserId,
    });
    assert.equal(denied.response.status, 404);
    assert.deepEqual(denied.body, { error: "Shared document not found." });
  }

  const rejectedMatterUpload = await request("/portal/documents/upload-url", {
    userId: portalUserId,
    method: "POST",
    body: {
      matterId: otherClientMatter.id,
      name: "not-ours.txt",
      size: 5,
      contentType: "text/plain",
    },
  });
  assert.equal(rejectedMatterUpload.response.status, 404);

  const rejectedInternalUploadCompletion = await request(
    `/portal/documents/${internalDocument.id}/complete`,
    { userId: portalUserId, method: "POST", body: {} },
  );
  assert.equal(rejectedInternalUploadCompletion.response.status, 404);

  const upload = await request("/portal/documents/upload-url", {
    userId: portalUserId,
    method: "POST",
    body: {
      matterId: firms.primary.matterId,
      name: "client-upload.txt",
      size: 5,
      contentType: "text/plain",
    },
  });
  assert.equal(upload.response.status, 200);
  const uploadId = (upload.body as { id: number }).id;
  const [uploadRecord] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, uploadId));
  assert.equal(uploadRecord.clientVisible, false);
  assert.equal(uploadRecord.uploadedFromPortal, true);
  assert.equal(uploadRecord.status, "uploading");

  const completedUpload = await request(
    `/portal/documents/${uploadId}/complete`,
    { userId: portalUserId, method: "POST", body: {} },
  );
  assert.equal(completedUpload.response.status, 200);
  assert.equal((completedUpload.body as { status: string }).status, "ready");

  const events = await db
    .select()
    .from(auditEventsTable)
    .where(and(
      eq(auditEventsTable.workspaceId, firms.primary.workspaceId),
      eq(auditEventsTable.clerkUserId, portalUserId),
    ));
  assert.ok(events.some((event) =>
    event.action === "client_portal_document_downloaded" &&
    event.entityId === sharedDocument.matterId &&
    event.details.documentId === sharedDocument.id,
  ));
  assert.ok(events.some((event) =>
    event.action === "client_portal_document_upload_started" &&
    event.entityId === firms.primary.matterId &&
    event.details.documentId === uploadId,
  ));
  assert.ok(events.some((event) =>
    event.action === "client_portal_document_uploaded" &&
    event.entityId === firms.primary.matterId &&
    event.details.documentId === uploadId,
  ));

  const deniedEvents = events.filter((event) =>
    event.action === "client_portal_document_access_denied",
  );
  assert.equal(deniedEvents.length, 5);
  assert.deepEqual(
    deniedEvents.map((event) => event.details.operation).sort(),
    ["download", "download", "download", "upload", "upload_complete"],
  );
  assert.ok(deniedEvents.every((event) =>
    event.entityLabel === "Unavailable document" ||
    event.entityLabel === "Unavailable matter",
  ));
});
