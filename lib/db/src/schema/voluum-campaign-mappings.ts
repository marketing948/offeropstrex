import { pgTable, text, serial, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { testingBatchesTable } from "./testing-batches";
import { workspacesTable } from "./workspaces";

/**
 * @deprecated Phase 2 (Task #12).
 *
 * Superseded by `tracker_campaigns`, which models the (batch, traffic_source,
 * device) → Voluum-campaign relationship the spec actually requires. This
 * table is kept intact for now so Phase 3 can write a one-shot migration
 * script that backfills `tracker_campaigns` from these rows. Phase 5 will
 * drop it. Do NOT add new readers/writers — use `trackerCampaignsTable`.
 */
export const voluumCampaignMappingsTable = pgTable("voluum_campaign_mappings", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id").notNull(),
  campaignName: text("campaign_name").notNull(),
  batchId: integer("batch_id").notNull().references(() => testingBatchesTable.id, { onDelete: "cascade" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqCampaignPerWorkspace: unique("voluum_campaign_mappings_workspace_campaign_unique").on(table.workspaceId, table.campaignId),
}));

export const insertVoluumCampaignMappingSchema = createInsertSchema(voluumCampaignMappingsTable).omit({ id: true, createdAt: true });
export type InsertVoluumCampaignMapping = z.infer<typeof insertVoluumCampaignMappingSchema>;
export type VoluumCampaignMapping = typeof voluumCampaignMappingsTable.$inferSelect;
