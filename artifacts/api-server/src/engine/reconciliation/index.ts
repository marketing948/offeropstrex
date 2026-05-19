// SPEC Phase 1 — reconciliation skeleton.
//
// Reconciliation is the engine's safety net: a periodic verification
// pass that re-asserts the canonical invariants from docs/SPEC.md and
// surfaces drift. Phase 1 ships the SKELETON: it only INSPECTS state
// and logs violations. Phase 2 (tracker-campaign tasks) and Phase 3
// (winners flow) will wire corrective events for the violation classes
// each phase owns.
//
// Why pure verification in Phase 1?
//   - Corrective events for invariants 1 + 2 require new event types
//     ("BatchTrafficSourceMissing", "TrackerTasksMissing") whose
//     handler logic is part of Phase 2 — emitting them now would mean
//     dispatching to a no-op handler, which is improvisation outside
//     the strict spec scope.
//   - Invariant 3 is already enforced inline by the Voluum sync via
//     `autoGroupOffersIntoBatches`; reconciliation re-runs it from
//     the cron path so workspaces with no recent sync still self-heal.
//
// Idempotency: a second invocation on a healthy workspace returns the
// same `{0, 0, 0}` violation counts and emits no new events.
//
// Invariants checked:
//   1. RETIRED — `testing_batches.currentTrafficSourceId` is part of the
//      dormant Voluum auto-grouping flow and is no longer populated by the
//      manual CampaignOps workflow. The field stays in the schema so the
//      Voluum layer can be re-enabled, but reconciliation no longer flags
//      its absence (every healthy new-flow batch would otherwise trip).
//      `invariant1Violations` is preserved on the result for log/metric
//      back-compat and is always 0.
//   2. Every active batch with a currentWorkspaceTrafficSourceId
//      batches only — empty in the manual flow) has exactly one OPEN
//      (TODO|IN_PROGRESS) `CREATE_IOS_TRACKER_CAMPAIGN` task and one OPEN
//      `CREATE_ANDROID_TRACKER_CAMPAIGN` task scoped to that batch +
//      traffic source.
//   3. Every voluum_offer carrying a valid tag is attached to a batch
//      (delegated to autoGroupOffersIntoBatches when the caller passes
//      a runAutoGroup callback; reconciliation itself never imports
//      from routes/* to avoid cycles).
//   4. Every NEW_BATCH-status batch has one OPEN
//      `create_voluum_campaign_ios` AND one OPEN
//      `create_voluum_campaign_android` task — the CampaignOps task pair
//      seeded by the BatchCreated rule.
//   5. Any batch with both ios+android campaigns in `ready` has a
//      GO_LIVE task. (Legacy ready→GO_LIVE flow; no-ops in the new
//      voluum_created → live pipeline because campaigns never enter
//      `ready`.)

import { campaignsTable, db, testingBatchesTable, todoTasksTable, voluumOffersTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Logger } from "pino";
import {
  recordReconciliationViolationOperationalEvents,
  type ReconciliationViolationOperationalInput,
} from "../../lib/campaignops-operational-events.ts";

export interface ReconcileResult {
  workspaceId: number;
  invariant1Violations: number;
  invariant2Violations: number;
  invariant3Violations: number;
  /** Pivot Phase 4 (Task #27): NEW_BATCH-status batches missing one or
   *  both manual CREATE_*_CAMPAIGN tasks. */
  invariant4Violations: number;
  /** Pivot Phase 4 (Task #27): batches whose ios + android campaigns
   *  are both `ready` but no GO_LIVE task exists. */
  invariant5Violations: number;
  /** True when an autoGroup callback was provided AND it ran. */
  autoGroupRan: boolean;
}

export interface ReconcileOptions {
  /** Optional callback so the cron can pass autoGroupOffersIntoBatches
   *  without this module taking a dependency on routes/*. */
  runAutoGroup?: (workspaceId: number, log: Logger) => Promise<unknown>;
}

