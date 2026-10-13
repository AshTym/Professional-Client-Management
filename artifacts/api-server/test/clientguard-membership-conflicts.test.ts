import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import express, { type Request } from "express";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import type { Server } from "node:http";

const originalDatabaseUrl = process.env.DATABASE_URL;
const schemaName = `clientguard_conflicts_${randomUUID().replaceAll("-", "")}`;
const firmAName = `Northbank Legal ${randomUUID()}`;
const firmBName = `Harbour Finance ${randomUUID()}`;
const firmAOwnerId = `firm-a-owner-${randomUUID()}`;
const firmBOwnerId = `firm-b-owner-${randomUUID()}`;
const firmAViewerId = `firm-a-viewer-${randomUUID()}`;
const replacementId = `replacement-${randomUUID()}`;
const conflictingUserId = `shared-user-${randomUUID()}`;

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
let activitiesTable: typeof import("@workspace/db").activitiesTable;
let auditEventsTable: typeof import("@workspace/db").auditEventsTable;
let firmAWorkspaceId = 0;
let firmBWorkspaceId = 0;
let conflictingMembershipAId = 0;
let conflictingMembershipBId = 0;
let firmAOwnerMembershipId = 0;
let replacementMembershipId = 0;
let assignedClientId = 0;
let assignedMatterId = 0;

before(async () => {
  if (!originalDatabaseUrl) {
    throw new Error("DATABASE_URL is required to run membership-conflict tests.");
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
    CREATE TABLE "${schemaName}".clientguard_audit_events (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES "${schemaName}".clientguard_workspaces(id) ON DELETE CASCADE,
      clerk_user_id text NOT NULL,
      actor text NOT NULL,
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id integer,
      entity_label text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      occurred_at timestamptz NOT NULL DEFAULT now()
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
    clientsTable,
    mattersTable,
    activitiesTable,
    auditEventsTable,
  } = database);

  const [firmA] = await db
    .insert(workspacesTable)
    .values({ name: firmAName, practiceType: "law" })
    .returning();
  const [firmB] = await db
    .insert(workspacesTable)
    .values({ name: firmBName, practiceType: "financial" })
    .returning();
  firmAWorkspaceId = firmA.id;
  firmBWorkspaceId = firmB.id;

  const [firmAOwner] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firmA.id,
      clerkUserId: firmAOwnerId,
      email: "owner-a@example.test",
      displayName: "Firm A Owner",
      role: "owner",
    })
    .returning();
  firmAOwnerMembershipId = firmAOwner.id;
  const [firmBOwner] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firmB.id,
      clerkUserId: firmBOwnerId,
      email: "owner-b@example.test",
      displayName: "Firm B Owner",
      role: "owner",
    })
    .returning();
  assert.ok(firmBOwner.id);
  const [replacement] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firmA.id,
      clerkUserId: replacementId,
      email: "replacement@example.test",
      displayName: "Firm A Replacement",
      role: "professional",
    })
    .returning();
  replacementMembershipId = replacement.id;
  await db.insert(membershipsTable).values({
    workspaceId: firmA.id,
    clerkUserId: firmAViewerId,
    email: "viewer-a@example.test",
    displayName: "Firm A Viewer",
    role: "professional",
  });
  const [conflictA] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firmA.id,
      clerkUserId: conflictingUserId,
      email: "shared-person@example.test",
      displayName: "Shared Person",
      role: "advisor",
    })
    .returning();
  conflictingMembershipAId = conflictA.id;
  const [conflictB] = await db
    .insert(membershipsTable)
    .values({
      workspaceId: firmB.id,
      clerkUserId: conflictingUserId,
      email: "shared-person@example.test",
      displayName: "Shared Person",
      role: "professional",
    })
    .returning();
  conflictingMembershipBId = conflictB.id;
  await db.insert(membershipsTable).values({
    workspaceId: firmB.id,
    clerkUserId: firmAOwnerId,
    email: "owner-a@example.test",
    displayName: "Firm A Owner",
    role: "admin",
    createdAt: new Date(Date.now() - 60_000),
  });

  const [client] = await db
    .insert(clientsTable)
    .values({
      workspaceId: firmA.id,
      name: "Shared Person Client",
      owner: "Shared Person",
    })
    .returning();
  assignedClientId = client.id;
  const [matter] = await db
    .insert(mattersTable)
    .values({
      workspaceId: firmA.id,
      clientId: client.id,
      title: "Shared Person Matter",
      reference: "SHARED-001",
      matterType: "advisory",
      responsible: "shared-person@example.test",
    })
    .returning();
  assignedMatterId = matter.id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user-id") || null;
    const authHandler = Object.assign(
      () => ({
        tokenType: "session_token",
        userId,
        sessionClaims: userId
          ? { sub: userId, email: `${userId}@example.test`, name: "Test Firm Admin" }
          : null,
      }),
      { [Symbol.for("@clerk/express.auth")]: true },
    );
    (req as Request & { auth: typeof authHandler }).auth = authHandler;
    next();
  });
  const { default: router } = await import("../src/routes/clientguard.ts");
  app.use("/api", router);
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

