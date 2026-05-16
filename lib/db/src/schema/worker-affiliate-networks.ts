import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";
import { employeesTable } from "./employees";
import { affiliateNetworksTable } from "./affiliate-networks";

export const workerAffiliateNetworksTable = pgTable("worker_affiliate_networks", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  affiliateNetworkId: integer("affiliate_network_id").notNull().references(() => affiliateNetworksTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqAssignment: unique("worker_affiliate_networks_unique").on(t.workspaceId, t.employeeId, t.affiliateNetworkId),
}));

export const insertWorkerAffiliateNetworkSchema = createInsertSchema(workerAffiliateNetworksTable).omit({ id: true, createdAt: true });
export type InsertWorkerAffiliateNetwork = z.infer<typeof insertWorkerAffiliateNetworkSchema>;
export type WorkerAffiliateNetwork = typeof workerAffiliateNetworksTable.$inferSelect;
