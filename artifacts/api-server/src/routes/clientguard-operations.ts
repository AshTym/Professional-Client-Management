import { clerkClient } from "@clerk/express";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  activitiesTable,
  auditEventsTable,
  billingDraftsTable,
  clientsTable,
  documentsTable,
  intakeSettingsTable,
  intakesTable,
  legalHoldsTable,
  mattersTable,
  membershipsTable,
  portalAccessTable,
  portalMessagesTable,
  portalRequestsTable,
  portalUpdatesTable,
  plannerItemsTable,
  retentionSettingsTable,
  workspacesTable,
  type IntakeRule,
} from "@workspace/db";
import * as api from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  firmAccess,
  identify,
  logActivity,
  membershipFor,
  logAuditEvent,
  type ClientGuardIdentity,
  type FirmAccess,
} from "../lib/clientguard-auth";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const allowedDocumentTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

function idFrom(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function defaultsForPractice(practiceType: string): IntakeRule[] {
  const law: IntakeRule[] = [
    { key: "identity", label: "Identity and contact details", description: "Confirm the prospective client's identity and contact details.", required: true, category: "Client verification" },
    { key: "parties", label: "All parties and related entities", description: "List clients, counterparties, beneficial owners, and related entities.", required: true, category: "Conflict checks" },
    { key: "matter_scope", label: "Matter scope and jurisdiction", description: "Record the requested work and relevant jurisdiction.", required: true, category: "Matter assessment" },
    { key: "conflicts", label: "Conflict search reviewed", description: "Review potential matches before opening a matter.", required: true, category: "Professional review" },
  ];
  const financial: IntakeRule[] = [
    { key: "identity", label: "Identity and contact details", description: "Confirm the client or entity identity and contact details.", required: true, category: "Client verification" },
    { key: "ownership", label: "Ownership and control", description: "Record beneficial owners and controlling persons where applicable.", required: true, category: "Onboarding checks" },
    { key: "funds", label: "Source of funds and purpose", description: "Record the intended service, source of funds, and stated purpose.", required: true, category: "Onboarding checks" },
    { key: "suitability", label: "Suitability and risk review", description: "Capture the firm's applicable suitability and risk checks.", required: true, category: "Professional review" },
  ];
  return practiceType === "financial"
    ? financial
    : practiceType === "both"
      ? [...law, ...financial.filter((check) => check.key !== "identity")]
      : law;
}

async function rulesForWorkspace(workspaceId: number, practiceType: string) {
  const [settings] = await db
    .select()
    .from(intakeSettingsTable)
    .where(eq(intakeSettingsTable.workspaceId, workspaceId))
    .limit(1);
  return settings?.checks ?? defaultsForPractice(practiceType);
}

function normalizeParty(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function isPotentialNameMatch(a: string, b: string) {
  const left = normalizeParty(a);
  const right = normalizeParty(b);
  if (left.length < 4 || right.length < 4) return false;
  return left === right || (Math.min(left.length, right.length) >= 7 &&
    (left.includes(right) || right.includes(left)));
}

async function findConflicts(workspaceId: number, parties: string[], excludeClientId?: number) {
  const normalizedParties = [...new Set(parties.map((party) => party.trim()).filter(Boolean))];
  const [clients, matters] = await Promise.all([
    db.select().from(clientsTable).where(eq(clientsTable.workspaceId, workspaceId)),
    db.select().from(mattersTable).where(eq(mattersTable.workspaceId, workspaceId)),
  ]);
  const found = new Map<string, { name: string; recordType: "client" | "matter"; recordId: number; recordLabel: string }>();
  for (const party of normalizedParties) {
    for (const client of clients) {
      if (client.id === excludeClientId) continue;
      if (isPotentialNameMatch(party, client.name)) {
        found.set(`client:${client.id}`, {
          name: party,
          recordType: "client",
          recordId: client.id,
          recordLabel: client.name,
        });
      }
    }
    for (const matter of matters) {
      if (isPotentialNameMatch(party, matter.title)) {
        found.set(`matter:${matter.id}`, {
          name: party,
          recordType: "matter",
          recordId: matter.id,
          recordLabel: matter.title,
        });
      }
    }
  }
  return [...found.values()];
}

async function appendAudit(
  workspaceId: number,
  identity: ClientGuardIdentity,
  action: string,
  entityType: string,
  entityId: number | null,
  entityLabel: string,
  details: Record<string, string | number | boolean | null> = {},
) {
  await db.insert(auditEventsTable).values({
    workspaceId,
    clerkUserId: identity.userId,
    actor: identity.name || identity.email || "User",
    action,
    entityType,
    entityId,
    entityLabel,
    details,
  });
}

function toFirmAccess(
  identity: ClientGuardIdentity,
  row: NonNullable<Awaited<ReturnType<typeof membershipFor>>>,
): FirmAccess {
  return {
    ...identity,
    workspaceId: row.workspace.id,
    workspaceName: row.workspace.name,
    practiceType: row.workspace.practiceType,
    role: row.membership.role,
  };
}

async function verifiedEmails(userId: string): Promise<string[]> {
  const user = await clerkClient.users.getUser(userId);
  return user.emailAddresses
    .filter((address) => address.verification?.status === "verified")
    .map((address) => address.emailAddress.trim().toLowerCase());
}

async function clientGrantFor(identity: ClientGuardIdentity) {
  const [byUser] = await db
    .select()
    .from(portalAccessTable)
    .where(
      and(
        eq(portalAccessTable.clerkUserId, identity.userId),
        eq(portalAccessTable.status, "active"),
      ),
    )
    .limit(1);
  if (byUser) return byUser;

  const emails = await verifiedEmails(identity.userId);
  if (!emails.length) return null;
  const [pending] = await db
    .select()
    .from(portalAccessTable)
    .where(
      and(
        inArray(portalAccessTable.email, emails),
        eq(portalAccessTable.status, "invited"),
      ),
    )
    .limit(1);
  if (!pending) return null;
  const [active] = await db
    .update(portalAccessTable)
    .set({
      status: "active",
      clerkUserId: identity.userId,
      activatedAt: new Date(),
    })
    .where(eq(portalAccessTable.id, pending.id))
    .returning();
  return active ?? null;
}

async function requireClientGrant(req: Request, res: Response) {
  const identity = identify(req, res);
  if (!identity) return null;
  const grant = await clientGrantFor(identity);
  if (!grant) {
    res.status(403).json({
      error: "This verified account does not have active client portal access.",
      code: "client_portal_access_required",
    });
    return null;
  }
  return { identity, grant };
}

async function getMatterTitle(workspaceId: number, matterId: number) {
  const [matter] = await db
    .select({ title: mattersTable.title })
    .from(mattersTable)
    .where(
      and(
        eq(mattersTable.id, matterId),
        eq(mattersTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return matter?.title ?? null;
}

router.get("/intake", async (req, res): Promise<void> => {
  const access = (await import("../lib/clientguard-auth")).firmAccess;
  const firm = await access(req, res);
  if (!firm) return;
  const [workspace] = await db
    .select({ practiceType: workspacesTable.practiceType })
    .from(workspacesTable)
    .where(eq(workspacesTable.id, firm.workspaceId))
    .limit(1);
  const [intakes, checks] = await Promise.all([
    db
      .select()
      .from(intakesTable)
      .where(eq(intakesTable.workspaceId, firm.workspaceId))
      .orderBy(desc(intakesTable.createdAt)),
    rulesForWorkspace(firm.workspaceId, workspace?.practiceType ?? firm.practiceType),
  ]);
  res.json(api.GetIntakeOverviewResponse.parse({ checks, intakes }));
});

router.put("/intake", async (req, res): Promise<void> => {
  const firmAccess = (await import("../lib/clientguard-auth")).firmAccess;
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  const parsed = api.SaveIntakeChecksBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const keys = new Set<string>();
  for (const check of parsed.data.checks) {
    if (!/^[a-z0-9_-]+$/i.test(check.key) || keys.has(check.key)) {
      res.status(400).json({ error: "Check keys must be unique letters, numbers, underscores, or hyphens." });
      return;
    }
    keys.add(check.key);
  }
  const [saved] = await db
    .insert(intakeSettingsTable)
    .values({
      workspaceId: firm.workspaceId,
      checks: parsed.data.checks,
      updatedByClerkUserId: firm.userId,
    })
    .onConflictDoUpdate({
      target: intakeSettingsTable.workspaceId,
      set: { checks: parsed.data.checks, updatedByClerkUserId: firm.userId, updatedAt: new Date() },
    })
    .returning();
  await appendAudit(firm.workspaceId, firm, "intake_checks_updated", "workspace", firm.workspaceId, "Intake checks", {
    count: saved.checks.length,
  });
  res.json(api.SaveIntakeChecksResponse.parse({ checks: saved.checks }));
});

router.post("/intakes", async (req, res): Promise<void> => {
  const firmAccess = (await import("../lib/clientguard-auth")).firmAccess;
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  const parsed = api.CreateIntakeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const [responsibleMember] = await db
    .select()
    .from(membershipsTable)
    .where(and(
      eq(membershipsTable.id, input.responsibleMemberId),
      eq(membershipsTable.workspaceId, firm.workspaceId),
    ))
    .limit(1);
  if (!responsibleMember) {
    res.status(400).json({ error: "Choose an active teammate in this firm." });
    return;
  }
  if (input.clientId) {
    const [client] = await db
      .select({ id: clientsTable.id, name: clientsTable.name })
      .from(clientsTable)
      .where(and(eq(clientsTable.id, input.clientId), eq(clientsTable.workspaceId, firm.workspaceId)))
      .limit(1);
    if (!client) {
      res.status(404).json({ error: "The selected client is not in this firm." });
      return;
    }
  }
  const rules = await rulesForWorkspace(firm.workspaceId, firm.practiceType);
  const missing = rules
    .filter((rule) => rule.required && !String(input.answers[rule.key] ?? "").trim())
    .map((rule) => rule.label);
  if (missing.length) {
    res.status(400).json({ error: `Complete required checks: ${missing.join(", ")}.` });
    return;
  }
  const parties = [input.clientName, ...input.partyNames];
  const conflictFindings = await findConflicts(firm.workspaceId, parties, input.clientId ?? undefined);
  const [created] = await db
    .insert(intakesTable)
    .values({
      workspaceId: firm.workspaceId,
      clientId: input.clientId ?? null,
      clientName: input.clientName.trim(),
      clientType: input.clientType,
      email: input.email ?? null,
      phone: input.phone ?? null,
      industry: input.industry ?? null,
      matterTitle: input.matterTitle.trim(),
      matterType: input.matterType.trim(),
      responsible: responsibleMember.displayName || responsibleMember.email || "Firm teammate",
      responsibleMemberId: responsibleMember.id,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      partyNames: [...new Set(parties.map((name) => name.trim()).filter(Boolean))],
      answers: input.answers,
      conflictFindings,
      createdByClerkUserId: firm.userId,
    })
    .returning();
  await appendAudit(firm.workspaceId, firm, "intake_created", "intake", created.id, created.matterTitle, {
    conflictCount: conflictFindings.length,
  });
  res.status(201).json(api.CreateIntakeResponse.parse(created));
});

router.patch("/intakes/:id/review", async (req, res): Promise<void> => {
  const firmAccess = (await import("../lib/clientguard-auth")).firmAccess;
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  const id = idFrom(req.params.id);
  const parsed = api.ReviewIntakeBody.safeParse(req.body);
  if (!id || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid intake ID." : parsed.error.message });
    return;
  }
  const [intake] = await db
    .select()
    .from(intakesTable)
    .where(and(eq(intakesTable.id, id), eq(intakesTable.workspaceId, firm.workspaceId)))
    .limit(1);
  if (!intake) {
    res.status(404).json({ error: "Intake not found." });
    return;
  }
  if (intake.status !== "review_required") {
    res.status(409).json({ error: "This intake has already been reviewed or converted." });
    return;
  }
  if (parsed.data.decision === "cleared" && intake.conflictFindings.length > 0 && !parsed.data.conflictsResolved) {
    res.status(409).json({ error: "A professional must document that potential conflict matches were resolved before clearing this intake." });
    return;
  }
  const [updated] = await db
    .update(intakesTable)
    .set({
      status: parsed.data.decision,
      reviewNote: parsed.data.note.trim(),
      reviewerClerkUserId: firm.userId,
      updatedAt: new Date(),
    })
    .where(and(eq(intakesTable.id, id), eq(intakesTable.status, "review_required")))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "The intake changed while it was being reviewed. Reload and try again." });
    return;
  }
  await appendAudit(firm.workspaceId, firm, "intake_professionally_reviewed", "intake", id, intake.matterTitle, {
    decision: parsed.data.decision,
    conflictCount: intake.conflictFindings.length,
    conflictsResolved: parsed.data.conflictsResolved,
  });
  res.json(api.ReviewIntakeResponse.parse(updated));
});

router.post("/intakes/:id/open-matter", async (req, res): Promise<void> => {
  const firmAccess = (await import("../lib/clientguard-auth")).firmAccess;
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  const id = idFrom(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid intake ID." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [intake] = await tx
      .select()
      .from(intakesTable)
      .where(and(eq(intakesTable.id, id), eq(intakesTable.workspaceId, firm.workspaceId)))
      .for("update")
      .limit(1);
    if (!intake) return { kind: "missing" as const };
    if (intake.status !== "cleared" || intake.openedMatterId) return { kind: "not-cleared" as const };

    let clientId = intake.clientId;
    const [responsibleMember] = intake.responsibleMemberId === null ? [] : await tx
      .select()
      .from(membershipsTable)
      .where(and(
        eq(membershipsTable.id, intake.responsibleMemberId),
        eq(membershipsTable.workspaceId, firm.workspaceId),
      ))
      .limit(1);
    let resolvedMember = responsibleMember;
    if (!resolvedMember) {
      const candidates = await tx
        .select()
        .from(membershipsTable)
        .where(eq(membershipsTable.workspaceId, firm.workspaceId));
      const label = intake.responsible.trim().toLocaleLowerCase();
      const matches = candidates.filter((candidate) =>
        [candidate.displayName, candidate.email]
          .some((value) => value.trim().toLocaleLowerCase() === label),
      );
      if (matches.length === 1) resolvedMember = matches[0];
    }
    const responsibleLabel = resolvedMember
      ? resolvedMember.displayName || resolvedMember.email || intake.responsible
      : intake.responsible;
    if (clientId) {
      const [existing] = await tx
        .select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.id, clientId), eq(clientsTable.workspaceId, firm.workspaceId)))
        .limit(1);
      if (!existing) return { kind: "missing-client" as const };
    } else {
      const [client] = await tx
        .insert(clientsTable)
        .values({
          workspaceId: firm.workspaceId,
          name: intake.clientName,
          clientType: intake.clientType,
          email: intake.email,
          phone: intake.phone,
          industry: intake.industry,
          owner: responsibleLabel,
          ownerMemberId: resolvedMember?.id ?? null,
          status: "prospect",
        })
        .returning();
      clientId = client.id;
    }
    const reference = `MAT-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const [matter] = await tx
      .insert(mattersTable)
      .values({
        workspaceId: firm.workspaceId,
        clientId,
        title: intake.matterTitle,
        reference,
        matterType: intake.matterType,
        responsible: responsibleLabel,
        responsibleMemberId: resolvedMember?.id ?? null,
        dueAt: intake.dueAt,
      })
      .returning();
    await tx
      .update(intakesTable)
      .set({ status: "converted", clientId, openedMatterId: matter.id, updatedAt: new Date() })
      .where(eq(intakesTable.id, intake.id));
    const [client] = await tx
      .select({ name: clientsTable.name })
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId))
      .limit(1);
    return { kind: "created" as const, matter: { ...matter, clientName: client?.name ?? intake.clientName }, title: intake.matterTitle };
  });
  if (result.kind === "missing") {
    res.status(404).json({ error: "Intake not found." });
    return;
  }
  if (result.kind !== "created") {
    res.status(409).json({ error: result.kind === "not-cleared" ? "Only a cleared intake can open a matter, and each intake can open one matter." : "The client record is unavailable in this firm." });
    return;
  }
  await logActivity(firm, "matter", result.matter.id, result.title, "opened matter after intake review");
  await appendAudit(firm.workspaceId, firm, "matter_opened_after_intake", "matter", result.matter.id, result.title, { intakeId: id });
  res.status(201).json(api.OpenMatterFromIntakeResponse.parse(result.matter));
});

router.get("/portal/access", async (req, res): Promise<void> => {
  const { firmAccess } = await import("../lib/clientguard-auth");
  const firm = await firmAccess(req, res);
  if (!firm) return;
  const records = await db
    .select({ access: portalAccessTable, clientName: clientsTable.name })
    .from(portalAccessTable)
    .innerJoin(clientsTable, and(eq(portalAccessTable.clientId, clientsTable.id), eq(portalAccessTable.workspaceId, clientsTable.workspaceId)))
    .where(eq(portalAccessTable.workspaceId, firm.workspaceId))
    .orderBy(desc(portalAccessTable.createdAt));
  res.json(api.ListPortalAccessResponse.parse(records.map(({ access, clientName }) => ({ ...access, clientName }))));
});

router.post("/portal/access", async (req, res): Promise<void> => {
  const { firmAccess } = await import("../lib/clientguard-auth");
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  const parsed = api.InvitePortalClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.id, parsed.data.clientId), eq(clientsTable.workspaceId, firm.workspaceId)))
    .limit(1);
  if (!client) {
    res.status(404).json({ error: "Client not found in this firm." });
    return;
  }
  const [existing] = await db
    .select()
    .from(portalAccessTable)
    .where(and(eq(portalAccessTable.workspaceId, firm.workspaceId), eq(portalAccessTable.clientId, client.id), eq(portalAccessTable.email, email)))
    .limit(1);
  if (existing && existing.status !== "revoked") {
    res.status(409).json({ error: "This email already has active or pending access to the client portal." });
    return;
  }
  let clerkUserId: string | null = null;
  let clerkInvitationId: string | null = null;
  const existingUsers = await clerkClient.users.getUserList({ emailAddress: [email], limit: 1 });
  const user = existingUsers.data[0];
  if (user) {
    const hasVerifiedEmail = user.emailAddresses.some((address) =>
      address.emailAddress.toLowerCase() === email && address.verification?.status === "verified",
    );
    if (!hasVerifiedEmail) {
      res.status(409).json({ error: "The existing account must verify this email before portal access is granted." });
      return;
    }
    clerkUserId = user.id;
  } else {
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      notify: true,
    });
    clerkInvitationId = invitation.id;
  }
  const values = {
    workspaceId: firm.workspaceId,
    clientId: client.id,
    email,
    clerkUserId,
    clerkInvitationId,
    status: clerkUserId ? "active" : "invited",
    invitedByClerkUserId: firm.userId,
    activatedAt: clerkUserId ? new Date() : null,
    revokedAt: null,
  };
  const [created] = existing
    ? await db.update(portalAccessTable).set(values).where(eq(portalAccessTable.id, existing.id)).returning()
    : await db.insert(portalAccessTable).values(values).returning();
  await appendAudit(firm.workspaceId, firm, "client_portal_invited", "client", client.id, client.name, { email });
  res.status(201).json(api.InvitePortalClientResponse.parse({ ...created, clientName: client.name }));
});

router.delete("/portal/access/:id", async (req, res): Promise<void> => {
  const { firmAccess } = await import("../lib/clientguard-auth");
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  const id = idFrom(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid portal access ID." });
    return;
  }
  const [record] = await db
    .select()
    .from(portalAccessTable)
    .where(and(eq(portalAccessTable.id, id), eq(portalAccessTable.workspaceId, firm.workspaceId)))
    .limit(1);
  if (!record) {
    res.status(404).json({ error: "Portal access not found." });
    return;
  }
  await db.update(portalAccessTable).set({ status: "revoked", revokedAt: new Date() }).where(eq(portalAccessTable.id, id));
  await appendAudit(firm.workspaceId, firm, "client_portal_access_revoked", "client", record.clientId, record.email, {});
  res.status(204).end();
});

router.get("/portal/requests", async (req, res): Promise<void> => {
  const view = typeof req.query.view === "string" ? req.query.view : "firm";
  if (view !== "firm" && view !== "client") {
    res.status(400).json({ error: "Choose a firm or client portal view." });
    return;
  }
  const identity = identify(req, res);
  if (!identity) return;
  const member = view === "firm" ? await membershipFor(identity.userId) : null;
  const grant = view === "client" ? await clientGrantFor(identity) : null;
  if ((view === "firm" && !member) || (view === "client" && !grant)) {
    res.status(403).json({ error: "Firm membership or client portal access is required." });
    return;
  }
  const workspaceId = member?.workspace.id ?? grant!.workspaceId;
  const filter = member
    ? eq(portalRequestsTable.workspaceId, workspaceId)
    : and(
      eq(portalRequestsTable.workspaceId, workspaceId),
      eq(portalRequestsTable.clientId, grant!.clientId),
    );
  const rows = await db.select({
    request: portalRequestsTable,
    matterTitle: mattersTable.title,
    responseMessage: portalMessagesTable.body,
  }).from(portalRequestsTable)
    .innerJoin(mattersTable, and(
      eq(portalRequestsTable.matterId, mattersTable.id),
      eq(portalRequestsTable.workspaceId, mattersTable.workspaceId),
    ))
    .leftJoin(portalMessagesTable, eq(portalRequestsTable.responseMessageId, portalMessagesTable.id))
    .where(filter)
    .orderBy(desc(portalRequestsTable.createdAt));
  await appendAudit(workspaceId, identity, "client_portal_requests_viewed", "portal_requests", null, "Client portal requests", {
    requestCount: rows.length,
    view: member ? "firm" : "client",
  });
  res.json(api.GetPortalRequestsResponse.parse(rows.map(({ request, matterTitle, responseMessage }) => ({
    id: request.id,
    matterId: request.matterId,
    matterTitle,
    title: request.title,
    details: request.details,
    status: request.status,
    createdAt: request.createdAt,
    respondedAt: request.respondedAt,
    responseMessage,
  }))));
});

router.post("/portal/requests", async (req, res): Promise<void> => {
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  const parsed = api.CreatePortalRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [matter] = await db.select().from(mattersTable).where(and(
    eq(mattersTable.id, parsed.data.matterId),
    eq(mattersTable.workspaceId, firm.workspaceId),
  )).limit(1);
  if (!matter) {
    res.status(404).json({ error: "Matter not found in this firm." });
    return;
  }
  const [request] = await db.insert(portalRequestsTable).values({
    workspaceId: firm.workspaceId,
    clientId: matter.clientId,
    matterId: matter.id,
    title: parsed.data.title.trim(),
    details: parsed.data.details.trim(),
    createdByClerkUserId: firm.userId,
  }).returning();
  await logAuditEvent(firm, "client_portal_request_created", "portal_request", request.id, request.title, {
    matterId: matter.id,
  });
  res.status(201).json(api.CreatePortalRequestResponse.parse({
    id: request.id, matterId: matter.id, matterTitle: matter.title,
    title: request.title, details: request.details, status: request.status,
    createdAt: request.createdAt, respondedAt: null, responseMessage: null,
  }));
});

router.post("/portal/requests/:id/respond", async (req, res): Promise<void> => {
  const session = await requireClientGrant(req, res);
  if (!session) return;
  const id = idFrom(req.params.id);
  const parsed = api.RespondToPortalRequestBody.safeParse(req.body);
  if (!id || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid portal request ID." : parsed.error.message });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [request] = await tx.select().from(portalRequestsTable).where(and(
      eq(portalRequestsTable.id, id),
      eq(portalRequestsTable.workspaceId, session.grant.workspaceId),
      eq(portalRequestsTable.clientId, session.grant.clientId),
    )).limit(1).for("update");
    if (!request) return { kind: "missing" as const };
    if (request.status !== "open") return { kind: "closed" as const };
    const [message] = await tx.insert(portalMessagesTable).values({
      workspaceId: request.workspaceId,
      clientId: request.clientId,
      matterId: request.matterId,
      senderClerkUserId: session.identity.userId,
      senderType: "client",
      senderName: session.identity.name || session.identity.email || "Client",
      body: parsed.data.body.trim(),
    }).returning();
    const [updated] = await tx.update(portalRequestsTable).set({
      status: "responded",
      respondedAt: new Date(),
      respondedByClerkUserId: session.identity.userId,
      responseMessageId: message.id,
    }).where(eq(portalRequestsTable.id, request.id)).returning();
    return { kind: "responded" as const, request: updated, message };
  });
  if (result.kind === "missing") {
    res.status(404).json({ error: "Portal request not found for this client account." });
    return;
  }
  if (result.kind === "closed") {
    res.status(409).json({ error: "This request is no longer open for a response." });
    return;
  }
  const [matter] = await db.select({ title: mattersTable.title }).from(mattersTable).where(and(
    eq(mattersTable.id, result.request.matterId),
    eq(mattersTable.workspaceId, session.grant.workspaceId),
  )).limit(1);
  await appendAudit(session.grant.workspaceId, session.identity, "client_portal_request_answered", "portal_request", id, result.request.title, {
    matterId: result.request.matterId,
  });
  res.json(api.RespondToPortalRequestResponse.parse({
    id, matterId: result.request.matterId, matterTitle: matter?.title ?? "",
    title: result.request.title, details: result.request.details, status: result.request.status,
    createdAt: result.request.createdAt, respondedAt: result.request.respondedAt,
    responseMessage: result.message.body,
  }));
});

router.patch("/portal/requests/:id", async (req, res): Promise<void> => {
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  const id = idFrom(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid portal request ID." });
    return;
  }
  const [request] = await db.select().from(portalRequestsTable).where(and(
    eq(portalRequestsTable.id, id),
    eq(portalRequestsTable.workspaceId, firm.workspaceId),
  )).limit(1);
  if (!request) {
    res.status(404).json({ error: "Portal request not found." });
    return;
  }
  if (request.status !== "responded") {
    res.status(409).json({ error: "Only a request with a client response can be closed." });
    return;
  }
  const [updated] = await db.update(portalRequestsTable).set({
    status: "closed",
    closedAt: new Date(),
    closedByClerkUserId: firm.userId,
  }).where(eq(portalRequestsTable.id, id)).returning();
  const [matter] = await db.select({ title: mattersTable.title }).from(mattersTable).where(eq(mattersTable.id, request.matterId)).limit(1);
  const [response] = request.responseMessageId
    ? await db.select({ body: portalMessagesTable.body }).from(portalMessagesTable).where(eq(portalMessagesTable.id, request.responseMessageId)).limit(1)
    : [];
  await logAuditEvent(firm, "client_portal_request_closed", "portal_request", id, request.title);
  res.json(api.ClosePortalRequestResponse.parse({
    id, matterId: request.matterId, matterTitle: matter?.title ?? "",
    title: request.title, details: request.details, status: updated.status,
    createdAt: request.createdAt, respondedAt: request.respondedAt,
    responseMessage: response?.body ?? null,
  }));
});

router.get("/portal/context", async (req, res): Promise<void> => {
  const session = await requireClientGrant(req, res);
  if (!session) return;
  const { identity, grant } = session;
  const [client] = await db
    .select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, grant.clientId), eq(clientsTable.workspaceId, grant.workspaceId)))
    .limit(1);
  if (!client) {
    res.status(403).json({ error: "This client portal access is no longer linked to an available client." });
    return;
  }
  const [matters, docs, updates] = await Promise.all([
    db.select().from(mattersTable).where(and(eq(mattersTable.workspaceId, grant.workspaceId), eq(mattersTable.clientId, client.id))).orderBy(desc(mattersTable.updatedAt)),
    db.select({ document: documentsTable, matterTitle: mattersTable.title }).from(documentsTable)
      .innerJoin(mattersTable, and(eq(documentsTable.matterId, mattersTable.id), eq(documentsTable.workspaceId, mattersTable.workspaceId)))
      .where(and(eq(documentsTable.workspaceId, grant.workspaceId), eq(mattersTable.clientId, client.id), eq(documentsTable.clientVisible, true), eq(documentsTable.status, "ready"))),
    db.select({ update: portalUpdatesTable, matterTitle: mattersTable.title }).from(portalUpdatesTable)
      .innerJoin(mattersTable, and(eq(portalUpdatesTable.matterId, mattersTable.id), eq(portalUpdatesTable.workspaceId, mattersTable.workspaceId)))
      .where(and(eq(portalUpdatesTable.workspaceId, grant.workspaceId), eq(portalUpdatesTable.clientId, client.id)))
      .orderBy(desc(portalUpdatesTable.publishedAt)),
  ]);
  await appendAudit(grant.workspaceId, identity, "client_portal_viewed", "client", client.id, client.name);
  res.json(api.GetClientPortalContextResponse.parse({
    client,
    matters: matters.map(({ id, title, reference, status, dueAt }) => ({ id, title, reference, status, dueAt })),
    documents: docs.map(({ document, matterTitle }) => ({
      id: document.id, matterId: document.matterId, matterTitle, name: document.originalName,
      contentType: document.contentType, sizeBytes: document.sizeBytes, createdAt: document.createdAt,
    })),
    updates: updates.map(({ update, matterTitle }) => ({
      id: update.id, matterId: update.matterId, matterTitle, subject: update.subject,
      body: update.body, publishedAt: update.publishedAt,
    })),
  }));
});

router.get("/portal/messages", async (req, res): Promise<void> => {
  const view = typeof req.query.view === "string" ? req.query.view : "firm";
  if (view !== "firm" && view !== "client") {
    res.status(400).json({ error: "Choose a firm or client portal view." });
    return;
  }
  const identity = identify(req, res);
  if (!identity) return;
  const member = view === "firm" ? await membershipFor(identity.userId) : null;
  const grant = view === "client" ? await clientGrantFor(identity) : null;
  if ((view === "firm" && !member) || (view === "client" && !grant)) {
    res.status(403).json({ error: "Firm membership or client portal access is required." });
    return;
  }
  const workspaceId = member?.workspace.id ?? grant!.workspaceId;
  const filters = member
    ? and(eq(portalMessagesTable.workspaceId, workspaceId))
    : and(eq(portalMessagesTable.workspaceId, workspaceId), eq(portalMessagesTable.clientId, grant!.clientId));
  const rows = await db.select({ message: portalMessagesTable, matterTitle: mattersTable.title })
    .from(portalMessagesTable)
    .innerJoin(mattersTable, and(eq(portalMessagesTable.matterId, mattersTable.id), eq(portalMessagesTable.workspaceId, mattersTable.workspaceId)))
    .where(filters)
    .orderBy(portalMessagesTable.createdAt);
  await appendAudit(workspaceId, identity, "client_portal_messages_viewed", "portal_messages", null, "Client portal messages", {
    messageCount: rows.length,
    view: member ? "firm" : "client",
  });
  res.json(api.ListPortalMessagesResponse.parse(rows.map(({ message, matterTitle }) => ({
    ...message, matterTitle,
  }))));
});

router.post("/portal/messages", async (req, res): Promise<void> => {
  const view = typeof req.query.view === "string" ? req.query.view : "firm";
  if (view !== "firm" && view !== "client") {
    res.status(400).json({ error: "Choose a firm or client portal view." });
    return;
  }
  const identity = identify(req, res);
  if (!identity) return;
  const parsed = api.SendPortalMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const firm = view === "firm" ? await firmAccess(req, res, true) : null;
  if (view === "firm" && !firm) return;
  const grant = view === "client" ? await clientGrantFor(identity) : null;
  if ((view === "firm" && !firm) || (view === "client" && !grant)) {
    res.status(403).json({ error: "Firm membership or client portal access is required." });
    return;
  }
  const workspaceId = firm?.workspaceId ?? grant!.workspaceId;
  const [matter] = await db.select().from(mattersTable).where(and(
    eq(mattersTable.id, parsed.data.matterId),
    eq(mattersTable.workspaceId, workspaceId),
    grant ? eq(mattersTable.clientId, grant.clientId) : undefined,
  )).limit(1);
  if (!matter) {
    res.status(404).json({ error: "Matter not found for this account." });
    return;
  }
  const [message] = await db.insert(portalMessagesTable).values({
    workspaceId,
    clientId: matter.clientId,
    matterId: matter.id,
    senderClerkUserId: identity.userId,
    senderType: firm ? "firm" : "client",
    senderName: identity.name || identity.email || (firm ? "Firm user" : "Client"),
    body: parsed.data.body.trim(),
  }).returning();
  await appendAudit(workspaceId, identity, "client_portal_message_sent", "matter", matter.id, matter.title, {
    senderType: firm ? "firm" : "client",
  });
  res.status(201).json(api.SendPortalMessageResponse.parse({ ...message, matterTitle: matter.title }));
});

router.post("/portal/documents/upload-url", async (req, res): Promise<void> => {
  const session = await requireClientGrant(req, res);
  if (!session) return;
  const parsed = api.RequestPortalDocumentUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.size > MAX_UPLOAD_BYTES || !allowedDocumentTypes.has(parsed.data.contentType)) {
    res.status(400).json({ error: "Upload a PDF, DOCX, or plain-text file up to 15 MB." });
    return;
  }
  const [matter] = await db.select().from(mattersTable).where(and(
    eq(mattersTable.id, parsed.data.matterId),
    eq(mattersTable.workspaceId, session.grant.workspaceId),
    eq(mattersTable.clientId, session.grant.clientId),
  )).limit(1);
  if (!matter) {
    res.status(404).json({ error: "Matter not found for this client account." });
    return;
  }
  const uploadURL = await objectStorage.getObjectEntityUploadURL();
  const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
  if (!objectPath.startsWith("/objects/uploads/")) {
    res.status(502).json({ error: "Could not create a private upload." });
    return;
  }
  const [document] = await db.insert(documentsTable).values({
    workspaceId: session.grant.workspaceId,
    matterId: matter.id,
    uploadedByClerkUserId: session.identity.userId,
    objectPath,
    originalName: parsed.data.name.trim(),
    contentType: parsed.data.contentType,
    sizeBytes: parsed.data.size,
    status: "uploading",
    uploadedFromPortal: true,
    clientVisible: false,
  }).returning();
  await appendAudit(session.grant.workspaceId, session.identity, "client_portal_document_upload_started", "matter", matter.id, matter.title, {
    documentId: document.id,
  });
  res.json(api.RequestPortalDocumentUploadResponse.parse({
    id: document.id, uploadURL, objectPath, originalName: document.originalName,
  }));
});

router.post("/portal/documents/:id/complete", async (req, res): Promise<void> => {
  const session = await requireClientGrant(req, res);
  if (!session) return;
  const id = idFrom(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid document ID." });
    return;
  }
  const [document] = await db.select().from(documentsTable).where(and(
    eq(documentsTable.id, id),
    eq(documentsTable.workspaceId, session.grant.workspaceId),
    eq(documentsTable.uploadedFromPortal, true),
    eq(documentsTable.uploadedByClerkUserId, session.identity.userId),
  )).limit(1);
  if (!document) {
    res.status(404).json({ error: "Portal upload not found." });
    return;
  }
  const [matter] = await db.select().from(mattersTable).where(and(
    eq(mattersTable.id, document.matterId),
    eq(mattersTable.clientId, session.grant.clientId),
  )).limit(1);
  if (!matter) {
    res.status(404).json({ error: "Matter not found for this client account." });
    return;
  }
  if (document.status === "uploading") {
    try {
      const file = await objectStorage.getObjectEntityFile(document.objectPath);
      const [metadata] = await file.getMetadata();
      if (Number(metadata.size ?? 0) !== document.sizeBytes) {
        res.status(400).json({ error: "The uploaded file size does not match." });
        return;
      }
      const storedType = metadata.contentType?.split(";")[0].trim().toLowerCase();
      if (storedType && storedType !== document.contentType) {
        res.status(400).json({ error: "The uploaded file type does not match." });
        return;
      }
    } catch (error) {
      req.log.warn({ err: error, documentId: id }, "Portal upload was not found in private storage");
      res.status(404).json({ error: "The uploaded file was not found in private storage." });
      return;
    }
  }
  const [ready] = document.status === "uploading"
    ? await db.update(documentsTable).set({ status: "ready" }).where(eq(documentsTable.id, id)).returning()
    : [document];
  await appendAudit(session.grant.workspaceId, session.identity, "client_portal_document_uploaded", "matter", matter.id, matter.title, { documentId: id });
  res.json(api.CompletePortalDocumentUploadResponse.parse({
    ...ready,
    matterTitle: matter.title,
  }));
});

router.get("/portal/documents/:id/file", async (req, res): Promise<void> => {
  const session = await requireClientGrant(req, res);
  if (!session) return;
  const id = idFrom(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid document ID." });
    return;
  }
  const [row] = await db.select({ document: documentsTable, matterTitle: mattersTable.title })
    .from(documentsTable)
    .innerJoin(mattersTable, and(eq(documentsTable.matterId, mattersTable.id), eq(documentsTable.workspaceId, mattersTable.workspaceId)))
    .where(and(
      eq(documentsTable.id, id),
      eq(documentsTable.workspaceId, session.grant.workspaceId),
      eq(documentsTable.clientVisible, true),
      eq(documentsTable.status, "ready"),
      eq(mattersTable.clientId, session.grant.clientId),
    )).limit(1);
  if (!row) {
    res.status(404).json({ error: "Shared document not found." });
    return;
  }
  await appendAudit(session.grant.workspaceId, session.identity, "client_portal_document_downloaded", "matter", row.document.matterId, row.matterTitle, { documentId: id });
  try {
    const file = await objectStorage.getObjectEntityFile(row.document.objectPath);
    const [metadata] = await file.getMetadata();
    const safeName = encodeURIComponent(row.document.originalName.replace(/[\r\n]/g, ""));
    res.setHeader("Content-Type", row.document.contentType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${safeName}`);
    res.setHeader("Cache-Control", "private, no-store");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    await pipeline(file.createReadStream(), res);
  } catch (error) {
    req.log.warn({ err: error, documentId: id }, "Client-visible document could not be streamed");
    if (!res.headersSent) res.status(404).json({ error: "Document not found." });
  }
});

