import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, performanceTable, testingBatchesTable } from "@workspace/db";
import {
  CreatePerformanceBody,
  UpdatePerformanceBody,
  UpdatePerformanceParams,
  DeletePerformanceParams,
  ListPerformanceQueryParams,
} from "@workspace/api-zod";
import { requireWorkspaceFromQuery, requireWorkspaceAccess } from "../lib/workspace-access";
import {
  queryPerformanceListRows,
  resolveMetricsDateRange,
} from "../lib/campaign-daily-metrics-aggregate.ts";

const router: IRouter = Router();

function serializePerf(perf: typeof performanceTable.$inferSelect) {
  return {
    ...perf,
    spend: perf.spend != null ? Number(perf.spend) : null,
    revenue: perf.revenue != null ? Number(perf.revenue) : null,
    profit: perf.profit != null ? Number(perf.profit) : null,
    roi: perf.roi != null ? Number(perf.roi) : null,
    cpa: perf.cpa != null ? Number(perf.cpa) : null,
    epc: perf.epc != null ? Number(perf.epc) : null,
    cvr: perf.cvr != null ? Number(perf.cvr) : null,
  };
}

// GET /performance reads imported Voluum daily metrics (campaign_daily_metrics).
// Visits are exposed as `clicks` for backward-compatible API shape.
router.get("/performance", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const params = ListPerformanceQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const range = resolveMetricsDateRange(params.data.date_from, params.data.date_to);
  if ("error" in range) {
    res.status(400).json({ error: range.error });
    return;
  }

  const rows = await queryPerformanceListRows({
    workspaceId,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    batchId: params.data.batch_id,
  });

  res.json(rows);
});

router.post("/performance", async (req, res): Promise<void> => {
  const parsed = CreatePerformanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Performance rows do not carry workspaceId directly; derive it from the parent batch.
  const [batch] = await db.select({ workspaceId: testingBatchesTable.workspaceId })
    .from(testingBatchesTable).where(eq(testingBatchesTable.id, parsed.data.batchId));
  if (!batch) { res.status(404).json({ error: "Parent batch not found" }); return; }
  if ((await requireWorkspaceAccess(req, res, batch.workspaceId)) === null) return;

  const [record] = await db.insert(performanceTable).values(parsed.data as typeof performanceTable.$inferInsert).returning();
  res.status(201).json(serializePerf(record));
});

router.patch("/performance/:id", async (req, res): Promise<void> => {
  const params = UpdatePerformanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdatePerformanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select({ workspaceId: testingBatchesTable.workspaceId })
    .from(performanceTable)
    .innerJoin(testingBatchesTable, eq(performanceTable.batchId, testingBatchesTable.id))
    .where(eq(performanceTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Performance record not found" }); return; }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  // SPEC Phase 1 (T006): defense-in-depth — re-scope the update via the
  // already-verified workspaceId so a TOCTOU race (performance row
  // re-parented between the pre-check SELECT and this UPDATE) cannot
  // mutate a row outside the caller's workspace.
  const [record] = await db
    .update(performanceTable)
    .set(parsed.data as Partial<typeof performanceTable.$inferInsert>)
    .where(and(
      eq(performanceTable.id, params.data.id),
      sql`exists (select 1 from testing_batches tb where tb.id = ${performanceTable.batchId} and tb.workspace_id = ${existing.workspaceId})`,
    ))
    .returning();

  if (!record) {
    res.status(404).json({ error: "Performance record not found" });
    return;
  }

  res.json(serializePerf(record));
});

router.delete("/performance/:id", async (req, res): Promise<void> => {
  const params = DeletePerformanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select({ workspaceId: testingBatchesTable.workspaceId })
    .from(performanceTable)
    .innerJoin(testingBatchesTable, eq(performanceTable.batchId, testingBatchesTable.id))
    .where(eq(performanceTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Performance record not found" }); return; }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  const [record] = await db
    .delete(performanceTable)
    .where(and(
      eq(performanceTable.id, params.data.id),
      sql`exists (select 1 from testing_batches tb where tb.id = ${performanceTable.batchId} and tb.workspace_id = ${existing.workspaceId})`,
    ))
    .returning();

  if (!record) {
    res.status(404).json({ error: "Performance record not found" });
    return;
  }

  res.json({ success: true });
});

export default router;
