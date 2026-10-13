import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import express, { type Request } from "express";
import { Pool } from "pg";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { encryptToken } from "../src/lib/clientguard-provider-service.ts";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalEncryptionKey = process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY;
const schemaName = `clientguard_provider_sync_test_${randomUUID().replaceAll("-", "")}`;
const userId = `provider-sync-owner-${randomUUID()}`;
let bootstrapPool: Pool | undefined;
let appPool: Pool | undefined;
let schemaCreated = false;
let server: Server | undefined;
let baseUrl = "";
let db: typeof import("@workspace/db").db;
let workspacesTable: typeof import("@workspace/db").workspacesTable;
let membershipsTable: typeof import("@workspace/db").membershipsTable;
let plannerItemsTable: typeof import("@workspace/db").plannerItemsTable;
let providerConnectionsTable: typeof import("@workspace/db").providerConnectionsTable;
let providerSyncsTable: typeof import("@workspace/db").providerSyncsTable;
let fixture: { workspaceId: number; plannerItemId: number };

before(async () => {
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL is required for provider sync tests.");
  process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY = "provider-sync-test-key-that-is-not-a-secret";
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
      workspace_id integer NOT NULL,
      clerk_user_id text NOT NULL,
      email text NOT NULL DEFAULT '',
      display_name text NOT NULL DEFAULT 'User',
      role text NOT NULL DEFAULT 'professional',
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (clerk_user_id)
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
    CREATE TABLE "${schemaName}".clientguard_provider_connections (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL,
      provider text NOT NULL,
      account_label text NOT NULL DEFAULT 'Connected account',
      remote_account_id text,
      remote_base_uri text,
      access_token_ciphertext text NOT NULL,
      refresh_token_ciphertext text,
      token_expires_at timestamptz,
      scopes text[] NOT NULL DEFAULT '{}',
      connected_by_clerk_user_id text NOT NULL,
      last_sync_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, provider)
    );
    CREATE TABLE "${schemaName}".clientguard_provider_syncs (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL,
      provider text NOT NULL,
      entity_type text NOT NULL,
      entity_id integer NOT NULL,
      external_id text NOT NULL,
      idempotency_key text,
      remote_record_id text,
      sync_status text NOT NULL DEFAULT 'synced',
      synced_by_clerk_user_id text NOT NULL,
      synced_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, provider, entity_type, entity_id),
      UNIQUE (idempotency_key)
    );
    CREATE TABLE "${schemaName}".clientguard_audit_events (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL,
      clerk_user_id text NOT NULL,
      actor text NOT NULL,
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id integer,
      entity_label text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}',
      occurred_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const isolatedUrl = new URL(originalDatabaseUrl);
  isolatedUrl.searchParams.set("options", `-c search_path=${schemaName}`);
  process.env.DATABASE_URL = isolatedUrl.toString();
  const database = await import("@workspace/db");
  ({ db, pool: appPool, workspacesTable, membershipsTable, plannerItemsTable, providerConnectionsTable, providerSyncsTable } = database);

  const [workspace] = await db.insert(workspacesTable).values({
    name: `Provider sync test ${randomUUID()}`,
    practiceType: "law",
  }).returning();
  await db.insert(membershipsTable).values({
    workspaceId: workspace.id,
    clerkUserId: userId,
    email: "provider-sync-owner@example.test",
    displayName: "Provider Sync Owner",
    role: "owner",
  });
  const [plannerItem] = await db.insert(plannerItemsTable).values({
    workspaceId: workspace.id,
    matterId: 1,
    documentId: 1,
    kind: "deadline",
    title: "File reviewed submission",
    details: "Confirmed from the source document.",
    dueAt: new Date(Date.now() + 86_400_000),
    sourcePage: 1,
    sourceQuote: "Submission is due tomorrow.",
    confirmedByClerkUserId: userId,
  }).returning();
  await db.insert(providerConnectionsTable).values({
    workspaceId: workspace.id,
    provider: "google",
    accountLabel: "Test Google account",
    accessTokenCiphertext: encryptToken("provider-test-access-token"),
    tokenExpiresAt: new Date(Date.now() + 3_600_000),
    connectedByClerkUserId: userId,
  });
  fixture = { workspaceId: workspace.id, plannerItemId: plannerItem.id };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { log: { warn: () => void } }).log = { warn: () => undefined };
    const authHandler = Object.assign(
      () => ({
        tokenType: "session_token",
        userId,
        sessionClaims: { sub: userId, email: "provider-sync-owner@example.test", name: "Provider Sync Owner" },
      }),
      { [Symbol.for("@clerk/express.auth")]: true },
    );
    (req as Request & { auth: typeof authHandler }).auth = authHandler;
    next();
  });
  const { default: router } = await import("../src/routes/clientguard-integrations.ts");
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
  if (originalEncryptionKey === undefined) delete process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY;
  else process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
});

async function syncPlannerItem() {
  return fetch(`${baseUrl}/integrations/google/calendar/${fixture.plannerItemId}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

test("a calendar event accepted before a network timeout is reconciled instead of duplicated", async (t) => {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const remoteEvents = new Map<string, Record<string, unknown>>();
  let createCount = 0;
  let lookupAvailable = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("https://www.googleapis.com/calendar/")) return originalFetch(input, init);

    if ((init?.method ?? "GET").toUpperCase() === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const id = String(body.id);
      createCount += 1;
      remoteEvents.set(id, { ...body, id });
      throw new TypeError("Connection closed after Google accepted the event.");
    }

    if (!lookupAvailable) throw new TypeError("Simulated temporary Calendar read failure.");
    const id = decodeURIComponent(url.split("/").at(-1) ?? "");
    const event = remoteEvents.get(id);
    return event
      ? new Response(JSON.stringify(event), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  });

  const first = await syncPlannerItem();
  assert.equal(first.status, 409);
  const firstBody = await first.json() as { code: string; syncStatus: string };
  assert.equal(firstBody.code, "provider_sync_uncertain");
  assert.equal(firstBody.syncStatus, "uncertain");
  assert.equal(createCount, 1);
  const [uncertain] = await db.select().from(providerSyncsTable);
  assert.equal(uncertain.syncStatus, "uncertain");
  assert.ok(uncertain.idempotencyKey);
  assert.equal(remoteEvents.size, 1);
  assert.equal([...remoteEvents.keys()][0], uncertain.idempotencyKey!.replaceAll("-", "").toLowerCase());

  lookupAvailable = true;
  const retry = await syncPlannerItem();
  assert.equal(retry.status, 200);
  const retryBody = await retry.json() as { externalId: string };
  assert.equal(retryBody.externalId, [...remoteEvents.keys()][0]);
  assert.equal(createCount, 1, "retry must find the accepted event without another POST");

  const [completed] = await db.select().from(providerSyncsTable);
  assert.equal(completed.syncStatus, "synced");
  assert.equal(completed.externalId, retryBody.externalId);

  const duplicate = await syncPlannerItem();
  assert.equal(duplicate.status, 409);
  const duplicateBody = await duplicate.json() as { code: string };
  assert.equal(duplicateBody.code, "provider_sync_completed");
  assert.equal(createCount, 1, "a completed sync must remain blocked from creating a second event");
});
