import type { TodoTask } from "@workspace/api-client-react";
import { getTaskTypeVisual } from "@/lib/task-type-visuals";

export const CAMPAIGN_OPS_TASK_TYPES = new Set([
  "create_voluum_campaign_ios",
  "create_voluum_campaign_android",
  "take_campaign_live",
  "find_winners",
  "all_traffic_sources_tested",
]);

export type WorkerTaskFilter = "all" | "campaignops" | "manual" | "overdue" | "blocked";

const OPEN_STATUSES = new Set(["TODO", "IN_PROGRESS", "BLOCKED"]);

export function isOpenWorkerTask(task: TodoTask): boolean {
  return OPEN_STATUSES.has(task.status);
}

export function isCampaignOpsTask(task: TodoTask): boolean {
  return CAMPAIGN_OPS_TASK_TYPES.has(task.taskType as string);
}

export function isManualTask(task: TodoTask): boolean {
  return task.taskType === "MANUAL";
}

export function parseDueDate(dueDate: string | null | undefined): Date | null {
  if (!dueDate?.trim()) return null;
  const d = new Date(dueDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isOverdueTask(task: TodoTask, now = new Date()): boolean {
  if (task.status === "DONE" || task.status === "BLOCKED") return false;
  const due = parseDueDate(task.dueDate);
  if (!due) return false;
  return due.getTime() < now.getTime();
}

export function formatDueDate(dueDate: string | null | undefined): string | null {
  const due = parseDueDate(dueDate);
  if (!due) return null;
  return due.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function platformLabel(task: TodoTask): string | null {
  const type = task.taskType as string;
  if (type === "create_voluum_campaign_ios") return "iOS";
  if (type === "create_voluum_campaign_android") return "Android";
  const fromTitle = task.title.match(/\b(iOS|Android)\b/);
  if (fromTitle) return fromTitle[1]!;
  const device = (task as { device?: string | null }).device;
  if (device === "ios") return "iOS";
  if (device === "android") return "Android";
  return null;
}

/** Prefer clean batch/platform headline over verbose internal task titles. */
export function workerTaskHeadline(task: TodoTask): string {
  const platform = platformLabel(task);
  if (/^Create Voluum campaign/i.test(task.title) && task.batchName?.trim() && platform) {
    return `${task.batchName.trim()} ${platform}`;
  }
  return task.title;
}

export function taskInstructions(task: TodoTask): string {
  if (task.description?.trim()) return task.description.trim();
  return getTaskTypeVisual(task.taskType as string).subtext;
}

export function matchesWorkerFilter(task: TodoTask, filter: WorkerTaskFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "campaignops":
      return isCampaignOpsTask(task);
    case "manual":
      return isManualTask(task);
    case "overdue":
      return isOverdueTask(task);
    case "blocked":
      return task.status === "BLOCKED";
    default:
      return true;
  }
}

const STATUS_RANK: Record<string, number> = {
  IN_PROGRESS: 0,
  TODO: 1,
  BLOCKED: 2,
};

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function compareWorkerTasks(a: TodoTask, b: TodoTask): number {
  const overdueA = isOverdueTask(a) ? 0 : 1;
  const overdueB = isOverdueTask(b) ? 0 : 1;
  if (overdueA !== overdueB) return overdueA - overdueB;

  const sa = STATUS_RANK[a.status] ?? 9;
  const sb = STATUS_RANK[b.status] ?? 9;
  if (sa !== sb) return sa - sb;

  const pa = PRIORITY_RANK[a.priority] ?? 9;
  const pb = PRIORITY_RANK[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;

  return a.title.localeCompare(b.title);
}
