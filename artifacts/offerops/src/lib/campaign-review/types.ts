/** Campaign Review Intelligence — UI layer types (not server automation). */

export type CampaignHealthStatus =
  | "healthy"
  | "needs_review"
  | "winner_candidate"
  | "scaling_opportunity"
  | "traffic_risk"
  | "burning"
  | "stale"
  | "attention_required";

export type CampaignSignalKind =
  | "traffic_50_no_conv"
  | "traffic_75_no_conv"
  | "traffic_100_no_conv"
  | "traffic_unlikely_pace"
  | "traffic_spike"
  | "traffic_decrease"
  | "zero_conversions"
  | "positive_roi"
  | "strong_revenue"
  | "likely_winner"
  | "scaling_opportunity"
  | "burning"
  | "stale";

export type CampaignSignal = {
  id: string;
  kind: CampaignSignalKind;
  label: string;
  detail: string;
  severity: "low" | "medium" | "high";
};

export type SuggestedReviewAction = {
  id: string;
  label: string;
  description: string;
  /** Memory event recorded when worker chooses this path. */
  memoryType:
    | "reviewed"
    | "dismissed_signal"
    | "winner_candidate"
    | "scaling_task_suggested"
    | "ignored"
    | "action_taken";
  href?: string;
};

export type ReviewQueueCampaign = {
  campaignId: number;
  campaignName: string;
  batchId: number | null;
  batchName: string | null;
  employeeId: number | null;
  employeeName: string | null;
  platform: string;
  purpose: string;
  status: string;
  health: CampaignHealthStatus;
  healthLabel: string;
  signals: CampaignSignal[];
  suggestedActions: SuggestedReviewAction[];
  visits: number;
  conversions: number;
  revenue: number;
  cost: number;
  roi: number;
  profit: number;
  firstSeenAt: string | null;
  escalated: boolean;
  voluumCampaignId?: string | null;
  reviewComment?: string | null;
  urgencyScore: number;
};

export type ReviewMemoryEventType =
  | "reviewed"
  | "dismissed_signal"
  | "winner_candidate"
  | "scaling_task_suggested"
  | "ignored"
  | "escalated"
  | "action_taken";

export type ReviewMemoryEvent = {
  id: string;
  workspaceId: number;
  employeeId: number;
  campaignId: number;
  type: ReviewMemoryEventType;
  signalId?: string;
  actionId?: string;
  createdAt: string;
  note?: string;
};
