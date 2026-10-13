import { and, desc, eq, gt, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import {
  auditEventsTable,
  billingDraftsTable,
  billingProfilesTable,
  clientsTable,
  intakesTable,
  mattersTable,
  oauthStatesTable,
  plannerItemsTable,
  providerConnectionsTable,
  providerSyncsTable,
  updateDraftsTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { firmAccess } from "../lib/clientguard-auth";
import {
  authorizationUrl,
  decryptToken,
  encryptToken,
  exchangeAuthorizationCode,
  getProviderProfile,
  hashOAuthState,
  providerJson,
  providerReady,
  ProviderHttpError,
  providers,
  randomOAuthState,
  redirectUriFor,
  refreshProviderToken,
  tokenExpiry,
  type Provider,
} from "../lib/clientguard-provider-service";

const router: IRouter = Router();

function providerValue(value: string | string[] | undefined): Provider | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  return providers.includes(normalized as Provider) ? normalized as Provider : null;
}

function idFrom(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function appOrigin(req: Parameters<typeof redirectUriFor>[0]) {
  const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "").split(",")[0].trim();
  const protocol = req.get("x-forwarded-proto")?.split(",")[0].trim() || req.protocol || "https";
  if (!host || /[\s/@]/.test(host)) throw new Error("Cannot determine the public host.");
  return `${protocol}://${host}`;
}

function safeReturnPath(req: Parameters<typeof redirectUriFor>[0]) {
  const fallback = "/settings/integrations";
  try {
    const referer = req.get("referer");
    if (!referer) return fallback;
    const path = new URL(referer).pathname;
    return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
  } catch {
    return fallback;
  }
}

async function audit(
  workspaceId: number,
  clerkUserId: string,
  actor: string,
  action: string,
  entityType: string,
  entityId: number,
  entityLabel: string,
  details: Record<string, string | number | boolean | null> = {},
) {
  await db.insert(auditEventsTable).values({
    workspaceId, clerkUserId, actor, action, entityType, entityId, entityLabel, details,
  });
}

function providerLabel(provider: Provider) {
  return {
    google: "Google Calendar and Gmail",
    microsoft: "Microsoft Outlook",
    xero: "Xero",
    quickbooks: "QuickBooks Online",
    docusign: "DocuSign",
  }[provider];
}

router.get("/integrations", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const saved = await db.select().from(providerConnectionsTable)
    .where(eq(providerConnectionsTable.workspaceId, access.workspaceId));
  const byProvider = new Map(saved.map((connection) => [connection.provider, connection]));
  res.json(api.ListWorkspaceIntegrationsResponse.parse(providers.map((provider) => {
    const connection = byProvider.get(provider);
    return {
      provider,
      connected: Boolean(connection),
      ready: providerReady(provider),
      accountLabel: connection?.accountLabel ?? providerLabel(provider),
      lastSyncAt: connection?.lastSyncAt ?? null,
    };
  })));
});

router.post("/integrations/:provider/authorize", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = api.AuthorizeWorkspaceIntegrationParams.safeParse(req.params);
  const provider = parsed.success ? providerValue(parsed.data.provider) : null;
  if (!provider) {
    res.status(400).json({ error: "Unsupported integration provider." });
    return;
  }
  if (!providerReady(provider)) {
    res.status(503).json({
      error: `${providerLabel(provider)} cannot be connected until its OAuth app credentials and the ClientGuard token-encryption secret are configured.`,
      code: "provider_oauth_not_configured",
    });
    return;
  }
  const state = randomOAuthState();
  const redirectPath = safeReturnPath(req);
  await db.insert(oauthStatesTable).values({
    stateHash: hashOAuthState(state),
    workspaceId: access.workspaceId,
    provider,
    clerkUserId: access.userId,
    redirectPath,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  try {
    res.json(api.AuthorizeWorkspaceIntegrationResponse.parse({
      authorizationUrl: authorizationUrl(provider, redirectUriFor(req, provider), state),
    }));
  } catch (error) {
    req.log.warn({ err: error, provider }, "Provider OAuth authorization could not be started");
    res.status(503).json({ error: "Provider authorization could not be started. Check its OAuth configuration." });
  }
});

router.get("/integrations/:provider/callback", async (req, res): Promise<void> => {
  const provider = providerValue(req.params.provider);
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const redirectError = (path: string, status: string) => {
    const url = new URL(path, appOrigin(req));
    url.searchParams.set("integration", status);
    if (provider) url.searchParams.set("provider", provider);
    res.redirect(302, url.toString());
  };
  if (!provider || !code || !state || !providerReady(provider)) {
    redirectError("/settings/integrations", "error");
    return;
  }
  const [oauthState] = await db.delete(oauthStatesTable).where(and(
    eq(oauthStatesTable.stateHash, hashOAuthState(state)),
    eq(oauthStatesTable.provider, provider),
    gt(oauthStatesTable.expiresAt, new Date()),
  )).returning();
  if (!oauthState) {
    res.status(400).send("This connection request has expired or was already used. Start again from ClientGuard.");
    return;
  }
  try {
    const token = await exchangeAuthorizationCode(provider, code, redirectUriFor(req, provider));
    const realmId = typeof req.query.realmId === "string" ? req.query.realmId : undefined;
    const profile = await getProviderProfile(provider, token.access_token, realmId);
    const [existing] = await db.select().from(providerConnectionsTable).where(and(
      eq(providerConnectionsTable.workspaceId, oauthState.workspaceId),
      eq(providerConnectionsTable.provider, provider),
    )).limit(1);
    const refreshToken = token.refresh_token
      ? encryptToken(token.refresh_token)
      : existing?.refreshTokenCiphertext ?? null;
    const values = {
      workspaceId: oauthState.workspaceId,
      provider,
      accountLabel: profile.label,
      remoteAccountId: profile.remoteAccountId || null,
      remoteBaseUri: profile.remoteBaseUri ?? existing?.remoteBaseUri ?? null,
      accessTokenCiphertext: encryptToken(token.access_token),
      refreshTokenCiphertext: refreshToken,
      tokenExpiresAt: tokenExpiry(token),
      scopes: (token.scope ?? "").split(/\s+/).filter(Boolean),
      connectedByClerkUserId: oauthState.clerkUserId,
      updatedAt: new Date(),
    };
    await db.insert(providerConnectionsTable).values(values).onConflictDoUpdate({
      target: [providerConnectionsTable.workspaceId, providerConnectionsTable.provider],
      set: values,
    });
    await audit(
      oauthState.workspaceId,
      oauthState.clerkUserId,
      "Firm member",
      "provider_connected",
      "integration",
      oauthState.workspaceId,
      providerLabel(provider),
      { provider, accountLabel: profile.label },
    );
    redirectError(oauthState.redirectPath, "connected");
  } catch (error) {
    req.log.warn({ err: error, provider, workspaceId: oauthState.workspaceId }, "Provider OAuth callback failed");
    redirectError(oauthState.redirectPath, "error");
  }
});

async function accessTokenFor(
  connection: typeof providerConnectionsTable.$inferSelect,
) {
  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() > Date.now() + 30_000) {
    return decryptToken(connection.accessTokenCiphertext);
  }
  if (!connection.refreshTokenCiphertext) {
    throw new Error("This provider session expired. Reconnect the account.");
  }
  const provider = providerValue(connection.provider);
  if (!provider) throw new Error("Unsupported provider.");
  const refreshed = await refreshProviderToken(provider, decryptToken(connection.refreshTokenCiphertext));
  const [updated] = await db.update(providerConnectionsTable).set({
    accessTokenCiphertext: encryptToken(refreshed.access_token),
    refreshTokenCiphertext: refreshed.refresh_token
      ? encryptToken(refreshed.refresh_token)
      : connection.refreshTokenCiphertext,
    tokenExpiresAt: tokenExpiry(refreshed),
    scopes: (refreshed.scope ?? connection.scopes.join(" ")).split(/\s+/).filter(Boolean),
    updatedAt: new Date(),
  }).where(eq(providerConnectionsTable.id, connection.id)).returning();
  return decryptToken(updated.accessTokenCiphertext);
}

