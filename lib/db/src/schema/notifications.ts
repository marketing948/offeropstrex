import { pgTable, text, serial, timestamp, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";
import { testingBatchesTable } from "./testing-batches";
import { workspacesTable } from "./workspaces";

// Phase 2: Spec-canonical notification taxonomy (Automation Bible §9).
export const notificationTypeEnum = pgEnum("notification_type", [
  "NEW_BATCH_CREATED",
  "TRACKER_CAMPAIGN_MISSING",
  "INVALID_TAG",
  "DUPLICATE_TRACKER_CAMPAIGN",
  "SUSPICIOUS_BATCH_UPDATE",
  "API_SYNC_FAILURE",
  "TASK_OVERDUE",
]);

// Phase 2: Notification severity drives in-app coloring + digest grouping.
export const notificationSeverityEnum = pgEnum("notification_severity", [
  "info",
  "warning",
  "high",
  "critical",
]);

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  batchId: integer("batch_id").references(() => testingBatchesTable.id, { onDelete: "set null" }),
  type: notificationTypeEnum("type").notNull(),
  severity: notificationSeverityEnum("severity").notNull().default("info"),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
