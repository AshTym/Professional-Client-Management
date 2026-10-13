import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  engagementLettersTable,
  matterCloseoutItemsTable,
  practiceSettingsTable,
} from "@workspace/db";

const REQUIRED_CLOSEOUT_KEYS = [
  "final_billing",
  "document_handover",
  "retention_review",
] as const;

export async function engagementSignatureRequired(workspaceId: number) {
  const [settings] = await db
    .select({ required: practiceSettingsTable.requireEngagementSignature })
    .from(practiceSettingsTable)
    .where(eq(practiceSettingsTable.workspaceId, workspaceId))
    .limit(1);
  return settings?.required ?? false;
}

export async function hasCompletedEngagementLetter(
  workspaceId: number,
  matterId: number,
) {
  const [letter] = await db
    .select({ id: engagementLettersTable.id })
    .from(engagementLettersTable)
    .where(
      and(
        eq(engagementLettersTable.workspaceId, workspaceId),
        eq(engagementLettersTable.matterId, matterId),
        eq(engagementLettersTable.status, "completed"),
      ),
    )
    .limit(1);
  return Boolean(letter);
}

export async function canMatterOpen(workspaceId: number, matterId: number) {
  if (!(await engagementSignatureRequired(workspaceId))) return true;
  return hasCompletedEngagementLetter(workspaceId, matterId);
}

export async function closeoutIsReady(workspaceId: number, matterId: number) {
  const items = await db
    .select({
      itemKey: matterCloseoutItemsTable.itemKey,
      status: matterCloseoutItemsTable.status,
    })
    .from(matterCloseoutItemsTable)
    .where(
      and(
        eq(matterCloseoutItemsTable.workspaceId, workspaceId),
        eq(matterCloseoutItemsTable.matterId, matterId),
        inArray(matterCloseoutItemsTable.itemKey, [...REQUIRED_CLOSEOUT_KEYS]),
      ),
    );
  return (
    items.length === REQUIRED_CLOSEOUT_KEYS.length &&
    REQUIRED_CLOSEOUT_KEYS.every((key) =>
      items.some((item) => item.itemKey === key && item.status === "complete"),
    )
  );
}
