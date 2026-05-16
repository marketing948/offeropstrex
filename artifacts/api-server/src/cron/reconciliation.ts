// SPEC Phase 1 — reconciliation cron.
//
// Mirrors the cron/overdue-tasks.ts pattern: 15-minute interval,
// non-overlapping ticks (skipped if the previous tick is still
// running), unref'd timer so it doesn't keep the event loop alive
// independently of the http server.
//
// Per-tick behavior: walk every workspace and run reconcileWorkspace
// with autoGroupOffersIntoBatches as the orphan-offer self-heal
// callback. Aggregate counts are logged at INFO when any violations
// are found, otherwise the per-workspace logs are sufficient.

import { db, workspacesTable } from "@workspace/db";
import { logger } from "../lib/logger.ts";
import { reconcileWorkspace } from "../engine/reconciliation/index.ts";
import { autoGroupOffersIntoBatches } from "../routes/sync.ts";
import { isVoluumEnabled } from "../lib/feature-flags.ts";

const CRON_INTERVAL_MS = 15 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

export interface ReconcileSweepResult {
  workspaces: number;
  invariant1Violations: number;
  invariant2Violations: number;
  invariant3Violations: number;
  // Pivot Phase 4 (Task #27):
  //  - invariant4: every NEW_BATCH has the CREATE_IOS_CAMPAIGN +
  //    CREATE_ANDROID_CAMPAIGN task pair.
  //  - invariant5: every batch whose ios + android campaigns are both
  //    in `ready` state has an open GO_LIVE task.
  invariant4Violations: number;
  invariant5Violations: number;
}

/** One sweep across every workspace. Exported for tests + the cron tick. */
export async function runReconciliationSweep(): Promise<ReconcileSweepResult> {
  const workspaces = await db
    .select({ id: workspacesTable.id })
    .from(workspacesTable);

  const sweep: ReconcileSweepResult = {
    workspaces: workspaces.length,
    invariant1Violations: 0,
    invariant2Violations: 0,
    invariant3Violations: 0,
    invariant4Violations: 0,
    invariant5Violations: 0,
  };

  // Pivot Phase 0 — Voluum-driven auto-grouping is gated. When Voluum is
  // off, run reconciliation invariants only and skip the orphan-offer
  // self-heal callback (which is Voluum-derived).
  const voluumOn = isVoluumEnabled();
  for (const ws of workspaces) {
    try {
      const result = await reconcileWorkspace(
        ws.id,
        logger.child({ workspaceId: ws.id }),
        voluumOn
          ? {
              runAutoGroup: async (workspaceId, log) => {
                // autoGroupOffersIntoBatches uses a route-style log object
                // with `info`/`warn`/`error`; the pino child satisfies that
                // shape.
                await autoGroupOffersIntoBatches(workspaceId, log as never);
              },
            }
          : {},
      );
      sweep.invariant1Violations += result.invariant1Violations;
      sweep.invariant2Violations += result.invariant2Violations;
      sweep.invariant3Violations += result.invariant3Violations;
      sweep.invariant4Violations += result.invariant4Violations;
      sweep.invariant5Violations += result.invariant5Violations;
    } catch (err) {
      logger.error({ err, workspaceId: ws.id }, "reconciliation: workspace sweep crashed");
    }
  }

  return sweep;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runReconciliationSweep();
    if (
      result.invariant1Violations > 0 ||
      result.invariant2Violations > 0 ||
      result.invariant3Violations > 0 ||
      result.invariant4Violations > 0 ||
      result.invariant5Violations > 0
    ) {
      logger.info(result, "reconciliation: sweep complete (violations found)");
    } else if (result.workspaces > 0) {
      logger.info(result, "reconciliation: sweep complete (clean)");
    }
  } catch (err) {
    logger.error({ err }, "reconciliation: sweep crashed");
  } finally {
    running = false;
  }
}

/** Start the reconciliation cron. Idempotent — safe to call once at server boot. */
export function startReconciliationCron(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, CRON_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ intervalMs: CRON_INTERVAL_MS }, "reconciliation: cron started");
}

/** Test-only — stop the cron between tests. */
export function _stopReconciliationCronForTests(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
