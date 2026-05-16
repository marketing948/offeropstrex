// Pivot Phase 4 (Task #27) — CampaignStatusChanged rule.
//
// Two transitions matter for downstream task creation:
//
//   * `→ ready`  — when BOTH campaigns (ios + android) for the batch
//     have reached `ready`, create one GO_LIVE task for the assigned
//     worker.
//
//   * `→ live`   — when BOTH campaigns have reached `live`, create one
//     OPTIMIZATION_FOLLOWUP task scheduled at
//     `live_at + test_duration_hours`. (`live_at` is the latter of the
//     two campaigns going live, derived here as max(updatedAt). The
//     manual `live_at` column on testing_batches is used when set, so
//     an admin override of the live timestamp wins.)
//
// All other transitions (draft, tested, closed) are no-ops at this
// phase. Idempotency: each derived task is uniquely identified by the
// batch and task type, so we re-query before emitting to avoid double-
// inserts even though the event-level dedupe (`campaign_status:<id>:<to>`)
// already prevents the rule from running twice for the same transition.

import { and, eq } from "drizzle-orm";
import {
  campaignsTable,
  testingBatchesTable,
  todoTasksTable,
} from "@workspace/db";
import type { Action, EventInput, Tx } from "../types.ts";

type CampaignStatusChangedEvent = Extract<
  EventInput,
  { type: "CampaignStatusChanged" }
>;

export async function handleCampaignStatusChanged(
  event: CampaignStatusChangedEvent,
  tx: Tx,
): Promise<Action[]> {
  const { workspaceId, payload } = event;
  const { batchId, to } = payload;

  if (to !== "ready" && to !== "live") return [];

  // Pull the batch row up front — needed for the assigned worker on
  // every branch and for the live_at / test_duration_hours timer on
  // the `live` branch.
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

  // Inspect both campaigns for the batch.
  const campaigns = await tx
    .select({
      id: campaignsTable.id,
      platform: campaignsTable.platform,
      status: campaignsTable.status,
      updatedAt: campaignsTable.updatedAt,
    })
    .from(campaignsTable)
    .where(
      and(
        eq(campaignsTable.workspaceId, workspaceId),
        eq(campaignsTable.batchId, batchId),
      ),
    );

  const hasIos = campaigns.some(
    (c) => c.platform === "ios" && c.status === to,
  );
  const hasAndroid = campaigns.some(
    (c) => c.platform === "android" && c.status === to,
  );
  if (!hasIos || !hasAndroid) return [];

  if (to === "ready") {
    // Skip if a GO_LIVE task for this batch already exists in any
    // open or done state — prevents re-creating after a worker
    // completes one (re-emit can still slip through if the dedupe
    // log was pruned).
    const existing = await tx
      .select({ id: todoTasksTable.id })
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.workspaceId, workspaceId),
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.taskType, "GO_LIVE"),
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
          title: `Take ${batchName} live`,
          taskType: "GO_LIVE",
          priority: "high",

        },
      },
    ];
  }

  // to === "live"
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

  // Compute follow-up due date: prefer the explicit `live_at` set on
  // the batch (manual override); fall back to the latest campaign
  // updatedAt as the de-facto live moment when both campaigns just
  // flipped. test_duration_hours defaults to 48 in the schema.
  const liveMoment = batch.liveAt
    ? new Date(batch.liveAt)
    : campaigns.reduce<Date>(
        (acc, c) => (c.updatedAt > acc ? c.updatedAt : acc),
        new Date(0),
      );
  const durationHours = batch.testDurationHours ?? 48;
  const dueAt = new Date(liveMoment.getTime() + durationHours * 3_600_000);

  const batchName = batch.batchName ?? `Batch #${batch.id}`;
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

        // `due_date` is a text column on todo_tasks; ISO date is the
        // existing convention from Phase 7.
        dueDate: dueAt.toISOString(),
      },
    },
  ];
}