const ACTIVE_BATCH_STATUSES = [
  "NEW_BATCH",
  "WAITING_FOR_TRACKER_CAMPAIGNS",
  "OFFER_READY_FOR_LIVE_TESTING",
  "LIVE_TESTS",
  "TESTED",
] as const;

export async function reconcileWorkspace(
  workspaceId: number,
  log: Logger,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const reconciliationPassAt = new Date();
  const operationalViolations: ReconciliationViolationOperationalInput[] = [];
  const result: ReconcileResult = {
    workspaceId,
    invariant1Violations: 0,
    invariant2Violations: 0,
    invariant3Violations: 0,
    invariant4Violations: 0,
    invariant5Violations: 0,
    autoGroupRan: false,
  };

  // Invariant 3: orphan-offer self-heal. Delegated to the caller-
  // provided autoGroup callback so this module stays free of route
  // imports. The caller (sync.ts / cron) decides whether re-running
  // is appropriate (e.g. cron always runs it; sync.ts skips because
  // sync just ran it).
  if (options.runAutoGroup) {
    try {
      await options.runAutoGroup(workspaceId, log);
      result.autoGroupRan = true;
    } catch (err) {
      log.error({ err, workspaceId }, "[Reconcile] autoGroup callback failed");
    }
  }

  // Re-count orphan offers AFTER the autoGroup pass to report the
  // post-fixup violation count (zero on a healthy workspace).
  const [orphanRow] = await db
    .select({ count: sql<number>`coalesce(count(*), 0)` })
    .from(voluumOffersTable)
    .where(
      and(
        eq(voluumOffersTable.workspaceId, workspaceId),
        eq(voluumOffersTable.isActive, true),
        isNull(voluumOffersTable.batchId),
        isNotNull(voluumOffersTable.primaryTag),
      ),
    );
  result.invariant3Violations = Number(orphanRow?.count ?? 0);
  if (result.invariant3Violations > 0) {
    log.warn(
      { workspaceId, count: result.invariant3Violations },
      "[Reconcile] invariant 3: tagged offers not attached to any batch",
    );
    operationalViolations.push({
      workspaceId,
      invariant: "invariant3",
      violationCount: result.invariant3Violations,
      reconciliationPassAt,
    });
  }

  // Load every active batch in this workspace once.
  const activeBatches = await db
    .select({
      id: testingBatchesTable.id,
      batchTag: testingBatchesTable.batchTag,
      status: testingBatchesTable.status,
      currentTrafficSourceId: testingBatchesTable.currentTrafficSourceId,
      currentWorkspaceTrafficSourceId: testingBatchesTable.currentWorkspaceTrafficSourceId,
    })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.workspaceId, workspaceId),
        ne(testingBatchesTable.status, "COMPLETED"),
        inArray(testingBatchesTable.status, [...ACTIVE_BATCH_STATUSES]),
      ),
    );

  // Invariant 1: RETIRED. `currentTrafficSourceId` is dormant Voluum-only
  // state; the manual CampaignOps flow never sets it, so flagging its
  // absence produced a WARN per batch on every sweep with no actionable
  // signal. The counter stays on the result (always 0) for log/metric
  // back-compat. Re-enabling Voluum does NOT need to revive this check —
  // invariant 2 already guards the Voluum task pair when
  // `currentTrafficSourceId` is set.

  // Invariant 2: each active batch with a currentWorkspaceTrafficSourceId must have
  // exactly one OPEN ios + one OPEN android tracker-creation task scoped
  // to the (batch, currentTS) pair.
  const eligible = activeBatches.filter((b) => b.currentWorkspaceTrafficSourceId != null);
  if (eligible.length > 0) {
    const eligibleBatchIds = eligible.map((b) => b.id);
    const taskRows = await db
      .select({
        relatedBatchId: todoTasksTable.relatedBatchId,
        trafficSourceId: todoTasksTable.trafficSourceId,
        taskType: todoTasksTable.taskType,
        device: todoTasksTable.trackerCampaignDevice,
      })
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.workspaceId, workspaceId),
          inArray(todoTasksTable.status, ["TODO", "IN_PROGRESS"]),
          isNotNull(todoTasksTable.relatedBatchId),
          inArray(todoTasksTable.relatedBatchId, eligibleBatchIds),
          inArray(todoTasksTable.taskType, [
            "CREATE_IOS_TRACKER_CAMPAIGN",
            "CREATE_ANDROID_TRACKER_CAMPAIGN",
          ]),
        ),
      );

    // Count OPEN tracker-creation tasks per (batchId, trafficSourceId, device).
    // Invariant 2 requires EXACTLY ONE per device, so we flag both
    // missing slots AND duplicates. The partial unique index on
    // todo_tasks blocks new duplicates at write time, but pre-existing
    // rows or a future code path that bypassed the index would surface
    // here.
    const countByKey = new Map<string, { ios: number; android: number }>();
    for (const t of taskRows) {
      if (t.relatedBatchId == null || t.trafficSourceId == null || t.device == null) continue;
      const key = `${t.relatedBatchId}::${t.trafficSourceId}`;
      const counts = countByKey.get(key) ?? { ios: 0, android: 0 };
      counts[t.device] += 1;
      countByKey.set(key, counts);
    }

    const violatingBatches: Array<{
      batchId: number;
      trafficSourceId: number;
      issues: string[];
    }> = [];
    for (const b of eligible) {
      const key = `${b.id}::${b.currentWorkspaceTrafficSourceId}`;
      const counts = countByKey.get(key) ?? { ios: 0, android: 0 };
      const issues: string[] = [];
      if (counts.ios === 0) issues.push("missing_ios");
      else if (counts.ios > 1) issues.push(`duplicate_ios:${counts.ios}`);
      if (counts.android === 0) issues.push("missing_android");
      else if (counts.android > 1) issues.push(`duplicate_android:${counts.android}`);
      if (issues.length > 0) {
        result.invariant2Violations += 1;
        violatingBatches.push({
          batchId: b.id,
          trafficSourceId: b.currentWorkspaceTrafficSourceId as number,
          issues,
        });
      }
    }
    if (violatingBatches.length > 0) {
      log.warn(
        { workspaceId, violatingBatches },
        "[Reconcile] invariant 2: active batches missing tracker-creation tasks — Phase 2 will emit TrackerTasksMissing",
      );
      operationalViolations.push({
        workspaceId,
        invariant: "invariant2",
        violationCount: result.invariant2Violations,
        affectedBatchIds: violatingBatches.map((row) => row.batchId),
        reconciliationPassAt,
      });
    }
  }

  // Invariant 4 (CampaignOps redesign): every NEW_BATCH-status batch must
  // have one OPEN `create_voluum_campaign_ios` AND one OPEN
  // `create_voluum_campaign_android` task — the auto-task pair seeded by
  // the BatchCreated rule. Drift means the rule short-circuited mid-tx.
  // Pure verification; corrective re-emit lives outside this skeleton.
  const newBatches = activeBatches.filter((b) => b.status === "NEW_BATCH");
  if (newBatches.length > 0) {
    const newBatchIds = newBatches.map((b) => b.id);
    const campaignTaskRows = await db
      .select({
        relatedBatchId: todoTasksTable.relatedBatchId,
        taskType: todoTasksTable.taskType,
      })
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.workspaceId, workspaceId),
          inArray(todoTasksTable.status, ["TODO", "IN_PROGRESS"]),
          isNotNull(todoTasksTable.relatedBatchId),
          inArray(todoTasksTable.relatedBatchId, newBatchIds),
          inArray(todoTasksTable.taskType, [
            "create_voluum_campaign_ios",
            "create_voluum_campaign_android",
          ]),
        ),
      );
    // Count OPEN tasks per (batch, device). Invariant 4 requires
    // EXACTLY ONE per device, so we surface BOTH missing slots and
    // duplicates (mirroring invariant 2's cardinality check). The
    // partial unique index on todo_tasks blocks new duplicates at write
    // time, but pre-existing rows or a future bypass would surface here.
    const countPerBatch = new Map<number, { ios: number; android: number }>();
    for (const t of campaignTaskRows) {
      if (t.relatedBatchId == null) continue;
      const cur = countPerBatch.get(t.relatedBatchId) ?? { ios: 0, android: 0 };
      if (t.taskType === "create_voluum_campaign_ios") cur.ios += 1;
      if (t.taskType === "create_voluum_campaign_android") cur.android += 1;
      countPerBatch.set(t.relatedBatchId, cur);
    }
    const violating4: Array<{ batchId: number; issues: string[] }> = [];
    for (const b of newBatches) {
      const counts = countPerBatch.get(b.id) ?? { ios: 0, android: 0 };
      const issues: string[] = [];
      if (counts.ios === 0) issues.push("missing_ios");
      else if (counts.ios > 1) issues.push(`duplicate_ios:${counts.ios}`);
      if (counts.android === 0) issues.push("missing_android");
      else if (counts.android > 1) issues.push(`duplicate_android:${counts.android}`);
      if (issues.length > 0) {
        result.invariant4Violations += 1;
        violating4.push({ batchId: b.id, issues });
      }
    }
    if (violating4.length > 0) {
      log.warn(
        { workspaceId, violating: violating4 },
        "[Reconcile] invariant 4: NEW_BATCH batches with missing or duplicate create_voluum_campaign_* tasks",
      );
      operationalViolations.push({
        workspaceId,
        invariant: "invariant4",
        violationCount: result.invariant4Violations,
        affectedBatchIds: violating4.map((row) => row.batchId),
        reconciliationPassAt,
      });
    }
  }

  // Pivot Phase 4 (Task #27) — invariant 5: any batch with BOTH
  // campaigns in `ready` must have one GO_LIVE task in any state.
  // Drift means the CampaignStatusChanged rule failed to fire.
  const readyPairs = await db
    .select({
      batchId: campaignsTable.batchId,
      readyCount: sql<number>`coalesce(count(*), 0)`,
    })
    .from(campaignsTable)
    .where(
      and(
        eq(campaignsTable.workspaceId, workspaceId),
        eq(campaignsTable.status, "ready"),
        isNotNull(campaignsTable.batchId),
      ),
    )
    .groupBy(campaignsTable.batchId)
    .having(sql`count(*) >= 2`);
  if (readyPairs.length > 0) {
    const readyBatchIds = readyPairs
      .map((r) => r.batchId)
      .filter((id): id is number => id != null);
    const goLiveTasks = await db
      .select({ relatedBatchId: todoTasksTable.relatedBatchId })
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.workspaceId, workspaceId),
          eq(todoTasksTable.taskType, "GO_LIVE"),
          isNotNull(todoTasksTable.relatedBatchId),
          inArray(todoTasksTable.relatedBatchId, readyBatchIds),
        ),
      );
    const haveGoLive = new Set(goLiveTasks.map((t) => t.relatedBatchId));
    const missingGoLive: number[] = [];
    for (const id of readyBatchIds) {
      if (!haveGoLive.has(id)) {
        result.invariant5Violations += 1;
        missingGoLive.push(id);
      }
    }
    if (missingGoLive.length > 0) {
      log.warn(
        { workspaceId, batchIds: missingGoLive },
        "[Reconcile] invariant 5: ready+ready campaign batches missing GO_LIVE task",
      );
      operationalViolations.push({
        workspaceId,
        invariant: "invariant5",
        violationCount: result.invariant5Violations,
        affectedBatchIds: missingGoLive,
        reconciliationPassAt,
      });
    }
  }

  await recordReconciliationViolationOperationalEvents(operationalViolations);

  log.info(
    {
      workspaceId,
      invariant1Violations: result.invariant1Violations,
      invariant2Violations: result.invariant2Violations,
      invariant3Violations: result.invariant3Violations,
      invariant4Violations: result.invariant4Violations,
      invariant5Violations: result.invariant5Violations,
      autoGroupRan: result.autoGroupRan,
    },
    "[Reconcile] pass complete",
  );

  return result;
}
