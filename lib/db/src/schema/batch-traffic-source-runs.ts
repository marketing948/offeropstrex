import { pgTable, serial, timestamp, integer, text, pgEnum, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";
import { testingBatchesTable } from "./testing-batches";
import { workspaceTrafficSourcesTable } from "./workspace-traffic-sources";
import { campaignsTable } from "./campaigns";

export const batchTrafficSourceRunStatusEnum = pgEnum("batch_traffic_source_run_status", [
  "pending",
  "active",
  "completed",
  "failed",
  "skipped",
]);

export const batchTrafficSourcePlatformStatusEnum = pgEnum("batch_traffic_source_platform_status", [
  "pending",
  "active",
  "completed",
  "failed",
  "skipped",
]);

export const batchTrafficSourceRunsTable = pgTable("batch_traffic_source_runs", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").notNull().references(() => testingBatchesTable.id, { onDelete: "cascade" }),
  trafficSourceId: integer("traffic_source_id").notNull().references(() => workspaceTrafficSourcesTable.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  status: batchTrafficSourceRunStatusEnum("status").notNull().default("pending"),
  iosStatus: batchTrafficSourcePlatformStatusEnum("ios_status").notNull().default("pending"),
  androidStatus: batchTrafficSourcePlatformStatusEnum("android_status").notNull().default("pending"),
  iosCampaignId: integer("ios_campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  androidCampaignId: integer("android_campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
  iosFailureReason: text("ios_failure_reason"),
  androidFailureReason: text("android_failure_reason"),
  iosCompletedAt: timestamp("ios_completed_at", { withTimezone: true }),
  androidCompletedAt: timestamp("android_completed_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** Target visits per offer for this run slot; used with offer_count to detect traffic target met. */
  targetAvgVisitsPerOffer: integer("target_avg_visits_per_offer"),
  /** Snapshot of offer count when run was created (from batch.number_of_offers). */
  offerCount: integer("offer_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqBatchTrafficSource: unique("batch_traffic_source_runs_batch_source_unique").on(t.batchId, t.trafficSourceId),
  uniqBatchPosition: unique("batch_traffic_source_runs_batch_position_unique").on(t.batchId, t.position),
}));

export const insertBatchTrafficSourceRunSchema = createInsertSchema(batchTrafficSourceRunsTable).omit({ id: true, createdAt: true });
export type InsertBatchTrafficSourceRun = z.infer<typeof insertBatchTrafficSourceRunSchema>;
export type BatchTrafficSourceRun = typeof batchTrafficSourceRunsTable.$inferSelect;
