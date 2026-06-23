/** Backend mirror of connected XP action types (see offerops action-catalog.ts). */
export const TASK_TYPE_TO_XP_ACTION: Record<string, string> = {
  GO_LIVE: "campaign_marked_live",
  take_campaign_live: "campaign_marked_live",
  OPTIMIZATION_FOLLOWUP: "optimization_completed",
  MOVE_WINNERS_TO_SCALED_CAMPAIGN: "campaign_scaled",
  FIND_WINNERS: "task_completed",
  find_winners: "task_completed",
  review_winners_target: "winner_confirmed",
  MANUAL: "task_completed",
};

const LEGACY_RULE_ID_BY_ACTION_TYPE: Record<string, string> = {
  campaign_marked_live: "campaignLive",
  optimization_completed: "optimizationCompleted",
  campaign_scaled: "scaleTaskCompleted",
  task_completed: "taskCompleted",
  winner_confirmed: "winnerFound",
};

type PointActionRow = {
  id: string;
  actionType?: string;
  enabled?: boolean;
  points?: number;
  name?: string;
};

export function findEnabledPointAction(
  pointActions: PointActionRow[],
  catalogActionType: string,
): PointActionRow | undefined {
  const legacyId = LEGACY_RULE_ID_BY_ACTION_TYPE[catalogActionType];
  return pointActions.find(
    (a) =>
      a.enabled &&
      (a.actionType === catalogActionType || a.id === catalogActionType || (legacyId != null && a.id === legacyId)),
  );
}

export function resolveTaskXpActionType(taskType: string): string {
  return TASK_TYPE_TO_XP_ACTION[taskType] ?? "task_completed";
}
