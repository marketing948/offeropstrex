/**
 * Shared open-task classification for Operations Hub panels.
 * Buckets are mutually exclusive so badge total = Critical + Blocked + Overdue.
 */

import type { TodoTask } from "@workspace/api-client-react";

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isOverdueOpenTask(task: TodoTask, today: string): boolean {
  if (task.status === "DONE" || task.status === "BLOCKED") return false;
  if (!task.dueDate?.trim()) return false;
  return task.dueDate.slice(0, 10) < today;
}

export type OpenTaskCounts = {
  critical: number;
  blocked: number;
  overdue: number;
  /** Sum of the three visible category counters. */
  total: number;
  pending: number;
};

export type OpenTaskCategory = "all" | "critical" | "blocked" | "overdue";

export function classifyOpenTasks(tasks: TodoTask[], today = todayIso()): OpenTaskCounts {
  const open = tasks.filter((t) => t.status !== "DONE");
  const blocked = open.filter((t) => t.status === "BLOCKED");
  const blockedIds = new Set(blocked.map((t) => t.id));
  const remaining = open.filter((t) => !blockedIds.has(t.id));
  const overdue = remaining.filter((t) => isOverdueOpenTask(t, today));
  const overdueIds = new Set(overdue.map((t) => t.id));
  const critical = remaining.filter(
    (t) => t.priority === "high" && !overdueIds.has(t.id),
  );

  return {
    critical: critical.length,
    blocked: blocked.length,
    overdue: overdue.length,
    total: critical.length + blocked.length + overdue.length,
    pending: open.length,
  };
}

function sortTasksByUrgency(a: TodoTask, b: TodoTask, today: string): number {
  const aOver = isOverdueOpenTask(a, today) ? 1 : 0;
  const bOver = isOverdueOpenTask(b, today) ? 1 : 0;
  if (aOver !== bOver) return bOver - aOver;
  const pri = (p: TodoTask["priority"]) => (p === "high" ? 2 : p === "medium" ? 1 : 0);
  if (pri(a.priority) !== pri(b.priority)) return pri(b.priority) - pri(a.priority);
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return a.title.localeCompare(b.title);
}

/** Returns open tasks for a hub panel category (mutually exclusive buckets for counters). */
export function getOpenTasksByCategory(
  tasks: TodoTask[],
  category: OpenTaskCategory,
  today = todayIso(),
): TodoTask[] {
  const open = tasks.filter((t) => t.status !== "DONE");
  if (category === "all") {
    return [...open].sort((a, b) => sortTasksByUrgency(a, b, today));
  }

  const blocked = open.filter((t) => t.status === "BLOCKED");
  const blockedIds = new Set(blocked.map((t) => t.id));
  const remaining = open.filter((t) => !blockedIds.has(t.id));
  const overdue = remaining.filter((t) => isOverdueOpenTask(t, today));
  const overdueIds = new Set(overdue.map((t) => t.id));
  const critical = remaining.filter(
    (t) => t.priority === "high" && !overdueIds.has(t.id),
  );

  if (category === "blocked") return blocked.sort((a, b) => sortTasksByUrgency(a, b, today));
  if (category === "overdue") return overdue.sort((a, b) => sortTasksByUrgency(a, b, today));
  return critical.sort((a, b) => sortTasksByUrgency(a, b, today));
}

export const OPEN_TASK_CATEGORY_LABELS: Record<OpenTaskCategory, string> = {
  all: "All open tasks",
  critical: "Critical tasks",
  blocked: "Blocked tasks",
  overdue: "Overdue tasks",
};
