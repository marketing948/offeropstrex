// Slice 8A — explicit admin-only batch recovery actions (manual operator repair).

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, testingBatchesTable } from "@workspace/db";
import { z } from "zod/v4";
import { requireAdmin, requireWorkspaceAccess } from "../../lib/workspace-access";
import { isBatchRecoveryAction } from "../../lib/batch-recovery.ts";
import { recreateMissingCreateVoluumCampaignTasks } from "../../engine/executor.ts";
import {
  recordBatchRecoveryOperationalEvent,
  replayFindWinnersForActiveRun,
} from "../../engine/batch-recovery.ts";
import { getEmployeeFromToken } from "../auth";

const router: IRouter = Router();

const markRunReviewedBodySchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

function parseBatchId(raw: string | undefined): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

router.post("/admin/batches/:id/recovery/:action", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (admin === null) return;

  const batchId = parseBatchId(req.params.id);
  if (batchId === null) {
    res.status(400).json({ error: "Invalid batch id" });
    return;
  }

  const actionParam = req.params.action;
  if (!actionParam || !isBatchRecoveryAction(actionParam)) {
    res.status(400).json({
      error: `Unknown recovery action. Supported: recreate-create-tasks, replay-find-winners, mark-run-reviewed`,
    });
    return;
  }

  const [batch] = await db
    .select({
      id: testingBatchesTable.id,
      workspaceId: testingBatchesTable.workspaceId,
    })
    .from(testingBatchesTable)
    .where(eq(testingBatchesTable.id, batchId));

  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }

  const workspaceId = await requireWorkspaceAccess(req, res, batch.workspaceId);
  if (workspaceId === null) return;

  try {
    if (actionParam === "recreate-create-tasks") {
      const result = await db.transaction(async (tx) => {
        const recreated = await recreateMissingCreateVoluumCampaignTasks(
          workspaceId,
          batchId,
          tx,
        );
        await recordBatchRecoveryOperationalEvent(
          {
            workspaceId,
            batchId,
            action: actionParam,
            actorId: admin.id,
            payload: {
              runId: recreated.runId,
              trafficSourceId: recreated.trafficSourceId,
              createdTaskIds: recreated.createdTasks.map((t) => t.id),
              idempotent: recreated.idempotent,
            },
          },
          tx,
        );
        return recreated;
      });

      res.json({
        action: actionParam,
        batchId,
        workspaceId,
        runId: result.runId,
        trafficSourceId: result.trafficSourceId,
        createdTasks: result.createdTasks,
        idempotent: result.idempotent,
      });
      return;
    }

    if (actionParam === "replay-find-winners") {
      const result = await db.transaction(async (tx) => {
        const replayed = await replayFindWinnersForActiveRun(
          workspaceId,
          batchId,
          tx,
        );
        await recordBatchRecoveryOperationalEvent(
          {
            workspaceId,
            batchId,
            action: actionParam,
            actorId: admin.id,
            payload: {
              runId: replayed.runId,
              replayedTaskIds: replayed.replayedTaskIds,
              idempotent: replayed.idempotent,
            },
          },
          tx,
        );
        return replayed;
      });

      res.json({
        action: actionParam,
        batchId,
        workspaceId,
        runId: result.runId,
        replayedTaskIds: result.replayedTaskIds,
        idempotent: result.idempotent,
      });
      return;
    }

    if (actionParam === "mark-run-reviewed") {
      const parsed = markRunReviewedBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }

      await db.transaction(async (tx) => {
        await recordBatchRecoveryOperationalEvent(
          {
            workspaceId,
            batchId,
            action: actionParam,
            actorId: admin.id,
            payload: {
              note: parsed.data.note ?? null,
              idempotent: false,
            },
          },
          tx,
        );
      });

      res.json({
        action: actionParam,
        batchId,
        workspaceId,
        note: parsed.data.note ?? null,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

export default router;
