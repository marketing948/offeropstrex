import { pgTable, text, serial, timestamp, integer, numeric, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";
import { testingBatchesTable } from "./testing-batches";

// Pivot Phase 2: manual batch results. One row per batch (unique
// batch_id). Phase 5 fills out the UI for entering and editing
// these; Phase 4 rules will read them to drive task creation.
export const batchResultsTable = pgTable("batch_results", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").notNull().references(() => testingBatchesTable.id, { onDelete: "cascade" }),
  clicks: integer("clicks").notNull().default(0),
  cost: numeric("cost").notNull().default("0"),
  revenue: numeric("revenue").notNull().default("0"),
  conversions: integer("conversions").notNull().default(0),
  roi: numeric("roi"),
  winnersCount: integer("winners_count").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqBatch: unique("batch_results_batch_unique").on(t.batchId),
}));

export const insertBatchResultSchema = createInsertSchema(batchResultsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBatchResult = z.infer<typeof insertBatchResultSchema>;
export type BatchResult = typeof batchResultsTable.$inferSelect;