async function connectionFor(workspaceId: number, provider: Provider) {
  const [connection] = await db.select().from(providerConnectionsTable).where(and(
    eq(providerConnectionsTable.workspaceId, workspaceId),
    eq(providerConnectionsTable.provider, provider),
  )).limit(1);
  return connection ?? null;
}

async function reserveSync(
  workspaceId: number,
  provider: Provider,
  entityType: string,
  entityId: number,
  clerkUserId: string,
) {
  const findExisting = () => db.select().from(providerSyncsTable).where(and(
    eq(providerSyncsTable.workspaceId, workspaceId),
    eq(providerSyncsTable.provider, provider),
    eq(providerSyncsTable.entityType, entityType),
    eq(providerSyncsTable.entityId, entityId),
  )).limit(1);
  const classifyExisting = async (existing: typeof providerSyncsTable.$inferSelect) => {
    if (existing.externalId !== "pending") return { kind: "completed" as const, sync: existing };
    if (!existing.idempotencyKey) return { kind: "uncertain" as const, sync: existing };

    const leaseExpired = existing.syncStatus === "pending"
      && Date.now() - existing.updatedAt.getTime() >= 60_000;
    if (existing.syncStatus === "pending" && !leaseExpired) {
      return { kind: "busy" as const, sync: existing };
    }

    if (leaseExpired) {
      const [stale] = await db.update(providerSyncsTable).set({
        syncStatus: "uncertain",
        updatedAt: new Date(),
      }).where(and(
        eq(providerSyncsTable.id, existing.id),
        eq(providerSyncsTable.syncStatus, "pending"),
        lte(providerSyncsTable.updatedAt, new Date(Date.now() - 60_000)),
      )).returning();
      if (!stale) return { kind: "busy" as const, sync: existing };
    }

    const [claimed] = await db.update(providerSyncsTable).set({
      syncStatus: "pending",
      updatedAt: new Date(),
    }).where(and(
      eq(providerSyncsTable.id, existing.id),
      eq(providerSyncsTable.syncStatus, "uncertain"),
    )).returning();
    return claimed
      ? { kind: "retry" as const, sync: claimed }
      : { kind: "busy" as const, sync: existing };
  };

  const [existing] = await findExisting();
  if (existing) return classifyExisting(existing);
  try {
    const [sync] = await db.insert(providerSyncsTable).values({
      workspaceId, provider, entityType, entityId,
      externalId: "pending",
      idempotencyKey: randomUUID(),
      syncStatus: "pending",
      syncedByClerkUserId: clerkUserId,
    }).returning();
    return { kind: "new" as const, sync };
  } catch (error) {
    const [raced] = await findExisting();
    if (raced) return classifyExisting(raced);
    throw error;
  }
}

