import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import * as api from "@workspace/api-zod";
import { practiceSettingsTable } from "@workspace/db";
import { db } from "@workspace/db";
import { firmAccess, logAuditEvent } from "../lib/clientguard-auth";

const router: IRouter = Router();
const DEFAULT_JURISDICTIONS = ["Australia", "USA", "Great Britain"];

function isAdmin(role: string) {
  return role === "owner" || role === "admin";
}

router.get("/practice/settings", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const [settings] = await db.select().from(practiceSettingsTable)
    .where(eq(practiceSettingsTable.workspaceId, access.workspaceId))
    .limit(1);
  res.json(api.GetPracticeSettingsResponse.parse({
    requireEngagementSignature: settings?.requireEngagementSignature ?? false,
    supportedJurisdictions: settings?.supportedJurisdictions.length
      ? settings.supportedJurisdictions
      : DEFAULT_JURISDICTIONS,
    updatedAt: settings?.updatedAt ?? null,
  }));
});

router.put("/practice/settings", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  if (!isAdmin(access.role)) {
    res.status(403).json({ error: "Only a firm owner or admin can change practice settings." });
    return;
  }
  const parsed = api.UpdatePracticeSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (new Set(parsed.data.supportedJurisdictions).size !== parsed.data.supportedJurisdictions.length) {
    res.status(400).json({ error: "Each supported jurisdiction can be selected only once." });
    return;
  }
  const [settings] = await db.insert(practiceSettingsTable).values({
    workspaceId: access.workspaceId,
    requireEngagementSignature: parsed.data.requireEngagementSignature,
    supportedJurisdictions: parsed.data.supportedJurisdictions,
    updatedByClerkUserId: access.userId,
  }).onConflictDoUpdate({
    target: practiceSettingsTable.workspaceId,
    set: {
      requireEngagementSignature: parsed.data.requireEngagementSignature,
      supportedJurisdictions: parsed.data.supportedJurisdictions,
      updatedByClerkUserId: access.userId,
      updatedAt: new Date(),
    },
  }).returning();
  await logAuditEvent(access, "practice_settings_updated", "practice_settings", settings.id, "Practice settings", {
    requireEngagementSignature: settings.requireEngagementSignature,
    supportedJurisdictions: settings.supportedJurisdictions.join(","),
  });
  res.json(api.UpdatePracticeSettingsResponse.parse({
    requireEngagementSignature: settings.requireEngagementSignature,
    supportedJurisdictions: settings.supportedJurisdictions,
    updatedAt: settings.updatedAt,
  }));
});

export default router;
