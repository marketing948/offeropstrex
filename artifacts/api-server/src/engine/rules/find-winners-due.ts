// CampaignOps redesign — FindWinnersDue rule.
//
// The 7-day scheduler (cron/find-winners-scheduler.ts) emits one
// FindWinnersDue per Campaign whose liveStartedAt crossed 7 days ago.
// The rule emits a single find_winners task assigned to the batch's
// worker. Idempotent via the event dedupe key + the partial unique
// index on (workspace, related_campaign_id, task_type).

import type { Action, EventInput } from "../types.ts";

type Ev = Extract<EventInput, { type: "FindWinnersDue" }>;

export function handleFindWinnersDue(event: Ev): Action[] {
  const { workspaceId, payload } = event;
  return [
    {
      type: "CreateTask",
      workspaceId,
      data: {
        employeeId: payload.employeeId,
        relatedBatchId: payload.batchId,
        relatedCampaignId: payload.campaignId,
        title: payload.taskTitle ?? `Find winners for "${payload.campaignName}"`,
        taskType: "find_winners",
        priority: "high",
      },
    },
  ];
}
