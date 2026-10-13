import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { clientsTable, mattersTable, workspacesTable } from "./clientguard";
import { updateDraftsTable } from "./clientguard-workflows";
import { z } from "zod/v4";

export type IntakeRule = {
  key: string;
  label: string;
  description: string;
  required: boolean;
  category: string;
};

export type IntakeConflict = {
  name: string;
  recordType: "client" | "matter";
  recordId: number;
  recordLabel: string;
};

export const intakeSettingsTable = pgTable(
  "clientguard_intake_settings",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    checks: jsonb("checks").$type<IntakeRule[]>().notNull().default([]),
    updatedByClerkUserId: text("updated_by_clerk_user_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("clientguard_intake_settings_workspace_unique").on(
      table.workspaceId,
    ),
  ],
);

export const intakesTable = pgTable(
  "clientguard_intakes",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id").references(() => clientsTable.id, {
      onDelete: "set null",
    }),
    clientName: text("client_name").notNull(),
    clientType: text("client_type").notNull().default("individual"),
    email: text("email"),
    phone: text("phone"),
    industry: text("industry"),
    matterTitle: text("matter_title").notNull(),
    matterType: text("matter_type").notNull(),
    responsible: text("responsible").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    partyNames: jsonb("party_names").$type<string[]>().notNull().default([]),
    answers: jsonb("answers")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    conflictFindings: jsonb("conflict_findings")
      .$type<IntakeConflict[]>()
      .notNull()
      .default([]),
    status: text("status").notNull().default("review_required"),
    reviewNote: text("review_note"),
    reviewerClerkUserId: text("reviewer_clerk_user_id"),
    openedMatterId: integer("opened_matter_id").references(() => mattersTable.id, {
      onDelete: "set null",
    }),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("clientguard_intakes_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    index("clientguard_intakes_client_idx").on(table.workspaceId, table.clientId),
  ],
);

export const portalAccessTable = pgTable(
  "clientguard_portal_access",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    clerkUserId: text("clerk_user_id"),
    clerkInvitationId: text("clerk_invitation_id"),
    status: text("status").notNull().default("invited"),
    invitedByClerkUserId: text("invited_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("clientguard_portal_access_client_email_unique").on(
      table.workspaceId,
      table.clientId,
      table.email,
    ),
    index("clientguard_portal_access_user_idx").on(
      table.clerkUserId,
      table.status,
    ),
  ],
);

export const portalMessagesTable = pgTable(
  "clientguard_portal_messages",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    senderClerkUserId: text("sender_clerk_user_id").notNull(),
    senderType: text("sender_type").notNull(),
    senderName: text("sender_name").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clientguard_portal_messages_matter_idx").on(
      table.workspaceId,
      table.matterId,
      table.createdAt,
    ),
    index("clientguard_portal_messages_client_idx").on(
      table.workspaceId,
      table.clientId,
      table.createdAt,
    ),
  ],
);

export const portalRequestsTable = pgTable(
  "clientguard_portal_requests",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    details: text("details").notNull(),
    status: text("status").notNull().default("open"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    respondedByClerkUserId: text("responded_by_clerk_user_id"),
    responseMessageId: integer("response_message_id").references(() => portalMessagesTable.id, {
      onDelete: "set null",
    }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByClerkUserId: text("closed_by_clerk_user_id"),
  },
  (table) => [
    index("clientguard_portal_requests_client_idx").on(
      table.workspaceId,
      table.clientId,
      table.status,
      table.createdAt,
    ),
    index("clientguard_portal_requests_matter_idx").on(
      table.workspaceId,
      table.matterId,
      table.status,
    ),
  ],
);

export const portalUpdatesTable = pgTable(
  "clientguard_portal_updates",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    matterId: integer("matter_id")
      .notNull()
      .references(() => mattersTable.id, { onDelete: "cascade" }),
    updateDraftId: integer("update_draft_id")
      .notNull()
      .references(() => updateDraftsTable.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    publishedByClerkUserId: text("published_by_clerk_user_id").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("clientguard_portal_update_draft_unique").on(
      table.updateDraftId,
    ),
    index("clientguard_portal_updates_client_idx").on(
      table.workspaceId,
      table.clientId,
      table.publishedAt,
    ),
  ],
);

export const auditEventsTable = pgTable(
  "clientguard_audit_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    entityLabel: text("entity_label").notNull(),
    details: jsonb("details").$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clientguard_audit_workspace_time_idx").on(
      table.workspaceId,
      table.occurredAt,
      table.id,
    ),
    index("clientguard_audit_entity_idx").on(
      table.workspaceId,
      table.entityType,
      table.entityId,
    ),
  ],
);

