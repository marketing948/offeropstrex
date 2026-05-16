// CampaignOps redesign — BatchCreated rule.
//
// On manual batch creation, seed the two campaign-creation tasks:
//   create_voluum_campaign_ios + create_voluum_campaign_android
// for the worker assigned to the batch. Each completion (in
// routes/todo-tasks.ts) creates a Campaign row + spawns the per-campaign
// take_campaign_live task.

import { and, eq, inArray } from "drizzle-orm";
import { testingBatchesTable, todoTasksTable } from "@workspace/db";
import type { Action, EventInput, Tx } from "../types.ts";

type BatchCreatedEvent = Extract<EventInput, { type: "BatchCreated" }>;

export async function handleBatchCreated(
  event: BatchCreatedEvent,
  tx: Tx,
): Promise<Action[]> {
  const { workspaceId, payload } = event;

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
  if (batch.employeeId == null) return [];

  // Anti-dup guard — partial unique index also enforces this at the DB.
  const existing = await tx
    .select({ id: todoTasksTable.id })
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.workspaceId, workspaceId),
        eq(todoTasksTable.relatedBatchId, batch.id),
        inArray(todoTasksTable.taskType, [
          "create_voluum_campaign_ios",
          "create_voluum_campaign_android",
        ]),
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
        relatedBatchId: batch.id,
        title: `Create Voluum campaign (iOS) for ${batchName}`,
        taskType: "create_voluum_campaign_ios",
        priority: "high",
      },
    },
    {
      type: "CreateTask",
      workspaceId,
      data: {
        employeeId: batch.employeeId,
        relatedBatchId: batch.id,
        title: `Create Voluum campaign (Android) for ${batchName}`,
        taskType: "create_voluum_campaign_android",
        priority: "high",
      },
    },
    {
      type: "CreateNotification",
      workspaceId,
      data: {
        employeeId: batch.employeeId,
        batchId: batch.id,
        type: "NEW_BATCH_CREATED",
        severity: "info",
        message: `New batch "${batchName}" — create iOS + Android Voluum campaigns.`,
      },
    },
  ];
}
