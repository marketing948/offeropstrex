// CampaignOps redesign — TaskCompleted rule.
//
// The route layer emits TaskCompletionRequested; the executor owns the
// task/campaign writes and chain-emits TaskCompleted with
// `relatedCampaignId` set. This rule handles follow-on work.
//
// Chain:
//   create_voluum_campaign_ios     → take_campaign_live (per Campaign)
//   create_voluum_campaign_android → take_campaign_live (per Campaign)
//   take_campaign_live             → no-op (7-day cron emits find_winners)
//   find_winners                   → mark the platform outcome on the
//                                    active batch_traffic_source_run.
//                                    The executor derives run status and
//                                    advances to the next source when
//                                    the run has a successful terminal
//                                    outcome.
//
// Legacy task types (CREATE_*_CAMPAIGN, GO_LIVE, OPTIMIZATION_FOLLOWUP,
// FIND_WINNERS, PAUSE_*, MOVE_WINNERS_*) are no-ops — historical data only.

import { and, eq } from "drizzle-orm";
import {
  todoTasksTable,
  campaignsTable,
  testingBatchesTable,
} from "@workspace/db";
import type { Action, EventInput, Tx } from "../types.ts";

type TaskCompletedEvent = Extract<EventInput, { type: "TaskCompleted" }>;

export async function handleTaskCompleted(
  event: TaskCompletedEvent,
  tx: Tx,
): Promise<Action[]> {
  const { workspaceId, payload } = event;
  const { taskType, relatedBatchId, relatedCampaignId } = payload;

  if (relatedBatchId == null) return [];

  const platformFromTaskType = (
    t: string,
  ): "ios" | "android" | null => {
    if (t === "create_voluum_campaign_ios") return "ios";
    if (t === "create_voluum_campaign_android") return "android";
    return null;
  };

  // ── create_voluum_campaign_* completed → spawn take_campaign_live ──
  const platform = platformFromTaskType(taskType);
  if (platform != null) {
    if (relatedCampaignId == null) return [];
    const [campaign] = await tx
      .select({
        id: campaignsTable.id,
        campaignName: campaignsTable.campaignName,
      })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.id, relatedCampaignId),
          eq(campaignsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!campaign) return [];

    const [batch] = await tx
      .select({ employeeId: testingBatchesTable.employeeId })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, relatedBatchId))
      .limit(1);
    if (!batch || batch.employeeId == null) return [];

    return [
      {
        type: "CreateTask",
        workspaceId,
        data: {
          employeeId: batch.employeeId,
          relatedBatchId,
          relatedCampaignId,
          title: `Take "${campaign.campaignName}" live`,
          taskType: "take_campaign_live",
          priority: "high",
        },
      },
    ];
  }

  // ── find_winners completed → record platform outcome on the source run ──
  if (taskType === "find_winners") {
    if (relatedCampaignId == null) return [];

    const [campaign] = await tx
      .select({
        id: campaignsTable.id,
        platform: campaignsTable.platform,
        trafficSourceId: campaignsTable.trafficSourceId,
        status: campaignsTable.status,
      })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.id, relatedCampaignId),
          eq(campaignsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!campaign || campaign.trafficSourceId == null) return [];

    const [task] = await tx
      .select({
        completionPayload: todoTasksTable.completionPayload,
      })
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.id, payload.taskId),
          eq(todoTasksTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    const payloadValue = task?.completionPayload;
    const failureReason =
      payloadValue &&
      typeof payloadValue === "object" &&
      !Array.isArray(payloadValue) &&
      "failureReason" in payloadValue &&
      typeof payloadValue.failureReason === "string"
        ? payloadValue.failureReason
        : null;
    const outcome = campaign.status === "closed" ? "failed" : "completed";

    return [
      {
        type: "CompleteTrafficSourceRunPlatform",
        workspaceId,
        batchId: relatedBatchId,
        trafficSourceId: campaign.trafficSourceId,
        platform: campaign.platform,
        campaignId: campaign.id,
        outcome,
        failureReason,
      },
    ];
  }

  // take_campaign_live: no engine action — the 7-day cron schedules
  // find_winners. (The route already updated the Campaign row.)
  // all_traffic_sources_tested: terminal — no follow-on.
  // Legacy types: no-op.
  return [];
}
