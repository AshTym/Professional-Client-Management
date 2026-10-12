import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import express, { type Request } from "express";
import { eq } from "drizzle-orm";
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
  } = database);

  const [primaryWorkspace] = await db
    .insert(workspacesTable)
    .values({ name: `Primary ${randomUUID()}`, practiceType: "law" })
    .returning();
  const [otherWorkspace] = await db
    .insert(workspacesTable)
    .values({ name: `Other ${randomUUID()}`, practiceType: "law" })
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
  const archivedClient = await request(`/clients/${newClientId}`, {
    userId: firms.primary.ownerId,
    method: "DELETE",
  });
  assert.equal(archivedClient.response.status, 204);

  const createdMatter = await request("/matters", {
    userId: firms.primary.ownerId,
    method: "POST",
    body: {
      clientId: firms.primary.clientId,
      title: "Writable Matter",
      matterType: "advisory",
      responsible: "Primary Owner",
    },
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
