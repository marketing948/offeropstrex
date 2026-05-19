// Phase 8e (Task #18) — admin-only manual batch creation.
//
// Spec: manual batch creation lives at POST /admin/batches/manual,
// requires admin role + an explicit workspaceId in the body. The old
// non-admin POST /testing-batches is now admin-gated and 403s for
// workers; new clients should call this endpoint instead.
//
// Spec-correction (post Phase 10): manually-created batches must also
// trigger the BatchCreated cascade (snapshot + tracker tasks + admin
// notification) just like sync-imported batches do. The handler emits
// BatchCreated immediately after insert, deduped by `batch_created:<batchId>`.

import { Router, type IRouter } from "express";
import { db, testingBatchesTable } from "@workspace/db";
import { CreateManualBatchBody } from "@workspace/api-zod";
import { requireAdmin, requireWorkspaceAccess } from "../../lib/workspace-access";
import { recordBatchCreatedOperationalEvent } from "../../lib/campaignops-operational-events.ts";
import { emit } from "../../engine/event-bus";

const router: IRouter = Router();

router.post("/admin/batches/manual", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;

  const parsed = CreateManualBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Spec requires explicit workspaceId in the body — the admin context
  // is global and there is no implicit "current workspace" on this
  // route, so we refuse to guess.
  const wsRaw = (req.body ?? {}).workspaceId ?? (req.body ?? {}).workspace_id;
  const wsId = await requireWorkspaceAccess(req, res, typeof wsRaw === "number" ? wsRaw : Number(wsRaw));
  if (wsId === null) return;

  const [batch] = await db
    .insert(testingBatchesTable)
    .values({ ...(parsed.data as typeof testingBatchesTable.$inferInsert), workspaceId: wsId })
    .returning();

  const initialTrafficSourceId =
    batch.currentWorkspaceTrafficSourceId ??
    (typeof parsed.data.trafficSourceId === "number" ? parsed.data.trafficSourceId : null);

  await recordBatchCreatedOperationalEvent({
    workspaceId: wsId,
    batchId: batch.id,
    employeeId: batch.employeeId,
    initialTrafficSourceId,
    trafficSourceStep: batch.trafficSourceStep,
    offerCount: batch.numberOfOffers ?? parsed.data.numberOfOffers ?? null,
    source: "routes.admin.batches.manual",
  });

  // Spec-correction: chain BatchCreated so manual batches go through
  // the same Phase-4 cascade as sync-imported ones. Failure to emit
  // is logged via event-bus tombstone and must not break the request.
  try {
    await emit({
      type: "BatchCreated",
      workspaceId: wsId,
      payload: {
        batchId: batch.id,
        tag: batch.batchTag ?? `manual_${batch.id}`,
        affiliateNetworkName: batch.affiliateNetwork ?? "",
        geo: batch.geo ?? "",
      },
      dedupeKey: `batch_created:${batch.id}`,
    });
  } catch (err) {
    req.log.warn({ err, batchId: batch.id }, "[Admin] BatchCreated emit failed for manual batch — tombstoned");
  }

  res.status(201).json({
    ...batch,
    testBudget: batch.testBudget != null ? Number(batch.testBudget) : null,
    spendThreshold: batch.spendThreshold != null ? Number(batch.spendThreshold) : null,
    createdAt: batch.createdAt.toISOString(),
    liveAt: batch.liveAt ? batch.liveAt.toISOString() : null,
    conditionsMetAt: batch.conditionsMetAt ? batch.conditionsMetAt.toISOString() : null,
    lastSyncAt: batch.lastSyncAt ? batch.lastSyncAt.toISOString() : null,
    employeeName: null,
  });
});

export default router;
