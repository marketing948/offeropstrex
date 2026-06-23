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
//                                    advances when both platforms are
//                                    terminal (success and/or dual-fail).
//
// Legacy task types (CREATE_*_CAMPAIGN, GO_LIVE, OPTIMIZATION_FOLLOWUP,
// FIND_WINNERS, PAUSE_*, MOVE_WINNERS_*) are no-ops — historical data only.

import { and, eq } from "drizzle-orm";
import {
  todoTasksTable,
  campaignsTable,
  testingBatchesTable,
  batchTrafficSourceRunsTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import {
  formatTakeCampaignLiveTitle,
  resolveCampaignDisplayName,
} from "../../lib/campaign-display-name.ts";
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
        platform: campaignsTable.platform,
        trafficSourceId: campaignsTable.trafficSourceId,
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

    let trafficSourceName: string | null = null;
    if (campaign.trafficSourceId != null) {
      const [source] = await tx
        .select({ name: workspaceTrafficSourcesTable.name })
        .from(workspaceTrafficSourcesTable)
        .where(eq(workspaceTrafficSourcesTable.id, campaign.trafficSourceId))
        .limit(1);
      trafficSourceName = source?.name ?? null;
    }

    const [batch] = await tx
      .select({
        employeeId: testingBatchesTable.employeeId,
        batchName: testingBatchesTable.batchName,
      })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, relatedBatchId))
      .limit(1);
    if (!batch || batch.employeeId == null) return [];

    const displayName = resolveCampaignDisplayName({
      campaignName: campaign.campaignName,
      batchName: batch.batchName,
      platform: campaign.platform,
    });

    return [
      {
        type: "CreateTask",
        workspaceId,
        data: {
          employeeId: batch.employeeId,
          relatedBatchId,
          relatedCampaignId,
          title: formatTakeCampaignLiveTitle(displayName, trafficSourceName),
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

  if (taskType === "review_winners_target") {
    const [taskRow] = await tx
      .select({ trafficSourceId: todoTasksTable.trafficSourceId })
      .from(todoTasksTable)
      .where(
        and(eq(todoTasksTable.id, payload.taskId), eq(todoTasksTable.workspaceId, workspaceId)),
      )
      .limit(1);
    if (taskRow?.trafficSourceId == null) return [];

    const [run] = await tx
      .select({
        iosCampaignId: batchTrafficSourceRunsTable.iosCampaignId,
        androidCampaignId: batchTrafficSourceRunsTable.androidCampaignId,
      })
      .from(batchTrafficSourceRunsTable)
      .where(
        and(
          eq(batchTrafficSourceRunsTable.workspaceId, workspaceId),
          eq(batchTrafficSourceRunsTable.batchId, relatedBatchId),
          eq(batchTrafficSourceRunsTable.trafficSourceId, taskRow.trafficSourceId),
        ),
      )
      .limit(1);
    if (!run) return [];

    const actions: Action[] = [];
    for (const platform of ["ios", "android"] as const) {
      const cid = platform === "ios" ? run.iosCampaignId : run.androidCampaignId;
      if (cid == null) continue;
      actions.push({
        type: "CompleteTrafficSourceRunPlatform",
        workspaceId,
        batchId: relatedBatchId,
        trafficSourceId: taskRow.trafficSourceId,
        platform,
        campaignId: cid,
        outcome: "completed",
        failureReason: null,
      });
    }
    return actions;
  }

  // take_campaign_live: no engine action — the 7-day cron schedules
  // find_winners. (The executor already updated the Campaign row.)
  // all_traffic_sources_tested: terminal — no follow-on.
  // Legacy types: no-op.
  return [];
}
