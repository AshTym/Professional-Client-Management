import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workspacesTable = pgTable("clientguard_workspaces", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  practiceType: text("practice_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const membershipsTable = pgTable(
  "clientguard_memberships",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull().default(""),
    displayName: text("display_name").notNull().default("User"),
    role: text("role").notNull().default("professional"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("clientguard_membership_workspace_user").on(
      table.workspaceId,
      table.clerkUserId,
    ),
    index("clientguard_membership_user_idx").on(table.clerkUserId),
  ],
);

export const clientsTable = pgTable(
  "clientguard_clients",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    clientType: text("client_type").notNull().default("individual"),
    email: text("email"),
    phone: text("phone"),
    industry: text("industry"),
    status: text("status").notNull().default("prospect"),
    owner: text("owner").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("clientguard_clients_workspace_idx").on(table.workspaceId),
    uniqueIndex("clientguard_clients_workspace_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    index("clientguard_clients_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
  ],
);

export const mattersTable = pgTable(
  "clientguard_matters",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    reference: text("reference").notNull(),
    matterType: text("matter_type").notNull(),
    status: text("status").notNull().default("open"),
    riskLevel: text("risk_level").notNull().default("medium"),
    responsible: text("responsible").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("clientguard_matter_reference_unique").on(
      table.workspaceId,
      table.reference,
    ),
    index("clientguard_matters_workspace_idx").on(table.workspaceId),
    index("clientguard_matters_client_idx").on(table.clientId),
  ],
);

export const activitiesTable = pgTable(
  "clientguard_activities",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    entityLabel: text("entity_label").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("clientguard_activity_workspace_time_idx").on(
      table.workspaceId,
      table.occurredAt,
    ),
  ],
);

export const insertWorkspaceSchema = createInsertSchema(workspacesTable).omit({
  id: true,
  createdAt: true,
});
export const insertMembershipSchema = createInsertSchema(
  membershipsTable,
).omit({ id: true, createdAt: true });
export const insertClientSchema = createInsertSchema(clientsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertMatterSchema = createInsertSchema(mattersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertActivitySchema = createInsertSchema(activitiesTable).omit({
  id: true,
  occurredAt: true,
});

export type Workspace = typeof workspacesTable.$inferSelect;
export type Membership = typeof membershipsTable.$inferSelect;
export type Client = typeof clientsTable.$inferSelect;
export type Matter = typeof mattersTable.$inferSelect;
export type Activity = typeof activitiesTable.$inferSelect;
export type InsertWorkspace = z.infer<typeof insertWorkspaceSchema>;
export type InsertMembership = z.infer<typeof insertMembershipSchema>;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type InsertMatter = z.infer<typeof insertMatterSchema>;
export type InsertActivity = z.infer<typeof insertActivitySchema>;
