/**
 * Pure goal-based Focus Today cards (no React, relative imports for Node tests).
 */

import {
  ceilCount,
  formatOpsMetric,
  type PaceEvaluation,
} from "./ops-v2-metrics.ts";

export type GoalKind = "revenue" | "testing" | "working";

export type GoalCardModel = {
  kind: GoalKind;
  label: string;
  icon: "revenue" | "testing" | "working";
  actual: number;
  target: number;
  gap: number;
  pace: PaceEvaluation;
  format: "currency" | "count";
  networkRows?: unknown[];
  supportsGeoDrilldown?: boolean;
};

export type FocusItemContext = {
  network?: string;
  geo?: string;
  batchId?: number;
  batchName?: string;
  taskIds?: number[];
  suggestedAction?: string;
  metricLabel?: string;
  metricValue?: string;
  navigationPath?: string;
  todayTarget?: string;
  currentValue?: string;
  expectedByNow?: string;
  paceGapLabel?: string;
  progressPct?: number;
  progressLabel?: string;
  kind?: GoalKind | "action" | "scaling";
};

export type FocusItem = {
  tier: "primary" | "secondary" | "tertiary";
  emoji: string;
  title: string;
  text: string;
  reason?: string;
  context?: FocusItemContext;
};

export type TodaysFocus = {
  items: FocusItem[];
  empty: boolean;
};

export type OpsCampaignRowLite = {
  status: string;
  campaignPurpose?: string | null;
  offerCount?: number | null;
};

type PaceFocusCandidate = {
  kind: GoalKind;
  urgency: number;
  item: FocusItem;
};

function paceProgressPct(actual: number, expectedByNow: number): number {
  if (expectedByNow <= 0) return actual > 0 ? 100 : 0;
  return Math.min(100, Math.round((actual / expectedByNow) * 100));
}

export function buildGoalPaceFocusItem(card: GoalCardModel): PaceFocusCandidate | null {
  if (card.target <= 0) {
    return {
      kind: card.kind,
      urgency: -1,
      item: {
        tier: "tertiary",
        emoji: card.kind === "revenue" ? "💵" : card.kind === "testing" ? "🧪" : "📡",
        title:
          card.kind === "revenue"
            ? "Revenue focus"
            : card.kind === "testing"
              ? "Testing focus"
              : "Working focus",
        text: "No goal set.",
        reason: `Configure a monthly ${card.label.toLowerCase()} target to unlock pacing guidance.`,
        context: {
          kind: card.kind,
          progressLabel: "No goal set",
          progressPct: 0,
          todayTarget: "—",
          currentValue: formatOpsMetric(card.actual, card.format),
          expectedByNow: "—",
          paceGapLabel: "—",
          suggestedAction: "Set monthly goals in Performance Engine settings.",
          navigationPath: "/performance/monthly-goals",
        },
      },
    };
  }

  const todayTarget = formatOpsMetric(card.pace.dailyExpected, card.format);
  const currentValue = formatOpsMetric(card.actual, card.format);
  const expectedByNow = formatOpsMetric(card.pace.expectedByNow, card.format);
  const behindUnits = Math.max(0, card.pace.expectedByNow - card.actual);
  const behindDisplay = formatOpsMetric(behindUnits, card.format);
  const catchUp =
    card.format === "count"
      ? Math.max(ceilCount(card.pace.dailyExpected), ceilCount(behindUnits))
      : ceilCount(behindUnits);
  const pacePct = paceProgressPct(card.actual, card.pace.expectedByNow);
  const behind = card.pace.paceGap < 0 && card.pace.paceStatus !== "Completed";
  const urgency = behind ? Math.abs(card.pace.paceGap) : card.pace.paceGap * -0.01;

  if (card.kind === "revenue") {
    return {
      kind: "revenue",
      urgency,
      item: {
        tier: behind ? "primary" : "secondary",
        emoji: "💵",
        title: "Revenue focus",
        text: behind
          ? "Revenue is behind pace. Focus on campaigns with highest profit/ROI today."
          : "Revenue is on pace. Protect winners and push profitable traffic.",
        reason: behind
          ? `You are ${behindDisplay} behind expected pace this month.`
          : `Current ${currentValue} vs ${expectedByNow} expected by now.`,
        context: {
          kind: "revenue",
          todayTarget,
          currentValue,
          expectedByNow,
          paceGapLabel: behind ? `${behindDisplay} behind` : "On pace",
          progressPct: pacePct,
          progressLabel: "Month progress vs today’s expected pace",
          metricLabel: "Revenue vs pace",
          metricValue: `${currentValue} / ${expectedByNow}`,
          suggestedAction: behind
            ? "Open Live Campaigns and prioritize highest profit/ROI rows."
            : "Keep monitoring Live Campaigns and scale profitable winners.",
          navigationPath: "/live-campaigns",
        },
      },
    };
  }

  if (card.kind === "testing") {
    const actionCount = behind ? Math.max(1, catchUp) : Math.max(1, ceilCount(card.pace.dailyExpected));
    return {
      kind: "testing",
      urgency,
      item: {
        tier: behind ? "primary" : "secondary",
        emoji: "🧪",
        title: "Testing focus",
        text: behind
          ? `Create ${actionCount} testing campaign${actionCount === 1 ? "" : "s"} today to get back on pace.`
          : `Create ${actionCount} testing campaign${actionCount === 1 ? "" : "s"} today to stay on pace.`,
        reason: behind
          ? `You are ${behindDisplay} testing campaigns behind pace.`
          : `Today’s target is ${todayTarget}; current month total is ${currentValue}.`,
        context: {
          kind: "testing",
          todayTarget,
          currentValue,
          expectedByNow,
          paceGapLabel: behind ? `${behindDisplay} behind` : "On pace",
          progressPct: pacePct,
          progressLabel: "Month progress vs today’s expected pace",
          metricLabel: "Testing vs pace",
          metricValue: `${currentValue} / ${expectedByNow}`,
          suggestedAction: `Open Testing Batches and launch ${actionCount} new test${actionCount === 1 ? "" : "s"}.`,
          navigationPath: "/testing-batches",
        },
      },
    };
  }

  if (behind) {
    const actionCount = Math.max(1, catchUp);
    return {
      kind: "working",
      urgency,
      item: {
        tier: "primary",
        emoji: "📡",
        title: "Working focus",
        text: `Move/launch ${actionCount} working campaign${actionCount === 1 ? "" : "s"} to get back on pace.`,
        reason: `You are ${behindDisplay} working campaigns behind pace.`,
        context: {
          kind: "working",
          todayTarget,
          currentValue,
          expectedByNow,
          paceGapLabel: `${behindDisplay} behind`,
          progressPct: pacePct,
          progressLabel: "Month progress vs today’s expected pace",
          metricLabel: "Working vs pace",
          metricValue: `${currentValue} / ${expectedByNow}`,
          suggestedAction: `Promote ${actionCount} tested winner${actionCount === 1 ? "" : "s"} to working live campaigns.`,
          navigationPath: "/live-campaigns",
        },
      },
    };
  }

  return {
    kind: "working",
    urgency,
    item: {
      tier: "secondary",
      emoji: "📡",
      title: "Working focus",
      text: "Working campaigns are on pace. Review scaling opportunities.",
      reason: `Current ${currentValue} vs ${expectedByNow} expected by now.`,
      context: {
        kind: "working",
        todayTarget,
        currentValue,
        expectedByNow,
        paceGapLabel: "On pace / ahead",
        progressPct: pacePct,
        progressLabel: "Month progress vs today’s expected pace",
        metricLabel: "Working vs pace",
        metricValue: `${currentValue} / ${expectedByNow}`,
        suggestedAction: "Open Live Campaigns Working tab and review Scaling Opportunities.",
        navigationPath: "/live-campaigns",
      },
    },
  };
}

