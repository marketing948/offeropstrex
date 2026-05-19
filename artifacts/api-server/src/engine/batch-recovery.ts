// Slice 8A — admin batch recovery helpers (engine-owned mutations only).

import { and, desc, eq } from "drizzle-orm";
import {
  batchTrafficSourceRunsTable,
  campaignsTable,
  todoTasksTable,
} from "@workspace/db";
import type { BatchRecoveryAction } from "../lib/batch-recovery.ts";
import { recordOperationalEvent } from "../lib/operational-events.ts";
import { applyActions } from "./executor.ts";
import { handleTaskCompleted } from "./rules/task-completed.ts";
import type { Tx } from "./types.ts";

type ActiveRunRow = {
  id: number;
  trafficSourceId: number;
  position: number;
  status: string;
  iosCampaignId: number | null;
  androidCampaignId: number | null;
};

async function loadActiveRun(
  tx: Tx,
  workspaceId: number,
  batchId: number,
): Promise<ActiveRunRow | null> {
  const [row] = await tx
    .select({
      id: batchTrafficSourceRunsTable.id,
      trafficSourceId: batchTrafficSourceRunsTable.trafficSourceId,
      position: batchTrafficSourceRunsTable.position,
      status: batchTrafficSourceRunsTable.status,
      iosCampaignId: batchTrafficSourceRunsTable.iosCampaignId,
      androidCampaignId: batchTrafficSourceRunsTable.androidCampaignId,
    })
    .from(batchTrafficSourceRunsTable)
    .where(
      and(
        eq(batchTrafficSourceRunsTable.workspaceId, workspaceId),
        eq(batchTrafficSourceRunsTable.batchId, batchId),
        eq(batchTrafficSourceRunsTable.status, "active"),
      ),
    )
    .orderBy(desc(batchTrafficSourceRunsTable.position))
    .limit(1);
  return row ?? null;
}

export type ReplayFindWinnersResult = {
  runId: number;
  replayedTaskIds: number[];
  idempotent: boolean;
};

/**
 * Re-applies TaskCompleted → find_winners handler actions idempotently.
 * Platform updates no-op when already terminal; run advance is guarded in executor.
 */
export async function replayFindWinnersForActiveRun(
  workspaceId: number,
  batchId: number,
  tx: Tx,
): Promise<ReplayFindWinnersResult> {
  const activeRun = await loadActiveRun(tx, workspaceId, batchId);
  if (!activeRun) {
    throw new Error("No active traffic source run for this batch");
  }

  const doneTasks = await tx
    .select({
      id: todoTasksTable.id,
      relatedCampaignId: todoTasksTable.relatedCampaignId,
    })
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.workspaceId, workspaceId),
        eq(todoTasksTable.relatedBatchId, batchId),
        eq(todoTasksTable.taskType, "find_winners"),
        eq(todoTasksTable.status, "DONE"),
      ),
    )
    .orderBy(desc(todoTasksTable.id));

  const replayedTaskIds: number[] = [];

  for (const task of doneTasks) {
    if (task.relatedCampaignId == null) continue;
    const [campaign] = await tx
      .select({ trafficSourceId: campaignsTable.trafficSourceId })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.id, task.relatedCampaignId),
          eq(campaignsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (campaign?.trafficSourceId !== activeRun.trafficSourceId) continue;

    const actions = await handleTaskCompleted(
      {
        type: "TaskCompleted",
        workspaceId,
        payload: {
          taskId: task.id,
          taskType: "find_winners",
          relatedBatchId: batchId,
          relatedCampaignId: task.relatedCampaignId,
        },
      },
      tx,
    );
    await applyActions(actions, tx);
    replayedTaskIds.push(task.id);
  }

  if (replayedTaskIds.length === 0) {
    throw new Error(
      "No completed find_winners tasks found for the active traffic source run",
    );
  }

  return {
    runId: activeRun.id,
    replayedTaskIds,
    idempotent: false,
  };
}

export async function recordBatchRecoveryOperationalEvent(
  input: {
    workspaceId: number;
    batchId: number;
    action: BatchRecoveryAction;
    actorId: number;
    payload?: Record<string, unknown>;
  },
  tx: Tx,
): Promise<void> {
  await recordOperationalEvent(
    {
      workspaceId: input.workspaceId,
      entityType: "batch",
      entityId: input.batchId,
      eventType: "BATCH_RECOVERY_ACTION",
      actorType: "employee",
      actorId: input.actorId,
      source: "routes.admin.batch_recovery",
      payloadJson: {
        batchId: input.batchId,
        workspaceId: input.workspaceId,
        action: input.action,
        actorId: input.actorId,
        ...input.payload,
      },
    },
    tx,
  );
}
