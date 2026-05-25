import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  Database,
  FlaskConical,
  Route,
  Trophy,
  TrendingUp,
} from "lucide-react";
import type { TodoTask } from "@workspace/api-client-react";
import {
  compareWorkerTasks,
  isCompletedWorkerTask,
  isManualTask,
  isOverdueTask,
} from "@/lib/worker-tasks";
import type { QueueSection } from "@/lib/work-queue";

export type TaskFamilyId =
  | "testing"
  | "winners"
  | "scaling"
  | "traffic"
  | "data"
  | "manual"
  | "other";

export type TaskFamilyConfig = {
  id: TaskFamilyId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Subtle section accent — border + header chip only */
  accentBorder: string;
  accentBg: string;
  accentText: string;
  iconBg: string;
  iconFg: string;
};

export const TASK_FAMILIES: TaskFamilyConfig[] = [
  {
    id: "testing",
    label: "Testing Tasks",
    description: "Campaign setup, go-live, and platform coverage",
    icon: FlaskConical,
    accentBorder: "border-violet-400/70 dark:border-violet-500/50",
    accentBg: "bg-violet-500/8",
    accentText: "text-violet-800 dark:text-violet-200",
    iconBg: "bg-violet-100 dark:bg-violet-950/50",
    iconFg: "text-violet-700 dark:text-violet-300",
  },
  {
    id: "winners",
    label: "Winner Tasks",
    description: "Winner discovery and traffic-target review",
    icon: Trophy,
    accentBorder: "border-amber-400/70 dark:border-amber-500/50",
    accentBg: "bg-amber-500/8",
    accentText: "text-amber-900 dark:text-amber-100",
    iconBg: "bg-amber-100 dark:bg-amber-950/50",
    iconFg: "text-amber-800 dark:text-amber-200",
  },
  {
    id: "scaling",
    label: "Scaling Tasks",
    description: "Move winners and scale follow-through",
    icon: TrendingUp,
    accentBorder: "border-emerald-400/70 dark:border-emerald-500/50",
    accentBg: "bg-emerald-500/8",
    accentText: "text-emerald-900 dark:text-emerald-100",
    iconBg: "bg-emerald-100 dark:bg-emerald-950/50",
    iconFg: "text-emerald-800 dark:text-emerald-200",
  },
  {
    id: "traffic",
    label: "Traffic Tasks",
    description: "Source pauses, optimization, and traffic control",
    icon: Route,
    accentBorder: "border-red-400/60 dark:border-red-500/45",
    accentBg: "bg-red-500/6",
    accentText: "text-red-900 dark:text-red-100",
    iconBg: "bg-red-100 dark:bg-red-950/45",
    iconFg: "text-red-800 dark:text-red-200",
  },
  {
    id: "data",
    label: "Data Tasks",
    description: "Metrics, imports, and operational data follow-ups",
    icon: Database,
    accentBorder: "border-indigo-400/70 dark:border-indigo-500/50",
    accentBg: "bg-indigo-500/8",
    accentText: "text-indigo-900 dark:text-indigo-100",
    iconBg: "bg-indigo-100 dark:bg-indigo-950/50",
    iconFg: "text-indigo-800 dark:text-indigo-200",
  },
  {
    id: "manual",
    label: "Manual Follow-ups",
    description: "Ops reminders and ad-hoc execution items",
    icon: ClipboardList,
    accentBorder: "border-slate-400/60 dark:border-slate-500/45",
    accentBg: "bg-slate-500/6",
    accentText: "text-slate-800 dark:text-slate-200",
    iconBg: "bg-slate-100 dark:bg-slate-800/60",
    iconFg: "text-slate-700 dark:text-slate-300",
  },
  {
    id: "other",
    label: "Other Work",
    description: "Uncategorized operational tasks",
    icon: ClipboardList,
    accentBorder: "border-border",
    accentBg: "bg-muted/30",
    accentText: "text-muted-foreground",
    iconBg: "bg-muted",
    iconFg: "text-muted-foreground",
  },
];

const FAMILY_BY_ID = new Map(TASK_FAMILIES.map((f) => [f.id, f]));

const TESTING_TYPES = new Set([
  "create_voluum_campaign_ios",
  "create_voluum_campaign_android",
  "take_campaign_live",
  "all_traffic_sources_tested",
  "CREATE_IOS_CAMPAIGN",
  "CREATE_ANDROID_CAMPAIGN",
  "CREATE_IOS_TRACKER_CAMPAIGN",
  "CREATE_ANDROID_TRACKER_CAMPAIGN",
  "GO_LIVE",
  "GO_LIVE_TRAFFIC_SOURCE_CAMPAIGN",
]);

