import { pgTable, text, serial, timestamp, integer, numeric, pgEnum, unique, jsonb, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";
import { workspacesTable, voluumTrafficSourcesTable } from "./workspaces";
import { affiliateNetworksTable } from "./affiliate-networks";
import { geosTable } from "./geos";

// Phase 2: Spec-canonical batch lifecycle (Automation Bible §6).
// Replaces legacy 12-state enum with the 6-state state machine the
// engine in Phase 3+ will drive.
export const batchStatusEnum = pgEnum("batch_status", [
  "NEW_BATCH",
  "WAITING_FOR_TRACKER_CAMPAIGNS",
  "OFFER_READY_FOR_LIVE_TESTING",
  "LIVE_TESTS",
  "TESTED",
  "COMPLETED",
]);

export const testingBatchesTable = pgTable("testing_batches", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  batchName: text("batch_name").notNull(),
  affiliateNetwork: text("affiliate_network").notNull(),
  geo: text("geo").notNull(),
  trafficSource: text("traffic_source").notNull(),
  vertical: text("vertical"),
  numberOfOffers: integer("number_of_offers"),
  trackerCampaignId: text("tracker_campaign_id"),
  status: batchStatusEnum("status").notNull().default("NEW_BATCH"),
  testStartDate: text("test_start_date"),
  testEndDate: text("test_end_date"),
  testBudget: numeric("test_budget"),
  notes: text("notes"),
  clicksThreshold: integer("clicks_threshold"),
  spendThreshold: numeric("spend_threshold"),
  daysThreshold: integer("days_threshold"),
  conditionsMetAt: timestamp("conditions_met_at", { withTimezone: true }),
  liveAt: timestamp("live_at", { withTimezone: true }),
  trafficSourceVoluumId: text("traffic_source_voluum_id"),
  affiliateNetworkVoluumId: text("affiliate_network_voluum_id"),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  batchTag: text("batch_tag"),
  // Phase 2: Engine-managed traffic-source rotation. The batch owns a
  // snapshot of the workspace traffic-source order at creation time
  // (so later admin reorderings don't retroactively change history),
  // and walks through it via traffic_source_step. current_traffic_source_id
  // is the row in the snapshot the batch is currently testing on.
  currentTrafficSourceId: integer("current_traffic_source_id").references(() => voluumTrafficSourcesTable.id, { onDelete: "set null" }),
  trafficSourceStep: integer("traffic_source_step").notNull().default(0),
  trafficSourceOrderSnapshot: jsonb("traffic_source_order_snapshot"),
  // Pivot Phase 2 (Task #25): re-pointed to the new manual
  // `affiliate_networks` table (was previously a FK into the
  // Voluum-synced `voluum_affiliate_networks`, which is dead weight
  // now that Voluum is locked out in pivot Phase 0). Existing rows
  // were verified NULL before the FK swap. RESTRICT on delete: an
  // affiliate network cannot be removed while batches still reference it.
  affiliateNetworkId: integer("affiliate_network_id").references(() => affiliateNetworksTable.id, { onDelete: "restrict" }),
  // Pivot Phase 2 (Task #25): FK into manual `geos` lookup. Legacy
  // `geo` text column is preserved for backward read compatibility
  // until Phase 7.
  geoId: integer("geo_id").references(() => geosTable.id, { onDelete: "restrict" }),
  // Pivot Phase 2 (Task #25): manual workflow lifecycle columns.
  // `assignedWorkerId` is intentionally NOT a separate column —
  // the existing `employeeId` already serves that role; downstream
  // code refers to it as the assigned worker.
  testRound: integer("test_round"),
  startDate: date("start_date"),
  testDurationHours: integer("test_duration_hours").notNull().default(48),
  // DEPRECATED in Phase 2: superseded by tracker_campaigns table. Kept for
  // historical UI display; sync no longer writes here in Phase 5+.
  voluumCampaignId: text("voluum_campaign_id"),
  voluumCampaignName: text("voluum_campaign_name"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqWorkspaceBatchTag: unique("testing_batches_workspace_batch_tag_unique").on(t.workspaceId, t.batchTag),
}));

export const insertTestingBatchSchema = createInsertSchema(testingBatchesTable).omit({ id: true, createdAt: true });
export type InsertTestingBatch = z.infer<typeof insertTestingBatchSchema>;
export type TestingBatch = typeof testingBatchesTable.$inferSelect;
