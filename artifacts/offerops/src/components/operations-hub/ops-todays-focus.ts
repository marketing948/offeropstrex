/**
 * Today’s Focus orchestration (goal pace + operational blockers + network/GEO actions).
 */

import type { TodoTask, TestingBatch } from "@workspace/api-client-react";
import type { BatchHealthResponse } from "@/lib/batch-health-api";
import {
  buildMissionControlRows,
  recommendationSummary,
} from "@/lib/mission-control-health";
import {
  buildDailyFocusActions,
  type FocusItem,
  type GoalCardModel,
  type MetricSliceBundle,
  type OpsCampaignRowLite,
  type TodaysFocus,
} from "@/components/operations-hub/ops-goal-focus";
import { currentMonthKey } from "@/lib/performance-engine/api";

export type {
  FocusItem,
  FocusItemContext,
  GoalCardModel,
  GoalKind,
  OpsCampaignRowLite,
  TodaysFocus,
  FocusActionType,
  MetricSliceBundle,
  NetworkGeoSlice,
  MissionCategory,
} from "@/components/operations-hub/ops-goal-focus";

export {
  buildDailyFocusActions,
  buildAdminInterventionFocus,
  computeGoalBasedFocus,
  allocateCatchUpAcrossSlices,
  priorityScore,
  enrichSlicesWithPerformance,
  buildPerfBoostBuckets,
  suggestReportsAction,
  reportsPaceFields,
  REVENUE_BEHIND_THRESHOLD_PCT,
} from "@/components/operations-hub/ops-goal-focus";

export type { AdminWorkerFocusInput } from "@/components/operations-hub/ops-goal-focus";

export { isScalingOpportunity } from "@/components/operations-hub/scaling-opportunity";

export type OperationalFocusInput = {
  batches: TestingBatch[];
  tasks: TodoTask[];
  healthByBatchId: Map<number, BatchHealthResponse | undefined>;
  today: string;
};

function batchLabel(batch: TestingBatch): string {
  const network = batch.affiliateNetwork?.trim() || "Unknown network";
  const geo = batch.geo?.trim() || "Unknown GEO";
  return `${network} ${geo}`;
}

export function computeTodaysFocus(
  goalCards: GoalCardModel[],
  hasAnyActivity: boolean,
  operational: OperationalFocusInput,
  campaigns: OpsCampaignRowLite[] = [],
  hasGeoTargets = false,
  options: {
    slices?: MetricSliceBundle;
    isAdmin?: boolean;
    employeeName?: string | null;
    monthKey?: string;
    now?: Date;
  } = {},
): TodaysFocus {
  const hasGoals = goalCards.some((g) => g.target > 0);
  const monthKey = options.monthKey ?? currentMonthKey();
  const slices: MetricSliceBundle = options.slices ?? {
    testing: [],
    working: [],
    revenue: [],
  };

  if (!hasAnyActivity && !hasGeoTargets && !hasGoals && goalCards[0]?.actual === 0) {
    const hasOps =
      operational.tasks.some((t) => t.status === "BLOCKED") ||
      operational.tasks.some((t) => {
        if (t.status === "DONE" || t.status === "BLOCKED") return false;
        if (!t.dueDate?.trim()) return false;
        return t.dueDate.slice(0, 10) < operational.today;
      });
    if (!hasOps) return { items: [], empty: true };
  }

  const items: FocusItem[] = [
    ...buildDailyFocusActions({
      monthKey,
      goalCards,
      slices,
      campaigns,
      isAdmin: options.isAdmin,
      employeeName: options.employeeName,
      now: options.now,
      maxActions: 5,
    }),
  ];

  const batchById = new Map(operational.batches.map((b) => [b.id, b]));
  const criticalRows = buildMissionControlRows(
    operational.batches,
    operational.healthByBatchId,
    new Map(operational.batches.map((b) => [b.id, { loading: false, error: false }])),
  ).filter((row) => row.healthState === "critical");

  if (items.length < 5 && criticalRows.length > 0 && !items.some((i) => i.context?.batchId)) {
    const row = criticalRows[0]!;
    items.push({
      tier: items.length === 0 ? "primary" : "secondary",
      emoji: "🔥",
      title: "Critical batch",
      text: `Resolve critical issue on ${row.batch.batchName}.`,
      reason: row.health
        ? `${recommendationSummary(row.health.recommendations)} — blocking forward progress.`
        : "Batch health flagged as critical.",
      context: {
        kind: "action",
        actionType: "campaign_health",
        actionLabel: "Review campaigns",
        batchId: row.batch.id,
        batchName: row.batch.batchName,
        suggestedAction: "Review batch health and resolve the critical blocker.",
        navigationPath: `/testing-batches/${row.batch.id}`,
      },
    });
  }

  const blockedTasks = operational.tasks.filter((t) => t.status === "BLOCKED");
  if (items.length < 5 && blockedTasks.length > 0) {
    const task = blockedTasks[0]!;
    const batch = task.relatedBatchId != null ? batchById.get(task.relatedBatchId) : undefined;
    const label = batch ? batchLabel(batch) : task.title;
    items.push({
      tier: items.length === 0 ? "primary" : "secondary",
      emoji: "🚫",
      title: "Blocked work",
      text: batch ? `Resolve blocked ${label} batch.` : `Unblock: ${task.title}.`,
      reason: batch
        ? "This batch is blocking new testing activity."
        : "Blocked task is stopping pipeline flow.",
      context: {
        kind: "action",
        actionType: "campaign_health",
        actionLabel: "Review campaigns",
        batchId: task.relatedBatchId ?? undefined,
        batchName: batch?.batchName ?? task.batchName ?? undefined,
        taskIds: blockedTasks.map((t) => t.id),
        suggestedAction: batch
          ? "Open the batch and clear the blocked task."
          : "Complete or unblock the related task.",
        navigationPath: batch ? `/testing-batches/${batch.id}` : "/tasks",
      },
    });
  }

  const finalItems = items.slice(0, 5).map((item, i) => ({
    ...item,
    tier: (i === 0 ? "primary" : i === 1 ? "secondary" : "tertiary") as FocusItem["tier"],
  }));

  return { items: finalItems, empty: finalItems.length === 0 };
}
