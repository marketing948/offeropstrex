import { pgTable, serial, timestamp, integer, pgEnum, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";
import { testingBatchesTable } from "./testing-batches";
import { workspaceTrafficSourcesTable } from "./workspace-traffic-sources";

export const batchTrafficSourceRunStatusEnum = pgEnum("batch_traffic_source_run_status", [
  "pending",
  "active",
  "completed",
  "skipped",
]);

export const batchTrafficSourceRunsTable = pgTable("batch_traffic_source_runs", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").notNull().references(() => testingBatchesTable.id, { onDelete: "cascade" }),
  trafficSourceId: integer("traffic_source_id").notNull().references(() => workspaceTrafficSourcesTable.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  status: batchTrafficSourceRunStatusEnum("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqBatchTrafficSource: unique("batch_traffic_source_runs_batch_source_unique").on(t.batchId, t.trafficSourceId),
  uniqBatchPosition: unique("batch_traffic_source_runs_batch_position_unique").on(t.batchId, t.position),
}));

export const insertBatchTrafficSourceRunSchema = createInsertSchema(batchTrafficSourceRunsTable).omit({ id: true, createdAt: true });
export type InsertBatchTrafficSourceRun = z.infer<typeof insertBatchTrafficSourceRunSchema>;
export type BatchTrafficSourceRun = typeof batchTrafficSourceRunsTable.$inferSelect;
