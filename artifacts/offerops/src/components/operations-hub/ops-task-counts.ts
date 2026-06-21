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
