// Pivot Phase 4 (Task #27) — OptimizationDue rule.
//
// Belt-and-braces handler for the optimization-followup cron. The
// happy path (both campaigns flip to live → CampaignStatusChanged
// rule schedules OPTIMIZATION_FOLLOWUP) covers nearly every case;
// this rule re-creates the task if the cron sees a batch whose
// `live_at + test_duration_hours` has elapsed and which somehow has
// no follow-up task — for example because of an earlier crash
// between the campaign status flip and the engine emit.

import { and, eq } from "drizzle-orm";
import { testingBatchesTable, todoTasksTable } from "@workspace/db";
import type { Action, EventInput, Tx } from "../types.ts";

const HOUR_MS = 60 * 60 * 1000;

type OptimizationDueEvent = Extract<EventInput, { type: "OptimizationDue" }>;

export async function handleOptimizationDue(
  event: OptimizationDueEvent,
  tx: Tx,
): Promise<Action[]> {
  const { workspaceId, payload } = event;
  const { batchId } = payload;

  const [batch] = await tx
    .select({
      id: testingBatchesTable.id,
      employeeId: testingBatchesTable.employeeId,
      batchName: testingBatchesTable.batchName,
      liveAt: testingBatchesTable.liveAt,
      testDurationHours: testingBatchesTable.testDurationHours,
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
        eq(todoTasksTable.taskType, "OPTIMIZATION_FOLLOWUP"),
      ),
    )
    .limit(1);
  if (existing.length > 0) return [];

  const batchName = batch.batchName ?? `Batch #${batch.id}`;
  // Parity with the primary CampaignStatusChanged path: dueDate =
  // live_at + test_duration_hours when both are known.
  const dueDate =
    batch.liveAt && batch.testDurationHours
      ? new Date(
          batch.liveAt.getTime() + batch.testDurationHours * HOUR_MS,
        ).toISOString()
      : undefined;
  return [
    {
      type: "CreateTask",
      workspaceId,
      data: {
        employeeId: batch.employeeId,
        relatedBatchId: batchId,
        title: `Optimization follow-up for ${batchName}`,
        taskType: "OPTIMIZATION_FOLLOWUP",
        priority: "medium",
        ...(dueDate ? { dueDate } : {}),
      },
    },
  ];
}
