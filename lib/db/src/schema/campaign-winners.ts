import { pgTable, serial, timestamp, integer, text, pgEnum, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";
import { employeesTable } from "./employees";
import { testingBatchesTable } from "./testing-batches";
import { workspaceTrafficSourcesTable } from "./workspace-traffic-sources";
import { campaignsTable, campaignPlatformEnum } from "./campaigns";

export const campaignWinnerSourceEnum = pgEnum("campaign_winner_source", [
  "manual_close",
  "target_reached_review",
]);

export const campaignWinnersTable = pgTable("campaign_winners", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").references(() => testingBatchesTable.id, { onDelete: "set null" }),
  campaignId: integer("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
  trafficSourceId: integer("traffic_source_id").references(() => workspaceTrafficSourcesTable.id, {
    onDelete: "set null",
  }),
  platform: campaignPlatformEnum("platform").notNull(),
  /** Voluum external offer id (canonical hyphenated lowercase UUID string). */
  offerId: text("offer_id").notNull(),
  source: campaignWinnerSourceEnum("source").notNull(),
  detectedByEmployeeId: integer("detected_by_employee_id").references(() => employeesTable.id, {
    onDelete: "set null",
  }),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqWorkspaceCampaignOffer: unique("campaign_winners_workspace_campaign_offer_unique").on(
    t.workspaceId,
    t.campaignId,
    t.offerId,
  ),
}));

export const insertCampaignWinnerSchema = createInsertSchema(campaignWinnersTable).omit({
  id: true,
  createdAt: true,
  detectedAt: true,
});
export type InsertCampaignWinner = z.infer<typeof insertCampaignWinnerSchema>;
export type CampaignWinner = typeof campaignWinnersTable.$inferSelect;
