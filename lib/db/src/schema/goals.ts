import { pgTable, text, serial, timestamp, integer, numeric, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";

export const periodTypeEnum = pgEnum("period_type", ["weekly", "monthly"]);

export const goalsTable = pgTable("goals", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  periodType: periodTypeEnum("period_type").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  targetOffersUploaded: integer("target_offers_uploaded"),
  targetBatchesCreated: integer("target_batches_created"),
  targetBatchesTested: integer("target_batches_tested"),
  targetCampaignsMovedToMain: integer("target_campaigns_moved_to_main"),
  targetGeosTested: integer("target_geos_tested"),
  targetTrafficSourcesTested: integer("target_traffic_sources_tested"),
  targetProfitOptional: numeric("target_profit_optional"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGoalSchema = createInsertSchema(goalsTable).omit({ id: true, createdAt: true });
export type InsertGoal = z.infer<typeof insertGoalSchema>;
export type Goal = typeof goalsTable.$inferSelect;
