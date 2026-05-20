import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";
import { employeesTable } from "./employees";

export const operationalActivityFeedTable = pgTable(
  "operational_activity_feed",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    actorEmployeeId: integer("actor_employee_id").references(() => employeesTable.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceCreatedAtIdx: index("operational_activity_feed_workspace_created_at_idx").on(
      t.workspaceId,
      t.createdAt,
    ),
    workspaceEventTypeIdx: index("operational_activity_feed_workspace_event_type_idx").on(
      t.workspaceId,
      t.eventType,
      t.createdAt,
    ),
  }),
);

export const insertOperationalActivityFeedSchema = createInsertSchema(
  operationalActivityFeedTable,
).omit({ id: true, createdAt: true });
export type InsertOperationalActivityFeed = z.infer<typeof insertOperationalActivityFeedSchema>;
export type OperationalActivityFeed = typeof operationalActivityFeedTable.$inferSelect;
