import { and, asc, eq, lte } from "drizzle-orm";
import { db, billingProfilesTable, updateSchedulesTable } from "@workspace/db";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { logger } from "./logger";
import {
  advanceUpdateSchedule,
  createClientUpdateDraft,
  createScheduledBillingDraft,
} from "./clientguard-workflows-service";

let running = false;

export function startClientGuardWorkflowScheduler(): NodeJS.Timeout {
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const dueBilling = await db
        .select()
        .from(billingProfilesTable)
        .where(
          and(
            eq(billingProfilesTable.scheduleEnabled, true),
            lte(billingProfilesTable.nextDraftAt, now),
          ),
        )
        .orderBy(asc(billingProfilesTable.nextDraftAt))
        .limit(50);
      if (dueBilling.length > 0) {
        await batchProcess(
          dueBilling,
          (profile) => createScheduledBillingDraft(profile),
          { concurrency: 2, retries: 3 },
        );
      }

      const dueUpdates = await db
        .select()
        .from(updateSchedulesTable)
        .where(
          and(
            eq(updateSchedulesTable.enabled, true),
            lte(updateSchedulesTable.nextDraftAt, now),
          ),
        )
        .orderBy(asc(updateSchedulesTable.nextDraftAt))
        .limit(50);
      if (dueUpdates.length > 0) {
        await batchProcess(
          dueUpdates,
          async (schedule) => {
            await createClientUpdateDraft(
              schedule.workspaceId,
              schedule.matterId,
              "schedule",
            );
            await advanceUpdateSchedule(schedule);
          },
          { concurrency: 2, retries: 3 },
        );
      }
    } catch (error) {
      logger.error({ err: error }, "Scheduled ClientGuard drafts failed");
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), 60_000);
  timer.unref();
  return timer;
}