function syncReservationRejected(
  res: Response,
  provider: Provider,
  reservation: Awaited<ReturnType<typeof reserveSync>>,
) {
  if (reservation.kind === "new" || reservation.kind === "retry") return false;
  if (reservation.kind === "uncertain") {
    res.status(409).json({
      error: `${providerLabel(provider)} may already have accepted this request. Its outcome is uncertain and no new record will be created until it can be reconciled.`,
      code: "provider_sync_uncertain",
      syncStatus: "uncertain",
    });
  } else {
    res.status(409).json({
      error: reservation.kind === "completed"
        ? "This record has already been synced through this account."
        : "This record is currently being synced. Wait a moment, then check again.",
      code: reservation.kind === "completed" ? "provider_sync_completed" : "provider_sync_in_progress",
      syncStatus: reservation.kind === "completed" ? "synced" : "pending",
    });
  }
  return true;
}

function sendUncertainSyncResponse(res: Response, provider: Provider) {
  res.status(409).json({
    error: `${providerLabel(provider)} may already have accepted this request. Its outcome is uncertain; retrying will reconcile the existing request before creating anything else.`,
    code: "provider_sync_uncertain",
    syncStatus: "uncertain",
  });
}

async function markSyncUncertain(id: number, remoteRecordId?: string | null) {
  await db.update(providerSyncsTable).set({
    syncStatus: "uncertain",
    ...(remoteRecordId ? { remoteRecordId } : {}),
    updatedAt: new Date(),
  }).where(eq(providerSyncsTable.id, id));
}

async function saveRemoteRecordId(id: number, remoteRecordId: string) {
  await db.update(providerSyncsTable).set({
    remoteRecordId,
    updatedAt: new Date(),
  }).where(eq(providerSyncsTable.id, id));
}

async function finishSync(
  syncId: number,
  externalId: string,
  connectionId: number,
  workspaceId: number,
  provider: Provider,
  entityType: string,
  entityId: number,
  actor: string,
  label: string,
) {
  const syncedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.update(providerSyncsTable).set({
      externalId,
      remoteRecordId: null,
      syncStatus: "synced",
      syncedAt,
      updatedAt: syncedAt,
    }).where(eq(providerSyncsTable.id, syncId));
    await tx.update(providerConnectionsTable).set({ lastSyncAt: syncedAt }).where(eq(providerConnectionsTable.id, connectionId));
    await tx.insert(auditEventsTable).values({
      workspaceId,
      clerkUserId: actor,
      actor: "Firm user",
      action: "record_synced",
      entityType,
      entityId,
      entityLabel: label,
      details: { provider, externalId },
    });
  });
}

async function removePendingSync(id: number) {
  await db.delete(providerSyncsTable).where(eq(providerSyncsTable.id, id));
}

async function preserveSyncAfterFailure(
  syncId: number,
  isNew: boolean,
  createAttempted: boolean,
  remoteRecordId?: string | null,
) {
  if (createAttempted || !isNew) {
    await markSyncUncertain(syncId, remoteRecordId);
  } else {
    await removePendingSync(syncId);
  }
}

function googleCalendarEventId(idempotencyKey: string) {
  return idempotencyKey.replaceAll("-", "").toLowerCase();
}

const graphSyncPropertyId = "String {9d6c0a43-0f93-4b36-9f85-5d9e354cd2c1} Name ClientGuardSyncKey";

async function reconcileCalendarEvent(provider: Provider, token: string, idempotencyKey: string) {
  if (provider === "google") {
    const eventId = googleCalendarEventId(idempotencyKey);
    try {
      const event = await providerJson(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
        token,
      );
      return String(event.id ?? "") || null;
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 404) return null;
      throw error;
    }
  }
  const url = new URL("https://graph.microsoft.com/v1.0/me/events");
  url.searchParams.set(
    "$filter",
    `singleValueExtendedProperties/any(ep: ep/id eq '${graphSyncPropertyId}' and ep/value eq '${idempotencyKey}')`,
  );
  url.searchParams.set("$select", "id,transactionId");
  url.searchParams.set("$expand", `singleValueExtendedProperties($filter=id eq '${graphSyncPropertyId}')`);
  const result = await providerJson(
    url.toString(),
    token,
  );
  const events = Array.isArray(result.value) ? result.value as Array<Record<string, unknown>> : [];
  return events[0]?.id ? String(events[0].id) : null;
}

