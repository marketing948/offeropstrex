import { pgTable, text, serial, boolean, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";

// Pivot Phase 2: manual lookup table — admin-managed list of affiliate
// networks per workspace. Replaces the Voluum-synced list (which is
// disabled in pivot Phase 0). New batches FK into this via
// testing_batches.affiliate_network_id.
export const affiliateNetworksTable = pgTable("affiliate_networks", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqWorkspaceName: unique("affiliate_networks_workspace_name_unique").on(t.workspaceId, t.name),
}));

export const insertAffiliateNetworkSchema = createInsertSchema(affiliateNetworksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAffiliateNetwork = z.infer<typeof insertAffiliateNetworkSchema>;
export type AffiliateNetwork = typeof affiliateNetworksTable.$inferSelect;
