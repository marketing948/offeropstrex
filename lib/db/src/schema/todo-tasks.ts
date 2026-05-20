import { pgTable, text, serial, timestamp, integer, boolean, pgEnum, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";
import { testingBatchesTable } from "./testing-batches";
import { workspacesTable } from "./workspaces";
import { workspaceTrafficSourcesTable } from "./workspace-traffic-sources";

// Task taxonomy. Legacy values are retained so historical rows stay
// queryable; the new CampaignOps flow uses the lowercase
// create_voluum_campaign_*, take_campaign_live, find_winners,
// all_traffic_sources_tested values.
export const taskTypeEnum = pgEnum("task_type", [
  // Legacy (pre-redesign) — kept for back-compat queries only.
  "CREATE_IOS_TRACKER_CAMPAIGN",
  "CREATE_ANDROID_TRACKER_CAMPAIGN",
  "GO_LIVE_TRAFFIC_SOURCE_CAMPAIGN",
  "MOVE_WINNERS_TO_SCALED_CAMPAIGN",
  "FIND_WINNERS",
  "PAUSE_TRAFFIC_SOURCE_CAMPAIGNS",
  "CREATE_IOS_CAMPAIGN",
  "CREATE_ANDROID_CAMPAIGN",
  "GO_LIVE",
  "OPTIMIZATION_FOLLOWUP",
  // CampaignOps redesign — canonical task types for the manual
  // create_voluum_campaign → take_campaign_live → find_winners →
  // next-traffic-source cycle.
  "create_voluum_campaign_ios",
  "create_voluum_campaign_android",
  "take_campaign_live",
  "find_winners",
  "all_traffic_sources_tested",
  "review_winners_target",
  // Human / ops reminders only — never wired to CampaignOps rules.
  "MANUAL",
]);

export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high"]);

export const taskStatusEnum = pgEnum("task_status", [
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
]);

export const trackerCampaignDeviceEnum = pgEnum("tracker_campaign_device", [
  "ios",
  "android",
]);

export const todoTasksTable = pgTable("todo_tasks", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id, { onDelete: "cascade" }),
  relatedBatchId: integer("related_batch_id").references(() => testingBatchesTable.id, { onDelete: "set null" }),
  // CampaignOps redesign: per-platform-per-traffic-source tasks reference
  // the specific Campaign they advance. Nullable so it stays compatible
  // with the initial create_voluum_campaign_* tasks (no Campaign yet).
  relatedCampaignId: integer("related_campaign_id"),
  title: text("title").notNull(),
  description: text("description"),
  taskType: taskTypeEnum("task_type").notNull(),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  status: taskStatusEnum("status").notNull().default("TODO"),
  dueDate: text("due_date"),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  flashing: boolean("flashing").notNull().default(false),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedByEmployeeId: integer("completed_by_employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
  completionPayload: jsonb("completion_payload"),
  blockedReason: text("blocked_reason"),
  trackerCampaignDevice: trackerCampaignDeviceEnum("tracker_campaign_device"),
  trafficSourceId: integer("traffic_source_id").references(() => workspaceTrafficSourcesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqOpenTrackerTaskPerSlot: uniqueIndex("todo_tasks_open_tracker_unique")
    .on(t.workspaceId, t.relatedBatchId, t.trafficSourceId, t.taskType, t.trackerCampaignDevice)
    .where(sql`status IN ('TODO', 'IN_PROGRESS') AND tracker_campaign_device IS NOT NULL`),
  uniqOpenBatchAutoTask: uniqueIndex("todo_tasks_open_batch_auto_unique")
    .on(t.workspaceId, t.relatedBatchId, t.taskType)
    .where(sql`status IN ('TODO', 'IN_PROGRESS') AND task_type IN (
      'CREATE_IOS_CAMPAIGN',
      'CREATE_ANDROID_CAMPAIGN',
      'GO_LIVE',
      'OPTIMIZATION_FOLLOWUP',
      'MOVE_WINNERS_TO_SCALED_CAMPAIGN'
    )`),
  // CampaignOps redesign — anti-duplication guards for the new flow.
  // create_voluum_campaign_* tasks are unique per (batch, platform,
  // task_type) while OPEN — we reuse task_type as the platform marker
  // since each platform has its own task type.
  uniqOpenCreateCampaignTask: uniqueIndex("todo_tasks_open_create_campaign_unique")
    .on(t.workspaceId, t.relatedBatchId, t.taskType)
    .where(sql`status IN ('TODO', 'IN_PROGRESS') AND task_type IN (
      'create_voluum_campaign_ios',
      'create_voluum_campaign_android'
    )`),
  // take_campaign_live and find_winners are unique per related Campaign
  // while OPEN, so a re-emit can never produce duplicate work.
  uniqOpenCampaignFollowupTask: uniqueIndex("todo_tasks_open_campaign_followup_unique")
    .on(t.workspaceId, t.relatedCampaignId, t.taskType)
    .where(sql`status IN ('TODO', 'IN_PROGRESS') AND task_type IN (
      'take_campaign_live',
      'find_winners'
    ) AND related_campaign_id IS NOT NULL`),
  uniqOpenCampaignOpsTerminalTask: uniqueIndex("todo_tasks_open_campaignops_terminal_unique")
    .on(t.workspaceId, t.relatedBatchId, t.taskType)
    .where(sql`status IN ('TODO', 'IN_PROGRESS') AND task_type = 'all_traffic_sources_tested'`),
}));

export const insertTodoTaskSchema = createInsertSchema(todoTasksTable).omit({ id: true, createdAt: true });
export type InsertTodoTask = z.infer<typeof insertTodoTaskSchema>;
export type TodoTask = typeof todoTasksTable.$inferSelect;
