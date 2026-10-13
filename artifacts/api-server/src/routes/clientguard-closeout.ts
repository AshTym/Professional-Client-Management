import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import * as api from "@workspace/api-zod";
import {
  clientsTable,
  legalHoldsTable,
  matterCloseoutItemsTable,
  matterFollowupsTable,
  mattersTable,
  retentionSettingsTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import { firmAccess, logAuditEvent } from "../lib/clientguard-auth";
import { canMatterOpen } from "../lib/clientguard-practice-service";

const router: IRouter = Router();
const CLOSEOUT_STEPS = [
  {
    itemKey: "final_billing",
    title: "Complete final billing and outstanding balance review",
  },
  {
    itemKey: "document_handover",
    title: "Confirm document handover and client access are complete",
  },
  {
    itemKey: "retention_review",
    title: "Review record disposition under the firm retention rule and any legal hold",
  },
] as const;

function idFrom(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function closeoutData(workspaceId: number, matterId: number) {
  const [matterRow] = await db.select({
    matter: mattersTable,
    clientName: clientsTable.name,
  }).from(mattersTable).innerJoin(clientsTable, and(
    eq(clientsTable.id, mattersTable.clientId),
    eq(clientsTable.workspaceId, mattersTable.workspaceId),
  )).where(and(
    eq(mattersTable.id, matterId),
    eq(mattersTable.workspaceId, workspaceId),
  )).limit(1);
  if (!matterRow) return null;

  const [items, followupRows, retention, holds] = await Promise.all([
    db.select().from(matterCloseoutItemsTable).where(and(
      eq(matterCloseoutItemsTable.workspaceId, workspaceId),
      eq(matterCloseoutItemsTable.matterId, matterId),
    )).orderBy(matterCloseoutItemsTable.id),
    db.select().from(matterFollowupsTable).where(and(
      eq(matterFollowupsTable.workspaceId, workspaceId),
      eq(matterFollowupsTable.matterId, matterId),
    )).orderBy(desc(matterFollowupsTable.dueAt)),
    db.select().from(retentionSettingsTable)
      .where(eq(retentionSettingsTable.workspaceId, workspaceId)).limit(1),
    db.select({ id: legalHoldsTable.id }).from(legalHoldsTable).where(and(
      eq(legalHoldsTable.workspaceId, workspaceId),
      inArray(legalHoldsTable.entityType, ["matter", "client"]),
      inArray(legalHoldsTable.entityId, [matterId, matterRow.matter.clientId]),
      isNull(legalHoldsTable.releasedAt),
    )),
  ]);
  const retentionDays = retention[0]?.matterRetentionDays ?? 2555;
  let targetRetentionDate: string | null = null;
  if (matterRow.matter.status === "closed" && !holds.length) {
    const retainedUntil = new Date(matterRow.matter.updatedAt);
    retainedUntil.setUTCDate(retainedUntil.getUTCDate() + retentionDays);
    targetRetentionDate = retainedUntil.toISOString().slice(0, 10);
  }
  const closeoutItemsComplete =
    items.length === CLOSEOUT_STEPS.length &&
    CLOSEOUT_STEPS.every((step) =>
      items.some((item) => item.itemKey === step.itemKey && item.status === "complete"),
    );
  const canClose = closeoutItemsComplete &&
    await canMatterOpen(workspaceId, matterId);
  return {
    matterId: matterRow.matter.id,
    matterTitle: matterRow.matter.title,
    matterStatus: matterRow.matter.status,
    items: items.map((item) => ({
      id: item.id,
      itemKey: item.itemKey,
      title: item.title,
      status: item.status,
      completedBy: item.completedByClerkUserId ? "Firm teammate" : null,
      completedAt: item.completedAt,
    })),
    followups: followupRows.map((item) => ({
      id: item.id,
      matterId: matterRow.matter.id,
      matterTitle: matterRow.matter.title,
      clientName: matterRow.clientName,
      dueAt: item.dueAt,
      reason: item.reason,
      status: item.status,
      createdAt: item.createdAt,
    })),
    retentionDays,
    targetRetentionDate,
    legalHold: holds.length > 0,
    canClose,
  };
}

router.get("/matters/:id/closeout", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const params = api.GetMatterCloseoutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const data = await closeoutData(access.workspaceId, params.data.id);
  if (!data) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  await logAuditEvent(access, "matter_closeout_viewed", "matter", data.matterId, data.matterTitle);
  res.json(api.GetMatterCloseoutResponse.parse(data));
});

router.post("/matters/:id/closeout", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = api.InitializeMatterCloseoutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [matter] = await db.select({ id: mattersTable.id, title: mattersTable.title })
    .from(mattersTable)
    .where(and(
      eq(mattersTable.id, params.data.id),
      eq(mattersTable.workspaceId, access.workspaceId),
    )).limit(1);
  if (!matter) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  await db.insert(matterCloseoutItemsTable).values(CLOSEOUT_STEPS.map((step) => ({
    workspaceId: access.workspaceId,
    matterId: matter.id,
    itemKey: step.itemKey,
    title: step.title,
  }))).onConflictDoNothing();
  const data = await closeoutData(access.workspaceId, matter.id);
  if (!data) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  await logAuditEvent(access, "matter_closeout_initialized", "matter", matter.id, matter.title);
  res.status(201).json(api.InitializeMatterCloseoutResponse.parse(data));
});

