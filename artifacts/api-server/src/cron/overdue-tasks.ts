// Phase 7 — overdue-tasks cron.
//
// Scans todo_tasks every CRON_INTERVAL_MS and emits one TaskOverdue
// event for each TODO/IN_PROGRESS task that:
//   - has not yet been escalated (escalatedAt IS NULL), AND
//   - is older than its workspace's `overdue_threshold_hours`
//     (default 24h, see Phase 7c note below).
//
// The event carries `dedupeKey = task_overdue:<taskId>`, so even if
// the cron tick runs twice (overlap, restart, race) the
// (workspace_id, type, dedupe_key) partial unique on `events` ensures
// we escalate each task at most once. The MarkTaskOverdue action
// inside the rule then sets `escalatedAt`, which is what removes the
// task from the next scan window — so if either the dedupe row OR
// the timestamp is present, the task is skipped.
//
// Phase 7c: threshold is per-workspace via
// `workspaces.overdue_threshold_hours` (default 24). The scan joins
// the workspace row and uses its threshold for the age comparison;
// `runOverdueTasksScan(threshold)` keeps a global override for
// tests so they don't have to seed a workspace row just to set 0h.

import { db, todoTasksTable, workspacesTable } from "@workspace/db";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { emit } from "../engine/event-bus.ts";
import { logger } from "../lib/logger.ts";

export const DEFAULT_OVERDUE_THRESHOLD_HOURS = 24;
const CRON_INTERVAL_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

/** One scan pass. Exported for tests.
 *
 *  When `thresholdOverrideHours` is provided, it forces that value for
 *  every workspace (test harness convenience). Otherwise the cutoff is
 *  computed per-row from `workspaces.overdue_threshold_hours`, so each
 *  workspace's SLA is honored independently in a single SQL pass. */
export async function runOverdueTasksScan(
  thresholdOverrideHours?: number,
): Promise<{ scanned: number; emitted: number }> {
  const thresholdExpr =
    thresholdOverrideHours == null
      ? sql`${workspacesTable.overdueThresholdHours}`
      : sql`${thresholdOverrideHours}`;
  const cutoff = sql`now() - (${thresholdExpr} || ' hours')::interval`;

  const candidates = await db
    .select({
      id: todoTasksTable.id,
      workspaceId: todoTasksTable.workspaceId,
      employeeId: todoTasksTable.employeeId,
      taskType: todoTasksTable.taskType,
      relatedBatchId: todoTasksTable.relatedBatchId,
      title: todoTasksTable.title,
      createdAt: todoTasksTable.createdAt,
    })
    .from(todoTasksTable)
    .innerJoin(workspacesTable, eq(workspacesTable.id, todoTasksTable.workspaceId))
    .where(
      and(
        inArray(todoTasksTable.status, ["TODO", "IN_PROGRESS"]),
        isNull(todoTasksTable.escalatedAt),
        lt(todoTasksTable.createdAt, cutoff),
      ),
    );

  let emitted = 0;
  const now = Date.now();

  for (const task of candidates) {
    const ageHours = (now - task.createdAt.getTime()) / 36e5;
    try {
      const result = await emit({
        type: "TaskOverdue",
        workspaceId: task.workspaceId,
        payload: {
          taskId: task.id,
          employeeId: task.employeeId,
          taskType: task.taskType,
          relatedBatchId: task.relatedBatchId,
          title: task.title,
          ageHours,
        },
        dedupeKey: `task_overdue:${task.id}`,
      });
      if (!result.deduped) emitted += 1;
    } catch (err) {
      logger.error(
        { err, taskId: task.id, workspaceId: task.workspaceId },
        "overdue-tasks: emit failed",
      );
    }
  }

  return { scanned: candidates.length, emitted };
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { scanned, emitted } = await runOverdueTasksScan();
    if (scanned > 0) {
      logger.info({ scanned, emitted }, "overdue-tasks: scan complete");
    }
  } catch (err) {
    logger.error({ err }, "overdue-tasks: scan crashed");
  } finally {
    running = false;
  }
}

export function startOverdueTasksCron(): () => void {
  if (timer) {
    return () => {
      stopOverdueTasksCronTimer();
    };
  }
  timer = setInterval(() => {
    void tick();
  }, CRON_INTERVAL_MS);
  // Don't keep the event loop alive on its own; the http server does.
  if (typeof timer.unref === "function") timer.unref();
  logger.info(
    { intervalMs: CRON_INTERVAL_MS, thresholdHours: DEFAULT_OVERDUE_THRESHOLD_HOURS },
    "overdue-tasks: cron started",
  );

  return stopOverdueTasksCronTimer;
}

function stopOverdueTasksCronTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Test-only — stop the cron between tests. */
export function _stopOverdueTasksCronForTests(): void {
  stopOverdueTasksCronTimer();
}
