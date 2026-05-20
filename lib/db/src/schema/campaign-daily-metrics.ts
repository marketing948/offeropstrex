import { pgTable, serial, timestamp, integer, numeric, date, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";
import { campaignsTable } from "./campaigns";
import { employeesTable } from "./employees";

export const campaignDailyMetricsTable = pgTable(
  "campaign_daily_metrics",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaignsTable.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    cost: numeric("cost").notNull().default("0"),
    revenue: numeric("revenue").notNull().default("0"),
    conversions: integer("conversions").notNull().default(0),
    visits: integer("visits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqCampaignDate: unique("campaign_daily_metrics_workspace_campaign_date_unique").on(
      t.campaignId,
      t.date,
    ),
  }),
);

export const insertCampaignDailyMetricSchema = createInsertSchema(campaignDailyMetricsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCampaignDailyMetric = z.infer<typeof insertCampaignDailyMetricSchema>;
export type CampaignDailyMetric = typeof campaignDailyMetricsTable.$inferSelect;
