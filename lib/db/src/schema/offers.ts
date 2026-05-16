import { pgTable, text, serial, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { testingBatchesTable } from "./testing-batches";
import { workspacesTable } from "./workspaces";

// Phase 2: Spec-canonical offer states (Automation Bible §7). Winner/loser
// is stamped at FIND_WINNERS evaluation; everything else is just imported
// or in the tested-pool. Workflow states (scaling/rejected/etc.) live on
// the batch, not on the offer.
export const offerStatusEnum = pgEnum("offer_status", [
  "imported",
  "tested",
  "winner",
  "loser",
]);

export const offersTable = pgTable("offers", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => testingBatchesTable.id, { onDelete: "cascade" }),
  offerId: text("offer_id"),
  offerName: text("offer_name").notNull(),
  affiliateNetwork: text("affiliate_network"),
  geo: text("geo"),
  vertical: text("vertical"),
  status: offerStatusEnum("status").notNull().default("imported"),
  notes: text("notes"),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOfferSchema = createInsertSchema(offersTable).omit({ id: true, createdAt: true });
export type InsertOffer = z.infer<typeof insertOfferSchema>;
export type Offer = typeof offersTable.$inferSelect;