router.patch("/closeout-items/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = api.UpdateCloseoutItemParams.safeParse(req.params);
  const body = api.UpdateCloseoutItemBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [item] = await db.select({
    item: matterCloseoutItemsTable,
    matterTitle: mattersTable.title,
    matterStatus: mattersTable.status,
  }).from(matterCloseoutItemsTable).innerJoin(mattersTable, and(
    eq(mattersTable.id, matterCloseoutItemsTable.matterId),
    eq(mattersTable.workspaceId, matterCloseoutItemsTable.workspaceId),
  )).where(and(
    eq(matterCloseoutItemsTable.id, params.data.id),
    eq(matterCloseoutItemsTable.workspaceId, access.workspaceId),
  )).limit(1);
  if (!item) {
    res.status(404).json({ error: "Closeout checklist item not found." });
    return;
  }
  if (item.matterStatus === "closed") {
    res.status(409).json({ error: "A closed matter's closeout checklist is read-only." });
    return;
  }
  const [updated] = await db.update(matterCloseoutItemsTable).set({
    status: body.data.status,
    completedByClerkUserId: body.data.status === "complete" ? access.userId : null,
    completedAt: body.data.status === "complete" ? new Date() : null,
  }).where(and(
    eq(matterCloseoutItemsTable.id, item.item.id),
    eq(matterCloseoutItemsTable.workspaceId, access.workspaceId),
  )).returning();
  await logAuditEvent(access, "matter_closeout_item_updated", "matter", item.item.matterId, item.matterTitle, {
    itemKey: item.item.itemKey,
    status: updated.status,
  });
  res.json(api.UpdateCloseoutItemResponse.parse({
    id: updated.id,
    itemKey: updated.itemKey,
    title: updated.title,
    status: updated.status,
    completedBy: updated.completedByClerkUserId ? "Firm teammate" : null,
    completedAt: updated.completedAt,
  }));
});

router.post("/matters/:id/followups", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = api.CreateMatterFollowupParams.safeParse(req.params);
  const body = api.CreateMatterFollowupBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [matter] = await db.select({
    matter: mattersTable,
    clientName: clientsTable.name,
  }).from(mattersTable).innerJoin(clientsTable, and(
    eq(clientsTable.id, mattersTable.clientId),
    eq(clientsTable.workspaceId, mattersTable.workspaceId),
  )).where(and(
    eq(mattersTable.id, params.data.id),
    eq(mattersTable.workspaceId, access.workspaceId),
  )).limit(1);
  if (!matter) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  const dueAt = new Date(body.data.dueAt);
  if (Number.isNaN(dueAt.getTime())) {
    res.status(400).json({ error: "Enter a valid follow-up date." });
    return;
  }
  const [followup] = await db.insert(matterFollowupsTable).values({
    workspaceId: access.workspaceId,
    matterId: matter.matter.id,
    dueAt,
    reason: body.data.reason.trim(),
    createdByClerkUserId: access.userId,
  }).returning();
  await logAuditEvent(access, "matter_reengagement_reminder_created", "matter", matter.matter.id, matter.matter.title, {
    followupId: followup.id,
    dueAt: followup.dueAt.toISOString(),
  });
  res.status(201).json(api.CreateMatterFollowupResponse.parse({
    id: followup.id,
    matterId: matter.matter.id,
    matterTitle: matter.matter.title,
    clientName: matter.clientName,
    dueAt: followup.dueAt,
    reason: followup.reason,
    status: followup.status,
    createdAt: followup.createdAt,
  }));
});

router.patch("/matter-followups/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = api.UpdateMatterFollowupParams.safeParse(req.params);
  const body = api.UpdateMatterFollowupBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.select({
    followup: matterFollowupsTable,
    matterTitle: mattersTable.title,
    clientName: clientsTable.name,
  }).from(matterFollowupsTable).innerJoin(mattersTable, and(
    eq(mattersTable.id, matterFollowupsTable.matterId),
    eq(mattersTable.workspaceId, matterFollowupsTable.workspaceId),
  )).innerJoin(clientsTable, and(
    eq(clientsTable.id, mattersTable.clientId),
    eq(clientsTable.workspaceId, mattersTable.workspaceId),
  )).where(and(
    eq(matterFollowupsTable.id, params.data.id),
    eq(matterFollowupsTable.workspaceId, access.workspaceId),
  )).limit(1);
  if (!row) {
    res.status(404).json({ error: "Re-engagement reminder not found." });
    return;
  }
  const [updated] = await db.update(matterFollowupsTable).set({
    status: body.data.status,
    completedByClerkUserId: body.data.status === "complete" ? access.userId : null,
    completedAt: body.data.status === "complete" ? new Date() : null,
  }).where(and(
    eq(matterFollowupsTable.id, row.followup.id),
    eq(matterFollowupsTable.workspaceId, access.workspaceId),
  )).returning();
  await logAuditEvent(access, "matter_reengagement_reminder_updated", "matter", row.followup.matterId, row.matterTitle, {
    followupId: updated.id,
    status: updated.status,
  });
  res.json(api.UpdateMatterFollowupResponse.parse({
    id: updated.id,
    matterId: row.followup.matterId,
    matterTitle: row.matterTitle,
    clientName: row.clientName,
    dueAt: updated.dueAt,
    reason: updated.reason,
    status: updated.status,
    createdAt: updated.createdAt,
  }));
});

export default router;
