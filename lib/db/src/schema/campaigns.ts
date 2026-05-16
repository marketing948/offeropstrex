import { pgTable, text, serial, timestamp, integer, numeric, pgEnum, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";
import { testingBatchesTable } from "./testing-batches";
import { workspaceTrafficSourcesTable } from "./workspace-traffic-sources";

// CampaignOps redesign (post Pivot Phase 7) — one Campaign per
// (batch, platform, traffic_source) cycle. Status flow:
//
//   voluum_created  → take_campaign_live task created
//   live            → 7-day find_winners task scheduled
//   tested          → next traffic source's create_voluum_campaign task spawned
//   closed          → end of cycle
//
// Legacy values "draft" and "ready" are retained in the enum so
// historical rows remain queryable; the new flow does not produce them.
export const campaignPlatformEnum = pgEnum("campaign_platform", ["ios", "android"]);
export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "ready",
  "voluum_created",
  "live",
  "tested",
  "closed",
]);

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").notNull().references(() => testingBatchesTable.id, { onDelete: "cascade" }),
  platform: campaignPlatformEnum("platform").notNull(),
  campaignName: text("campaign_name").notNull(),
  trafficSourceId: integer("traffic_source_id").references(() => workspaceTrafficSourcesTable.id, { onDelete: "set null" }),
  campaignUrl: text("campaign_url"),
  status: campaignStatusEnum("status").notNull().default("voluum_created"),
  // Voluum (manual entry — no API integration)
  voluumCampaignId: text("voluum_campaign_id"),
  voluumCampaignName: text("voluum_campaign_name"),
  // Traffic source side (manual entry)
  trafficSourceCampaignId: text("traffic_source_campaign_id"),
  trafficSourceCampaignUrl: text("traffic_source_campaign_url"),
  liveStartedAt: timestamp("live_started_at", { withTimezone: true }),
  // Per-Campaign performance (replaces batch_results going forward)
  winnersCount: integer("winners_count"),
  revenue: numeric("revenue"),
  cost: numeric("cost"),
  clicks: integer("clicks"),
  conversions: integer("conversions"),
  roi: numeric("roi"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // CampaignOps redesign: one Campaign per (batch, platform, traffic_source)
  // cycle. The earlier (batch, platform) unique constraint has been
  // dropped because the new flow tests every traffic source per platform.
  uniqBatchPlatformTrafficSource: unique("campaigns_batch_platform_traffic_source_unique")
    .on(t.batchId, t.platform, t.trafficSourceId),
}));

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;
