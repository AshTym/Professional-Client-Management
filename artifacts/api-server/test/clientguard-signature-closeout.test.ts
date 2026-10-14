import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import express, { type Request } from "express";
import { Pool } from "pg";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { encryptToken } from "../src/lib/clientguard-provider-service.ts";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalEncryptionKey = process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY;
const schemaName = `clientguard_signature_closeout_${randomUUID().replaceAll("-", "")}`;
const userId = `signature-closeout-owner-${randomUUID()}`;
let bootstrapPool: Pool | undefined;
let appPool: Pool | undefined;
let schemaCreated = false;
let server: Server | undefined;
let baseUrl = "";
let workspaceId = 0;
let clientId = 0;
let db: typeof import("@workspace/db").db;
let workspacesTable: typeof import("@workspace/db").workspacesTable;
let membershipsTable: typeof import("@workspace/db").membershipsTable;
let clientsTable: typeof import("@workspace/db").clientsTable;
let mattersTable: typeof import("@workspace/db").mattersTable;
let practiceSettingsTable: typeof import("@workspace/db").practiceSettingsTable;
let engagementLettersTable: typeof import("@workspace/db").engagementLettersTable;
let documentsTable: typeof import("@workspace/db").documentsTable;
let providerConnectionsTable: typeof import("@workspace/db").providerConnectionsTable;
let auditEventsTable: typeof import("@workspace/db").auditEventsTable;
let activitiesTable: typeof import("@workspace/db").activitiesTable;
let matterCloseoutItemsTable: typeof import("@workspace/db").matterCloseoutItemsTable;
let matterFollowupsTable: typeof import("@workspace/db").matterFollowupsTable;
let legalHoldsTable: typeof import("@workspace/db").legalHoldsTable;

