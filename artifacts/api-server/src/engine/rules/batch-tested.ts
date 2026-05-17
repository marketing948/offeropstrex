// SPEC §6 — BatchTested rule.
//
// Producer (sync / reconciliation) emits BatchTested when the spec gate
// (every offer >= 20k visits AND >=24h since liveAt — Phase 3) is met.
// Effects:
//   - flip status to TESTED (chain-emit BatchStatusChanged so the
//     notification rule fires; Phase 3 will add the MOVE_WINNERS task
//     creation alongside).

import { and, eq } from "drizzle-orm";
import { testingBatchesTable } from "@workspace/db";
import type { Action, BatchStatus, EventInput, Tx } from "../types.ts";
import { emitWithinTx } from "../event-bus.ts";

type BatchTestedEvent = Extract<EventInput, { type: "BatchTested" }>;

export async function handleBatchTested(
  event: BatchTestedEvent,
  tx: Tx,
): Promise<Action[]> {
  const { workspaceId, payload } = event;

  const [batch] = await tx
    .select({
      id: testingBatchesTable.id,
      status: testingBatchesTable.status,
    })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.id, payload.batchId),
        eq(testingBatchesTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!batch) return [];
  if (batch.status === "TESTED" || batch.status === "COMPLETED") return [];

  // Chain a BatchStatusChanged into the same tx; that event owns the
  // status write and notification side effects.
  const fromStatus: BatchStatus = batch.status;
  await emitWithinTx(tx, {
    type: "BatchStatusChanged",
    workspaceId,
    payload: { batchId: batch.id, from: fromStatus, to: "TESTED" },
    dedupeKey: `auto_to_tested:${batch.id}`,
  });

  return [];
}
