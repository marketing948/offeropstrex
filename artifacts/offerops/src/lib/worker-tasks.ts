import type { TodoTask } from "@workspace/api-client-react";
import { getTaskTypeVisual } from "@/lib/task-type-visuals";

const TITLE_ACTION_SEP = " — ";

function extractQuotedTitle(title: string, pattern: RegExp): string | null {
  const m = title.match(pattern);
  return m?.[1]?.trim() ?? null;
}

/** Best-effort campaign label for display (batch + platform or parsed title). */
export function resolveTaskCampaignLabel(task: TodoTask): string {
  const fromTake = extractQuotedTitle(task.title, /^Take "(.+)" live$/i);
  if (fromTake) return fromTake;

  const fromFind = extractQuotedTitle(task.title, /^Find winners for "(.+)"$/i);
  if (fromFind) return fromFind;

  const fromReview = extractQuotedTitle(task.title, /^Review winners for "(.+)"$/i);
  if (fromReview) return fromReview;

  const platform = platformLabel(task);
  if (task.batchName?.trim()) {
    const batch = task.batchName.trim();
    if (platform && !batch.toLowerCase().includes(platform.toLowerCase())) {
      return `${batch} ${platform}`;
    }
    return batch;
  }

  if (task.title.includes(TITLE_ACTION_SEP)) {
    return task.title.split(TITLE_ACTION_SEP)[0]!.trim();
  }

  const stripped = task.title
    .replace(/^Create Voluum campaign(?:\s+\([^)]+\))?(?:\s+for)?\s*/i, "")
    .replace(/^Optimization follow-up for\s*/i, "")
    .replace(/\s+on\s+.+$/i, "")
    .trim();

  return stripped || task.title;
}

export function taskActionPhrase(
  task: TodoTask,
  trafficSourceName?: string | null,
): string {
  const type = task.taskType as string;
  const ts = trafficSourceName?.trim() || task.trafficSourceName?.trim() || "Traffic Source";

  switch (type) {
    case "create_voluum_campaign_ios":
    case "CREATE_IOS_CAMPAIGN":
    case "CREATE_IOS_TRACKER_CAMPAIGN":
      return "Open Voluum iOS Campaign";
    case "create_voluum_campaign_android":
    case "CREATE_ANDROID_CAMPAIGN":
    case "CREATE_ANDROID_TRACKER_CAMPAIGN":
      return "Open Voluum Android Campaign";
    case "take_campaign_live":
    case "GO_LIVE":
    case "GO_LIVE_TRAFFIC_SOURCE_CAMPAIGN":
      return `Go live on ${ts}`;
    case "find_winners":
    case "FIND_WINNERS":
      return "Review campaign performance";
    case "review_winners_target":
      return "Review winners at traffic target";
    case "OPTIMIZATION_FOLLOWUP":
      return "Optimize traffic allocation";
    case "MOVE_WINNERS_TO_SCALED_CAMPAIGN":
      return "Move winners to scaled campaign";
    case "all_traffic_sources_tested":
      return "Acknowledge platform fully tested";
    case "MANUAL":
      return "Complete manual follow-up";
    default:
      if (/^Take .+ live$/i.test(task.title)) return `Go live on ${ts}`;
      if (/optimization follow-up/i.test(task.title)) return "Optimize traffic allocation";
      if (/scale/i.test(task.title)) return "Scale campaign traffic";
      if (/review/i.test(task.title)) return "Review campaign performance";
      if (/Create Voluum/i.test(task.title)) {
        return platformLabel(task) === "Android"
          ? "Open Voluum Android Campaign"
          : "Open Voluum iOS Campaign";
      }
      return getTaskTypeVisual(type).label;
  }
}

/** Campaign name + clear action for Work Queue rows and detail header. */
export function workerTaskHeadline(
  task: TodoTask,
  trafficSourceName?: string | null,
): string {
  if (task.title.includes(TITLE_ACTION_SEP)) {
    const [campaign, action] = task.title.split(TITLE_ACTION_SEP);
    if (campaign?.trim() && action?.trim()) return task.title;
  }

  const campaign = resolveTaskCampaignLabel(task);
  const action = taskActionPhrase(task, trafficSourceName);
  return `${campaign}${TITLE_ACTION_SEP}${action}`;
}

export const CAMPAIGN_OPS_TASK_TYPES = new Set([
  "create_voluum_campaign_ios",
  "create_voluum_campaign_android",
  "take_campaign_live",
  "find_winners",
  "review_winners_target",
  "all_traffic_sources_tested",
]);

export type WorkerTaskFilter = "all" | "campaignops" | "manual" | "overdue" | "blocked";

/** Server query param for GET /todo-tasks completion scope. */
export type WorkerTaskStatusFilter = "active" | "completed" | "all";

const OPEN_STATUSES = new Set(["TODO", "IN_PROGRESS", "BLOCKED"]);

export function isOpenWorkerTask(task: TodoTask): boolean {
  return OPEN_STATUSES.has(task.status);
}

export function isCompletedWorkerTask(task: TodoTask): boolean {
  return task.status === "DONE";
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

/** Mixed open + completed lists: open tasks first, then completed newest-first. */
export function compareWorkerTasksForList(a: TodoTask, b: TodoTask): number {
  const doneA = a.status === "DONE" ? 1 : 0;
  const doneB = b.status === "DONE" ? 1 : 0;
  if (doneA !== doneB) return doneA - doneB;
  if (a.status === "DONE" && b.status === "DONE") {
    const ca = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const cb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    if (ca !== cb) return cb - ca;
    return b.id - a.id;
  }
  return compareWorkerTasks(a, b);
}