router.post("/integrations/:provider/calendar/:id/sync", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = api.SyncApprovedPlannerItemParams.safeParse(req.params);
  const provider = parsed.success ? providerValue(parsed.data.provider) : null;
  const id = parsed.success ? parsed.data.id : null;
  if (!provider || !["google", "microsoft"].includes(provider) || !id) {
    res.status(400).json({ error: "Choose Google or Microsoft and a valid planner item." });
    return;
  }
  const [item] = await db.select().from(plannerItemsTable).where(and(
    eq(plannerItemsTable.id, id),
    eq(plannerItemsTable.workspaceId, access.workspaceId),
  )).limit(1);
  if (!item || item.status !== "open" || !item.dueAt) {
    res.status(409).json({ error: "Only a confirmed planner item with a due date can be synced." });
    return;
  }
  const connection = await connectionFor(access.workspaceId, provider);
  if (!connection) {
    res.status(409).json({ error: `Connect ${providerLabel(provider)} before syncing this item.` });
    return;
  }
  const reservation = await reserveSync(access.workspaceId, provider, "planner_item", id, access.userId);
  if (syncReservationRejected(res, provider, reservation)) return;
  const { sync } = reservation;
  let createAttempted = false;
  try {
    const token = await accessTokenFor(connection);
    if (reservation.kind === "retry") {
      const externalId = await reconcileCalendarEvent(provider, token, sync.idempotencyKey!);
      if (externalId) {
        await finishSync(sync.id, externalId, connection.id, access.workspaceId, provider, "planner_item", id, access.userId, item.title);
        res.json(api.SyncApprovedPlannerItemResponse.parse({
          provider, externalId, message: `Existing calendar event reconciled in ${providerLabel(provider)}.`,
        }));
        return;
      }
    }
    const start = new Date(item.dueAt);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const description = [item.details, item.sourceQuote ? `Source: ${item.sourceQuote}` : ""].filter(Boolean).join("\n\n");
    let externalId = "";
    if (provider === "google") {
      const eventId = googleCalendarEventId(sync.idempotencyKey!);
      createAttempted = true;
      const result = await providerJson("https://www.googleapis.com/calendar/v3/calendars/primary/events", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: eventId,
          summary: item.title,
          description,
          start: { dateTime: start.toISOString(), timeZone: "UTC" },
          end: { dateTime: end.toISOString(), timeZone: "UTC" },
          extendedProperties: { private: { clientguardSyncKey: sync.idempotencyKey! } },
        }),
      });
      externalId = String(result.id ?? "");
    } else {
      createAttempted = true;
      const result = await providerJson("https://graph.microsoft.com/v1.0/me/events", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: item.title,
          body: { contentType: "text", content: description },
          start: { dateTime: start.toISOString().replace("Z", ""), timeZone: "UTC" },
          end: { dateTime: end.toISOString().replace("Z", ""), timeZone: "UTC" },
          transactionId: sync.idempotencyKey,
          singleValueExtendedProperties: [
            { id: graphSyncPropertyId, value: sync.idempotencyKey! },
          ],
        }),
      });
      externalId = String(result.id ?? "");
    }
    if (!externalId) throw new Error("Calendar provider did not return an event ID.");
    await finishSync(sync.id, externalId, connection.id, access.workspaceId, provider, "planner_item", id, access.userId, item.title);
    res.json(api.SyncApprovedPlannerItemResponse.parse({
      provider, externalId, message: `Calendar event created in ${providerLabel(provider)}.`,
    }));
  } catch (error) {
    if (createAttempted) {
      try {
        const token = await accessTokenFor(connection);
        const externalId = await reconcileCalendarEvent(provider, token, sync.idempotencyKey!);
        if (externalId) {
          await finishSync(sync.id, externalId, connection.id, access.workspaceId, provider, "planner_item", id, access.userId, item.title);
          res.json(api.SyncApprovedPlannerItemResponse.parse({
            provider, externalId, message: `Existing calendar event reconciled in ${providerLabel(provider)}.`,
          }));
          return;
        }
      } catch (reconcileError) {
        req.log.warn({ err: reconcileError, provider, plannerItemId: id }, "Calendar sync reconciliation failed");
      }
    }
    const uncertain = createAttempted || reservation.kind === "retry";
    await preserveSyncAfterFailure(sync.id, reservation.kind === "new", createAttempted);
    req.log.warn({ err: error, provider, plannerItemId: id }, "Calendar sync failed");
    if (uncertain) {
      sendUncertainSyncResponse(res, provider);
      return;
    }
    res.status(502).json({ error: "Calendar sync failed. Check the connected account and try again." });
  }
});

async function providerJsonWithBody(
  url: string,
  token: string,
  body: unknown,
  method = "POST",
) {
  return providerJson(url, token, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function escapeQueryString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"');
}

async function xeroAccountAndTax(
  token: string,
  tenantId: string,
  taxRateBps: number,
) {
  const headers = { "xero-tenant-id": tenantId };
  const accountData = await providerJson("https://api.xero.com/api.xro/2.0/Accounts?where=Type%3D%3D%22REVENUE%22%26%26Status%3D%3D%22ACTIVE%22", token, { headers });
  const accounts = Array.isArray(accountData.Accounts) ? accountData.Accounts as Array<Record<string, unknown>> : [];
  const account = accounts.find((row) => ["professional services", "services"].includes(String(row.Name ?? "").toLowerCase()))
    ?? (accounts.length === 1 ? accounts[0] : undefined);
  if (!account?.Code) throw new Error("Set up one clearly named Xero revenue account (Professional Services or Services) before syncing.");
  const rateData = await providerJson("https://api.xero.com/api.xro/2.0/TaxRates", token, { headers });
  const rates = Array.isArray(rateData.TaxRates) ? rateData.TaxRates as Array<Record<string, unknown>> : [];
  const tax = rates.find((row) => {
    const percent = Number(row.EffectiveRate ?? row.TaxRate ?? NaN);
    return row.Status === "ACTIVE" && Number.isFinite(percent) && Math.abs(percent * 100 - taxRateBps) <= 1;
  });
  if (!tax?.TaxType) throw new Error(`Xero has no active tax rate matching ${taxRateBps / 100}% for this reviewed bill.`);
  return { accountCode: String(account.Code), taxType: String(tax.TaxType) };
}

async function xeroContact(token: string, tenantId: string, name: string, email: string | null) {
  const headers = { "xero-tenant-id": tenantId };
  const field = email ? "EmailAddress" : "Name";
  const value = email ?? name;
  const where = encodeURIComponent(`${field}=="${escapeQueryString(value)}"`);
  const found = await providerJson(`https://api.xero.com/api.xro/2.0/Contacts?where=${where}`, token, { headers });
  const contacts = Array.isArray(found.Contacts) ? found.Contacts as Array<Record<string, unknown>> : [];
  if (contacts[0]?.ContactID) return String(contacts[0].ContactID);
  const created = await providerJson("https://api.xero.com/api.xro/2.0/Contacts", token, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ Contacts: [{ Name: name, ...(email ? { EmailAddress: email } : {}) }] }),
  });
  const rows = Array.isArray(created.Contacts) ? created.Contacts as Array<Record<string, unknown>> : [];
  if (!rows[0]?.ContactID) throw new Error("Xero did not create a contact for this client.");
  return String(rows[0].ContactID);
}

