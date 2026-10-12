import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import {
  activitiesTable,
  billingDraftsTable,
  billingProfilesTable,
  clientsTable,
  documentSuggestionsTable,
  documentsTable,
  mattersTable,
  plannerItemsTable,
  timeEntriesTable,
  updateDraftsTable,
  updateSchedulesTable,
  db,
} from "@workspace/db";
import {
  draftBillNarrative,
  draftClientUpdate,
  extractDocumentPages,
  extractSourceSuggestions,
  type SourcePage,
} from "./clientguard-ai";

export type BillingCadence = "weekly" | "monthly" | "quarterly";
export type UpdateCadence = "weekly" | "fortnightly" | "monthly";

export function nextCadenceDate(date: Date, cadence: string): Date {
  const next = new Date(date);
  if (cadence === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  if (cadence === "fortnightly") {
    next.setUTCDate(next.getUTCDate() + 14);
    return next;
  }

  const monthOffset = cadence === "quarterly" ? 3 : 1;
  const targetMonth = next.getUTCMonth() + monthOffset;
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(targetMonth);
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

export async function getBillingOverview(workspaceId: number) {
  const [profiles, timeEntries, drafts] = await Promise.all([
    db
      .select({
        profile: billingProfilesTable,
        matterTitle: mattersTable.title,
        clientName: clientsTable.name,
      })
      .from(billingProfilesTable)
      .innerJoin(
        mattersTable,
        and(
          eq(billingProfilesTable.matterId, mattersTable.id),
          eq(billingProfilesTable.workspaceId, mattersTable.workspaceId),
        ),
      )
      .innerJoin(clientsTable, eq(mattersTable.clientId, clientsTable.id))
      .where(eq(billingProfilesTable.workspaceId, workspaceId))
      .orderBy(asc(mattersTable.title)),
    db
      .select({
        entry: timeEntriesTable,
        matterTitle: mattersTable.title,
      })
      .from(timeEntriesTable)
      .innerJoin(
        mattersTable,
        and(
          eq(timeEntriesTable.matterId, mattersTable.id),
          eq(timeEntriesTable.workspaceId, mattersTable.workspaceId),
        ),
      )
      .where(eq(timeEntriesTable.workspaceId, workspaceId))
      .orderBy(desc(timeEntriesTable.workDate), desc(timeEntriesTable.createdAt))
      .limit(200),
    db
      .select({
        draft: billingDraftsTable,
        matterTitle: mattersTable.title,
        clientName: clientsTable.name,
      })
      .from(billingDraftsTable)
      .innerJoin(
        mattersTable,
        and(
          eq(billingDraftsTable.matterId, mattersTable.id),
          eq(billingDraftsTable.workspaceId, mattersTable.workspaceId),
        ),
      )
      .innerJoin(clientsTable, eq(mattersTable.clientId, clientsTable.id))
      .where(eq(billingDraftsTable.workspaceId, workspaceId))
      .orderBy(desc(billingDraftsTable.generatedAt))
      .limit(100),
  ]);

  return {
    profiles: profiles.map(({ profile, matterTitle, clientName }) => ({
      ...profile,
      matterTitle,
      clientName,
    })),
    timeEntries: timeEntries.map(({ entry, matterTitle }) => ({
      ...entry,
      matterTitle,
    })),
    drafts: drafts.map(({ draft, matterTitle, clientName }) => ({
      ...draft,
      matterTitle,
      clientName,
    })),
  };
}

export async function createScheduledBillingDraft(
  profile: typeof billingProfilesTable.$inferSelect,
): Promise<typeof billingDraftsTable.$inferSelect | null> {
  const [existing] = await db
    .select()
    .from(billingDraftsTable)
    .where(
      and(
        eq(billingDraftsTable.workspaceId, profile.workspaceId),
        eq(billingDraftsTable.matterId, profile.matterId),
        eq(billingDraftsTable.periodStartAt, profile.periodStartAt),
        eq(billingDraftsTable.periodEndAt, profile.nextDraftAt),
      ),
    )
    .limit(1);
  if (existing) {
    await advanceBillingProfile(profile);
    return existing;
  }

  const [matter] = await db
    .select({
      id: mattersTable.id,
      title: mattersTable.title,
      status: mattersTable.status,
      clientName: clientsTable.name,
    })
    .from(mattersTable)
    .innerJoin(clientsTable, eq(mattersTable.clientId, clientsTable.id))
    .where(
      and(
        eq(mattersTable.workspaceId, profile.workspaceId),
        eq(mattersTable.id, profile.matterId),
      ),
    )
    .limit(1);
  if (!matter) {
    await advanceBillingProfile(profile);
    return null;
  }
  if (matter.status === "closed") {
    await db
      .update(billingProfilesTable)
      .set({ scheduleEnabled: false })
      .where(eq(billingProfilesTable.id, profile.id));
    return null;
  }

  const periodStartDate = profile.periodStartAt.toISOString().slice(0, 10);
  const periodEndDate = profile.nextDraftAt.toISOString().slice(0, 10);
  const entries =
    profile.feeType === "hourly"
      ? await db
          .select()
          .from(timeEntriesTable)
          .where(
            and(
              eq(timeEntriesTable.workspaceId, profile.workspaceId),
              eq(timeEntriesTable.matterId, profile.matterId),
              eq(timeEntriesTable.billable, true),
              isNull(timeEntriesTable.billingDraftId),
              gte(timeEntriesTable.workDate, periodStartDate),
              lte(timeEntriesTable.workDate, periodEndDate),
            ),
          )
          .orderBy(asc(timeEntriesTable.workDate), asc(timeEntriesTable.createdAt))
      : [];

  const lineItems =
    profile.feeType === "fixed"
      ? [
          {
            description: profile.feeDescription,
            workDate: null,
            durationMinutes: null,
            rateCents: null,
            amountCents: profile.fixedFeeCents ?? 0,
          },
        ]
      : entries.map((entry) => ({
          description: entry.description,
          workDate: entry.workDate,
          durationMinutes: entry.durationMinutes,
          rateCents: profile.hourlyRateCents,
          amountCents: Math.round(
            (entry.durationMinutes * (profile.hourlyRateCents ?? 0)) / 60,
          ),
        }));

  if (lineItems.length === 0) {
    await advanceBillingProfile(profile);
    return null;
  }

  const subtotalCents = lineItems.reduce(
    (total, line) => total + line.amountCents,
    0,
  );
  const taxCents = Math.round((subtotalCents * profile.taxRateBps) / 10_000);
  if (
    !Number.isSafeInteger(subtotalCents + taxCents) ||
    subtotalCents + taxCents > 2_147_483_647
  ) {
    throw new Error(
      "This billing period exceeds the supported total. Split the period or review the logged time and rate.",
    );
  }
  const narrative = await draftBillNarrative({
    matterTitle: matter.title,
    clientName: matter.clientName,
    currency: profile.currency,
    periodStart: profile.periodStartAt,
    periodEnd: profile.nextDraftAt,
    feeDescription: profile.feeDescription,
    lineItems,
  });

  const draft = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(billingDraftsTable)
      .values({
        workspaceId: profile.workspaceId,
        matterId: profile.matterId,
        periodStartAt: profile.periodStartAt,
        periodEndAt: profile.nextDraftAt,
        currency: profile.currency,
        subtotalCents,
        taxCents,
        totalCents: subtotalCents + taxCents,
        narrative,
        lineItems,
        status: "draft",
      })
      .onConflictDoNothing()
      .returning();

    let result = created;
    if (!result) {
      const [found] = await tx
        .select()
        .from(billingDraftsTable)
        .where(
          and(
            eq(billingDraftsTable.workspaceId, profile.workspaceId),
            eq(billingDraftsTable.matterId, profile.matterId),
            eq(billingDraftsTable.periodStartAt, profile.periodStartAt),
            eq(billingDraftsTable.periodEndAt, profile.nextDraftAt),
          ),
        )
        .limit(1);
      if (!found) throw new Error("Unable to create or find the bill draft.");
      result = found;
    }

    if (created && entries.length > 0) {
      await tx
        .update(timeEntriesTable)
        .set({ billingDraftId: created.id })
        .where(
          and(
            eq(timeEntriesTable.workspaceId, profile.workspaceId),
            eq(timeEntriesTable.matterId, profile.matterId),
            inArray(
              timeEntriesTable.id,
              entries.map((entry) => entry.id),
            ),
            isNull(timeEntriesTable.billingDraftId),
          ),
        );
    }
    await tx
      .update(billingProfilesTable)
      .set({
        periodStartAt: profile.nextDraftAt,
        nextDraftAt: nextCadenceDate(profile.nextDraftAt, profile.billingCycle),
      })
      .where(
        and(
          eq(billingProfilesTable.id, profile.id),
          eq(billingProfilesTable.nextDraftAt, profile.nextDraftAt),
        ),
      );
    return result;
  });
  return draft;
}

