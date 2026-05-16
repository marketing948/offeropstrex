import { Router, type IRouter } from "express";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { db, performanceTable, testingBatchesTable, batchResultsTable } from "@workspace/db";
import {
  CreatePerformanceBody,
  UpdatePerformanceBody,
  UpdatePerformanceParams,
  DeletePerformanceParams,
  ListPerformanceQueryParams,
} from "@workspace/api-zod";
import { requireWorkspaceFromQuery, requireWorkspaceAccess } from "../lib/workspace-access";

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

// Pivot Phase 6 (Task #29): GET /performance now sources its rows
// from `batch_results` (the manual P&L table) instead of the legacy
// Voluum-derived `performance` table. The Performance shape is kept
// intact so existing callers (ops-queue, reports, performance pages)
// continue to work unchanged — only the data origin changes.
//
// Mapping per row:
//   id          → batch_results.id
//   batchId     → batch_results.batch_id
//   date        → DATE(batch_results.created_at) as text (YYYY-MM-DD)
//   spend       → batch_results.cost
//   clicks      → batch_results.clicks
//   conversions → batch_results.conversions
//   revenue     → batch_results.revenue
//   profit      → revenue - cost (computed)
//   roi         → batch_results.roi
//   cpa, epc,
//   cvr         → derived (cost/conv, revenue/clicks, conv/clicks)
router.get("/performance", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const params = ListPerformanceQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [eq(batchResultsTable.workspaceId, workspaceId)];
  if (params.data.batch_id) {
    conditions.push(eq(batchResultsTable.batchId, params.data.batch_id));
  }
  if (params.data.date_from) {
    conditions.push(gte(batchResultsTable.createdAt, new Date(`${params.data.date_from}T00:00:00.000Z`)));
  }
  if (params.data.date_to) {
    const next = new Date(`${params.data.date_to}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    conditions.push(lt(batchResultsTable.createdAt, next));
  }

  const rows = await db
    .select({
      id: batchResultsTable.id,
      batchId: batchResultsTable.batchId,
      date: sql<string>`to_char(${batchResultsTable.createdAt}, 'YYYY-MM-DD')`,
      cost: batchResultsTable.cost,
      clicks: batchResultsTable.clicks,
      conversions: batchResultsTable.conversions,
      revenue: batchResultsTable.revenue,
      roi: batchResultsTable.roi,
    })
    .from(batchResultsTable)
    .innerJoin(testingBatchesTable, eq(batchResultsTable.batchId, testingBatchesTable.id))
    .where(and(...conditions))
    .orderBy(batchResultsTable.createdAt);

  res.json(rows.map(r => {
    const cost = Number(r.cost ?? 0);
    const revenue = Number(r.revenue ?? 0);
    const profit = revenue - cost;
    const clicks = r.clicks ?? 0;
    const conversions = r.conversions ?? 0;
    const cpa = conversions > 0 ? cost / conversions : null;
    const epc = clicks > 0 ? revenue / clicks : null;
    const cvr = clicks > 0 ? (conversions / clicks) * 100 : null;
    return {
      id: r.id,
      batchId: r.batchId,
      date: r.date,
      spend: cost,
      clicks,
      conversions,
      revenue,
      profit,
      roi: r.roi != null ? Number(r.roi) : null,
      cpa,
      epc,
      cvr,
    };
  }));
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
    .where(eq(performanceTable.id, params.data.id))
    .returning();

  if (!record) {
    res.status(404).json({ error: "Performance record not found" });
    return;
  }

  res.json({ success: true });
});

export default router;
