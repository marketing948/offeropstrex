import type { TodoTask } from "@workspace/api-client-react";
import {
  compareWorkerTasks,
  isCampaignOpsTask,
  isCompletedWorkerTask,
  isManualTask,
  isOverdueTask,
  isOpenWorkerTask,
} from "@/lib/worker-tasks";
import { getTaskTypeVisual } from "@/lib/task-type-visuals";

export type { DateFilterPreset as DatePreset } from "@/lib/date-filter-presets";
export { dueDateInPreset, DATE_FILTER_PRESET_OPTIONS as DATE_PRESET_OPTIONS } from "@/lib/date-filter-presets";

export type QueueTab = "my" | "active" | "blocked" | "overdue" | "completed";

export const QUEUE_TAB_OPTIONS: { key: QueueTab; label: string }[] = [
  { key: "my", label: "My Queue" },
  { key: "active", label: "Active" },
  { key: "blocked", label: "Blocked" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Completed" },
];

export type TaskVisualWeight = "critical" | "elevated" | "normal" | "muted";

export function getTaskVisualWeight(task: TodoTask, now = new Date()): TaskVisualWeight {
  if (isCompletedWorkerTask(task)) return "muted";
  if (task.status === "BLOCKED") return "critical";
  if (isOverdueTask(task, now)) return "critical";
  if (task.priority === "high" && isOpenWorkerTask(task)) return "elevated";
  if (task.status === "IN_PROGRESS") return "elevated";
  if (isNewlyAssigned(task, now)) return "elevated";
  return "normal";
}

export function isNewlyAssigned(task: TodoTask, now = new Date()): boolean {
  if (task.status !== "TODO") return false;
  const created = new Date(task.createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return now.getTime() - created.getTime() < 24 * 60 * 60 * 1000;
}

export function matchesQueueTab(task: TodoTask, tab: QueueTab, viewerEmployeeId?: number): boolean {
  switch (tab) {
    case "my":
      return viewerEmployeeId != null && task.employeeId === viewerEmployeeId;
    case "active":
      return isOpenWorkerTask(task);
    case "blocked":
      return task.status === "BLOCKED";
    case "overdue":
      return isOverdueTask(task);
    case "completed":
      return isCompletedWorkerTask(task);
    default:
      return true;
  }
}

export function matchesWorkQueueSearch(task: TodoTask, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const visual = getTaskTypeVisual(task.taskType as string);
  const haystack = [
    task.title,
    task.description,
    task.batchName,
    task.employeeName,
    visual.label,
    task.taskType,
    task.status,
    task.priority,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function formatTaskAge(iso: string, now = new Date()): string {
  const created = new Date(iso);
  if (Number.isNaN(created.getTime())) return "";
  const ms = now.getTime() - created.getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function taskLinkPath(taskId: number): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "") || "";
  return `${base}/tasks?open=${taskId}`;
}

export type QueueSection = {
  id: string;
  label: string;
  tasks: TodoTask[];
};

export function groupActiveQueueTasks(tasks: TodoTask[]): QueueSection[] {
  const blocked: TodoTask[] = [];
  const overdue: TodoTask[] = [];
  const inProgress: TodoTask[] = [];
  const todo: TodoTask[] = [];
  const other: TodoTask[] = [];

  for (const t of tasks) {
    if (t.status === "BLOCKED") blocked.push(t);
    else if (isOverdueTask(t)) overdue.push(t);
    else if (t.status === "IN_PROGRESS") inProgress.push(t);
    else if (t.status === "TODO") todo.push(t);
    else other.push(t);
  }

  const sort = (list: TodoTask[]) => [...list].sort(compareWorkerTasks);
  const sections: QueueSection[] = [];
  if (blocked.length) sections.push({ id: "blocked", label: "Blocked", tasks: sort(blocked) });
  if (overdue.length) sections.push({ id: "overdue", label: "Overdue", tasks: sort(overdue) });
  if (inProgress.length) {
    sections.push({ id: "in_progress", label: "In progress", tasks: sort(inProgress) });
  }
  if (todo.length) sections.push({ id: "todo", label: "Ready to start", tasks: sort(todo) });
  if (other.length) sections.push({ id: "other", label: "Other", tasks: sort(other) });
  return sections;
}

export function countByQueueTab(tasks: TodoTask[], viewerEmployeeId?: number): Record<QueueTab, number> {
  return {
    my: tasks.filter((t) => matchesQueueTab(t, "my", viewerEmployeeId)).length,
    active: tasks.filter((t) => matchesQueueTab(t, "active")).length,
    blocked: tasks.filter((t) => matchesQueueTab(t, "blocked")).length,
    overdue: tasks.filter((t) => matchesQueueTab(t, "overdue")).length,
    completed: tasks.filter((t) => matchesQueueTab(t, "completed")).length,
  };
}

export { isCampaignOpsTask, isManualTask, isOverdueTask, isCompletedWorkerTask };