export const retentionSettingsTable = pgTable(
  "clientguard_retention_settings",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    matterRetentionDays: integer("matter_retention_days").notNull().default(2555),
    auditRetentionDays: integer("audit_retention_days").notNull().default(2555),
    updatedByClerkUserId: text("updated_by_clerk_user_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("clientguard_retention_workspace_unique").on(table.workspaceId),
  ],
);

export const legalHoldsTable = pgTable(
  "clientguard_legal_holds",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    reason: text("reason").notNull(),
    placedByClerkUserId: text("placed_by_clerk_user_id").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    releasedByClerkUserId: text("released_by_clerk_user_id"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => [
    index("clientguard_legal_holds_entity_idx").on(
      table.workspaceId,
      table.entityType,
      table.entityId,
      table.releasedAt,
    ),
  ],
);

export const providerConnectionsTable = pgTable(
  "clientguard_provider_connections",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    accountLabel: text("account_label").notNull().default("Connected account"),
    remoteAccountId: text("remote_account_id"),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes").array().notNull().default([]),
    connectedByClerkUserId: text("connected_by_clerk_user_id").notNull(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("clientguard_provider_workspace_unique").on(
      table.workspaceId,
      table.provider,
    ),
    index("clientguard_provider_workspace_idx").on(
      table.workspaceId,
      table.provider,
    ),
  ],
);

export const providerSyncsTable = pgTable(
  "clientguard_provider_syncs",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    externalId: text("external_id").notNull(),
    syncedByClerkUserId: text("synced_by_clerk_user_id").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("clientguard_provider_sync_entity_unique").on(
      table.workspaceId,
      table.provider,
      table.entityType,
      table.entityId,
    ),
    index("clientguard_provider_sync_workspace_idx").on(
      table.workspaceId,
      table.syncedAt,
    ),
  ],
);

export const oauthStatesTable = pgTable(
  "clientguard_oauth_states",
  {
    id: serial("id").primaryKey(),
    stateHash: text("state_hash").notNull(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    redirectPath: text("redirect_path").notNull().default("/settings/integrations"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("clientguard_oauth_state_hash_unique").on(table.stateHash),
    index("clientguard_oauth_state_expiry_idx").on(table.expiresAt),
  ],
);

export const insertIntakeSchema = createInsertSchema(intakesTable).omit({
  id: true,
  conflictFindings: true,
  status: true,
  reviewNote: true,
  reviewerClerkUserId: true,
  openedMatterId: true,
  createdAt: true,
  updatedAt: true,
});
export const insertPortalMessageSchema = createInsertSchema(
  portalMessagesTable,
).omit({ id: true, createdAt: true });
export const insertPortalRequestSchema = createInsertSchema(
  portalRequestsTable,
).omit({ id: true, createdAt: true, respondedAt: true, responseMessageId: true, closedAt: true });
export const insertAuditEventSchema = createInsertSchema(auditEventsTable).omit({
  id: true,
  occurredAt: true,
});

export type IntakeCase = typeof intakesTable.$inferSelect;
export type PortalAccess = typeof portalAccessTable.$inferSelect;
export type PortalMessage = typeof portalMessagesTable.$inferSelect;
export type PortalRequest = typeof portalRequestsTable.$inferSelect;
export type PortalUpdate = typeof portalUpdatesTable.$inferSelect;
export type AuditEvent = typeof auditEventsTable.$inferSelect;
export type LegalHold = typeof legalHoldsTable.$inferSelect;
export type ProviderConnection = typeof providerConnectionsTable.$inferSelect;
export type InsertIntake = z.infer<typeof insertIntakeSchema>;
export type InsertPortalMessage = z.infer<typeof insertPortalMessageSchema>;
export type InsertPortalRequest = z.infer<typeof insertPortalRequestSchema>;
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
