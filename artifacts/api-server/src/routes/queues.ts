// Phase 9-hard followup: rewritten on the spec-canonical 6-state batch
// lifecycle (NEW_BATCH / WAITING_FOR_TRACKER_CAMPAIGNS /
// OFFER_READY_FOR_LIVE_TESTING / LIVE_TESTS / TESTED / COMPLETED) and
// the spec-canonical 4-state offer enum (imported / tested / winner /
// loser). The legacy enum literals ("draft", "live_testing", "ready",
// "ready_for_optimization", "optimizing", "completed",
// "moved_to_next_source", "scaling", "main_campaign") were dropped in
// Phase 2 and live queries against them were 500'ing in production.
//
// The frontend ops-queue.tsx still consumes the historical
// QueueSummary shape (liveTesting / readyForOptimization / optimizing
// / retestsPending / scaling). We keep that shape so the FE keeps
// rendering, and re-map each lane to a sensible new-enum slice:
//   liveTesting          → batches in LIVE_TESTS
//   readyForOptimization → batches in TESTED (ready for FIND_WINNERS)
//   optimizing           → [] (concept retired in spec)
//   retestsPending       → [] (offer "retest" status removed in spec)
//   scaling              → batches in COMPLETED
//
// AST mutation lint passes — this route only reads, and the read
// shapes don't touch engine-owned write paths.
import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, testingBatchesTable, employeesTable, offersTable } from "@workspace/db";
import { requireWorkspaceFromQuery } from "../lib/workspace-access";

const router: IRouter = Router();

type BatchStatusLiteral =
  | "NEW_BATCH"
  | "WAITING_FOR_TRACKER_CAMPAIGNS"
  | "OFFER_READY_FOR_LIVE_TESTING"
  | "LIVE_TESTS"
  | "TESTED"
  | "COMPLETED";

async function getBatchesForStatuses(
  statuses: BatchStatusLiteral[],
  workspaceId: number,
  employeeId?: number,
) {
  if (statuses.length === 0) return [];

  const conditions = [
    inArray(testingBatchesTable.status, statuses),
    eq(testingBatchesTable.workspaceId, workspaceId),
  ];
  if (employeeId) {
    conditions.push(eq(testingBatchesTable.employeeId, employeeId));
  }

  const rows = await db
    .select({ batch: testingBatchesTable, employeeName: employeesTable.name })
    .from(testingBatchesTable)
    .leftJoin(employeesTable, eq(testingBatchesTable.employeeId, employeesTable.id))
    .where(and(...conditions))
    .orderBy(testingBatchesTable.createdAt);

  const batchIds = rows.map((r) => r.batch.id);
  if (batchIds.length === 0) return [];

  const offers = await db
    .select()
    .from(offersTable)
    .where(inArray(offersTable.batchId, batchIds));

  return rows.map((r) => {
    const batchOffers = offers.filter((o) => o.batchId === r.batch.id);
    const offerCounts = {
      total: batchOffers.length,
      winner: batchOffers.filter((o) => o.status === "winner").length,
      loser: batchOffers.filter((o) => o.status === "loser").length,
      retest: 0,
      pending: batchOffers.filter((o) => o.status === "imported").length,
    };

    return {
      id: r.batch.id,
      batchName: r.batch.batchName,
      affiliateNetwork: r.batch.affiliateNetwork,
      geo: r.batch.geo,
      trafficSource: r.batch.trafficSource,
      status: r.batch.status,
      employeeId: r.batch.employeeId,
      employeeName: r.employeeName ?? null,
      createdAt: r.batch.createdAt.toISOString(),
      liveAt: r.batch.liveAt ? r.batch.liveAt.toISOString() : null,
      conditionsMetAt: r.batch.conditionsMetAt
        ? r.batch.conditionsMetAt.toISOString()
        : null,
      clicksThreshold: r.batch.clicksThreshold,
      spendThreshold:
        r.batch.spendThreshold != null ? Number(r.batch.spendThreshold) : null,
      daysThreshold: r.batch.daysThreshold,
      offerCounts,
    };
  });
}

router.get("/queues", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const employeeId = req.query.employee_id
    ? Number(req.query.employee_id)
    : undefined;

  const [liveTesting, readyForOptimization, scaling] = await Promise.all([
    getBatchesForStatuses(["LIVE_TESTS"], workspaceId, employeeId),
    getBatchesForStatuses(["TESTED"], workspaceId, employeeId),
    getBatchesForStatuses(["COMPLETED"], workspaceId, employeeId),
  ]);

  res.json({
    liveTesting,
    readyForOptimization,
    optimizing: [],
    retestsPending: [],
    scaling,
  });
});

export default router;