before(async () => {
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL is required for signature and closeout tests.");
  process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY = "signature-closeout-test-encryption-key";
  bootstrapPool = new Pool({ connectionString: originalDatabaseUrl });
  await bootstrapPool.query(`CREATE SCHEMA "${schemaName}"`);
  schemaCreated = true;
  await bootstrapPool.query(`
    CREATE TABLE "${schemaName}".clientguard_workspaces (
      id serial PRIMARY KEY, name text NOT NULL, practice_type text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_memberships (
      id serial PRIMARY KEY, workspace_id integer NOT NULL, clerk_user_id text NOT NULL UNIQUE,
      email text NOT NULL DEFAULT '', display_name text NOT NULL DEFAULT 'User',
      role text NOT NULL DEFAULT 'professional', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_clients (
      id serial PRIMARY KEY, workspace_id integer NOT NULL, name text NOT NULL,
      client_type text NOT NULL DEFAULT 'individual', email text, phone text, industry text,
      status text NOT NULL DEFAULT 'prospect', owner text NOT NULL DEFAULT 'Firm user',
      owner_member_id integer, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_matters (
      id serial PRIMARY KEY, workspace_id integer NOT NULL, client_id integer NOT NULL,
      title text NOT NULL, reference text NOT NULL, matter_type text NOT NULL,
      status text NOT NULL DEFAULT 'open', risk_level text NOT NULL DEFAULT 'medium',
      responsible text NOT NULL DEFAULT 'Firm user', responsible_member_id integer,
      due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_activities (
      id serial PRIMARY KEY, workspace_id integer NOT NULL, clerk_user_id text NOT NULL,
      actor text NOT NULL, action text NOT NULL, entity_type text NOT NULL,
      entity_id integer NOT NULL, entity_label text NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_audit_events (
      id serial PRIMARY KEY, workspace_id integer NOT NULL, clerk_user_id text NOT NULL,
      actor text NOT NULL, action text NOT NULL, entity_type text NOT NULL,
      entity_id integer, entity_label text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
      occurred_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_practice_settings (
      id serial PRIMARY KEY, workspace_id integer NOT NULL UNIQUE,
      require_engagement_signature boolean NOT NULL DEFAULT false,
      supported_jurisdictions text[] NOT NULL DEFAULT '{}',
      updated_by_clerk_user_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_documents (
      id serial PRIMARY KEY, workspace_id integer NOT NULL, matter_id integer NOT NULL,
      uploaded_by_clerk_user_id text NOT NULL, object_path text NOT NULL,
      original_name text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL,
      status text NOT NULL DEFAULT 'uploading', client_visible boolean NOT NULL DEFAULT false,
      uploaded_from_portal boolean NOT NULL DEFAULT false, reviewed_at timestamptz,
      last_analysis_error text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_engagement_letters (
      id serial PRIMARY KEY, workspace_id integer NOT NULL, matter_id integer NOT NULL,
      revision integer NOT NULL DEFAULT 1, client_name text NOT NULL, client_email text NOT NULL,
      matter_title text NOT NULL, scope text NOT NULL, billing_terms text NOT NULL,
      status text NOT NULL DEFAULT 'draft', provider text NOT NULL DEFAULT 'docusign',
      envelope_id text, draft_document_id integer, signed_document_id integer,
      created_by_clerk_user_id text NOT NULL, sent_at timestamptz, signed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, matter_id, revision)
    );
    CREATE TABLE "${schemaName}".clientguard_provider_connections (
      id serial PRIMARY KEY, workspace_id integer NOT NULL, provider text NOT NULL,
      account_label text NOT NULL DEFAULT 'Connected account', remote_account_id text,
      remote_base_uri text, access_token_ciphertext text NOT NULL, refresh_token_ciphertext text,
      token_expires_at timestamptz, scopes text[] NOT NULL DEFAULT '{}',
      connected_by_clerk_user_id text NOT NULL, last_sync_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (workspace_id, provider)
    );
    CREATE TABLE "${schemaName}".clientguard_matter_closeout_items (
      id serial PRIMARY KEY, workspace_id integer NOT NULL, matter_id integer NOT NULL,
      item_key text NOT NULL, title text NOT NULL, status text NOT NULL DEFAULT 'open',
      completed_by_clerk_user_id text, completed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (workspace_id, matter_id, item_key)
    );
    CREATE TABLE "${schemaName}".clientguard_closeout_checklist_settings (
      id serial PRIMARY KEY, workspace_id integer NOT NULL UNIQUE, checklists jsonb NOT NULL,
      updated_by_clerk_user_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_matter_followups (
      id serial PRIMARY KEY, workspace_id integer NOT NULL, matter_id integer NOT NULL,
      due_at timestamptz NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'open',
      created_by_clerk_user_id text NOT NULL, completed_by_clerk_user_id text,
      completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_retention_settings (
      id serial PRIMARY KEY, workspace_id integer NOT NULL UNIQUE,
      matter_retention_days integer NOT NULL DEFAULT 2555,
      audit_retention_days integer NOT NULL DEFAULT 2555,
      updated_by_clerk_user_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${schemaName}".clientguard_legal_holds (
      id serial PRIMARY KEY, workspace_id integer NOT NULL, entity_type text NOT NULL,
      entity_id integer NOT NULL, reason text NOT NULL, placed_by_clerk_user_id text NOT NULL,
      placed_at timestamptz NOT NULL DEFAULT now(), released_by_clerk_user_id text,
      released_at timestamptz
    );
    CREATE TABLE "${schemaName}".test_audit_control (
      id integer PRIMARY KEY, reject_action text
    );
    INSERT INTO "${schemaName}".test_audit_control (id) VALUES (1);
    CREATE FUNCTION "${schemaName}".reject_selected_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE selected_action text;
    BEGIN
      SELECT reject_action INTO selected_action FROM "${schemaName}".test_audit_control WHERE id = 1;
      IF selected_action = NEW.action THEN
        RAISE EXCEPTION 'simulated audit storage failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER reject_selected_audit BEFORE INSERT ON "${schemaName}".clientguard_audit_events
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_selected_audit();
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
    practiceSettingsTable,
    engagementLettersTable,
    documentsTable,
    providerConnectionsTable,
    auditEventsTable,
    activitiesTable,
    matterCloseoutItemsTable,
    matterFollowupsTable,
    legalHoldsTable,
  } = database);

  const [workspace] = await db.insert(workspacesTable).values({
    name: `Signature and closeout test ${randomUUID()}`,
    practiceType: "law",
  }).returning();
  workspaceId = workspace.id;
  await db.insert(membershipsTable).values({
    workspaceId,
    clerkUserId: userId,
    email: "owner@example.test",
    displayName: "Test Owner",
    role: "owner",
  });
  const [client] = await db.insert(clientsTable).values({
    workspaceId,
    name: "Test Client",
    owner: "Test Owner",
  }).returning();
  clientId = client.id;
  await db.insert(practiceSettingsTable).values({
    workspaceId,
    requireEngagementSignature: true,
    updatedByClerkUserId: userId,
  });
  await db.insert(providerConnectionsTable).values({
    workspaceId,
    provider: "docusign",
    accountLabel: "Test DocuSign",
    remoteAccountId: "test-account",
    remoteBaseUri: "https://demo.docusign.net/restapi/v2.1",
    accessTokenCiphertext: encryptToken("test-access-token"),
    connectedByClerkUserId: userId,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authHandler = Object.assign(
      () => ({
        tokenType: "session_token",
        userId,
        sessionClaims: { sub: userId, email: "owner@example.test", name: "Test Owner" },
      }),
      { [Symbol.for("@clerk/express.auth")]: true },
    );
    (req as Request & { auth: typeof authHandler }).auth = authHandler;
    (req as Request & { log: { warn: () => void } }).log = { warn: () => undefined };
    next();
  });
  const { default: matterRouter } = await import("../src/routes/clientguard.ts");
  const { default: engagementRouter } = await import("../src/routes/clientguard-engagements.ts");
  const { default: closeoutRouter } = await import("../src/routes/clientguard-closeout.ts");
  app.use("/api", matterRouter, engagementRouter, closeoutRouter);
  app.use((error: Error, _req: Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message });
  });
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
  if (server) await new Promise<void>((resolve, reject) =>
    server!.close((error) => error ? reject(error) : resolve()),
  );
  if (appPool) await appPool.end();
  if (bootstrapPool) {
    if (schemaCreated) await bootstrapPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await bootstrapPool.end();
  }
  if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalEncryptionKey === undefined) delete process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY;
  else process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
});

async function request(path: string, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createMatter(status: "open" | "on_hold" | "closed" = "on_hold") {
  const [matter] = await db.insert(mattersTable).values({
    workspaceId,
    clientId,
    title: `Matter ${randomUUID()}`,
    reference: `TEST-${randomUUID()}`,
    matterType: "advisory",
    status,
    responsible: "Test Owner",
  }).returning();
  return matter;
}

async function createLetter(matterId: number, status: "draft" | "sent" | "completed" = "draft") {
  const [document] = await db.insert(documentsTable).values({
    workspaceId,
    matterId,
    uploadedByClerkUserId: userId,
    objectPath: "/objects/uploads/draft.pdf",
    originalName: "draft.pdf",
    contentType: "application/pdf",
    sizeBytes: 9,
    status: "ready",
  }).returning();
  const [letter] = await db.insert(engagementLettersTable).values({
    workspaceId,
    matterId,
    clientName: "Test Client",
    clientEmail: "client@example.test",
    matterTitle: "Test Matter",
    scope: "Legal advice",
    billingTerms: "Fixed fee",
    status,
    envelopeId: status === "draft" ? null : "envelope-test",
    draftDocumentId: document.id,
    createdByClerkUserId: userId,
  }).returning();
  return letter;
}

async function rejectAuditAction(action: string | null) {
  assert(bootstrapPool);
  await bootstrapPool.query(
    `UPDATE "${schemaName}".test_audit_control SET reject_action = $1 WHERE id = 1`,
    [action],
  );
}

async function mockStorage(t: TestContext) {
  const { ObjectStorageService } = await import("../src/lib/objectStorage.ts");
  mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async () =>
    ({ download: async () => [Buffer.from("draft pdf")] }) as unknown as Awaited<
      ReturnType<typeof ObjectStorageService.prototype.getObjectEntityFile>
    >,
  );
  mock.method(ObjectStorageService.prototype, "getObjectEntityUploadURL", async () =>
    "https://storage.googleapis.com/test-bucket/uploads/signed.pdf",
  );
  mock.method(ObjectStorageService.prototype, "normalizeObjectEntityPath", () =>
    "/objects/uploads/signed.pdf",
  );
  mock.method(ObjectStorageService.prototype, "trySetObjectEntityAclPolicy", async () => "/objects/uploads/signed.pdf");
}

test("required engagement signatures gate opening and signed matters can then be opened", async () => {
  const matter = await createMatter();
  const blocked = await request(`/matters/${matter.id}`, "PATCH", { status: "open" });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json() as { code: string }).code, "engagement_signature_required");
  const [unchanged] = await db.select().from(mattersTable).where(
    eq(mattersTable.id, matter.id),
  );
  assert.equal(unchanged.status, "on_hold");

  await createLetter(matter.id, "completed");
  const opened = await request(`/matters/${matter.id}`, "PATCH", { status: "open" });
  assert.equal(opened.status, 200);
  assert.equal((await opened.json() as { status: string }).status, "open");
});

test("DocuSign sends recover from provider and audit failures without advancing a draft", async (t) => {
  await mockStorage(t);
  const matter = await createMatter();
  const letter = await createLetter(matter.id);
  const originalFetch = globalThis.fetch.bind(globalThis);
  const sendAttempts: string[] = [];
  let providerSendFails = true;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/envelopes") && (init?.method ?? "GET") === "POST") {
      const body = JSON.parse(String(init?.body)) as { transactionId: string };
      sendAttempts.push(body.transactionId);
      if (providerSendFails) return Response.json({ message: "provider unavailable" }, { status: 503 });
      return Response.json({ envelopeId: "envelope-test" });
    }
    return originalFetch(input, init);
  });

  const providerFailure = await request(`/engagement-letters/${letter.id}/send`, "POST", {});
  assert.equal(providerFailure.status, 502);
  assert.equal((await db.select().from(engagementLettersTable).where(
    eq(engagementLettersTable.id, letter.id),
  ))[0].status, "draft");

  providerSendFails = false;
  await rejectAuditAction("engagement_letter_sent");
  const auditFailure = await request(`/engagement-letters/${letter.id}/send`, "POST", {});
  assert.equal(auditFailure.status, 502);
  assert.equal((await db.select().from(engagementLettersTable).where(
    eq(engagementLettersTable.id, letter.id),
  ))[0].status, "draft");

  await rejectAuditAction(null);
  const retried = await request(`/engagement-letters/${letter.id}/send`, "POST", {});
  assert.equal(retried.status, 200);
  assert.equal((await retried.json() as { status: string }).status, "sent");
  assert.equal(sendAttempts.length, 3);
  assert.equal(new Set(sendAttempts).size, 1);
  assert.equal((await db.select().from(auditEventsTable).where(
    eq(auditEventsTable.action, "engagement_letter_sent"),
  )).length, 1);
});

test("DocuSign status sync preserves hold state on outages/audit failures and safely retries signed copies", async (t) => {
  await mockStorage(t);
  const matter = await createMatter("on_hold");
  const letter = await createLetter(matter.id, "sent");
  const originalFetch = globalThis.fetch.bind(globalThis);
  let providerStatusFails = true;
  let signedDocumentDownloads = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("storage.googleapis.com/test-bucket")) return new Response(null, { status: 200 });
    if (url.endsWith("/envelopes/envelope-test")) {
      if (providerStatusFails) return Response.json({ message: "temporarily unavailable" }, { status: 503 });
      return Response.json({ status: "completed" });
    }
    if (url.endsWith("/documents/combined")) {
      signedDocumentDownloads += 1;
      return new Response(Buffer.from("%PDF-test"), { status: 200, headers: { "Content-Type": "application/pdf" } });
    }
    return originalFetch(input, init);
  });

  const providerFailure = await request(`/engagement-letters/${letter.id}/sync`, "POST", {});
  assert.equal(providerFailure.status, 502);
  assert.equal((await db.select().from(engagementLettersTable).where(
    eq(engagementLettersTable.id, letter.id),
  ))[0].status, "sent");
  assert.equal((await db.select().from(mattersTable).where(
    eq(mattersTable.id, matter.id),
  ))[0].status, "on_hold");

  providerStatusFails = false;
  await rejectAuditAction("engagement_letter_status_synced");
  const auditFailure = await request(`/engagement-letters/${letter.id}/sync`, "POST", {});
  assert.equal(auditFailure.status, 502);
  assert.equal((await db.select().from(engagementLettersTable).where(
    eq(engagementLettersTable.id, letter.id),
  ))[0].status, "sent");
  assert.equal((await db.select().from(mattersTable).where(
    eq(mattersTable.id, matter.id),
  ))[0].status, "on_hold");
  assert.equal((await db.select().from(documentsTable).where(
    eq(documentsTable.matterId, matter.id),
  )).length, 1);

  await rejectAuditAction(null);
  const retried = await request(`/engagement-letters/${letter.id}/sync`, "POST", {});
  assert.equal(retried.status, 200);
  const synced = await retried.json() as { status: string; signedDocumentId: number | null };
  assert.equal(synced.status, "completed");
  assert.ok(synced.signedDocumentId);
  assert.equal((await db.select().from(mattersTable).where(
    eq(mattersTable.id, matter.id),
  ))[0].status, "open");
  assert.equal((await db.select().from(documentsTable).where(
    eq(documentsTable.matterId, matter.id),
  )).length, 2);
  assert.equal(signedDocumentDownloads, 2);
});

test("closeout gates closure, legal holds pause disposition, and reminders survive normal updates", async () => {
  await db.update(practiceSettingsTable).set({ requireEngagementSignature: false })
    .where(eq(practiceSettingsTable.workspaceId, workspaceId));
  const matter = await createMatter("open");
  const blocked = await request(`/matters/${matter.id}`, "PATCH", { status: "closed" });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json() as { code: string }).code, "matter_closeout_required");

  const initialized = await request(`/matters/${matter.id}/closeout`, "POST", {});
  assert.equal(initialized.status, 201);
  const initializedBody = await initialized.json() as {
    items: Array<{ id: number; itemKey: string }>;
  };
  assert.deepEqual(new Set(initializedBody.items.map((item) => item.itemKey)), new Set([
    "final_billing", "document_handover", "retention_review",
  ]));
  for (const item of initializedBody.items) {
    const response = await request(`/closeout-items/${item.id}`, "PATCH", { status: "complete" });
    assert.equal(response.status, 200);
  }
  const [hold] = await db.insert(legalHoldsTable).values({
    workspaceId,
    entityType: "matter",
    entityId: matter.id,
    reason: "Preserve all records",
    placedByClerkUserId: userId,
  }).returning();
  const reminder = await request(`/matters/${matter.id}/followups`, "POST", {
    dueAt: "2027-01-15T12:00:00.000Z",
    reason: "Annual review",
  });
  assert.equal(reminder.status, 201);
  const reminderBody = await reminder.json() as { id: number; status: string };
  assert.equal(reminderBody.status, "open");
  const markedComplete = await request(`/matter-followups/${reminderBody.id}`, "PATCH", { status: "complete" });
  assert.equal(markedComplete.status, 200);

  await rejectAuditAction("matter_status_updated");
  const auditFailure = await request(`/matters/${matter.id}`, "DELETE");
  assert.equal(auditFailure.status, 500);
  assert.equal((await db.select().from(mattersTable).where(
    eq(mattersTable.id, matter.id),
  ))[0].status, "open");
  await rejectAuditAction(null);

  const closed = await request(`/matters/${matter.id}`, "DELETE");
  assert.equal(closed.status, 204);
  const withHoldResponse = await request(`/matters/${matter.id}/closeout`);
  assert.equal(withHoldResponse.status, 200);
  const withHold = await withHoldResponse.json() as {
    matterStatus: string; legalHold: boolean; targetRetentionDate: string | null; followups: Array<{ status: string }>;
  };
  assert.equal(withHold.matterStatus, "closed");
  assert.equal(withHold.legalHold, true);
  assert.equal(withHold.targetRetentionDate, null);
  assert.equal(withHold.followups[0].status, "complete");

  await db.update(legalHoldsTable).set({ releasedAt: new Date(), releasedByClerkUserId: userId })
    .where(eq(legalHoldsTable.id, hold.id));
  const releasedResponse = await request(`/matters/${matter.id}/closeout`);
  const released = await releasedResponse.json() as { legalHold: boolean; targetRetentionDate: string | null };
  assert.equal(released.legalHold, false);
  assert.ok(released.targetRetentionDate);
});

test("firm closeout checklist settings are audited and matter checklists retain their starting snapshot", async () => {
  const initialSettings = await request("/closeout/checklist-settings", "PUT", {
    checklists: [
      {
        matterType: null,
        items: [{ itemKey: "general_review", title: "Complete the general closeout review" }],
      },
      {
        matterType: "advisory",
        items: [
          { itemKey: "archive_files", title: "Archive advisory workpapers" },
          { itemKey: "confirm_final_invoice", title: "Confirm the final advisory invoice" },
        ],
      },
    ],
  });
  assert.equal(initialSettings.status, 200);
  const settingsBody = await initialSettings.json() as {
    checklists: Array<{ matterType: string | null; items: Array<{ itemKey: string }> }>;
  };
  assert.equal(settingsBody.checklists.length, 2);
  const fetchedSettings = await request("/closeout/checklist-settings");
  assert.equal(fetchedSettings.status, 200);
  assert.deepEqual(
    (await fetchedSettings.json() as typeof settingsBody).checklists,
    settingsBody.checklists,
  );

  await db.update(membershipsTable).set({ role: "professional" })
    .where(eq(membershipsTable.clerkUserId, userId));
  const deniedUpdate = await request("/closeout/checklist-settings", "PUT", {
    checklists: settingsBody.checklists,
  });
  assert.equal(deniedUpdate.status, 403);
  await db.update(membershipsTable).set({ role: "owner" })
    .where(eq(membershipsTable.clerkUserId, userId));

  const matter = await createMatter("open");
  const initialized = await request(`/matters/${matter.id}/closeout`, "POST", {});
  assert.equal(initialized.status, 201);
  const startedChecklist = await initialized.json() as {
    items: Array<{ id: number; itemKey: string; title: string; status: string }>;
  };
  assert.deepEqual(startedChecklist.items.map(({ itemKey, title }) => [itemKey, title]), [
    ["archive_files", "Archive advisory workpapers"],
    ["confirm_final_invoice", "Confirm the final advisory invoice"],
  ]);

  const changedSettings = await request("/closeout/checklist-settings", "PUT", {
    checklists: [
      {
        matterType: null,
        items: [{ itemKey: "general_review", title: "Complete the general closeout review" }],
      },
      {
        matterType: "advisory",
        items: [{ itemKey: "confirm_transfer", title: "Confirm the client handover" }],
      },
    ],
  });
  assert.equal(changedSettings.status, 200);
  const existingMatter = await request(`/matters/${matter.id}/closeout`);
  const unchangedSnapshot = await existingMatter.json() as {
    items: Array<{ itemKey: string; title: string }>;
  };
  assert.deepEqual(unchangedSnapshot.items.map(({ itemKey, title }) => [itemKey, title]), [
    ["archive_files", "Archive advisory workpapers"],
    ["confirm_final_invoice", "Confirm the final advisory invoice"],
  ]);

  const blocked = await request(`/matters/${matter.id}`, "PATCH", { status: "closed" });
  assert.equal(blocked.status, 409);
  for (const item of startedChecklist.items) {
    const completed = await request(`/closeout-items/${item.id}`, "PATCH", { status: "complete" });
    assert.equal(completed.status, 200);
  }
  const closed = await request(`/matters/${matter.id}`, "PATCH", { status: "closed" });
  assert.equal(closed.status, 200);

  const [audit] = await db.select().from(auditEventsTable).where(
    eq(auditEventsTable.action, "closeout_checklist_settings_updated"),
  );
  assert.ok(audit);
  assert.match(String(audit.details.checklistDefinitions), /archive_files/);
});
