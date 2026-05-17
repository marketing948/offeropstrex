import { pgTable, text, serial, boolean, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workspacesTable = pgTable("workspaces", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  voluumAccessId: text("voluum_access_id"),
  voluumAccessKey: text("voluum_access_key"),
  voluumApiBaseUrl: text("voluum_api_base_url"),
  voluumWorkspaceId: text("voluum_workspace_id"),
  voluumWorkspaceName: text("voluum_workspace_name"),
  syncInterval: text("sync_interval").notNull().default("manual"),
  syncStatus: text("sync_status"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  trafficSourcesSynced: integer("traffic_sources_synced").notNull().default(0),
  networksSynced: integer("networks_synced").notNull().default(0),
  // Phase 7c (Bible §9): per-workspace SLA threshold for the overdue-tasks
  // cron. Cron compares `now() - todo_tasks.created_at` against this value
  // on every scan. NOT NULL with a default of 24h so every workspace —
  // including legacy rows backfilled by the schema push — has a concrete
  // SLA without an extra coalesce in the cron query.
  overdueThresholdHours: integer("overdue_threshold_hours").notNull().default(24),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWorkspaceSchema = createInsertSchema(workspacesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkspace = z.infer<typeof insertWorkspaceSchema>;
export type Workspace = typeof workspacesTable.$inferSelect;

export const voluumTrafficSourcesTable = pgTable("voluum_traffic_sources", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  voluumId: text("voluum_id").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  uniq: unique("voluum_traffic_sources_workspace_voluum_unique").on(t.workspaceId, t.voluumId),
}));

export const insertVoluumTrafficSourceSchema = createInsertSchema(voluumTrafficSourcesTable).omit({ id: true });
export type InsertVoluumTrafficSource = z.infer<typeof insertVoluumTrafficSourceSchema>;
export type VoluumTrafficSource = typeof voluumTrafficSourcesTable.$inferSelect;

export const voluumAffiliateNetworksTable = pgTable("voluum_affiliate_networks", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  voluumId: text("voluum_id").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  uniq: unique("voluum_affiliate_networks_workspace_voluum_unique").on(t.workspaceId, t.voluumId),
}));

export const insertVoluumAffiliateNetworkSchema = createInsertSchema(voluumAffiliateNetworksTable).omit({ id: true });
export type InsertVoluumAffiliateNetwork = z.infer<typeof insertVoluumAffiliateNetworkSchema>;
export type VoluumAffiliateNetwork = typeof voluumAffiliateNetworksTable.$inferSelect;

export const voluumCampaignsTable = pgTable("voluum_campaigns", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  campaignName: text("campaign_name").notNull(),
  trafficSourceName: text("traffic_source_name"),
  trafficSourceId: text("traffic_source_id"),
  affiliateNetworkName: text("affiliate_network_name"),
  affiliateNetworkId: text("affiliate_network_id"),
  country: text("country"),
  status: text("status"),
  // Canonical lowercase OfferOps tag matched on this campaign, or NULL if
  // none of the campaign's Voluum tags matched the OfferOps tag pattern.
  primaryTag: text("primary_tag"),
  // JSON-encoded array of all Voluum tags returned for this campaign.
  allTags: text("all_tags"),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  uniq: unique("voluum_campaigns_workspace_campaign_unique").on(t.workspaceId, t.campaignId),
}));

export const insertVoluumCampaignSchema = createInsertSchema(voluumCampaignsTable).omit({ id: true });
export type InsertVoluumCampaign = z.infer<typeof insertVoluumCampaignSchema>;
export type VoluumCampaign = typeof voluumCampaignsTable.$inferSelect;

export const voluumOffersTable = pgTable("voluum_offers", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  offerId: text("offer_id").notNull(),
  offerName: text("offer_name").notNull(),
  affiliateNetworkName: text("affiliate_network_name"),
  affiliateNetworkId: text("affiliate_network_id"),
  country: text("country"),
  offerUrl: text("offer_url"),
  primaryTag: text("primary_tag"),
  allTags: text("all_tags"),
  status: text("status"),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  batchId: integer("batch_id"),
  // Spec compliance (Automation Bible §6.5): per-offer visits sourced
  // from the Voluum offer-grouped report. The BatchStatsUpdated rule
  // gates BatchTested on `every offer in the batch has visits >=
  // 20000`. Defaults to 0 so newly-imported offers do not falsely
  // satisfy the gate before the first report sync runs.
  visits: integer("visits").notNull().default(0),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  uniq: unique("voluum_offers_workspace_offer_unique").on(t.workspaceId, t.offerId),
}));

export const insertVoluumOfferSchema = createInsertSchema(voluumOffersTable).omit({ id: true });
export type InsertVoluumOffer = z.infer<typeof insertVoluumOfferSchema>;
export type VoluumOffer = typeof voluumOffersTable.$inferSelect;
