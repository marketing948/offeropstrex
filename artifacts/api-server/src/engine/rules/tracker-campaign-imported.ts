// Phase 4 + spec-correction (post Phase 10) — TrackerCampaignImported rule.
//
// Spec (Automation Bible §6.3): when a tracker campaign is imported
//   1. PERSIST the tracker_campaigns row via RecordTrackerCampaign
//      (idempotent on the composite unique index).
//   2. complete the matching CREATE_*_TRACKER_CAMPAIGN task for that
//      (batch, traffic source, device) triple.
//   3. SPEC-CORRECTION: if the batch is still NEW_BATCH (i.e. this is
//      the FIRST tracker campaign imported for it), transition to
//      WAITING_FOR_TRACKER_CAMPAIGNS — pending the OTHER device.
//   4. if BOTH ios + android tracker campaigns are now imported for
//      the batch's CURRENT traffic source, advance the batch status
//      to OFFER_READY_FOR_LIVE_TESTING.

import { and, eq } from "drizzle-orm";
import {
  testingBatchesTable,
  todoTasksTable,
  trackerCampaignsTable,
} from "@workspace/db";
import type { Action, EventInput, Tx } from "../types.ts";

type TrackerCampaignImportedEvent = Extract<
  EventInput,
  { type: "TrackerCampaignImported" }
>;

export async function handleTrackerCampaignImported(
  event: TrackerCampaignImportedEvent,
  tx: Tx,
): Promise<Action[]> {
  const { workspaceId, payload } = event;
  const actions: Action[] = [];

  // 1. Always persist the tracker_campaigns row (idempotent).
  actions.push({
    type: "RecordTrackerCampaign",
    workspaceId,
    data: {
      batchId: payload.batchId,
      trafficSourceId: payload.trafficSourceId,
      device: payload.device,
      voluumCampaignId: payload.voluumCampaignId,
      tag: payload.tag,
    },
  });

  // 2. Complete the matching CREATE_*_TRACKER_CAMPAIGN task, if any.
  const matchingTaskType =
    payload.device === "ios"
      ? "CREATE_IOS_TRACKER_CAMPAIGN"
      : "CREATE_ANDROID_TRACKER_CAMPAIGN";

  const openTasks = await tx
    .select({ id: todoTasksTable.id })
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.workspaceId, workspaceId),
        eq(todoTasksTable.relatedBatchId, payload.batchId),
        eq(todoTasksTable.trafficSourceId, payload.trafficSourceId),
        eq(todoTasksTable.taskType, matchingTaskType),
      ),
    );

  for (const task of openTasks) {
    actions.push({ type: "CompleteTask", taskId: task.id });
  }

  // 3. + 4. Status transitions based on device coverage for the
  //    batch's current traffic source.
  const [batch] = await tx
    .select({
      id: testingBatchesTable.id,
      status: testingBatchesTable.status,
      currentTrafficSourceId: testingBatchesTable.currentTrafficSourceId,
    })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.id, payload.batchId),
        eq(testingBatchesTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!batch) return actions;

  const sourceId = batch.currentTrafficSourceId ?? payload.trafficSourceId;

  const importedForSource = await tx
    .select({ device: trackerCampaignsTable.device })
    .from(trackerCampaignsTable)
    .where(
      and(
        eq(trackerCampaignsTable.workspaceId, workspaceId),
        eq(trackerCampaignsTable.batchId, batch.id),
        eq(trackerCampaignsTable.trafficSourceId, sourceId),
      ),
    );

  const devicesImported = new Set<string>(importedForSource.map((r) => r.device));
  if (payload.trafficSourceId === sourceId) {
    devicesImported.add(payload.device);
  }
  const bothImported =
    devicesImported.has("ios") && devicesImported.has("android");

  if (bothImported && batch.status !== "OFFER_READY_FOR_LIVE_TESTING") {
    // Both devices in — advance regardless of whether we're coming from
    // NEW_BATCH or WAITING_FOR_TRACKER_CAMPAIGNS.
    if (
      batch.status === "NEW_BATCH" ||
      batch.status === "WAITING_FOR_TRACKER_CAMPAIGNS"
    ) {
      actions.push({
        type: "ChangeBatchStatus",
        batchId: batch.id,
        status: "OFFER_READY_FOR_LIVE_TESTING",
      });
    }
  } else if (
    batch.status === "NEW_BATCH" &&
    payload.trafficSourceId === sourceId
  ) {
    // Spec-correction: first tracker campaign imported FOR THE BATCH'S
    // CURRENT traffic source but the other device is still missing —
    // transition NEW_BATCH → WAITING. Imports for non-current sources
    // (e.g. operator pre-creates the next-source's tracker early) must
    // not advance status.
    actions.push({
      type: "ChangeBatchStatus",
      batchId: batch.id,
      status: "WAITING_FOR_TRACKER_CAMPAIGNS",
    });
  }

  return actions;
}