test("each firm admin reviews only local memberships and removals preserve assigned records", async () => {
  const responseA = await request("/workspace/membership-conflicts", {
    userId: firmAOwnerId,
  });
  assert.equal(responseA.response.status, 200);
  const conflictA = responseA.body.find(
    (item: { membershipId: number }) => item.membershipId === conflictingMembershipAId,
  );
  assert.ok(conflictA);
  assert.equal(conflictA.firmName, firmAName);
  assert.equal(conflictA.otherFirmCount, 1);
  assert.equal(conflictA.otherMembershipCount, 1);
  assert.ok(!JSON.stringify(responseA.body).includes(firmBName));
  assert.ok(!JSON.stringify(responseA.body).includes(conflictingUserId));
  assert.ok(
    responseA.body.some(
      (item: { membershipId: number }) => item.membershipId === firmAOwnerMembershipId,
    ),
    "duplicate owner identity is visible only as the current firm's own membership",
  );

  const responseB = await request("/workspace/membership-conflicts", {
    userId: firmBOwnerId,
  });
  assert.equal(responseB.response.status, 200);
  const conflictB = responseB.body.find(
    (item: { membershipId: number }) => item.membershipId === conflictingMembershipBId,
  );
  assert.ok(conflictB);
  assert.equal(conflictB.firmName, firmBName);
  assert.ok(!JSON.stringify(responseB.body).includes(firmAName));

  const forbidden = await request("/workspace/membership-conflicts", {
    userId: firmAViewerId,
  });
  assert.equal(forbidden.response.status, 403);

  const protectedOwner = await request(
    `/workspace/membership-conflicts/${firmAOwnerMembershipId}/decision`,
    {
      userId: firmAOwnerId,
      method: "POST",
      body: { decision: "remove", reason: "Remove duplicate owner access" },
    },
  );
  assert.equal(protectedOwner.response.status, 409);
  assert.equal(protectedOwner.body.code, "firm_owner_protected");

  const retainA = await request(
    `/workspace/membership-conflicts/${conflictingMembershipAId}/decision`,
    {
      userId: firmAOwnerId,
      method: "POST",
      body: { decision: "retain", reason: "This person needs firm A access" },
    },
  );
  assert.equal(retainA.response.status, 200);
  assert.equal(retainA.body.decision, "retain");
  assert.equal(retainA.body.accessRemoved, false);

  const retainB = await request(
    `/workspace/membership-conflicts/${conflictingMembershipBId}/decision`,
    {
      userId: firmBOwnerId,
      method: "POST",
      body: { decision: "retain", reason: "This person needs firm B access" },
    },
  );
  assert.equal(retainB.response.status, 200);

  const missingReplacement = await request(
    `/workspace/membership-conflicts/${conflictingMembershipAId}/decision`,
    {
      userId: firmAOwnerId,
      method: "POST",
      body: { decision: "remove", reason: "Remove duplicate firm A access" },
    },
  );
  assert.equal(missingReplacement.response.status, 409);
  assert.equal(
    missingReplacement.body.code,
    "membership_assignments_replacement_required",
  );

  const removed = await request(
    `/workspace/membership-conflicts/${conflictingMembershipAId}/decision`,
    {
      userId: firmAOwnerId,
      method: "POST",
      body: {
        decision: "remove",
        reason: "Remove duplicate firm A access",
        replacementMemberId: replacementMembershipId,
      },
    },
  );
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.decision, "remove");
  assert.equal(removed.body.accessRemoved, true);
  assert.equal(removed.body.remainingMembershipCount, 1);

  const remainingA = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.id, conflictingMembershipAId));
  const remainingB = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.id, conflictingMembershipBId));
  assert.equal(remainingA.length, 0);
  assert.equal(remainingB.length, 1);

  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, assignedClientId));
  const [matter] = await db
    .select()
    .from(mattersTable)
    .where(eq(mattersTable.id, assignedMatterId));
  assert.equal(client.owner, "Firm A Replacement");
  assert.equal(matter.responsible, "Firm A Replacement");

  const firmAReviews = await db
    .select()
    .from(auditEventsTable)
    .where(eq(auditEventsTable.workspaceId, firmAWorkspaceId));
  const firmBReviews = await db
    .select()
    .from(auditEventsTable)
    .where(eq(auditEventsTable.workspaceId, firmBWorkspaceId));
  assert.deepEqual(
    firmAReviews
      .filter((review) =>
        review.entityType === "membership_access_conflict" &&
        review.entityId === conflictingMembershipAId,
      )
      .map((review) => review.details.decision),
    ["retain", "remove"],
  );
  const lastFirmAReview = firmAReviews
    .filter(
      (review) =>
        review.entityType === "membership_access_conflict" &&
        review.entityId === conflictingMembershipAId,
    )
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id - b.id)
    .at(-1);
  assert.equal(lastFirmAReview?.clerkUserId, firmAOwnerId);
  assert.equal(lastFirmAReview?.details.replacementMemberId, replacementMembershipId);
  assert.deepEqual(
    firmBReviews
      .filter((review) => review.entityType === "membership_access_conflict")
      .map((review) => review.details.decision),
    ["retain"],
  );

  const auditEvents = await db
    .select()
    .from(auditEventsTable)
    .where(eq(auditEventsTable.workspaceId, firmAWorkspaceId));
  assert.equal(
    auditEvents.filter((event) => event.entityType === "membership_access_conflict").length,
    2,
  );
  assert.ok(auditEvents.every((event) => event.clerkUserId === firmAOwnerId));
  assert.ok(
    !(await db
      .select()
      .from(auditEventsTable)
      .where(eq(auditEventsTable.workspaceId, firmBWorkspaceId)))
      .some((event) => event.clerkUserId === firmAOwnerId),
  );

  const reassignmentActivities = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.workspaceId, firmAWorkspaceId));
  assert.ok(reassignmentActivities.some((event) => event.entityId === assignedClientId));
  assert.ok(reassignmentActivities.some((event) => event.entityId === assignedMatterId));
});