async function advanceBillingProfile(
  profile: typeof billingProfilesTable.$inferSelect,
) {
  await db
    .update(billingProfilesTable)
    .set({
      periodStartAt: profile.nextDraftAt,
      nextDraftAt: nextCadenceDate(profile.nextDraftAt, profile.billingCycle),
    })
    .where(
      and(
        eq(billingProfilesTable.id, profile.id),
        eq(billingProfilesTable.nextDraftAt, profile.nextDraftAt),
      ),
    );
}

export async function getDocumentOverview(workspaceId: number) {
  const [documents, suggestions, plannerItems] = await Promise.all([
    db
      .select({
        document: documentsTable,
        matterTitle: mattersTable.title,
      })
      .from(documentsTable)
      .innerJoin(
        mattersTable,
        and(
          eq(documentsTable.matterId, mattersTable.id),
          eq(documentsTable.workspaceId, mattersTable.workspaceId),
        ),
      )
      .where(eq(documentsTable.workspaceId, workspaceId))
      .orderBy(desc(documentsTable.createdAt))
      .limit(100),
    db
      .select({
        suggestion: documentSuggestionsTable,
        documentName: documentsTable.originalName,
        matterTitle: mattersTable.title,
      })
      .from(documentSuggestionsTable)
      .innerJoin(
        documentsTable,
        eq(documentSuggestionsTable.documentId, documentsTable.id),
      )
      .innerJoin(mattersTable, eq(documentSuggestionsTable.matterId, mattersTable.id))
      .where(eq(documentSuggestionsTable.workspaceId, workspaceId))
      .orderBy(desc(documentSuggestionsTable.createdAt))
      .limit(200),
    db
      .select({
        item: plannerItemsTable,
        documentName: documentsTable.originalName,
        matterTitle: mattersTable.title,
      })
      .from(plannerItemsTable)
      .innerJoin(documentsTable, eq(plannerItemsTable.documentId, documentsTable.id))
      .innerJoin(mattersTable, eq(plannerItemsTable.matterId, mattersTable.id))
      .where(eq(plannerItemsTable.workspaceId, workspaceId))
      .orderBy(asc(plannerItemsTable.dueAt), desc(plannerItemsTable.createdAt))
      .limit(300),
  ]);

  return {
    documents: documents.map(({ document, matterTitle }) => ({
      ...document,
      matterTitle,
    })),
    suggestions: suggestions.map(
      ({ suggestion, documentName, matterTitle }) => ({
        ...suggestion,
        documentName,
        matterTitle,
      }),
    ),
    plannerItems: plannerItems.map(({ item, documentName, matterTitle }) => ({
      ...item,
      documentName,
      matterTitle,
    })),
  };
}

