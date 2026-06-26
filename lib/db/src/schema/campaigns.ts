import { pgTable, text, serial, timestamp, integer, numeric, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";
import { employeesTable } from "./employees";
import { testingBatchesTable } from "./testing-batches";
import { workspaceTrafficSourcesTable } from "./workspace-traffic-sources";
import { affiliateNetworksTable } from "./affiliate-networks";
import { geosTable } from "./geos";

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
  "ready_for_winner_review",
  "tested",
  "closed",
]);

/** testing = CampaignOps batch cycle; working/scaling = manual production live. */
export const campaignPurposeEnum = pgEnum("campaign_purpose", [
  "testing",
  "working",
  "scaling",
]);

export const campaignManualCloseReasonEnum = pgEnum("campaign_manual_close_reason", [
  "opened_by_mistake",
  "no_traffic_dead_campaign",
  "technical_issue",
  "winners_found",
]);

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").references(() => testingBatchesTable.id, { onDelete: "cascade" }),
  platform: campaignPlatformEnum("platform").notNull(),
  campaignName: text("campaign_name").notNull(),
  trafficSourceId: integer("traffic_source_id").references(() => workspaceTrafficSourcesTable.id, { onDelete: "set null" }),
  campaignUrl: text("campaign_url"),
  status: campaignStatusEnum("status").notNull().default("voluum_created"),
  campaignPurpose: campaignPurposeEnum("campaign_purpose").notNull().default("testing"),
  parentCampaignId: integer("parent_campaign_id"),
  affiliateNetworkId: integer("affiliate_network_id").references(() => affiliateNetworksTable.id, {
    onDelete: "set null",
  }),
  geo: text("geo"),
  /** Canonical GEO for working-campaign slot matching; prefer over free-text `geo`. */
  geoId: integer("geo_id").references(() => geosTable.id, { onDelete: "set null" }),
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
  closeSource: text("close_source"),
  manualCloseReason: campaignManualCloseReasonEnum("manual_close_reason"),
  manualCloseNote: text("manual_close_note"),
  manualClosedAt: timestamp("manual_closed_at", { withTimezone: true }),
  manualClosedByEmployeeId: integer("manual_closed_by_employee_id").references(() => employeesTable.id, {
    onDelete: "set null",
  }),
  // Owner of manually-created production/live campaigns. Set from the
  // authenticated employee at creation (never from request body). NULLABLE:
  // existing rows and CampaignOps-generated campaigns may be null (no backfill).
  createdByEmployeeId: integer("created_by_employee_id").references(() => employeesTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (_t) => ({
  // Partial unique index for testing campaigns only — see migration
  // 0015_production_live_campaigns.sql (batch_id IS NOT NULL).
}));

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;
