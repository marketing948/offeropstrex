// CampaignOps redesign — TaskCompleted rule.
//
// The route layer (routes/todo-tasks.ts) is the producer of TaskCompleted
// for the new flow. It mutates the Campaign row directly (campaigns is
// not in FORBIDDEN_TABLES) and emits TaskCompleted with `relatedCampaignId`
// set. This rule's job is to spawn the NEXT task in the chain.
//
// Chain:
//   create_voluum_campaign_ios     → take_campaign_live (per Campaign)
//   create_voluum_campaign_android → take_campaign_live (per Campaign)
//   take_campaign_live             → no-op (7-day cron emits find_winners)
//   find_winners                   → next traffic source's
//                                    create_voluum_campaign_<platform>,
//                                    OR all_traffic_sources_tested
//
// Legacy task types (CREATE_*_CAMPAIGN, GO_LIVE, OPTIMIZATION_FOLLOWUP,
// FIND_WINNERS, PAUSE_*, MOVE_WINNERS_*) are no-ops — historical data only.

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import {
  campaignsTable,
  testingBatchesTable,
  todoTasksTable,
  workspaceTrafficSourcesTable,
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

  // ── find_winners completed → next-traffic-source create task ──
  if (taskType === "find_winners") {
    if (relatedCampaignId == null) return [];

    const [campaign] = await tx
      .select({
        id: campaignsTable.id,
        platform: campaignsTable.platform,
        trafficSourceId: campaignsTable.trafficSourceId,
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
      .select({
        id: testingBatchesTable.id,
        employeeId: testingBatchesTable.employeeId,
        batchName: testingBatchesTable.batchName,
      })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, relatedBatchId))
      .limit(1);
    if (!batch || batch.employeeId == null) return [];

    // Active workspace traffic sources, ordered by position.
    const sources = await tx
      .select({
        id: workspaceTrafficSourcesTable.id,
        name: workspaceTrafficSourcesTable.name,
      })
      .from(workspaceTrafficSourcesTable)
      .where(
        and(
          eq(workspaceTrafficSourcesTable.workspaceId, workspaceId),
          eq(workspaceTrafficSourcesTable.isActive, true),
        ),
      )
      .orderBy(asc(workspaceTrafficSourcesTable.position));

    // Already-tested (or in-flight) traffic sources for this batch+platform.
    const existingCampaigns = await tx
      .select({ trafficSourceId: campaignsTable.trafficSourceId })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.workspaceId, workspaceId),
          eq(campaignsTable.batchId, relatedBatchId),
          eq(campaignsTable.platform, campaign.platform),
        ),
      );
    const usedIds = new Set(
      existingCampaigns
        .map((c) => c.trafficSourceId)
        .filter((v): v is number => v != null),
    );

    const next = sources.find((s) => !usedIds.has(s.id));
    const batchName = batch.batchName ?? `Batch #${batch.id}`;

    if (!next) {
      // Per-platform completion: only emit all_traffic_sources_tested for
      // this batch when BOTH platforms have exhausted the source list.
      // Defensive cross-platform check:
      const otherPlatform: "ios" | "android" =
        campaign.platform === "ios" ? "android" : "ios";
      const otherCampaigns = await tx
        .select({ trafficSourceId: campaignsTable.trafficSourceId })
        .from(campaignsTable)
        .where(
          and(
            eq(campaignsTable.workspaceId, workspaceId),
            eq(campaignsTable.batchId, relatedBatchId),
            eq(campaignsTable.platform, otherPlatform),
          ),
        );
      const otherUsed = new Set(
        otherCampaigns
          .map((c) => c.trafficSourceId)
          .filter((v): v is number => v != null),
      );
      const otherRemaining = sources.find((s) => !otherUsed.has(s.id));
      if (otherRemaining) {
        // Other platform still has work; nothing else to schedule here.
        return [];
      }

      // Anti-dup: don't double-emit the all-done task.
      const [existing] = await tx
        .select({ id: todoTasksTable.id })
        .from(todoTasksTable)
        .where(
          and(
            eq(todoTasksTable.workspaceId, workspaceId),
            eq(todoTasksTable.relatedBatchId, relatedBatchId),
            eq(todoTasksTable.taskType, "all_traffic_sources_tested"),
          ),
        )
        .limit(1);
      if (existing) return [];

      return [
        {
          type: "CreateTask",
          workspaceId,
          data: {
            employeeId: batch.employeeId,
            relatedBatchId,
            title: `All traffic sources tested for ${batchName}`,
            taskType: "all_traffic_sources_tested",
            priority: "low",
          },
        },
      ];
    }

    const nextTaskType =
      campaign.platform === "ios"
        ? "create_voluum_campaign_ios"
        : "create_voluum_campaign_android";

    // Anti-dup: an open create_voluum_campaign_<platform> for this batch
    // already covers this (the partial unique index would also catch it).
    const [openSame] = await tx
      .select({ id: todoTasksTable.id })
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.workspaceId, workspaceId),
          eq(todoTasksTable.relatedBatchId, relatedBatchId),
          eq(todoTasksTable.taskType, nextTaskType),
          inArray(todoTasksTable.status, ["TODO", "IN_PROGRESS"]),
        ),
      )
      .limit(1);
    if (openSame) return [];

    return [
      {
        type: "CreateTask",
        workspaceId,
        data: {
          employeeId: batch.employeeId,
          relatedBatchId,
          title: `Create Voluum campaign (${campaign.platform === "ios" ? "iOS" : "Android"}) for ${batchName} on ${next.name}`,
          taskType: nextTaskType,
          priority: "high",
          trafficSourceId: next.id,
        },
      },
    ];
  }

  // take_campaign_live: no engine action — the 7-day cron schedules
  // find_winners. (The route already updated the Campaign row.)
  // all_traffic_sources_tested: terminal — no follow-on.
  // Legacy types: no-op.
  void ne;
  void desc;
  return [];
}