export function missingOfferCountFocus(campaigns: OpsCampaignRowLite[]): FocusItem | null {
  const missing = campaigns.filter(
    (c) =>
      (c.campaignPurpose === "working" || c.campaignPurpose === "scaling") &&
      c.status === "live" &&
      (c.offerCount == null || c.offerCount <= 0),
  );
  if (missing.length === 0) return null;
  return {
    tier: "secondary",
    emoji: "🧩",
    title: "Missing offer count",
    text: `Review ${missing.length} campaign${missing.length === 1 ? "" : "s"} missing offer count.`,
    reason: "Offer count is required to evaluate visits-per-offer pacing and Action Required.",
    context: {
      kind: "action",
      progressPct: 0,
      progressLabel: "Action required",
      metricLabel: "Missing offer count",
      metricValue: String(missing.length),
      suggestedAction: "Open Live Campaigns and set offer count on each flagged row.",
      navigationPath: "/live-campaigns",
    },
  };
}

export function computeGoalBasedFocus(
  goalCards: GoalCardModel[],
  campaigns: OpsCampaignRowLite[] = [],
): FocusItem[] {
  const candidates = goalCards
    .map((card) => buildGoalPaceFocusItem(card))
    .filter((c): c is PaceFocusCandidate => c != null)
    .sort((a, b) => b.urgency - a.urgency);

  const items: FocusItem[] = [];
  for (const candidate of candidates) {
    if (items.length >= 3) break;
    if (candidate.urgency < 0 && items.length > 0) continue;
    items.push({
      ...candidate.item,
      tier: items.length === 0 ? "primary" : items.length === 1 ? "secondary" : "tertiary",
    });
  }

  const missing = missingOfferCountFocus(campaigns);
  if (missing && items.length < 3) {
    if (items.length >= 1) {
      items.splice(Math.min(1, items.length), 0, {
        ...missing,
        tier: items.length === 0 ? "primary" : "secondary",
      });
    } else {
      items.push({ ...missing, tier: "primary" });
    }
  }

  const seen = new Set<string>();
  const unique: FocusItem[] = [];
  for (const item of items) {
    if (seen.has(item.title)) continue;
    seen.add(item.title);
    unique.push({
      ...item,
      tier: unique.length === 0 ? "primary" : unique.length === 1 ? "secondary" : "tertiary",
    });
    if (unique.length >= 3) break;
  }
  return unique;
}

export function ensureThreeFocusItems(items: FocusItem[], goalCards: GoalCardModel[]): FocusItem[] {
  const result = [...items];
  const filled = computeGoalBasedFocus(goalCards);
  for (const item of filled) {
    if (result.length >= 3) break;
    if (!result.some((r) => r.title === item.title)) {
      result.push({
        ...item,
        tier: result.length === 0 ? "primary" : result.length === 1 ? "secondary" : "tertiary",
      });
    }
  }
  return result.slice(0, 3);
}
