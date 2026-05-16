// Pivot Phase 4 (Task #27) — BatchResultsRecorded rule.
//
// When the worker (or admin) records performance results for a batch,
// a MOVE_WINNERS_TO_SCALED_CAMPAIGN task is created if either:
//   - winnersCount > 0, OR
//   - roi > 0 (treated as fractional ROI: 0.10 = +10% margin).
//
// Idempotency: the producing event uses dedupe key
// `batch_results:<batchId>`, so re-recording results on the same batch
// is a no-op at the bus layer. We additionally guard against a stale
// dedupe-row pruning with a pre-insert lookup so a worker never sees
// duplicate move-winners tasks for the same batch.

import { and, eq } from "drizzle-orm";
import { testingBatchesTable, todoTasksTable } from "@workspace/db";
import type { Action, EventInput, Tx } from "../types.ts";

type BatchResultsRecordedEvent = Extract<
  EventInput,
  { type: "BatchResultsRecorded" }
>;

export async function handleBatchResultsRecorded(
  event: BatchResultsRecordedEvent,
  tx: Tx,
): Promise<Action[]> {
  const { workspaceId, payload } = event;
  const { batchId, winnersCount, roi } = payload;

  const roiNumber = roi == null || roi === "" ? 0 : Number(roi);
  const qualifies = winnersCount > 0 || (Number.isFinite(roiNumber) && roiNumber > 0);
  if (!qualifies) return [];

  const [batch] = await tx
    .select({
      id: testingBatchesTable.id,
      employeeId: testingBatchesTable.employeeId,
      batchName: testingBatchesTable.batchName,
    })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.id, batchId),
        eq(testingBatchesTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!batch || batch.employeeId == null) return [];

  const existing = await tx
    .select({ id: todoTasksTable.id })
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.workspaceId, workspaceId),
        eq(todoTasksTable.relatedBatchId, batchId),
        eq(todoTasksTable.taskType, "MOVE_WINNERS_TO_SCALED_CAMPAIGN"),
      ),
    )
    .limit(1);
  if (existing.length > 0) return [];

  const batchName = batch.batchName ?? `Batch #${batch.id}`;
  return [
    {
      type: "CreateTask",
      workspaceId,
      data: {
        employeeId: batch.employeeId,
        relatedBatchId: batchId,
        title: `Move winners to scaled campaign for ${batchName}`,
        taskType: "MOVE_WINNERS_TO_SCALED_CAMPAIGN",
        priority: "high",

      },
    },
  ];
}