const WINNER_TYPES = new Set(["find_winners", "FIND_WINNERS", "review_winners_target"]);

const SCALING_TYPES = new Set(["MOVE_WINNERS_TO_SCALED_CAMPAIGN"]);

const TRAFFIC_TYPES = new Set([
  "PAUSE_TRAFFIC_SOURCE_CAMPAIGNS",
  "OPTIMIZATION_FOLLOWUP",
]);

const DATA_TYPES = new Set<string>([]);

export function resolveTaskFamily(task: TodoTask): TaskFamilyId {
  if (isManualTask(task)) return "manual";
  const t = task.taskType as string;
  if (WINNER_TYPES.has(t)) return "winners";
  if (SCALING_TYPES.has(t)) return "scaling";
  if (TRAFFIC_TYPES.has(t)) return "traffic";
  if (TESTING_TYPES.has(t)) return "testing";
  if (DATA_TYPES.has(t)) return "data";
  return "other";
}

export function getTaskFamilyConfig(id: TaskFamilyId): TaskFamilyConfig {
  return FAMILY_BY_ID.get(id) ?? FAMILY_BY_ID.get("other")!;
}

export type FamilyQueueSection = QueueSection & {
  familyId: TaskFamilyId;
  config: TaskFamilyConfig;
};

export function groupTasksByFamily(tasks: TodoTask[]): FamilyQueueSection[] {
  const buckets = new Map<TaskFamilyId, TodoTask[]>();
  for (const t of tasks) {
    const id = resolveTaskFamily(t);
    const list = buckets.get(id) ?? [];
    list.push(t);
    buckets.set(id, list);
  }

  const sections: FamilyQueueSection[] = [];
  for (const config of TASK_FAMILIES) {
    const list = buckets.get(config.id);
    if (!list?.length) continue;
    sections.push({
      id: config.id,
      familyId: config.id,
      label: config.label,
      config,
      tasks: [...list].sort(compareWorkerTasks),
    });
  }
  return sections;
}

export type WorkQueueRailFilters = {
  status: "all" | "todo" | "in_progress" | "blocked" | "done";
  priority: "all" | "high" | "normal";
  due: "all" | "overdue" | "today" | "week";
};

export function matchesRailStatus(task: TodoTask, status: WorkQueueRailFilters["status"]): boolean {
  if (status === "all") return true;
  if (status === "done") return task.status === "DONE";
  if (status === "blocked") return task.status === "BLOCKED";
  if (status === "in_progress") return task.status === "IN_PROGRESS";
  if (status === "todo") return task.status === "TODO";
  return true;
}

export function matchesRailPriority(
  task: TodoTask,
  priority: WorkQueueRailFilters["priority"],
): boolean {
  if (priority === "all") return true;
  if (priority === "high") return task.priority === "high";
  return task.priority !== "high";
}

export function matchesRailDue(task: TodoTask, due: WorkQueueRailFilters["due"], now = new Date()): boolean {
  if (due === "all") return true;
  if (due === "overdue") return isOverdueTask(task, now);
  const d = task.dueDate ? new Date(task.dueDate) : null;
  if (!d || Number.isNaN(d.getTime())) return due !== "today" && due !== "week";
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const endToday = new Date(start);
  endToday.setDate(endToday.getDate() + 1);
  const endWeek = new Date(start);
  endWeek.setDate(endWeek.getDate() + 7);
  if (due === "today") return d >= start && d < endToday;
  if (due === "week") return d >= start && d < endWeek;
  return true;
}

export function applyRailFilters(tasks: TodoTask[], filters: WorkQueueRailFilters): TodoTask[] {
  return tasks.filter(
    (t) =>
      matchesRailStatus(t, filters.status) &&
      matchesRailPriority(t, filters.priority) &&
      matchesRailDue(t, filters.due),
  );
}

export function completedTodayCount(tasks: TodoTask[], now = new Date()): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return tasks.filter((t) => {
    if (!isCompletedWorkerTask(t) || !t.completedAt) return false;
    const d = new Date(t.completedAt);
    return !Number.isNaN(d.getTime()) && d >= start;
  }).length;
}

export function highPriorityOpenCount(tasks: TodoTask[]): number {
  return tasks.filter((t) => t.priority === "high" && !isCompletedWorkerTask(t)).length;
}
