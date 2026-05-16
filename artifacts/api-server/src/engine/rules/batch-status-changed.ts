// SPEC §6 — BatchStatusChanged rule. Notification-only.
//
// The status change itself is performed by other rules' ChangeBatchStatus
// actions (or by lifecycle routes via emit()), so this rule MUST NOT emit
// ChangeBatchStatus to avoid loops.
//
// Phase 1 cleanup: TESTED no longer seeds a FIND_WINNERS task here. The
// canonical replacement task (MOVE_WINNERS_TO_SCALED_CAMPAIGN, with winner
// IDs in payload) is created by the Phase 3 winners-flow rule when the
// per-offer revenue gate is computed. Phase 1 only emits the high-severity
// notification so the worker is still alerted.

import { and, eq } from "drizzle-orm";
import { testingBatchesTable } from "@workspace/db";
import type { Action, EventInput, Tx } from "../types.ts";

type BatchStatusChangedEvent = Extract<
  EventInput,
  { type: "BatchStatusChanged" }
>;

export async function handleBatchStatusChanged(
  event: BatchStatusChangedEvent,
  tx: Tx,
): Promise<Action[]> {
  const { workspaceId, payload } = event;

  // Drop no-op transitions defensively.
  if (payload.from === payload.to) return [];

  const [batch] = await tx
    .select({
      id: testingBatchesTable.id,
      employeeId: testingBatchesTable.employeeId,
      batchName: testingBatchesTable.batchName,
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

  const actions: Action[] = [];

  if (payload.to === "LIVE_TESTS") {
    actions.push({
      type: "CreateNotification",
      workspaceId,
      data: {
        employeeId: batch.employeeId,
        batchId: batch.id,
        type: "NEW_BATCH_CREATED",
        severity: "info",
        message: `Batch "${batch.batchName}" is now LIVE_TESTS.`,
      },
    });
  }

  if (payload.to === "TESTED") {
    actions.push({
      type: "CreateNotification",
      workspaceId,
      data: {
        employeeId: batch.employeeId,
        batchId: batch.id,
        type: "NEW_BATCH_CREATED",
        severity: "high",
        message: `Batch "${batch.batchName}" finished testing — pick winners.`,
      },
    });
    // TODO(Phase 3): emit MOVE_WINNERS_TO_SCALED_CAMPAIGN task here once
    // the winner-selection rule (BatchTested handler extension) computes
    // the winners offer-id payload.
  }

  return actions;
}
