import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import express, { type Request } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
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
let activitiesTable: typeof import("@workspace/db").activitiesTable;
let portalAccessTable: typeof import("@workspace/db").portalAccessTable;
let portalMessagesTable: typeof import("@workspace/db").portalMessagesTable;
let portalRequestsTable: typeof import("@workspace/db").portalRequestsTable;

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
    CREATE TABLE "${schemaName}".clientguard_intake_settings (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL UNIQUE REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      checks jsonb NOT NULL DEFAULT '[]',
      updated_by_clerk_user_id text NOT NULL,
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
    activitiesTable,
    portalAccessTable,
    portalMessagesTable,
    portalRequestsTable,
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
    next();
  });
  const { default: router } = await import("../src/routes/clientguard.ts");
  const { default: workflowRouter } = await import(
    "../src/routes/clientguard-workflows.ts"
  );
  const { default: operationsRouter } = await import(
    "../src/routes/clientguard-operations.ts"
  );
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
        action.startsWith(`${firmName} tied dashboard event `),
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
    (activity.body as Array<{ action: string }>).map(({ action }) => action),
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
    const exported = await request("/audit/exports", {
      userId: firms.primary.ownerId,
      method: "POST",
      body: { scope: "selected", matterIds: [firms.primary.matterId] },
    });
    assert.equal(exported.response.status, 204);

    const activity = await request("/activity", {
      userId: firms.primary.ownerId,
    });
    assert.equal(activity.response.status, 200);
    const events = activity.body as Array<{
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
      body: { scope: "all", matterIds: [firms.primary.matterId] },
    });
    assert.equal(partialAllExport.response.status, 400);

    const allMattersExport = await request("/audit/exports", {
      userId: firms.primary.ownerId,
      method: "POST",
      body: {
        scope: "all",
        matterIds: [firms.primary.matterId, additionalMatter.id],
      },
    });
    assert.equal(allMattersExport.response.status, 204);

    const otherFirmActivity = await request("/activity", {
      userId: firms.other.ownerId,
    });
    assert.equal(otherFirmActivity.response.status, 200);
    assert.equal(
      (otherFirmActivity.body as Array<{ action: string }>).some((event) =>
        event.action.includes("exported"),
      ),
      false,
    );

    const crossFirmExport = await request("/audit/exports", {
      userId: firms.primary.ownerId,
      method: "POST",
      body: { scope: "all", matterIds: [firms.other.matterId] },
    });
    assert.equal(crossFirmExport.response.status, 404);
    const activityAfterRejectedExport = await request("/activity", {
      userId: firms.primary.ownerId,
    });
    const exportEvents = (
      activityAfterRejectedExport.body as Array<{ action: string }>
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
      (firstPage.body as Array<{ action: string }>).map(({ action }) => action),
      [primaryActions[2], primaryActions[1]],
    );

    const secondPage = await request("/activity?limit=2&offset=2", {
      userId: firms.primary.ownerId,
    });
    assert.equal(secondPage.response.status, 200);
    assert.deepEqual(
      (secondPage.body as Array<{ action: string }>).map(({ action }) => action),
      [primaryActions[0], "primary-only activity"],
    );
    assert(
      (secondPage.body as Array<{ action: string }>).every(
        ({ action }) => !action.startsWith("other"),
      ),
    );

    const pastLastPage = await request("/activity?limit=2&offset=4", {
      userId: firms.primary.ownerId,
    });
    assert.equal(pastLastPage.response.status, 200);
    assert.deepEqual(pastLastPage.body, []);

    const otherFirmPage = await request("/activity?limit=2&offset=0", {
      userId: firms.other.ownerId,
    });
    assert.equal(otherFirmPage.response.status, 200);
    assert.deepEqual(
      (otherFirmPage.body as Array<{ action: string }>).map(({ action }) => action),
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

test("ownership transfer remains committed when owner notification emails fail", async (t) => {
  const successorId = `ownership-notice-failure-${randomUUID()}`;
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
  const previousNotificationSender = process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL;
  process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL = "notifications@example.test";
  const activityIds: number[] = [];
  const createEmail = t.mock.method(
    clerkClient.emails,
    "create",
    async () => {
      throw new Error("Email provider unavailable");
    },
  );

  try {
    const transferred = await request(
      `/workspace/members/${successor.id}/transfer-ownership`,
      { userId: firms.primary.ownerId, method: "POST" },
    );
    assert.equal(transferred.response.status, 200);
    assert.equal(createEmail.mock.callCount(), 2);

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
  assert((listed.body as Array<{ id: number }>).some(({ id }) => id === pending.id));

  const oldLink = await request("/workspace/invitations/accept", {
    userId: `resend-target-${randomUUID()}`,
    method: "POST",
    body: { token: oldToken },
  });
  assert.equal(oldLink.response.status, 404);
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
  assert.equal(withdrawn.response.status, 204);
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
  assert.equal(withdrawn.response.status, 204);
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
    [401, 401, 401, 401, 401, 401, 401, 401],
  );
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
  });
  const [viewer] = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.role, "viewer"));
  const forbiddenAssignments = await request(
    `/workspace/members/${departing.id}/assignments`,
    { userId: viewer.clerkUserId },
  );
  assert.equal(forbiddenAssignments.response.status, 403);

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
  assert.equal(updatedMatter.responsible, replacementName);
  assert.equal(remainingMembership.length, 0);

  const activity = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.workspaceId, firms.primary.workspaceId));
  const reassignmentEvents = activity.filter(
    (event) =>
      (event.entityId === client.id || event.entityId === matter.id) &&
      event.action.startsWith("reassigned "),
  );
  assert.equal(reassignmentEvents.length, 2);
  assert.ok(reassignmentEvents.some((event) => event.entityType === "client"));
  assert.ok(reassignmentEvents.some((event) => event.entityType === "matter"));
  assert.ok(activity.some((event) => event.action === `removed ${departingName} from the firm workspace`));
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
