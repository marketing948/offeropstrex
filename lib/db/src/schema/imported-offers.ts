import { pgTable, text, serial, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { testingBatchesTable } from "./testing-batches";
import { workspacesTable } from "./workspaces";

export const importedOfferStatusEnum = pgEnum("imported_offer_status", [
  "pending",
  "imported",
  "skipped",
  "error",
]);

export const importedOffersTable = pgTable("imported_offers", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").references(() => testingBatchesTable.id, { onDelete: "set null" }),
  voluumCampaignId: text("voluum_campaign_id"),
  voluumOfferId: text("voluum_offer_id"),
  offerName: text("offer_name").notNull(),
  affiliateNetwork: text("affiliate_network"),
  geo: text("geo"),
  tag: text("tag"),
  status: importedOfferStatusEnum("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertImportedOfferSchema = createInsertSchema(importedOffersTable).omit({ id: true, importedAt: true });
export type InsertImportedOffer = z.infer<typeof insertImportedOfferSchema>;
export type ImportedOffer = typeof importedOffersTable.$inferSelect;
