// Pivot Phase 4 (Task #27) — minimal manual `batch_results` write
// surface. The unique (batchId) constraint on batch_results means a
// single POST behaves as upsert from the worker's POV: posting twice
// to the same batch updates the existing row. Either path emits
// `BatchResultsRecorded`, which the rule turns into a
// MOVE_WINNERS_TO_SCALED_CAMPAIGN task when winnersCount > 0 OR
// roi > 0. The bus dedupes via key `batch_results:<batchId>`, so
// re-recording results never produces duplicate tasks.
//
// `batch_results` is NOT in FORBIDDEN_TABLES so the route writes
// directly. Engine-owned follow-ups (todo_tasks) flow through emit()
// → rule → executor only.

import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, batchResultsTable, testingBatchesTable } from "@workspace/db";
import { z } from "zod/v4";
import { requireWorkspaceAccess } from "../lib/workspace-access";
import { emit } from "../engine/event-bus";

const router: IRouter = Router();

// Pivot Phase 4 (Task #27): Zod-validated POST body. Phase 5's UI
// will switch to the generated `insertBatchResultSchema`.
const numericString = z
  .union([z.number(), z.string()])
  .transform((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : null;
  })
  .pipe(z.string().nullable());

const postBodySchema = z.object({
  workspaceId: z.number().int().positive(),
  batchId: z.number().int().positive(),
  clicks: z.number().int().nonnegative().optional(),
  cost: numericString.optional(),
  revenue: numericString.optional(),
  conversions: z.number().int().nonnegative().optional(),
  roi: numericString.optional(),
  winnersCount: z.number().int().nonnegative().optional(),
  notes: z.string().nullable().optional(),
});

function serialize(row: typeof batchResultsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.post("/batch-results", async (req, res): Promise<void> => {
  const parsed = postBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid body",
      issues: parsed.error.issues,
    });
    return;
  }
  const {
    workspaceId: wsId,
    batchId: bId,
    clicks,
    cost,
    revenue,
    conversions,
    roi,
    winnersCount,
    notes,
  } = parsed.data;
  if ((await requireWorkspaceAccess(req, res, wsId)) === null) return;

  const [batch] = await db
    .select({ id: testingBatchesTable.id })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.id, bId),
        eq(testingBatchesTable.workspaceId, wsId),
      ),
    );
  if (!batch) {
    res.status(404).json({ error: "Batch not found in workspace" });
    return;
  }

  const values = {
    workspaceId: wsId,
    batchId: bId,
    clicks: clicks ?? 0,
    cost: cost ?? "0",
    revenue: revenue ?? "0",
    conversions: conversions ?? 0,
    roi: roi ?? null,
    winnersCount: winnersCount ?? 0,
    notes: notes ?? null,
  };

  // Upsert on the unique (batchId) constraint so a worker posting
  // twice for the same batch updates the previous row in place.
  const [row] = await db
    .insert(batchResultsTable)
    .values(values)
    .onConflictDoUpdate({
      target: batchResultsTable.batchId,
      set: {
        clicks: values.clicks,
        cost: values.cost,
        revenue: values.revenue,
        conversions: values.conversions,
        roi: values.roi,
        winnersCount: values.winnersCount,
        notes: values.notes,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Pivot Phase 4 (Task #27): only attach the dedupe key once the
  // result row qualifies for a MOVE_WINNERS task. A non-qualifying
  // first record (winners=0 AND roi<=0) must NOT poison the dedupe
  // log — otherwise a later qualifying update is silently dropped.
  // The rule itself is still idempotent (existing-task SELECT + the
  // partial unique index), so re-emitting on every qualifying write
  // is safe.
  const roiNum =
    row.roi == null || row.roi === "" ? 0 : Number(row.roi);
  const qualifies =
    row.winnersCount > 0 || (Number.isFinite(roiNum) && roiNum > 0);
  try {
    await emit({
      type: "BatchResultsRecorded",
      workspaceId: wsId,
      payload: {
        batchId: bId,
        winnersCount: row.winnersCount,
        roi: row.roi,
      },
      dedupeKey: qualifies ? `batch_results:${bId}` : undefined,
    });
  } catch (err) {
    req.log.warn(
      { err, batchId: bId },
      "[batch-results] BatchResultsRecorded emit failed — tombstoned",
    );
  }

  res.status(201).json(serialize(row));
});

router.get("/batch-results", async (req, res): Promise<void> => {
  const wsId = Number(req.query["workspace_id"]);
  if (!Number.isInteger(wsId) || wsId <= 0) {
    res.status(400).json({ error: "workspace_id is required" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, wsId)) === null) return;

  const batchIdRaw = req.query["batch_id"];
  let batchIdNum: number | null = null;
  if (batchIdRaw != null && batchIdRaw !== "") {
    const n = Number(batchIdRaw);
    if (!Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: "batch_id must be a positive integer" });
      return;
    }
    batchIdNum = n;
  }
  const where =
    batchIdNum != null
      ? and(
          eq(batchResultsTable.workspaceId, wsId),
          eq(batchResultsTable.batchId, batchIdNum),
        )
      : eq(batchResultsTable.workspaceId, wsId);

  const rows = await db.select().from(batchResultsTable).where(where);
  res.json(rows.map(serialize));
});