export async function analyzeDocument(
  document: typeof documentsTable.$inferSelect,
  bytes: Buffer,
) {
  const pages: SourcePage[] = await extractDocumentPages(bytes, document.contentType);
  const extracted = await extractSourceSuggestions(pages);
  const [pageCount] = [pages.length];
  const inserted = await db.transaction(async (tx) => {
    await tx
      .delete(documentSuggestionsTable)
      .where(
        and(
          eq(documentSuggestionsTable.workspaceId, document.workspaceId),
          eq(documentSuggestionsTable.documentId, document.id),
          eq(documentSuggestionsTable.status, "pending"),
        ),
      );
    const rows =
      extracted.length > 0
        ? await tx
            .insert(documentSuggestionsTable)
            .values(
              extracted.map((item) => ({
                workspaceId: document.workspaceId,
                documentId: document.id,
                matterId: document.matterId,
                kind: item.kind,
                title: item.title,
                details: item.details,
                dueAt: item.dueAt,
                sourcePage: item.sourcePage,
                sourceQuote: item.sourceQuote,
                confidence: item.confidence,
                status: "pending",
              })),
            )
            .returning()
        : [];
    await tx
      .update(documentsTable)
      .set({ status: "analyzed", lastAnalysisError: null })
      .where(eq(documentsTable.id, document.id));
    return rows;
  });
  return { suggestions: inserted, sourcePageCount: pageCount };
}

