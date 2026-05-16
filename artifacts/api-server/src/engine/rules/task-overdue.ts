// Phase 7 — TaskOverdue rule.
//
// The overdue-tasks cron emits one TaskOverdue per crossing-the-SLA
// task, deduped on `task_overdue:<taskId>`. This rule converts that
// signal into the engine's two visible side effects:
//   1. MarkTaskOverdue   — sets flashing=true + escalatedAt=now on the
//                          task row (worker UI surfaces this).
//   2. CreateNotification — TASK_OVERDUE for the task's assignee, with
//                          severity=high so it sorts above routine
//                          notifications in the inbox.
//
// The producer carries the full payload (employeeId, taskType, title,
// ageHours) so the rule never has to re-read the task. That keeps the
// rule branch-free and lets the cron decide what counts as "overdue"
// in one place.

import type { Action, EventInput, Tx } from "../types.ts";

type TaskOverdueEvent = Extract<EventInput, { type: "TaskOverdue" }>;

export function handleTaskOverdue(
  event: TaskOverdueEvent,
  _tx: Tx,
): Action[] {
  const { workspaceId, payload } = event;

  return [
    {
      type: "MarkTaskOverdue",
      taskId: payload.taskId,
    },
    {
      type: "CreateNotification",
      workspaceId,
      data: {
        employeeId: payload.employeeId,
        batchId: payload.relatedBatchId,
        type: "TASK_OVERDUE",
        severity: "high",
        message: `Task "${payload.title}" is overdue (${Math.round(
          payload.ageHours,
        )}h old).`,
      },
    },
  ];
}
