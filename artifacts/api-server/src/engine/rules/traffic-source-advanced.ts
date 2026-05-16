// Phase 4 + spec-correction (post Phase 10) — TrafficSourceAdvanced rule.
//
// Producer (Phase 5 lifecycle, or task-completed handler when
// PAUSE_TRAFFIC_SOURCE_CAMPAIGNS is marked DONE) emits this when the
// batch's pointer moves to the next traffic source in its snapshot.
// Effects:
//   - reset the batch's status to NEW_BATCH so the new source must
//     repeat the tracker-campaign step from scratch (per spec).
//   - seed CREATE_IOS / CREATE_ANDROID tracker-campaign tasks for the
//     new source, flashing=true (worker must notice).

import { and, eq } from "drizzle-orm";
import { testingBatchesTable } from "@workspace/db";
import type { Action, EventInput, Tx } from "../types.ts";

type TrafficSourceAdvancedEvent = Extract<
  EventInput,
  { type: "TrafficSourceAdvanced" }
>;

export async function handleTrafficSourceAdvanced(
  event: TrafficSourceAdvancedEvent,
  tx: Tx,
): Promise<Action[]> {
  const { workspaceId, payload } = event;

  const [batch] = await tx
    .select({
      id: testingBatchesTable.id,
      employeeId: testingBatchesTable.employeeId,
      batchName: testingBatchesTable.batchName,
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

  const actions: Action[] = [];

  for (const device of ["ios", "android"] as const) {
    actions.push({
      type: "CreateTask",
      workspaceId,
      data: {
        employeeId: batch.employeeId,
        relatedBatchId: batch.id,
        title: `Create ${device.toUpperCase()} tracker campaign for "${batch.batchName}" on ${payload.nextTrafficSourceName}`,
        taskType:
          device === "ios"
            ? "CREATE_IOS_TRACKER_CAMPAIGN"
            : "CREATE_ANDROID_TRACKER_CAMPAIGN",
        priority: "high",
        trackerCampaignDevice: device,
        trafficSourceId: payload.nextTrafficSourceId,
        // Spec-correction: subsequent CREATE_*_TRACKER_CAMPAIGN tasks
        // also flash so the worker notices the new rotation step.
        flashing: true,
      },
    });
  }

  // Spec-correction: reset to NEW_BATCH (not WAITING_FOR_TRACKER_CAMPAIGNS)
  // so the new source's lifecycle starts from a clean slate. The
  // TrackerCampaignImported handler will move it to WAITING when the
  // first tracker arrives.
  if (batch.status !== "NEW_BATCH") {
    actions.push({
      type: "ChangeBatchStatus",
      batchId: batch.id,
      status: "NEW_BATCH",
    });
  }

  return actions;
}
