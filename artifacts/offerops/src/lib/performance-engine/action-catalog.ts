export type ConnectionStatus = "connected" | "not_connected";
export type RuleKind = "xp" | "penalty" | "bonus";

export type CatalogAction = {
  actionType: string;
  label: string;
  description: string;
  category: string;
  connectionStatus: ConnectionStatus;
  sourceArea: string;
  defaultXp: number;
  allowedRuleTypes: RuleKind[];
  /** Legacy pointActions.id values wired in awardTaskCompletionXp */
  legacyRuleIds?: string[];
};

export type CatalogPenalty = {
  actionType: string;
  label: string;
  description: string;
  category: string;
  connectionStatus: ConnectionStatus;
  sourceArea: string;
  defaultPenalty: number;
};

export type CatalogBonusEvent = {
  actionType: string;
  label: string;
  description: string;
  category: string;
  connectionStatus: ConnectionStatus;
  sourceArea: string;
  defaultXp: number;
};

export const XP_ACTION_CATALOG: CatalogAction[] = [
  {
    actionType: "testing_batch_created",
    label: "Testing batch created",
    description: "Reward when a worker creates a new testing batch.",
    category: "Testing / Batch",
    connectionStatus: "not_connected",
    sourceArea: "Testing Batches",
    defaultXp: 2,
    allowedRuleTypes: ["xp"],
    legacyRuleIds: ["batchCreated"],
  },
  {
    actionType: "testing_batch_completed",
    label: "Testing batch completed",
    description: "Reward when a testing batch reaches completion.",
    category: "Testing / Batch",
    connectionStatus: "not_connected",
    sourceArea: "Testing Batches",
    defaultXp: 5,
    allowedRuleTypes: ["xp"],
  },
  {
    actionType: "offer_added_to_testing",
    label: "Offer added to testing",
    description: "Reward when an offer is added to a testing workflow.",
    category: "Testing / Batch",
    connectionStatus: "not_connected",
    sourceArea: "Testing Batches",
    defaultXp: 3,
    allowedRuleTypes: ["xp"],
  },
  {
    actionType: "campaign_created",
    label: "Campaign created",
    description: "Reward when a campaign record is created.",
    category: "Campaign lifecycle",
    connectionStatus: "not_connected",
    sourceArea: "Campaigns",
    defaultXp: 2,
    allowedRuleTypes: ["xp"],
  },
  {
    actionType: "campaign_moved_to_working",
    label: "Campaign moved to Working",
    description: "Reward when a campaign purpose changes to working.",
    category: "Campaign lifecycle",
    connectionStatus: "not_connected",
    sourceArea: "Campaigns",
    defaultXp: 4,
    allowedRuleTypes: ["xp"],
  },
  {
    actionType: "campaign_marked_live",
    label: "Campaign marked Live",
    description: "Reward when a go-live task completes and a campaign is marked live.",
    category: "Campaign lifecycle",
    connectionStatus: "connected",
    sourceArea: "Task completion (GO_LIVE)",
    defaultXp: 3,
    allowedRuleTypes: ["xp"],
    legacyRuleIds: ["campaignLive"],
  },
  {
    actionType: "campaign_paused",
    label: "Campaign paused",
    description: "Reward when a campaign is paused.",
    category: "Campaign lifecycle",
    connectionStatus: "not_connected",
    sourceArea: "Campaigns",
    defaultXp: 1,
    allowedRuleTypes: ["xp"],
  },
  {
    actionType: "campaign_scaled",
    label: "Campaign scaled",
    description: "Reward when a move-to-scale / scale task completes.",
    category: "Campaign lifecycle",
    connectionStatus: "connected",
    sourceArea: "Task completion (MOVE_WINNERS_TO_SCALED_CAMPAIGN)",
    defaultXp: 6,
    allowedRuleTypes: ["xp"],
    legacyRuleIds: ["scaleTaskCompleted"],
  },
  {
    actionType: "winner_created",
    label: "Winner created",
    description: "Reward when a winner is identified.",
    category: "Winner discovery",
    connectionStatus: "not_connected",
    sourceArea: "Winners",
    defaultXp: 10,
    allowedRuleTypes: ["xp"],
    legacyRuleIds: ["winnerFound"],
  },
  {
    actionType: "winner_confirmed",
    label: "Winner confirmed",
    description: "Reward when a review-winners task completes.",
    category: "Winner discovery",
    connectionStatus: "connected",
    sourceArea: "Task completion (review_winners_target)",
    defaultXp: 10,
    allowedRuleTypes: ["xp"],
    legacyRuleIds: ["winnerFound"],
  },
  {
    actionType: "first_conversion_recorded",
    label: "First conversion recorded",
    description: "Reward when the first conversion is recorded for a campaign.",
    category: "Winner discovery",
    connectionStatus: "not_connected",
    sourceArea: "Performance metrics",
    defaultXp: 15,
    allowedRuleTypes: ["xp"],
  },
  {
    actionType: "daily_metrics_uploaded",
    label: "Daily metrics uploaded",
    description: "Reward when daily metrics are uploaded for a campaign.",
    category: "Reporting / data quality",
    connectionStatus: "not_connected",
    sourceArea: "Reports",
    defaultXp: 5,
    allowedRuleTypes: ["xp"],
  },
  {
    actionType: "csv_import_completed",
    label: "CSV import completed",
    description: "Reward when a CSV import finishes successfully.",
    category: "Reporting / data quality",
    connectionStatus: "not_connected",
    sourceArea: "Imports",
    defaultXp: 5,
    allowedRuleTypes: ["xp"],
  },
  {
    actionType: "campaign_review_completed",
    label: "Campaign review completed",
    description: "Reward when a campaign review workflow completes.",
    category: "Reporting / data quality",
    connectionStatus: "not_connected",
    sourceArea: "Campaign Review",
    defaultXp: 4,
    allowedRuleTypes: ["xp"],
  },
  {
    actionType: "missing_metrics_fixed",
    label: "Missing metrics fixed",
    description: "Reward when missing metrics are resolved.",
    category: "Reporting / data quality",
    connectionStatus: "not_connected",
    sourceArea: "Reports",
    defaultXp: 3,
    allowedRuleTypes: ["xp"],
  },
  {
    actionType: "optimization_completed",
    label: "Optimization completed",
    description: "Reward when an optimization follow-up task completes.",
    category: "Optimization / discipline",
    connectionStatus: "connected",
    sourceArea: "Task completion (OPTIMIZATION_FOLLOWUP)",
    defaultXp: 5,
    allowedRuleTypes: ["xp"],
    legacyRuleIds: ["optimizationCompleted"],
  },
  {
    actionType: "task_completed",
    label: "Task completed",
    description: "Reward when any supported todo task is completed.",
    category: "Optimization / discipline",
    connectionStatus: "connected",
    sourceArea: "Task completion (executor)",
    defaultXp: 1,
    allowedRuleTypes: ["xp"],
    legacyRuleIds: ["taskCompleted"],
  },
  {
    actionType: "task_completed_on_time",
    label: "Task completed on time",
    description: "Reward when a task is completed before its due date.",
    category: "Optimization / discipline",
    connectionStatus: "not_connected",
    sourceArea: "Tasks",
    defaultXp: 2,
    allowedRuleTypes: ["xp"],
    legacyRuleIds: ["allTasksOnTime"],
  },
  {
    actionType: "overdue_task_resolved",
    label: "Overdue task resolved",
    description: "Reward when an overdue task is finally completed.",
    category: "Optimization / discipline",
    connectionStatus: "not_connected",
    sourceArea: "Tasks",
    defaultXp: 2,
    allowedRuleTypes: ["xp"],
  },
  {
    actionType: "blocked_task_unblocked",
    label: "Blocked task unblocked",
    description: "Reward when a blocked task is unblocked and completed.",
    category: "Optimization / discipline",
    connectionStatus: "not_connected",
    sourceArea: "Tasks",
    defaultXp: 2,
    allowedRuleTypes: ["xp"],
  },
];

