import { pgTable, text, serial, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable, voluumTrafficSourcesTable } from "./workspaces";
import { testingBatchesTable } from "./testing-batches";
import { trackerCampaignDeviceEnum } from "./todo-tasks";

// Phase 2: A `tracker_campaign` is the Voluum-side campaign object the
// worker creates per (batch, traffic source, device) triple in response to
// a CREATE_*_TRACKER_CAMPAIGN task. The engine ingests it from sync once
// the matching tag appears in Voluum, closes the task, and uses the row
// to drive subsequent FIND_WINNERS / PAUSE_* tasks.
export const trackerCampaignsTable = pgTable("tracker_campaigns", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").notNull().references(() => testingBatchesTable.id, { onDelete: "cascade" }),
  trafficSourceId: integer("traffic_source_id").notNull().references(() => voluumTrafficSourcesTable.id, { onDelete: "restrict" }),
  device: trackerCampaignDeviceEnum("device").notNull(),
  voluumCampaignId: text("voluum_campaign_id").notNull(),
  tag: text("tag").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // One Voluum campaign id per workspace (cross-workspace ids may legitimately
  // collide if Voluum reuses ids across tenants).
  uniqVoluumCampaignPerWorkspace: unique("tracker_campaigns_workspace_voluum_campaign_unique").on(t.workspaceId, t.voluumCampaignId),
  // Exactly one tracker campaign per (batch, traffic source, device).
  // Enforces DUPLICATE_TRACKER_CAMPAIGN detection at the DB layer.
  uniqBatchSourceDevice: unique("tracker_campaigns_batch_source_device_unique").on(t.batchId, t.trafficSourceId, t.device),
}));

export const insertTrackerCampaignSchema = createInsertSchema(trackerCampaignsTable).omit({ id: true, importedAt: true });
export type InsertTrackerCampaign = z.infer<typeof insertTrackerCampaignSchema>;
export type TrackerCampaign = typeof trackerCampaignsTable.$inferSelect;
