import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";
import { workspacesTable } from "./workspaces";

export const dailyReportsTable = pgTable("daily_reports", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  reportDate: text("report_date").notNull(),
  offersUploaded: integer("offers_uploaded").notNull().default(0),
  batchesCreated: integer("batches_created").notNull().default(0),
  batchesTested: integer("batches_tested").notNull().default(0),
  campaignsMovedToMain: integer("campaigns_moved_to_main").notNull().default(0),
  campaignsClosed: integer("campaigns_closed").notNull().default(0),
  notes: text("notes"),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDailyReportSchema = createInsertSchema(dailyReportsTable).omit({ id: true, createdAt: true });
export type InsertDailyReport = z.infer<typeof insertDailyReportSchema>;
export type DailyReport = typeof dailyReportsTable.$inferSelect;