export const PENALTY_ACTION_CATALOG: CatalogPenalty[] = [
  {
    actionType: "task_overdue",
    label: "Task overdue",
    description: "Deduct XP when a task passes its due date.",
    category: "Tasks",
    connectionStatus: "not_connected",
    sourceArea: "Tasks",
    defaultPenalty: 5,
  },
  {
    actionType: "daily_metrics_missing",
    label: "Daily metrics missing",
    description: "Deduct XP when required daily metrics are missing.",
    category: "Reporting",
    connectionStatus: "not_connected",
    sourceArea: "Reports",
    defaultPenalty: 5,
  },
  {
    actionType: "campaign_review_overdue",
    label: "Campaign review overdue",
    description: "Deduct XP when campaign review is overdue.",
    category: "Campaign review",
    connectionStatus: "not_connected",
    sourceArea: "Campaign Review",
    defaultPenalty: 5,
  },
  {
    actionType: "testing_batch_stale",
    label: "Testing batch stale",
    description: "Deduct XP when a testing batch is stuck too long.",
    category: "Testing / Batch",
    connectionStatus: "not_connected",
    sourceArea: "Testing Batches",
    defaultPenalty: 3,
  },
  {
    actionType: "working_campaign_no_update",
    label: "Working campaign no update",
    description: "Deduct XP when a working campaign has no recent updates.",
    category: "Campaigns",
    connectionStatus: "not_connected",
    sourceArea: "Live Campaigns",
    defaultPenalty: 4,
  },
  {
    actionType: "repeated_data_error",
    label: "Repeated data error",
    description: "Deduct XP for repeated data quality errors.",
    category: "Data quality",
    connectionStatus: "not_connected",
    sourceArea: "Reports",
    defaultPenalty: 5,
  },
  {
    actionType: "campaign_left_blocked_too_long",
    label: "Campaign left blocked too long",
    description: "Deduct XP when a campaign stays blocked beyond grace period.",
    category: "Campaigns",
    connectionStatus: "not_connected",
    sourceArea: "Campaigns",
    defaultPenalty: 5,
  },
];

