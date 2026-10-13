import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mattersTable, workspacesTable } from "./clientguard";

export const billingProfilesTable = pgTable(
  "clientguard_billing_profiles",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    feeType: text("fee_type").notNull().default("hourly"),
    currency: text("currency").notNull().default("AUD"),
    hourlyRateCents: integer("hourly_rate_cents"),
    fixedFeeCents: integer("fixed_fee_cents"),
    feeDescription: text("fee_description").notNull().default("Professional services"),
    billingCycle: text("billing_cycle").notNull().default("monthly"),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    scheduleEnabled: boolean("schedule_enabled").notNull().default(false),
    periodStartAt: timestamp("period_start_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    nextDraftAt: timestamp("next_draft_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("clientguard_billing_profile_matter_unique").on(
      table.workspaceId,
      table.matterId,
    ),
    index("clientguard_billing_profile_due_idx").on(
      table.scheduleEnabled,
      table.nextDraftAt,
    ),
  ],
);

export const billingDraftsTable = pgTable(
  "clientguard_billing_drafts",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    periodStartAt: timestamp("period_start_at", { withTimezone: true }).notNull(),
    periodEndAt: timestamp("period_end_at", { withTimezone: true }).notNull(),
    currency: text("currency").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    narrative: text("narrative").notNull(),
    lineItems: jsonb("line_items").$type<
      Array<{
        description: string;
        workDate: string | null;
        durationMinutes: number | null;
        rateCents: number | null;
        amountCents: number;
      }>
    >().notNull(),
    status: text("status").notNull().default("draft"),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("clientguard_billing_draft_period_unique").on(
      table.workspaceId,
      table.matterId,
      table.periodStartAt,
      table.periodEndAt,
    ),
    index("clientguard_billing_drafts_workspace_idx").on(
      table.workspaceId,
      table.generatedAt,
    ),
  ],
);

export const timeEntriesTable = pgTable(
  "clientguard_time_entries",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    description: text("description").notNull(),
    workDate: date("work_date", { mode: "string" }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    billable: boolean("billable").notNull().default(true),
    billingDraftId: integer("billing_draft_id").references(
      () => billingDraftsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clientguard_time_entries_matter_date_idx").on(
      table.workspaceId,
      table.matterId,
      table.workDate,
    ),
    index("clientguard_time_entries_draft_idx").on(table.billingDraftId),
  ],
);

export const documentsTable = pgTable(
  "clientguard_documents",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    uploadedByClerkUserId: text("uploaded_by_clerk_user_id").notNull(),
    objectPath: text("object_path").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: text("status").notNull().default("uploading"),
    clientVisible: boolean("client_visible").notNull().default(false),
    uploadedFromPortal: boolean("uploaded_from_portal").notNull().default(false),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    lastAnalysisError: text("last_analysis_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clientguard_documents_workspace_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("clientguard_documents_matter_idx").on(
      table.workspaceId,
      table.matterId,
    ),
  ],
);

export const documentSuggestionsTable = pgTable(
  "clientguard_document_suggestions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    details: text("details").notNull().default(""),
    dueAt: timestamp("due_at", { withTimezone: true }),
    sourcePage: integer("source_page").notNull(),
    sourceQuote: text("source_quote").notNull(),
    confidence: real("confidence").notNull().default(0),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clientguard_document_suggestions_workspace_idx").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    index("clientguard_document_suggestions_document_idx").on(
      table.documentId,
    ),
  ],
);

export const plannerItemsTable = pgTable(
  "clientguard_planner_items",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    details: text("details").notNull().default(""),
    dueAt: timestamp("due_at", { withTimezone: true }),
    sourcePage: integer("source_page").notNull(),
    sourceQuote: text("source_quote").notNull(),
    status: text("status").notNull().default("open"),
    confirmedByClerkUserId: text("confirmed_by_clerk_user_id").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clientguard_planner_items_workspace_due_idx").on(
      table.workspaceId,
      table.dueAt,
    ),
    index("clientguard_planner_items_matter_idx").on(
      table.workspaceId,
      table.matterId,
    ),
  ],
);

export const updateSchedulesTable = pgTable(
  "clientguard_update_schedules",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    cadence: text("cadence").notNull().default("weekly"),
    nextDraftAt: timestamp("next_draft_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("clientguard_update_schedule_matter_unique").on(
      table.workspaceId,
      table.matterId,
    ),
    index("clientguard_update_schedule_due_idx").on(
      table.enabled,
      table.nextDraftAt,
    ),
  ],
);

export const updateDraftsTable = pgTable(
  "clientguard_update_drafts",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    sourceActivityIds: integer("source_activity_ids").array().notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("draft"),
    generatedBy: text("generated_by").notNull().default("user"),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    index("clientguard_update_drafts_workspace_idx").on(
      table.workspaceId,
      table.generatedAt,
    ),
    index("clientguard_update_drafts_matter_idx").on(
      table.workspaceId,
      table.matterId,
    ),
  ],
);

export const insertBillingProfileSchema = createInsertSchema(
  billingProfilesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBillingDraftSchema = createInsertSchema(
  billingDraftsTable,
).omit({ id: true, generatedAt: true, reviewedAt: true });
export const insertTimeEntrySchema = createInsertSchema(timeEntriesTable).omit({
  id: true,
  billingDraftId: true,
  createdAt: true,
});
export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  createdAt: true,
});
export const insertDocumentSuggestionSchema = createInsertSchema(
  documentSuggestionsTable,
).omit({ id: true, createdAt: true });
export const insertPlannerItemSchema = createInsertSchema(plannerItemsTable).omit({
  id: true,
  confirmedAt: true,
  createdAt: true,
});
export const insertUpdateScheduleSchema = createInsertSchema(
  updateSchedulesTable,
).omit({ id: true, updatedAt: true });
export const insertUpdateDraftSchema = createInsertSchema(updateDraftsTable).omit({
  id: true,
  generatedAt: true,
  reviewedAt: true,
});

export type BillingProfile = typeof billingProfilesTable.$inferSelect;
export type BillingDraft = typeof billingDraftsTable.$inferSelect;
export type TimeEntry = typeof timeEntriesTable.$inferSelect;
export type ClientDocument = typeof documentsTable.$inferSelect;
export type DocumentSuggestion = typeof documentSuggestionsTable.$inferSelect;
export type PlannerItem = typeof plannerItemsTable.$inferSelect;
export type UpdateSchedule = typeof updateSchedulesTable.$inferSelect;
export type ClientUpdateDraft = typeof updateDraftsTable.$inferSelect;
export type InsertBillingProfile = z.infer<typeof insertBillingProfileSchema>;
export type InsertBillingDraft = z.infer<typeof insertBillingDraftSchema>;
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type InsertDocumentSuggestion = z.infer<
  typeof insertDocumentSuggestionSchema
>;
export type InsertPlannerItem = z.infer<typeof insertPlannerItemSchema>;
export type InsertUpdateSchedule = z.infer<typeof insertUpdateScheduleSchema>;
export type InsertUpdateDraft = z.infer<typeof insertUpdateDraftSchema>;