router.patch("/documents/:id/client-visibility", async (req, res): Promise<void> => {
  const { firmAccess } = await import("../lib/clientguard-auth");
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  const id = idFrom(req.params.id);
  const parsed = api.SetDocumentClientVisibilityBody.safeParse(req.body);
  if (!id || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid document ID." : parsed.error.message });
    return;
  }
  const [row] = await db.select({ document: documentsTable, matterTitle: mattersTable.title })
    .from(documentsTable)
    .innerJoin(mattersTable, and(eq(documentsTable.matterId, mattersTable.id), eq(documentsTable.workspaceId, mattersTable.workspaceId)))
    .where(and(eq(documentsTable.id, id), eq(documentsTable.workspaceId, firm.workspaceId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  if (parsed.data.visible && row.document.status !== "ready") {
    res.status(409).json({ error: "Only completed documents can be shared with a client." });
    return;
  }
  const [updated] = await db.update(documentsTable).set({ clientVisible: parsed.data.visible }).where(eq(documentsTable.id, id)).returning();
  await appendAudit(firm.workspaceId, firm, parsed.data.visible ? "document_shared_with_client" : "document_unshared_from_client", "matter", updated.matterId, row.matterTitle, { documentId: id });
  res.json(api.SetDocumentClientVisibilityResponse.parse({
    ...updated, matterTitle: row.matterTitle,
  }));
});

router.get("/portal/updates", async (req, res): Promise<void> => {
  const session = await requireClientGrant(req, res);
  if (!session) return;
  const rows = await db.select({ update: portalUpdatesTable, matterTitle: mattersTable.title })
    .from(portalUpdatesTable)
    .innerJoin(mattersTable, and(eq(portalUpdatesTable.matterId, mattersTable.id), eq(portalUpdatesTable.workspaceId, mattersTable.workspaceId)))
    .where(and(eq(portalUpdatesTable.workspaceId, session.grant.workspaceId), eq(portalUpdatesTable.clientId, session.grant.clientId)))
    .orderBy(desc(portalUpdatesTable.publishedAt));
  await appendAudit(session.grant.workspaceId, session.identity, "client_portal_updates_viewed", "client_updates", null, "Approved client updates", {
    updateCount: rows.length,
  });
  res.json(api.ListPortalUpdatesResponse.parse(rows.map(({ update, matterTitle }) => ({
    id: update.id, matterId: update.matterId, matterTitle,
    subject: update.subject, body: update.body, publishedAt: update.publishedAt,
  }))));
});

router.post("/portal/updates", async (req, res): Promise<void> => {
  const { firmAccess } = await import("../lib/clientguard-auth");
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  const parsed = api.PublishClientUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [draft] = await db.select().from((await import("@workspace/db")).updateDraftsTable)
    .where(and(
      eq((await import("@workspace/db")).updateDraftsTable.id, parsed.data.draftId),
      eq((await import("@workspace/db")).updateDraftsTable.workspaceId, firm.workspaceId),
    )).limit(1);
  if (!draft) {
    res.status(404).json({ error: "Client update draft not found." });
    return;
  }
  if (draft.status !== "reviewed") {
    res.status(409).json({ error: "Review the update draft before publishing it to the portal." });
    return;
  }
  const [matter] = await db.select().from(mattersTable).where(and(
    eq(mattersTable.id, draft.matterId), eq(mattersTable.workspaceId, firm.workspaceId),
  )).limit(1);
  if (!matter) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  const [existing] = await db.select().from(portalUpdatesTable).where(eq(portalUpdatesTable.updateDraftId, draft.id)).limit(1);
  if (existing) {
    res.status(409).json({ error: "This reviewed update has already been published." });
    return;
  }
  const [published] = await db.insert(portalUpdatesTable).values({
    workspaceId: firm.workspaceId,
    clientId: matter.clientId,
    matterId: matter.id,
    updateDraftId: draft.id,
    subject: draft.subject,
    body: draft.body,
    publishedByClerkUserId: firm.userId,
  }).returning();
  await appendAudit(firm.workspaceId, firm, "reviewed_client_update_published_to_portal", "matter", matter.id, matter.title, { draftId: draft.id });
  res.status(201).json(api.PublishClientUpdateResponse.parse({
    id: published.id, matterId: matter.id, matterTitle: matter.title,
    subject: published.subject, body: published.body, publishedAt: published.publishedAt,
  }));
});

router.post("/audit/exports", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const parsed = api.LogMatterExportRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ids = [...new Set(parsed.data.matterIds)];
  if (ids.length !== parsed.data.matterIds.length) {
    res.status(400).json({ error: "Matter IDs must be unique." });
    return;
  }
  const rows = await db.select({ id: mattersTable.id })
    .from(mattersTable)
    .where(and(
      eq(mattersTable.workspaceId, access.workspaceId),
      inArray(mattersTable.id, ids),
    ));
  if (rows.length !== ids.length) {
    res.status(404).json({ error: "One or more selected matters were not found in this firm." });
    return;
  }
  if (parsed.data.scope === "all") {
    const [matterCount] = await db
      .select({ value: count() })
      .from(mattersTable)
      .where(eq(mattersTable.workspaceId, access.workspaceId));
    if (matterCount.value !== ids.length) {
      res.status(400).json({ error: "An all-matters export must include every matter in this firm." });
      return;
    }
  }
  const actor = access.name || access.email || "Firm user";
  const countLabel = `${ids.length} ${ids.length === 1 ? "record" : "records"}`;
  await db.transaction(async (tx) => {
    await tx.insert(auditEventsTable).values({
      workspaceId: access.workspaceId,
      clerkUserId: access.userId,
      actor,
      action: "matter_pdf_exported",
      entityType: "matter_export",
      entityId: null,
      entityLabel: "Matter PDF export",
      details: { scope: parsed.data.scope, matterCount: ids.length, format: "pdf" },
    });
    await tx.insert(activitiesTable).values({
      workspaceId: access.workspaceId,
      clerkUserId: access.userId,
      actor,
      action: `exported ${parsed.data.scope} matters (${countLabel})`,
      entityType: "workspace",
      entityId: access.workspaceId,
      entityLabel: "Matter PDF",
    });
  });
  res.sendStatus(204);
});

router.get("/audit", async (req, res): Promise<void> => {
  const { firmAccess } = await import("../lib/clientguard-auth");
  const firm = await firmAccess(req, res);
  if (!firm) return;
  const parsed = api.ListAuditEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const limit = parsed.data.limit ?? 100;
  const events = await db.select().from(auditEventsTable)
    .where(eq(auditEventsTable.workspaceId, firm.workspaceId))
    .orderBy(desc(auditEventsTable.occurredAt), desc(auditEventsTable.id))
    .limit(limit);
  res.json(api.ListAuditEventsResponse.parse(events));
});

router.get("/governance", async (req, res): Promise<void> => {
  const { firmAccess } = await import("../lib/clientguard-auth");
  const firm = await firmAccess(req, res);
  if (!firm) return;
  const [settings, holds] = await Promise.all([
    db.select().from(retentionSettingsTable).where(eq(retentionSettingsTable.workspaceId, firm.workspaceId)).limit(1),
    db.select().from(legalHoldsTable).where(eq(legalHoldsTable.workspaceId, firm.workspaceId)).orderBy(desc(legalHoldsTable.placedAt)),
  ]);
  const [retention] = settings;
  const holdRows = await Promise.all(holds.map(async (hold) => {
    const [record] = hold.entityType === "client"
      ? await db.select({ label: clientsTable.name }).from(clientsTable).where(and(eq(clientsTable.id, hold.entityId), eq(clientsTable.workspaceId, firm.workspaceId))).limit(1)
      : await db.select({ label: mattersTable.title }).from(mattersTable).where(and(eq(mattersTable.id, hold.entityId), eq(mattersTable.workspaceId, firm.workspaceId))).limit(1);
    return {
      id: hold.id, entityType: hold.entityType, entityId: hold.entityId,
      entityLabel: record?.label ?? "Unavailable record",
      reason: hold.reason, placedBy: hold.placedByClerkUserId,
      placedAt: hold.placedAt, releasedAt: hold.releasedAt,
    };
  }));
  res.json(api.GetGovernanceOverviewResponse.parse({
    retention: {
      matterRetentionDays: retention?.matterRetentionDays ?? 2555,
      auditRetentionDays: retention?.auditRetentionDays ?? 2555,
    },
    legalHolds: holdRows,
  }));
});

router.put("/governance", async (req, res): Promise<void> => {
  const { firmAccess } = await import("../lib/clientguard-auth");
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  if (!["owner", "admin"].includes(firm.role)) {
    res.status(403).json({ error: "Only a firm owner or admin can change retention settings." });
    return;
  }
  const parsed = api.UpdateRetentionSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [saved] = await db.insert(retentionSettingsTable).values({
    workspaceId: firm.workspaceId,
    matterRetentionDays: parsed.data.matterRetentionDays,
    auditRetentionDays: parsed.data.auditRetentionDays,
    updatedByClerkUserId: firm.userId,
  }).onConflictDoUpdate({
    target: retentionSettingsTable.workspaceId,
    set: {
      matterRetentionDays: parsed.data.matterRetentionDays,
      auditRetentionDays: parsed.data.auditRetentionDays,
      updatedByClerkUserId: firm.userId,
      updatedAt: new Date(),
    },
  }).returning();
  await appendAudit(firm.workspaceId, firm, "retention_settings_updated", "workspace", firm.workspaceId, "Retention settings", {
    matterRetentionDays: saved.matterRetentionDays,
    auditRetentionDays: saved.auditRetentionDays,
  });
  res.json(api.UpdateRetentionSettingsResponse.parse({
    matterRetentionDays: saved.matterRetentionDays,
    auditRetentionDays: saved.auditRetentionDays,
  }));
});

router.post("/governance/legal-holds", async (req, res): Promise<void> => {
  const { firmAccess } = await import("../lib/clientguard-auth");
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  if (!["owner", "admin"].includes(firm.role)) {
    res.status(403).json({ error: "Only a firm owner or admin can place legal holds." });
    return;
  }
  const parsed = api.PlaceLegalHoldBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { entityType, entityId, reason } = parsed.data;
  const [target] = entityType === "client"
    ? await db.select({ label: clientsTable.name }).from(clientsTable).where(and(eq(clientsTable.id, entityId), eq(clientsTable.workspaceId, firm.workspaceId))).limit(1)
    : await db.select({ label: mattersTable.title }).from(mattersTable).where(and(eq(mattersTable.id, entityId), eq(mattersTable.workspaceId, firm.workspaceId))).limit(1);
  if (!target) {
    res.status(404).json({ error: `${entityType === "client" ? "Client" : "Matter"} not found in this firm.` });
    return;
  }
  const [active] = await db.select().from(legalHoldsTable).where(and(
    eq(legalHoldsTable.workspaceId, firm.workspaceId),
    eq(legalHoldsTable.entityType, entityType),
    eq(legalHoldsTable.entityId, entityId),
    isNull(legalHoldsTable.releasedAt),
  )).limit(1);
  if (active) {
    res.status(409).json({ error: "An active legal hold already exists for this record." });
    return;
  }
  const [hold] = await db.insert(legalHoldsTable).values({
    workspaceId: firm.workspaceId, entityType, entityId,
    reason: reason.trim(), placedByClerkUserId: firm.userId,
  }).returning();
  await appendAudit(firm.workspaceId, firm, "legal_hold_placed", entityType, entityId, target.label, {});
  res.status(201).json(api.PlaceLegalHoldResponse.parse({
    id: hold.id, entityType, entityId, entityLabel: target.label,
    reason: hold.reason, placedBy: firm.name, placedAt: hold.placedAt, releasedAt: null,
  }));
});

router.patch("/governance/legal-holds/:id", async (req, res): Promise<void> => {
  const { firmAccess } = await import("../lib/clientguard-auth");
  const firm = await firmAccess(req, res, true);
  if (!firm) return;
  if (!["owner", "admin"].includes(firm.role)) {
    res.status(403).json({ error: "Only a firm owner or admin can release legal holds." });
    return;
  }
  const id = idFrom(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid legal hold ID." });
    return;
  }
  const [hold] = await db.select().from(legalHoldsTable).where(and(
    eq(legalHoldsTable.id, id), eq(legalHoldsTable.workspaceId, firm.workspaceId),
  )).limit(1);
  if (!hold) {
    res.status(404).json({ error: "Legal hold not found." });
    return;
  }
  if (hold.releasedAt) {
    res.status(409).json({ error: "This legal hold has already been released." });
    return;
  }
  const [updated] = await db.update(legalHoldsTable).set({
    releasedAt: new Date(), releasedByClerkUserId: firm.userId,
  }).where(and(eq(legalHoldsTable.id, id), isNull(legalHoldsTable.releasedAt))).returning();
  const [target] = hold.entityType === "client"
    ? await db.select({ label: clientsTable.name }).from(clientsTable).where(and(eq(clientsTable.id, hold.entityId), eq(clientsTable.workspaceId, firm.workspaceId))).limit(1)
    : await db.select({ label: mattersTable.title }).from(mattersTable).where(and(eq(mattersTable.id, hold.entityId), eq(mattersTable.workspaceId, firm.workspaceId))).limit(1);
  await appendAudit(firm.workspaceId, firm, "legal_hold_released", hold.entityType, hold.entityId, target?.label ?? "Unavailable record", {});
  res.json(api.ReleaseLegalHoldResponse.parse({
    id: updated.id, entityType: updated.entityType, entityId: updated.entityId,
    entityLabel: target?.label ?? "Unavailable record", reason: updated.reason,
    placedBy: hold.placedByClerkUserId, placedAt: updated.placedAt,
    releasedAt: updated.releasedAt,
  }));
});

export default router;