async function quickbooksEntity(
  token: string,
  realmId: string,
  entity: string,
  query: string,
) {
  const base = process.env.QUICKBOOKS_ENVIRONMENT === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  return providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent(query)}&minorversion=75`, token);
}

async function quickbooksContact(token: string, realmId: string, name: string, email: string | null) {
  const safeName = escapeQueryString(name);
  const found = await quickbooksEntity(token, realmId, "Customer", `select * from Customer where DisplayName = '${safeName}'`);
  const response = found.QueryResponse as Record<string, unknown> | undefined;
  const customers = Array.isArray(response?.Customer) ? response.Customer as Array<Record<string, unknown>> : [];
  if (customers[0]?.Id) return String(customers[0].Id);
  const base = process.env.QUICKBOOKS_ENVIRONMENT === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  const created = await providerJsonWithBody(
    `${base}/v3/company/${encodeURIComponent(realmId)}/customer?minorversion=75`,
    token,
    { DisplayName: name.slice(0, 100), ...(email ? { PrimaryEmailAddr: { Address: email } } : {}) },
  );
  const customer = created.Customer as Record<string, unknown> | undefined;
  if (!customer?.Id) throw new Error("QuickBooks did not create a customer record.");
  return String(customer.Id);
}

async function quickbooksServiceItem(token: string, realmId: string) {
  const found = await quickbooksEntity(token, realmId, "Item", "select * from Item where Type = 'Service' and Active = true");
  const response = found.QueryResponse as Record<string, unknown> | undefined;
  const items = Array.isArray(response?.Item) ? response.Item as Array<Record<string, unknown>> : [];
  const preferred = items.find((row) => ["professional services", "services"].includes(String(row.Name ?? "").toLowerCase()));
  const item = preferred ?? (items.length === 1 ? items[0] : undefined);
  if (!item?.Id) throw new Error("Set up one clearly named QuickBooks service item (Professional Services or Services) before syncing.");
  return String(item.Id);
}

async function quickbooksTaxCode(token: string, realmId: string, taxRateBps: number) {
  const codesResult = await quickbooksEntity(token, realmId, "TaxCode", "select * from TaxCode where Active = true");
  const codesResponse = codesResult.QueryResponse as Record<string, unknown> | undefined;
  const codes = Array.isArray(codesResponse?.TaxCode) ? codesResponse.TaxCode as Array<Record<string, unknown>> : [];
  if (taxRateBps === 0) {
    const nonTax = codes.find((code) => code.Taxable === false || /non.?tax|exempt/i.test(String(code.Name ?? "")));
    if (nonTax?.Id) return String(nonTax.Id);
  }
  const ratesResult = await quickbooksEntity(token, realmId, "TaxRate", "select * from TaxRate");
  const ratesResponse = ratesResult.QueryResponse as Record<string, unknown> | undefined;
  const rates = Array.isArray(ratesResponse?.TaxRate) ? ratesResponse.TaxRate as Array<Record<string, unknown>> : [];
  const rateById = new Map(rates.map((rate) => [String(rate.Id), Number(rate.RateValue)]));
  const match = codes.find((code) => {
    const list = code.SalesTaxRateList as { TaxRateDetail?: Array<{ TaxRateRef?: { value?: string } }> } | undefined;
    const sum = (list?.TaxRateDetail ?? []).reduce((value, detail) => value + (rateById.get(String(detail.TaxRateRef?.value)) ?? 0), 0);
    return Math.abs(sum * 100 - taxRateBps) <= 1;
  });
  if (!match?.Id) throw new Error(`QuickBooks has no active tax code matching ${taxRateBps / 100}% for this reviewed bill.`);
  return String(match.Id);
}

function xeroInvoiceReference(idempotencyKey: string) {
  return `ClientGuard-${idempotencyKey}`;
}

async function reconcileXeroInvoice(token: string, tenantId: string, idempotencyKey: string) {
  const where = encodeURIComponent(`Reference=="${xeroInvoiceReference(idempotencyKey)}"`);
  const result = await providerJson(
    `https://api.xero.com/api.xro/2.0/Invoices?where=${where}`,
    token,
    { headers: { "xero-tenant-id": tenantId } },
  );
  const invoices = Array.isArray(result.Invoices) ? result.Invoices as Array<Record<string, unknown>> : [];
  return invoices[0]?.InvoiceID ? String(invoices[0].InvoiceID) : null;
}

function gmailMessageId(idempotencyKey: string) {
  return `clientguard-${idempotencyKey}@clientguard.invalid`;
}

async function reconcileGmailEmail(token: string, idempotencyKey: string) {
  const messageId = gmailMessageId(idempotencyKey);
  const query = `rfc822msgid:${messageId}`;
  const sent = await providerJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(`in:sent ${query}`)}`,
    token,
  );
  const sentMessages = Array.isArray(sent.messages) ? sent.messages as Array<Record<string, unknown>> : [];
  if (sentMessages[0]?.id) return { kind: "sent" as const, id: String(sentMessages[0].id) };

  const drafts = await providerJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/drafts?q=${encodeURIComponent(query)}`,
    token,
  );
  const draftRows = Array.isArray(drafts.drafts) ? drafts.drafts as Array<Record<string, unknown>> : [];
  return draftRows[0]?.id
    ? { kind: "draft" as const, id: String(draftRows[0].id) }
    : { kind: "missing" as const, id: null };
}