// Pivot Phase 5 (Task #28): full CRUD — partial update for an
// already-recorded result row. Re-emits BatchResultsRecorded if the
// updated row qualifies (winners > 0 OR roi > 0) so the rule can
// still schedule a MOVE_WINNERS task on a late-corrected result.
const patchBodySchema = z.object({
  clicks: z.number().int().nonnegative().optional(),
  cost: numericString.optional(),
  revenue: numericString.optional(),
  conversions: z.number().int().nonnegative().optional(),
  roi: numericString.optional(),
  winnersCount: z.number().int().nonnegative().optional(),
  notes: z.string().nullable().optional(),
});

router.patch("/batch-results/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer" });
    return;
  }
  const parsed = patchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }

  const [existing] = await db
    .select()
    .from(batchResultsTable)
    .where(eq(batchResultsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Batch result not found" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  const updates: Partial<typeof batchResultsTable.$inferInsert> = { updatedAt: new Date() };
  const d = parsed.data;
  if (d.clicks !== undefined) updates.clicks = d.clicks;
  if (d.cost !== undefined) updates.cost = d.cost ?? "0";
  if (d.revenue !== undefined) updates.revenue = d.revenue ?? "0";
  if (d.conversions !== undefined) updates.conversions = d.conversions;
  if (d.roi !== undefined) updates.roi = d.roi;
  if (d.winnersCount !== undefined) updates.winnersCount = d.winnersCount;
  if (d.notes !== undefined) updates.notes = d.notes;

  const [row] = await db
    .update(batchResultsTable)
    .set(updates)
    .where(and(eq(batchResultsTable.id, id), eq(batchResultsTable.workspaceId, existing.workspaceId)))
    .returning();

  // Re-emit if the updated row qualifies — preserves the ability for
  // a late-corrected result (e.g. winners 0 -> 3) to still schedule
  // the MOVE_WINNERS follow-up. Idempotent via the partial unique
  // index on todo_tasks + the rule's existing-task SELECT.
  const roiNum = row.roi == null || row.roi === "" ? 0 : Number(row.roi);
  const qualifies = row.winnersCount > 0 || (Number.isFinite(roiNum) && roiNum > 0);
  if (qualifies) {
    try {
      await emit({
        type: "BatchResultsRecorded",
        workspaceId: row.workspaceId,
        payload: { batchId: row.batchId, winnersCount: row.winnersCount, roi: row.roi },
        dedupeKey: `batch_results:${row.batchId}`,
      });
    } catch (err) {
      req.log.warn(
        { err, batchId: row.batchId },
        "[batch-results] BatchResultsRecorded emit failed (PATCH path) — tombstoned",
      );
    }
  }

  res.json(serialize(row));
});

export default router;
