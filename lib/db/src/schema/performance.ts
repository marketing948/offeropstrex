import { pgTable, text, serial, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { testingBatchesTable } from "./testing-batches";

export const performanceTable = pgTable("performance", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => testingBatchesTable.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  spend: numeric("spend"),
  clicks: integer("clicks"),
  conversions: integer("conversions"),
  revenue: numeric("revenue"),
  profit: numeric("profit"),
  roi: numeric("roi"),
  cpa: numeric("cpa"),
  epc: numeric("epc"),
  cvr: numeric("cvr"),
});

export const insertPerformanceSchema = createInsertSchema(performanceTable).omit({ id: true });
export type InsertPerformance = z.infer<typeof insertPerformanceSchema>;
export type Performance = typeof performanceTable.$inferSelect;