async function reconcileMicrosoftEmail(
  token: string,
  idempotencyKey: string,
  remoteRecordId?: string | null,
) {
  const headers = { Prefer: 'IdType="ImmutableId"' };
  if (remoteRecordId) {
    try {
      const message = await providerJson(
        `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(remoteRecordId)}?$select=id,isDraft`,
        token,
        { headers },
      );
      if (message.id) return { kind: message.isDraft === true ? "draft" as const : "sent" as const, id: String(message.id) };
    } catch (error) {
      if (!(error instanceof ProviderHttpError && error.status === 404)) throw error;
    }
  }
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set(
    "$filter",
    `singleValueExtendedProperties/any(ep: ep/id eq '${graphSyncPropertyId}' and ep/value eq '${idempotencyKey}')`,
  );
  url.searchParams.set("$select", "id,isDraft");
  url.searchParams.set("$expand", `singleValueExtendedProperties($filter=id eq '${graphSyncPropertyId}')`);
  const result = await providerJson(url.toString(), token, { headers });
  const messages = Array.isArray(result.value) ? result.value as Array<Record<string, unknown>> : [];
  return messages[0]?.id
    ? { kind: messages[0].isDraft === true ? "draft" as const : "sent" as const, id: String(messages[0].id) }
    : { kind: "missing" as const, id: null };
}

router.post("/integrations/:provider/billing/:id/sync", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = api.SyncReviewedBillParams.safeParse(req.params);
  const provider = parsed.success ? providerValue(parsed.data.provider) : null;
  const id = parsed.success ? parsed.data.id : null;
  if (!provider || !["xero", "quickbooks"].includes(provider) || !id) {
    res.status(400).json({ error: "Choose Xero or QuickBooks and a valid billing draft." });
    return;
  }
  const [row] = await db.select({
    draft: billingDraftsTable,
    matter: mattersTable,
    client: clientsTable,
    profile: billingProfilesTable,
  }).from(billingDraftsTable)
    .innerJoin(mattersTable, and(eq(billingDraftsTable.matterId, mattersTable.id), eq(billingDraftsTable.workspaceId, mattersTable.workspaceId)))
    .innerJoin(clientsTable, and(eq(mattersTable.clientId, clientsTable.id), eq(mattersTable.workspaceId, clientsTable.workspaceId)))
    .leftJoin(billingProfilesTable, and(eq(billingProfilesTable.matterId, mattersTable.id), eq(billingProfilesTable.workspaceId, mattersTable.workspaceId)))
    .where(and(eq(billingDraftsTable.id, id), eq(billingDraftsTable.workspaceId, access.workspaceId)))
    .limit(1);
  if (!row || row.draft.status !== "reviewed") {
    res.status(409).json({ error: "Only a reviewed bill draft can be synced." });
    return;
  }
  const connection = await connectionFor(access.workspaceId, provider);
  if (!connection) {
    res.status(409).json({ error: `Connect ${providerLabel(provider)} before syncing this bill.` });
    return;
  }
  const reservation = await reserveSync(access.workspaceId, provider, "billing_draft", id, access.userId);
  if (syncReservationRejected(res, provider, reservation)) return;
  const { sync } = reservation;
  let createAttempted = false;
  try {
    const token = await accessTokenFor(connection);
    if (reservation.kind === "retry" && provider === "xero") {
      const tenantId = connection.remoteAccountId;
      if (!tenantId) throw new Error("Reconnect Xero; the organisation identifier is unavailable.");
      const externalId = await reconcileXeroInvoice(token, tenantId, sync.idempotencyKey!);
      if (externalId) {
        await finishSync(sync.id, externalId, connection.id, access.workspaceId, provider, "billing_draft", id, access.userId, `Billing draft ${id}`);
        res.json(api.SyncReviewedBillResponse.parse({
          provider, externalId, message: `Existing reviewed bill reconciled in ${providerLabel(provider)}.`,
        }));
        return;
      }
      if (Date.now() - sync.createdAt.getTime() > 6 * 60 * 1000) {
        await markSyncUncertain(sync.id);
        sendUncertainSyncResponse(res, provider);
        return;
      }
    }
    const taxRateBps = row.profile?.taxRateBps ?? 0;
    const expectedTax = Math.round(row.draft.subtotalCents * taxRateBps / 10_000);
    if (Math.abs(expectedTax - row.draft.taxCents) > 1) {
      throw new Error("The reviewed draft tax total no longer matches the billing profile. Review it before syncing.");
    }
    let externalId = "";
    if (provider === "xero") {
      const tenantId = connection.remoteAccountId;
      if (!tenantId) throw new Error("Reconnect Xero; the organisation identifier is unavailable.");
      const [contactId, mapping] = await Promise.all([
        xeroContact(token, tenantId, row.client.name, row.client.email),
        xeroAccountAndTax(token, tenantId, taxRateBps),
      ]);
      createAttempted = true;
      const response = await providerJson("https://api.xero.com/api.xro/2.0/Invoices", token, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xero-tenant-id": tenantId,
          "Idempotency-Key": sync.idempotencyKey!,
        },
        body: JSON.stringify({
          Invoices: [{
            Type: "ACCREC",
            Status: "DRAFT",
            Contact: { ContactID: contactId },
            Date: row.draft.periodEndAt.toISOString().slice(0, 10),
            CurrencyCode: row.draft.currency,
            Reference: xeroInvoiceReference(sync.idempotencyKey!),
            LineItems: row.draft.lineItems.map((line) => ({
              Description: line.description,
              Quantity: 1,
              UnitAmount: line.amountCents / 100,
              AccountCode: mapping.accountCode,
              TaxType: mapping.taxType,
            })),
          }],
        }),
      });
      const invoices = Array.isArray(response.Invoices) ? response.Invoices as Array<Record<string, unknown>> : [];
      externalId = String(invoices[0]?.InvoiceID ?? "");
    } else {
      const realmId = connection.remoteAccountId;
      if (!realmId) throw new Error("Reconnect QuickBooks; the company identifier is unavailable.");
      const [customerId, itemId, taxCodeId] = await Promise.all([
        quickbooksContact(token, realmId, row.client.name, row.client.email),
        quickbooksServiceItem(token, realmId),
        quickbooksTaxCode(token, realmId, taxRateBps),
      ]);
      const base = process.env.QUICKBOOKS_ENVIRONMENT === "sandbox"
        ? "https://sandbox-quickbooks.api.intuit.com"
        : "https://quickbooks.api.intuit.com";
      createAttempted = true;
      const response = await providerJsonWithBody(
        `${base}/v3/company/${encodeURIComponent(realmId)}/invoice?minorversion=75&requestid=${encodeURIComponent(sync.idempotencyKey!)}`,
        token,
        {
          CustomerRef: { value: customerId },
          TxnDate: row.draft.periodEndAt.toISOString().slice(0, 10),
          CurrencyRef: { value: row.draft.currency },
          PrivateNote: `ClientGuard reviewed draft ${row.draft.id}; sync ${sync.idempotencyKey}`,
          EmailStatus: "NotSet",
          GlobalTaxCalculation: "TaxExcluded",
          TxnTaxDetail: { TxnTaxCodeRef: { value: taxCodeId }, TotalTax: row.draft.taxCents / 100 },
          Line: row.draft.lineItems.map((line) => ({
            Amount: line.amountCents / 100,
            DetailType: "SalesItemLineDetail",
            Description: line.description,
            SalesItemLineDetail: {
              ItemRef: { value: itemId },
              Qty: 1,
              UnitPrice: line.amountCents / 100,
              TaxCodeRef: { value: taxCodeId },
            },
          })),
        },
      );
      const invoice = response.Invoice as Record<string, unknown> | undefined;
      externalId = String(invoice?.Id ?? "");
    }
    if (!externalId) throw new Error("Accounting provider did not return an invoice identifier.");
    await finishSync(sync.id, externalId, connection.id, access.workspaceId, provider, "billing_draft", id, access.userId, `Billing draft ${id}`);
    res.json(api.SyncReviewedBillResponse.parse({
      provider, externalId, message: `Reviewed bill created in ${providerLabel(provider)} without sending it to the client.`,
    }));
  } catch (error) {
    if (createAttempted && provider === "xero" && connection.remoteAccountId) {
      try {
        const token = await accessTokenFor(connection);
        const externalId = await reconcileXeroInvoice(token, connection.remoteAccountId, sync.idempotencyKey!);
        if (externalId) {
          await finishSync(sync.id, externalId, connection.id, access.workspaceId, provider, "billing_draft", id, access.userId, `Billing draft ${id}`);
          res.json(api.SyncReviewedBillResponse.parse({
            provider, externalId, message: `Existing reviewed bill reconciled in ${providerLabel(provider)}.`,
          }));
          return;
        }
      } catch (reconcileError) {
        req.log.warn({ err: reconcileError, provider, billingDraftId: id }, "Invoice sync reconciliation failed");
      }
    }
    const uncertain = createAttempted || reservation.kind === "retry";
    await preserveSyncAfterFailure(sync.id, reservation.kind === "new", createAttempted);
    req.log.warn({ err: error, provider, billingDraftId: id }, "Reviewed bill sync failed");
    if (uncertain) {
      sendUncertainSyncResponse(res, provider);
      return;
    }
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("Set up") || message.includes("matching") || message.includes("reconnect") || message.includes("matches the billing profile")
      ? 409
      : 502;
    res.status(status).json({
      error: status === 409 ? message : "Accounting sync failed. Check the connected account and try again.",
    });
  }
});