export async function getClientUpdateOverview(workspaceId: number) {
  const [schedules, drafts] = await Promise.all([
    db
      .select({
        schedule: updateSchedulesTable,
        matterTitle: mattersTable.title,
        clientName: clientsTable.name,
      })
      .from(updateSchedulesTable)
      .innerJoin(
        mattersTable,
        and(
          eq(updateSchedulesTable.matterId, mattersTable.id),
          eq(updateSchedulesTable.workspaceId, mattersTable.workspaceId),
        ),
      )
      .innerJoin(clientsTable, eq(mattersTable.clientId, clientsTable.id))
      .where(eq(updateSchedulesTable.workspaceId, workspaceId))
      .orderBy(asc(mattersTable.title)),
    db
      .select({
        draft: updateDraftsTable,
        matterTitle: mattersTable.title,
        clientName: clientsTable.name,
      })
      .from(updateDraftsTable)
      .innerJoin(
        mattersTable,
        and(
          eq(updateDraftsTable.matterId, mattersTable.id),
          eq(updateDraftsTable.workspaceId, mattersTable.workspaceId),
        ),
      )
      .innerJoin(clientsTable, eq(mattersTable.clientId, clientsTable.id))
      .where(eq(updateDraftsTable.workspaceId, workspaceId))
      .orderBy(desc(updateDraftsTable.generatedAt))
      .limit(100),
  ]);
  return {
    schedules: schedules.map(({ schedule, matterTitle, clientName }) => ({
      ...schedule,
      matterId: schedule.matterId,
      matterTitle,
      clientName,
    })),
    drafts: drafts.map(({ draft, matterTitle, clientName }) => ({
      ...draft,
      matterTitle,
      clientName,
    })),
  };
}

export async function createClientUpdateDraft(
  workspaceId: number,
  matterId: number,
  generatedBy: "user" | "schedule",
) {
  const [matter] = await db
    .select({
      id: mattersTable.id,
      title: mattersTable.title,
      clientId: mattersTable.clientId,
      clientName: clientsTable.name,
      status: mattersTable.status,
    })
    .from(mattersTable)
    .innerJoin(clientsTable, eq(mattersTable.clientId, clientsTable.id))
    .where(
      and(
        eq(mattersTable.workspaceId, workspaceId),
        eq(mattersTable.id, matterId),
      ),
    )
    .limit(1);
  if (!matter || matter.status === "closed") return null;

  const recentCutoff = new Date();
  recentCutoff.setUTCDate(recentCutoff.getUTCDate() - 90);
  const activities = await db
    .select()
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.workspaceId, workspaceId),
        gte(activitiesTable.occurredAt, recentCutoff),
        or(
          and(
            eq(activitiesTable.entityType, "matter"),
            eq(activitiesTable.entityId, matterId),
          ),
          and(
            eq(activitiesTable.entityType, "client"),
            eq(activitiesTable.entityId, matter.clientId),
          ),
        ),
      ),
    )
    .orderBy(desc(activitiesTable.occurredAt))
    .limit(25);
  if (activities.length === 0) return null;

  const generated = await draftClientUpdate({
    clientName: matter.clientName,
    matterTitle: matter.title,
    activities: activities.map((activity) => ({
      date: activity.occurredAt.toISOString(),
      actor: activity.actor,
      action: activity.action,
      label: activity.entityLabel,
    })),
  });
  const [draft] = await db
    .insert(updateDraftsTable)
    .values({
      workspaceId,
      matterId,
      sourceActivityIds: activities.map((activity) => activity.id),
      subject: generated.subject,
      body: generated.body,
      status: "draft",
      generatedBy,
    })
    .returning();
  return { ...draft, matterTitle: matter.title, clientName: matter.clientName };
}

export async function advanceUpdateSchedule(
  schedule: typeof updateSchedulesTable.$inferSelect,
) {
  if (!schedule.nextDraftAt) return;
  await db
    .update(updateSchedulesTable)
    .set({
      nextDraftAt: nextCadenceDate(schedule.nextDraftAt, schedule.cadence),
    })
    .where(
      and(
        eq(updateSchedulesTable.id, schedule.id),
        eq(updateSchedulesTable.nextDraftAt, schedule.nextDraftAt),
      ),
    );
}

export async function deletePendingSuggestionsForDocument(
  workspaceId: number,
  documentId: number,
) {
  await db
    .delete(documentSuggestionsTable)
    .where(
      and(
        eq(documentSuggestionsTable.workspaceId, workspaceId),
        eq(documentSuggestionsTable.documentId, documentId),
        eq(documentSuggestionsTable.status, "pending"),
      ),
    );
}
