import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";

export const operationalEventsTable = pgTable("operational_events", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  eventType: text("event_type").notNull(),
  actorType: text("actor_type").notNull().default("system"),
  actorId: text("actor_id"),
  source: text("source").notNull(),
  payloadJson: jsonb("payload_json").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workspaceCreatedAtIdx: index("operational_events_workspace_created_at_idx").on(t.workspaceId, t.createdAt, t.id),
  workspaceEntityIdx: index("operational_events_workspace_entity_idx").on(t.workspaceId, t.entityType, t.entityId, t.createdAt),
  workspaceEventTypeIdx: index("operational_events_workspace_event_type_idx").on(t.workspaceId, t.eventType, t.createdAt),
}));

export const insertOperationalEventSchema = createInsertSchema(operationalEventsTable).omit({ id: true, createdAt: true });
export type InsertOperationalEvent = z.infer<typeof insertOperationalEventSchema>;
export type OperationalEvent = typeof operationalEventsTable.$inferSelect;