router.post("/integrations/:provider/email", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const provider = providerValue(req.params.provider);
  const parsed = api.SendReviewedClientUpdateEmailBody.safeParse(req.body);
  if (!provider || !["google", "microsoft"].includes(provider) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Choose Google or Microsoft." : parsed.error.message });
    return;
  }
  const [draft] = await db.select({
    draft: updateDraftsTable,
    matter: mattersTable,
    client: clientsTable,
  }).from(updateDraftsTable)
    .innerJoin(mattersTable, and(eq(updateDraftsTable.matterId, mattersTable.id), eq(updateDraftsTable.workspaceId, mattersTable.workspaceId)))
    .innerJoin(clientsTable, and(eq(mattersTable.clientId, clientsTable.id), eq(mattersTable.workspaceId, clientsTable.workspaceId)))
    .where(and(eq(updateDraftsTable.id, parsed.data.draftId), eq(updateDraftsTable.workspaceId, access.workspaceId)))
    .limit(1);
  if (!draft || draft.draft.status !== "reviewed") {
    res.status(409).json({ error: "Only a reviewed client update can be sent." });
    return;
  }
  if (!draft.client.email) {
    res.status(409).json({ error: "Add a client email address before sending this update." });
    return;
  }
  const connection = await connectionFor(access.workspaceId, provider);
  if (!connection) {
    res.status(409).json({ error: `Connect ${providerLabel(provider)} before sending this update.` });
    return;
  }
  const reservation = await reserveSync(access.workspaceId, provider, "client_update_email", draft.draft.id, access.userId);
  if (syncReservationRejected(res, provider, reservation)) return;
  const { sync } = reservation;
  let createAttempted = false;
  let remoteRecordId = sync.remoteRecordId;
  try {
    const token = await accessTokenFor(connection);
    const subject = draft.draft.subject.replace(/[\r\n]+/g, " ").trim();
    let externalId = "";
    if (provider === "google") {
      if (reservation.kind === "retry") {
        const reconciled = await reconcileGmailEmail(token, sync.idempotencyKey!);
        if (reconciled.kind === "sent") {
          externalId = reconciled.id!;
        } else if (reconciled.kind === "draft") {
          remoteRecordId = reconciled.id;
          await saveRemoteRecordId(sync.id, remoteRecordId!);
        } else {
          await markSyncUncertain(sync.id);
          sendUncertainSyncResponse(res, provider);
          return;
        }
      }
      if (!externalId) {
        if (!remoteRecordId) {
          const mime = [
            `To: ${draft.client.email}`,
            `Subject: ${subject}`,
            `Message-ID: <${gmailMessageId(sync.idempotencyKey!)}>`,
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=UTF-8",
            "",
            draft.draft.body,
          ].join("\r\n");
          createAttempted = true;
          const created = await providerJson("https://gmail.googleapis.com/gmail/v1/users/me/drafts", token, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: { raw: Buffer.from(mime, "utf8").toString("base64url") } }),
          });
          remoteRecordId = String(created.id ?? "");
          if (!remoteRecordId) throw new Error("Gmail did not return the saved draft identifier.");
          await saveRemoteRecordId(sync.id, remoteRecordId);
        }
        createAttempted = true;
        const sent = await providerJson("https://gmail.googleapis.com/gmail/v1/users/me/drafts/send", token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: remoteRecordId }),
        });
        const sentMessage = sent.message as Record<string, unknown> | undefined;
        externalId = String(sentMessage?.id ?? sent.id ?? "");
        if (!externalId) {
          const reconciled = await reconcileGmailEmail(token, sync.idempotencyKey!);
          if (reconciled.kind !== "sent") throw new Error("Gmail accepted the send request without confirming the sent message.");
          externalId = reconciled.id!;
        }
      }
    } else {
      if (reservation.kind === "retry") {
        const reconciled = await reconcileMicrosoftEmail(token, sync.idempotencyKey!, remoteRecordId);
        if (reconciled.kind === "sent") {
          externalId = reconciled.id!;
        } else if (reconciled.kind === "draft") {
          remoteRecordId = reconciled.id;
          await saveRemoteRecordId(sync.id, remoteRecordId!);
        } else {
          await markSyncUncertain(sync.id);
          sendUncertainSyncResponse(res, provider);
          return;
        }
      }
      if (!externalId) {
        if (!remoteRecordId) {
          createAttempted = true;
          const created = await providerJson("https://graph.microsoft.com/v1.0/me/messages", token, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Prefer: 'IdType="ImmutableId"',
            },
            body: JSON.stringify({
              subject,
              body: { contentType: "Text", content: draft.draft.body },
              toRecipients: [{ emailAddress: { address: draft.client.email } }],
              internetMessageHeaders: [
                { name: "x-clientguard-sync-key", value: sync.idempotencyKey! },
              ],
              singleValueExtendedProperties: [
                { id: graphSyncPropertyId, value: sync.idempotencyKey! },
              ],
            }),
          });
          remoteRecordId = String(created.id ?? "");
          if (!remoteRecordId) throw new Error("Microsoft did not return the saved draft identifier.");
          await saveRemoteRecordId(sync.id, remoteRecordId);
        }
        createAttempted = true;
        await providerJson(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(remoteRecordId)}/send`, token, {
          method: "POST",
          headers: { Prefer: 'IdType="ImmutableId"' },
        });
        const sent = await reconcileMicrosoftEmail(token, sync.idempotencyKey!, remoteRecordId);
        if (sent.kind !== "sent") throw new Error("Microsoft accepted the send request without confirming the sent message.");
        externalId = sent.id!;
      }
    }
    await finishSync(sync.id, externalId, connection.id, access.workspaceId, provider, "client_update_email", draft.draft.id, access.userId, draft.draft.subject);
    res.json(api.SendReviewedClientUpdateEmailResponse.parse({
      provider, externalId, message: "Reviewed client update sent.",
    }));
  } catch (error) {
    if (createAttempted) {
      try {
        const token = await accessTokenFor(connection);
        const reconciled = provider === "google"
          ? await reconcileGmailEmail(token, sync.idempotencyKey!)
          : await reconcileMicrosoftEmail(token, sync.idempotencyKey!, remoteRecordId);
        if (reconciled.kind === "sent") {
          await finishSync(sync.id, reconciled.id!, connection.id, access.workspaceId, provider, "client_update_email", draft.draft.id, access.userId, draft.draft.subject);
          res.json(api.SendReviewedClientUpdateEmailResponse.parse({
            provider, externalId: reconciled.id, message: "Existing sent email reconciled.",
          }));
          return;
        }
        if (reconciled.kind === "draft") remoteRecordId = reconciled.id;
      } catch (reconcileError) {
        req.log.warn({ err: reconcileError, provider, draftId: draft.draft.id }, "Client update email reconciliation failed");
      }
    }
    const uncertain = createAttempted || reservation.kind === "retry";
    await preserveSyncAfterFailure(sync.id, reservation.kind === "new", createAttempted, remoteRecordId);
    req.log.warn({ err: error, provider, draftId: draft.draft.id }, "Reviewed client update email failed");
    if (uncertain) {
      sendUncertainSyncResponse(res, provider);
      return;
    }
    res.status(502).json({ error: "Email delivery failed. Check the connected account and try again." });
  }
});

export default router;