export const BONUS_EVENT_CATALOG: CatalogBonusEvent[] = [
  {
    actionType: "monthly_revenue_goal_hit",
    label: "Monthly revenue goal hit",
    description: "XP awarded when a worker hits their monthly revenue goal (via goal plan XP reward).",
    category: "Monthly goals",
    connectionStatus: "connected",
    sourceArea: "Goal completion XP (xp_ledger)",
    defaultXp: 500,
  },
  {
    actionType: "monthly_testing_goal_hit",
    label: "Monthly testing goal hit",
    description: "XP awarded when a worker hits their monthly testing goal.",
    category: "Monthly goals",
    connectionStatus: "connected",
    sourceArea: "Goal completion XP (xp_ledger)",
    defaultXp: 200,
  },
  {
    actionType: "monthly_working_goal_hit",
    label: "Monthly working campaigns goal hit",
    description: "XP awarded when a worker hits their working campaigns goal.",
    category: "Monthly goals",
    connectionStatus: "connected",
    sourceArea: "Goal completion XP (xp_ledger)",
    defaultXp: 300,
  },
  {
    actionType: "winner_created",
    label: "Winner created",
    description: "One-time bonus when a winner is created.",
    category: "Winners",
    connectionStatus: "not_connected",
    sourceArea: "Winners",
    defaultXp: 50,
  },
  {
    actionType: "high_profit_day",
    label: "High profit day",
    description: "Bonus for an exceptional profit day.",
    category: "Performance",
    connectionStatus: "not_connected",
    sourceArea: "Performance metrics",
    defaultXp: 25,
  },
  {
    actionType: "first_winner_of_month",
    label: "First winner of month",
    description: "Bonus for the first winner found in a month.",
    category: "Winners",
    connectionStatus: "not_connected",
    sourceArea: "Winners",
    defaultXp: 40,
  },
  {
    actionType: "perfect_week_reporting",
    label: "Perfect week reporting",
    description: "Bonus when all reporting is complete for a week.",
    category: "Reporting",
    connectionStatus: "not_connected",
    sourceArea: "Reports",
    defaultXp: 30,
  },
  {
    actionType: "all_tasks_completed_on_time_week",
    label: "All tasks on time (week)",
    description: "Bonus when all tasks are completed on time in a week.",
    category: "Discipline",
    connectionStatus: "not_connected",
    sourceArea: "Tasks",
    defaultXp: 20,
  },
  {
    actionType: "top_worker_month",
    label: "Top worker of month",
    description: "Bonus for ranking #1 on the monthly XP leaderboard.",
    category: "Leaderboard",
    connectionStatus: "not_connected",
    sourceArea: "XP Leaderboard",
    defaultXp: 100,
  },
  {
    actionType: "overachieved_monthly_goal",
    label: "Overachieved monthly goal",
    description: "Bonus when a worker exceeds a monthly goal target (overachieve XP on goal plan).",
    category: "Monthly goals",
    connectionStatus: "connected",
    sourceArea: "Goal completion XP (overachieve)",
    defaultXp: 50,
  },
];

const xpByType = new Map(XP_ACTION_CATALOG.map((a) => [a.actionType, a]));
const xpByLegacy = new Map<string, CatalogAction>();
for (const a of XP_ACTION_CATALOG) {
  for (const id of a.legacyRuleIds ?? []) xpByLegacy.set(id, a);
}

export function getXpCatalogEntry(actionType: string): CatalogAction | undefined {
  return xpByType.get(actionType);
}

export function resolveXpCatalogFromRule(rule: { actionType?: string; id?: string }): CatalogAction | undefined {
  if (rule.actionType) return xpByType.get(rule.actionType);
  if (rule.id) return xpByLegacy.get(rule.id) ?? xpByType.get(rule.id);
  return undefined;
}

export function catalogCategoryGroups<T extends { category: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return map;
}

export function connectedXpActionTypes(): string[] {
  return XP_ACTION_CATALOG.filter((a) => a.connectionStatus === "connected").map((a) => a.actionType);
}

export function connectedBonusEventTypes(): string[] {
  return BONUS_EVENT_CATALOG.filter((a) => a.connectionStatus === "connected").map((a) => a.actionType);
}

/** Task type → catalog actionType for awardTaskCompletionXp */
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
