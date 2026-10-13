import {
  boolean,
  bigint,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspacesTable, mattersTable, membershipsTable } from "./clientguard";
import { documentsTable } from "./clientguard-workflows";

export const practiceSettingsTable = pgTable(
  "clientguard_practice_settings",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    requireEngagementSignature: boolean("require_engagement_signature")
      .notNull()
      .default(false),
    supportedJurisdictions: text("supported_jurisdictions")
      .array()
      .notNull()
      .default([]),
    updatedByClerkUserId: text("updated_by_clerk_user_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("clientguard_practice_settings_workspace_unique").on(
      table.workspaceId,
    ),
  ],
);

export const engagementLettersTable = pgTable(
  "clientguard_engagement_letters",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    clientName: text("client_name").notNull(),
    clientEmail: text("client_email").notNull(),
    matterTitle: text("matter_title").notNull(),
    scope: text("scope").notNull(),
    billingTerms: text("billing_terms").notNull(),
    status: text("status").notNull().default("draft"),
    provider: text("provider").notNull().default("docusign"),
    envelopeId: text("envelope_id"),
    draftDocumentId: integer("draft_document_id").references(
      () => documentsTable.id,
      { onDelete: "set null" },
    ),
    signedDocumentId: integer("signed_document_id").references(
      () => documentsTable.id,
      { onDelete: "set null" },
    ),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("clientguard_engagement_workspace_matter_idx").on(
      table.workspaceId,
      table.matterId,
      table.createdAt,
    ),
    uniqueIndex("clientguard_engagement_revision_unique").on(
      table.workspaceId,
      table.matterId,
      table.revision,
    ),
  ],
);

export const trustAccountsTable = pgTable(
  "clientguard_trust_accounts",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    currency: text("currency").notNull(),
    accountReference: text("account_reference"),
    requireSecondApproval: boolean("require_second_approval")
      .notNull()
      .default(true),
    active: boolean("active").notNull().default(true),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clientguard_trust_accounts_workspace_idx").on(
      table.workspaceId,
      table.active,
    ),
  ],
);

export const trustLedgerEntriesTable = pgTable(
  "clientguard_trust_ledger_entries",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    accountId: integer("account_id")
      .notNull()
      .references(() => trustAccountsTable.id, { onDelete: "restrict" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "restrict" }),
    entryType: text("entry_type").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    reference: text("reference"),
    status: text("status").notNull().default("pending_approval"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    approvedByClerkUserId: text("approved_by_clerk_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clientguard_trust_entry_account_date_idx").on(
      table.workspaceId,
      table.accountId,
      table.entryDate,
    ),
    index("clientguard_trust_entry_matter_idx").on(
      table.workspaceId,
      table.matterId,
    ),
    index("clientguard_trust_entry_status_idx").on(
      table.workspaceId,
      table.status,
    ),
  ],
);

export const trustStatementsTable = pgTable(
  "clientguard_trust_statements",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    accountId: integer("account_id")
      .notNull()
      .references(() => trustAccountsTable.id, { onDelete: "restrict" }),
    sourceType: text("source_type").notNull(),
    sourceName: text("source_name").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    openingBalanceCents: bigint("opening_balance_cents", { mode: "number" }).notNull(),
    closingBalanceCents: bigint("closing_balance_cents", { mode: "number" }).notNull(),
    status: text("status").notNull().default("open"),
    importedByClerkUserId: text("imported_by_clerk_user_id").notNull(),
    reconciledByClerkUserId: text("reconciled_by_clerk_user_id"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clientguard_trust_statement_workspace_idx").on(
      table.workspaceId,
      table.accountId,
      table.periodEnd,
    ),
  ],
);

export const trustStatementLinesTable = pgTable(
  "clientguard_trust_statement_lines",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    statementId: integer("statement_id")
      .notNull()
      .references(() => trustStatementsTable.id, { onDelete: "cascade" }),
    lineDate: date("line_date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    reference: text("reference"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    matchedEntryId: integer("matched_entry_id").references(
      () => trustLedgerEntriesTable.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("unmatched"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clientguard_trust_statement_line_statement_idx").on(
      table.workspaceId,
      table.statementId,
    ),
    uniqueIndex("clientguard_trust_statement_line_entry_unique").on(
      table.matchedEntryId,
    ),
  ],
);

export const matterCloseoutItemsTable = pgTable(
  "clientguard_matter_closeout_items",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("open"),
    completedByClerkUserId: text("completed_by_clerk_user_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("clientguard_closeout_item_unique").on(
      table.workspaceId,
      table.matterId,
      table.itemKey,
    ),
    index("clientguard_closeout_items_matter_idx").on(
      table.workspaceId,
      table.matterId,
    ),
  ],
);

export const matterFollowupsTable = pgTable(
  "clientguard_matter_followups",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    completedByClerkUserId: text("completed_by_clerk_user_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clientguard_matter_followups_workspace_due_idx").on(
      table.workspaceId,
      table.status,
      table.dueAt,
    ),
  ],
);

export const teamCapacitiesTable = pgTable(
  "clientguard_team_capacities",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    membershipId: integer("membership_id")
      .notNull()
      .references(() => membershipsTable.id, { onDelete: "cascade" }),
    weeklyCapacityMinutes: integer("weekly_capacity_minutes").notNull(),
    activeMatterLimit: integer("active_matter_limit").notNull(),
    updatedByClerkUserId: text("updated_by_clerk_user_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("clientguard_team_capacity_member_unique").on(
      table.workspaceId,
      table.membershipId,
    ),
  ],
);

export type PracticeSettings = typeof practiceSettingsTable.$inferSelect;
export type EngagementLetter = typeof engagementLettersTable.$inferSelect;
export type TrustAccount = typeof trustAccountsTable.$inferSelect;
export type TrustLedgerEntry = typeof trustLedgerEntriesTable.$inferSelect;
export type TrustStatement = typeof trustStatementsTable.$inferSelect;
export type TrustStatementLine = typeof trustStatementLinesTable.$inferSelect;
export type MatterCloseoutItem = typeof matterCloseoutItemsTable.$inferSelect;
export type MatterFollowup = typeof matterFollowupsTable.$inferSelect;
export type TeamCapacity = typeof teamCapacitiesTable.$inferSelect;
