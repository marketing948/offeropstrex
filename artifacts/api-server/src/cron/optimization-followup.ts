// Pivot Phase 4 (Task #27) — optimization-followup cron.
//
// The happy path for OPTIMIZATION_FOLLOWUP task creation is the
// CampaignStatusChanged rule: when both campaigns flip to `live`,
// the rule schedules the task with dueDate = live_at +
// test_duration_hours. This cron is the safety net — it scans for
// batches whose `live_at + test_duration_hours` has already passed
// AND which still have NO open OPTIMIZATION_FOLLOWUP task, and emits
// `OptimizationDue` so the rule re-creates the task. Idempotent via
// dedupe key `optimization:<batchId>`.

import {
  campaignsTable,
  db,
  testingBatchesTable,
  todoTasksTable,
} from "@workspace/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { emit } from "../engine/event-bus.ts";
import { logger } from "../lib/logger.ts";

const CRON_INTERVAL_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

/** One scan pass. Exported for tests. */
export async function runOptimizationFollowupScan(): Promise<{
  scanned: number;
  emitted: number;
}> {
  // Find batches where:
  //   - liveAt is set AND now >= liveAt + (test_duration_hours hours), AND
  //   - both ios AND android campaigns are live, AND
  //   - no existing OPTIMIZATION_FOLLOWUP task for the batch.
  const candidates = await db
    .select({
      id: testingBatchesTable.id,
      workspaceId: testingBatchesTable.workspaceId,
    })
    .from(testingBatchesTable)
    .where(
      and(
        isNotNull(testingBatchesTable.liveAt),
        sql`now() >= ${testingBatchesTable.liveAt} + (coalesce(${testingBatchesTable.testDurationHours}, 48) || ' hours')::interval`,
        sql`exists (
          select 1 from ${campaignsTable} c
          where c.batch_id = ${testingBatchesTable.id}
            and c.workspace_id = ${testingBatchesTable.workspaceId}
            and c.platform = 'ios' and c.status = 'live'
        )`,
        sql`exists (
          select 1 from ${campaignsTable} c
          where c.batch_id = ${testingBatchesTable.id}
            and c.workspace_id = ${testingBatchesTable.workspaceId}
            and c.platform = 'android' and c.status = 'live'
        )`,
        sql`not exists (
          select 1 from ${todoTasksTable} t
          where t.related_batch_id = ${testingBatchesTable.id}
            and t.workspace_id = ${testingBatchesTable.workspaceId}
            and t.task_type = 'OPTIMIZATION_FOLLOWUP'
        )`,
      ),
    );

  let emitted = 0;
  for (const b of candidates) {
    try {
      const result = await emit({
        type: "OptimizationDue",
        workspaceId: b.workspaceId,
        payload: { batchId: b.id },
        dedupeKey: `optimization:${b.id}`,
      });
      if (!result.deduped) emitted += 1;
    } catch (err) {
      logger.error(
        { err, batchId: b.id, workspaceId: b.workspaceId },
        "optimization-followup: emit failed",
      );
    }
  }

  return { scanned: candidates.length, emitted };
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { scanned, emitted } = await runOptimizationFollowupScan();
    if (scanned > 0) {
      logger.info(
        { scanned, emitted },
        "optimization-followup: scan complete",
      );
    }
  } catch (err) {
    logger.error({ err }, "optimization-followup: scan crashed");
  } finally {
    running = false;
  }
}

/** Start the cron. Idempotent — safe to call once at server boot. */
export function startOptimizationFollowupCron(): () => void {
  if (timer) {
    return () => {
      stopOptimizationFollowupCronTimer();
    };
  }
  timer = setInterval(() => {
    void tick();
  }, CRON_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info(
    { intervalMs: CRON_INTERVAL_MS },
    "optimization-followup: cron started",
  );

  return stopOptimizationFollowupCronTimer;
}

function stopOptimizationFollowupCronTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Test-only — stop the cron between tests. */
export function _stopOptimizationFollowupCronForTests(): void {
  stopOptimizationFollowupCronTimer();
}
