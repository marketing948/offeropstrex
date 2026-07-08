/**
 * Goal-Based Today Focus — daily action engine (pure, Node-testable).
 */

import {
  ceilCount,
  evaluatePace,
  formatOpsMetric,
  type PaceEvaluation,
} from "./ops-v2-metrics.ts";
import { isScalingOpportunity } from "./scaling-opportunity.ts";

export type GoalKind = "revenue" | "testing" | "working";

export type FocusActionType =
  | "testing_action"
  | "scaling_opportunity"
  | "campaign_health"
  | "revenue_rescue"
  | "admin_intervention"
  | "working_action";

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

export type MissionCategory =
  | "testing"
  | "working"
  | "scaling"
  | "fixes"
  | "revenue"
  | "admin";

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
  actionType?: FocusActionType;
  actionLabel?: string;
  employeeName?: string;
  allocationLines?: string[];
  campaignIds?: number[];
  /** Daily Mission Board — actionable units for this row (capped). */
  dailyTargetUnits?: number;
  completedTodayUnits?: number;
  missionCategory?: MissionCategory;
  completionSource?: "createdAt" | "updatedAt" | "none" | "advisory";
  completionLabel?: string;
  /** False when we cannot reliably measure today-completion. */
  canTrackCompletion?: boolean;
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
  id?: number;
  status: string;
  campaignPurpose?: string | null;
  offerCount?: number | null;
  liveStartedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  revenue?: number | string | null;
  cost?: number | string | null;
  roi?: number | string | null;
  employeeName?: string | null;
  employeeId?: number | null;
  batchAffiliateNetwork?: string | null;
  affiliateNetworkName?: string | null;
  batchGeo?: string | null;
  geo?: string | null;
};

export type NetworkGeoSlice = {
  network: string;
  geo?: string | null;
  current: number;
  target: number;
  /** Optional performance boost inputs (revenue/profit/ROI). */
  revenue?: number;
  profit?: number;
  roi?: number;
};

export type MetricSliceBundle = {
  testing: NetworkGeoSlice[];
  working: NetworkGeoSlice[];
  revenue: NetworkGeoSlice[];
};

export type FocusEngineOptions = {
  monthKey: string;
  goalCards: GoalCardModel[];
  slices: MetricSliceBundle;
  campaigns?: OpsCampaignRowLite[];
  isAdmin?: boolean;
  employeeName?: string | null;
  now?: Date;
  maxActions?: number;
  /** Revenue paceVariancePct must be <= this (e.g. -20) to show revenue rescue. */
  revenueBehindThresholdPct?: number;
};

/** Per-worker input for admin intervention queue (all-employees Focus). */
export type AdminWorkerFocusInput = {
  employeeId: number;
  employeeName: string;
  goalCards: GoalCardModel[];
  slices: MetricSliceBundle;
  campaigns?: OpsCampaignRowLite[];
};

const PROGRESS_LABEL = "Month progress vs today’s expected pace";
export const REVENUE_BEHIND_THRESHOLD_PCT = -20;

function tierForIndex(i: number): FocusItem["tier"] {
  if (i === 0) return "primary";
  if (i === 1) return "secondary";
  return "tertiary";
}

function paceProgressPct(actual: number, expectedByNow: number): number {
  if (expectedByNow <= 0) return actual > 0 ? 100 : 0;
  return Math.min(100, Math.round((actual / expectedByNow) * 100));
}

/**
 * priorityScore = paceGapWeight * goalWeight * performanceBoost
 * - pace gap is primary (behind units)
 * - goal required (target > 0)
 * - performance boost: profit/ROI preferred when available, else revenue
 */
export function priorityScore(slice: NetworkGeoSlice, monthKey: string, now = new Date()): number {
  if (!(slice.target > 0)) return -1;
  const pace = evaluatePace(slice.current, slice.target, monthKey, now);
  const behind = Math.max(0, pace.expectedByNow - slice.current);
  if (behind <= 0) return -1;
  const paceGapWeight = behind;
  const goalWeight = 1;
  const revenue = Number(slice.revenue ?? 0);
  const profit = Number(slice.profit ?? 0);
  const roi = Number(slice.roi ?? 0);
  const hasProfit = slice.profit != null && Number.isFinite(Number(slice.profit));
  const hasRoi = slice.roi != null && Number.isFinite(Number(slice.roi));
  let boost = 1;
  if (hasProfit && profit > 0) boost += 0.4;
  else if (revenue > 0) boost += 0.25;
  if (hasRoi && roi > 0) boost += 0.2;
  if (hasProfit && hasRoi && profit > 0 && roi > 0) boost += 0.2;
  return paceGapWeight * goalWeight * boost;
}

/** Aggregate profit/revenue/ROI onto Network/GEO goal slices from performance + campaigns. */
export function enrichSlicesWithPerformance(
  slices: NetworkGeoSlice[],
  perfByNetworkGeo: Map<string, { revenue: number; profit: number; spend: number }>,
): NetworkGeoSlice[] {
  return slices.map((s) => {
    const keyExact = s.geo ? `${s.network}|${s.geo}` : `${s.network}|`;
    const keyNet = `${s.network}|`;
    const bucket = perfByNetworkGeo.get(keyExact) ?? perfByNetworkGeo.get(keyNet);
    if (!bucket) return s;
    const revenue = s.revenue ?? bucket.revenue;
    const profit = s.profit ?? bucket.profit;
    const roi =
      s.roi ??
      (bucket.spend > 0 ? ((bucket.revenue - bucket.spend) / bucket.spend) * 100 : 0);
    return { ...s, revenue, profit, roi };
  });
}

export function buildPerfBoostBuckets(
  rows: { network: string; geo?: string | null; revenue: number; profit: number; spend: number }[],
): Map<string, { revenue: number; profit: number; spend: number }> {
  const map = new Map<string, { revenue: number; profit: number; spend: number }>();
  for (const r of rows) {
    const net = r.network.trim() || "(unset)";
    const geo = (r.geo ?? "").trim();
    for (const key of [`${net}|${geo}`, `${net}|`] as const) {
      const cur = map.get(key) ?? { revenue: 0, profit: 0, spend: 0 };
      cur.revenue += r.revenue;
      cur.profit += r.profit;
      cur.spend += r.spend;
      map.set(key, cur);
    }
  }
  return map;
}

export function allocateCatchUpAcrossSlices(
  slices: NetworkGeoSlice[],
  totalCatchUp: number,
  monthKey: string,
  now = new Date(),
): { network: string; geo?: string | null; count: number; score: number }[] {
  const catchUp = Math.max(0, ceilCount(totalCatchUp));
  if (catchUp <= 0) return [];

  const ranked = slices
    .map((s) => ({
      slice: s,
      score: priorityScore(s, monthKey, now),
      behind: (() => {
        const pace = evaluatePace(s.current, s.target, monthKey, now);
        return Math.max(0, pace.expectedByNow - s.current);
      })(),
    }))
    .filter((r) => r.score > 0 && r.behind > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return [];

  const totalBehind = ranked.reduce((s, r) => s + r.behind, 0);
  const out: { network: string; geo?: string | null; count: number; score: number }[] = [];
  let remaining = catchUp;

  for (let i = 0; i < ranked.length && remaining > 0; i++) {
    const row = ranked[i]!;
    const isLast = i === ranked.length - 1;
    let share = isLast
      ? remaining
      : Math.max(1, Math.round((row.behind / totalBehind) * catchUp));
    share = Math.min(share, remaining, ceilCount(row.behind));
    if (share <= 0) continue;
    out.push({
      network: row.slice.network,
      geo: row.slice.geo ?? null,
      count: share,
      score: row.score,
    });
    remaining -= share;
  }

  if (remaining > 0 && out[0]) {
    out[0] = { ...out[0], count: out[0].count + remaining };
  }

  return out.filter((r) => r.count > 0);
}

function formatAllocationLines(
  rows: { network: string; geo?: string | null; count: number }[],
): string[] {
  return rows.slice(0, 6).map((r) => {
    const where = r.geo ? `${r.network} / ${r.geo}` : r.network;
    return `${where}: ${r.count}`;
  });
}

function campaignProfit(c: OpsCampaignRowLite): number {
  const revenue = Number(c.revenue ?? 0);
  const cost = Number(c.cost ?? 0);
  return revenue - cost;
}

function campaignRoi(c: OpsCampaignRowLite): number {
  const raw = Number(c.roi ?? 0);
  return Math.abs(raw) <= 1 && raw !== 0 ? raw * 100 : raw;
}

export function buildTestingFocusAction(
  card: GoalCardModel,
  slices: NetworkGeoSlice[],
  monthKey: string,
  opts: { employeeName?: string | null; isAdmin?: boolean; now?: Date },
): { score: number; item: FocusItem } | null {
  if (!(card.target > 0)) return null;
  const behindUnits = Math.max(0, card.pace.expectedByNow - card.actual);
  const behind = card.pace.paceGap < 0 && card.pace.paceStatus !== "Completed";
  if (!behind || behindUnits <= 0) return null;
  const catchUp = Math.max(ceilCount(card.pace.dailyExpected), ceilCount(behindUnits));
  const alloc = allocateCatchUpAcrossSlices(slices, catchUp, monthKey, opts.now);
  const lines = formatAllocationLines(alloc);
  const score = behindUnits * 10 + (alloc[0]?.score ?? 0);
  const who = opts.isAdmin && opts.employeeName ? opts.employeeName : null;
  const topWhere = alloc[0]
    ? alloc[0].geo
      ? `${alloc[0].network} / ${alloc[0].geo}`
      : alloc[0].network
    : null;
  const primarySentence = who
    ? `${who} needs ${catchUp} testing campaign${catchUp === 1 ? "" : "s"}${topWhere ? ` on ${topWhere}` : ""}`
    : `Create ${catchUp} testing campaign${catchUp === 1 ? "" : "s"} today${topWhere ? ` for ${topWhere}` : ""}`;

  return {
    score,
    item: {
      tier: "primary",
      emoji: "🧪",
      title: "Testing focus",
      text: primarySentence,
      reason: lines.length > 1 ? lines.map((l) => `• ${l}`).join("\n") : undefined,
      context: {
        kind: "testing",
        actionType: "testing_action",
        actionLabel: "Create campaigns",
        todayTarget: formatOpsMetric(card.pace.dailyExpected, "count"),
        currentValue: formatOpsMetric(card.actual, "count"),
        expectedByNow: formatOpsMetric(card.pace.expectedByNow, "count"),
        paceGapLabel: `${formatOpsMetric(behindUnits, "count")} behind`,
        progressPct: paceProgressPct(card.actual, card.pace.expectedByNow),
        progressLabel: PROGRESS_LABEL,
        allocationLines: lines,
        employeeName: opts.employeeName ?? undefined,
        navigationPath: "/testing-batches",
        suggestedAction: "Open Testing Batches and create the allocated network/GEO tests.",
        network: alloc[0]?.network,
        geo: alloc[0]?.geo ?? undefined,
        dailyTargetUnits: catchUp,
        missionCategory: "testing",
      },
    },
  };
}

export function buildWorkingFocusAction(
  card: GoalCardModel,
  slices: NetworkGeoSlice[],
  monthKey: string,
  opts: { employeeName?: string | null; isAdmin?: boolean; now?: Date },
): { score: number; item: FocusItem } | null {
  if (!(card.target > 0)) return null;
  const behindUnits = Math.max(0, card.pace.expectedByNow - card.actual);
  const behind = card.pace.paceGap < 0 && card.pace.paceStatus !== "Completed";
  if (!behind) return null;
  const catchUp = Math.max(1, Math.max(ceilCount(card.pace.dailyExpected), ceilCount(behindUnits)));
  const alloc = allocateCatchUpAcrossSlices(slices, catchUp, monthKey, opts.now);
  const lines = formatAllocationLines(alloc);
  const who = opts.isAdmin && opts.employeeName ? opts.employeeName : null;
  const topWhere = alloc[0]
    ? alloc[0].geo
      ? `${alloc[0].network} / ${alloc[0].geo}`
      : alloc[0].network
    : null;
  const text = who
    ? `${who} needs ${catchUp} working campaign${catchUp === 1 ? "" : "s"}${topWhere ? ` on ${topWhere}` : ""}`
    : `Launch/move ${catchUp} working campaign${catchUp === 1 ? "" : "s"}${topWhere ? ` for ${topWhere}` : ""}`;

  return {
    score: behindUnits * 8 + (alloc[0]?.score ?? 0),
    item: {
      tier: "primary",
      emoji: "📡",
      title: "Working focus",
      text,
      reason: lines.length > 1 ? lines.map((l) => `• ${l}`).join("\n") : undefined,
      context: {
        kind: "working",
        actionType: "working_action",
        actionLabel: "Launch/move campaigns",
        todayTarget: formatOpsMetric(card.pace.dailyExpected, "count"),
        currentValue: formatOpsMetric(card.actual, "count"),
        expectedByNow: formatOpsMetric(card.pace.expectedByNow, "count"),
        paceGapLabel: `${formatOpsMetric(behindUnits, "count")} behind`,
        progressPct: paceProgressPct(card.actual, card.pace.expectedByNow),
        progressLabel: PROGRESS_LABEL,
        allocationLines: lines,
        employeeName: opts.employeeName ?? undefined,
        navigationPath: "/live-campaigns",
        suggestedAction: "Promote tested winners to working live campaigns.",
        network: alloc[0]?.network,
        geo: alloc[0]?.geo ?? undefined,
        dailyTargetUnits: catchUp,
        missionCategory: "working",
      },
    },
  };
}

export function buildRevenueRescueAction(
  card: GoalCardModel,
  slices: NetworkGeoSlice[],
  monthKey: string,
  opts: {
    employeeName?: string | null;
    isAdmin?: boolean;
    now?: Date;
    thresholdPct?: number;
  },
): { score: number; item: FocusItem } | null {
  if (!(card.target > 0)) return null;
  const threshold = opts.thresholdPct ?? REVENUE_BEHIND_THRESHOLD_PCT;
  const behind = card.pace.paceVariancePct <= threshold;
  if (!behind) return null;

  const ranked = slices
    .map((s) => ({ slice: s, score: priorityScore(s, monthKey, opts.now) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = ranked[0]?.slice;
  const who = opts.isAdmin && opts.employeeName ? opts.employeeName : null;
  const where = top
    ? top.geo
      ? `${top.network} / ${top.geo}`
      : top.network
    : "priority networks";
  const behindAmt = formatOpsMetric(Math.max(0, card.pace.expectedByNow - card.actual), "currency");

  return {
    // Keep revenue below testing/working; only compete with health/scaling when severely behind.
    score:
      Math.abs(card.pace.paceVariancePct) +
      (card.pace.paceVariancePct <= -50 ? 250 : 0),
    item: {
      tier: "tertiary",
      emoji: "💵",
      title: "Revenue rescue",
      text: who
        ? `${who} revenue is severely behind pace on ${where}`
        : `Revenue is behind pace on ${where}`,
      reason: `Pace ${card.pace.paceVariancePct.toFixed(1)}% vs expected (${behindAmt} gap).`,
      context: {
        kind: "revenue",
        actionType: "revenue_rescue",
        actionLabel: "Check revenue drivers",
        todayTarget: formatOpsMetric(card.pace.dailyExpected, "currency"),
        currentValue: formatOpsMetric(card.actual, "currency"),
        expectedByNow: formatOpsMetric(card.pace.expectedByNow, "currency"),
        paceGapLabel: `${behindAmt} behind`,
        progressPct: paceProgressPct(card.actual, card.pace.expectedByNow),
        progressLabel: PROGRESS_LABEL,
        employeeName: opts.employeeName ?? undefined,
        navigationPath: "/live-campaigns",
        network: top?.network,
        geo: top?.geo ?? undefined,
        suggestedAction: "Open Live Campaigns and prioritize highest profit/ROI rows.",
        dailyTargetUnits: 1,
        missionCategory: "revenue",
        canTrackCompletion: false,
        completionSource: "advisory",
        completionLabel: "Advisory — check revenue drivers",
      },
    },
  };
}

export function buildMissingOfferCountAction(
  campaigns: OpsCampaignRowLite[],
  opts: { employeeName?: string | null; isAdmin?: boolean },
): { score: number; item: FocusItem } | null {
  const missing = campaigns.filter(
    (c) =>
      (c.campaignPurpose === "working" || c.campaignPurpose === "scaling") &&
      c.status === "live" &&
      (c.offerCount == null || c.offerCount <= 0),
  );
  if (missing.length === 0) return null;
  const who = opts.isAdmin && opts.employeeName ? opts.employeeName : null;
  return {
    score: missing.length * 6,
    item: {
      tier: "secondary",
      emoji: "🧩",
      title: "Campaign health",
      text: who
        ? `${who} has ${missing.length} campaign${missing.length === 1 ? "" : "s"} missing offer count`
        : `Add offer count to ${missing.length} campaign${missing.length === 1 ? "" : "s"}`,
      reason: "Required for visits-per-offer pacing.",
      context: {
        kind: "action",
        actionType: "campaign_health",
        actionLabel: "Add offer count",
        progressPct: 0,
        progressLabel: "Action required",
        metricLabel: "Missing offer count",
        metricValue: String(missing.length),
        campaignIds: missing.map((c) => c.id).filter((id): id is number => id != null),
        employeeName: opts.employeeName ?? undefined,
        navigationPath: "/live-campaigns",
        suggestedAction: "Open Live Campaigns and set offer count on each flagged row.",
        dailyTargetUnits: missing.length,
        missionCategory: "fixes",
      },
    },
  };
}

export function buildScalingOpportunityAction(
  campaigns: OpsCampaignRowLite[],
  opts: { employeeName?: string | null; isAdmin?: boolean; now?: Date },
): { score: number; item: FocusItem } | null {
  const now = opts.now ?? new Date();
  const scaling = campaigns.filter((c) =>
    isScalingOpportunity({
      campaignPurpose: c.campaignPurpose,
      status: c.status,
      profit: campaignProfit(c),
      roi: campaignRoi(c),
      liveStartedAt: c.liveStartedAt,
      createdAt: c.createdAt,
      now,
    }),
  );
  if (scaling.length === 0) return null;
  const who = opts.isAdmin && opts.employeeName ? opts.employeeName : null;
  return {
    score: scaling.length * 4,
    item: {
      tier: "secondary",
      emoji: "📈",
      title: "Scaling opportunities",
      text: who
        ? `${who} has ${scaling.length} scaling opportunit${scaling.length === 1 ? "y" : "ies"} ready`
        : `Review ${scaling.length} scaling opportunit${scaling.length === 1 ? "y" : "ies"}`,
      reason: "Working · profit > 0 · ROI > 0 · live ≥ 2 days.",
      context: {
        kind: "scaling",
        actionType: "scaling_opportunity",
        actionLabel: "Review scaling",
        progressPct: 100,
        progressLabel: "Ready for review",
        metricLabel: "Scaling opportunities",
        metricValue: String(scaling.length),
        campaignIds: scaling.map((c) => c.id).filter((id): id is number => id != null),
        employeeName: opts.employeeName ?? undefined,
        navigationPath: "/live-campaigns",
        suggestedAction: "Open Live Campaigns Working rows and review Scaling Opportunities.",
        dailyTargetUnits: scaling.length,
        missionCategory: "scaling",
        canTrackCompletion: false,
        completionSource: "advisory",
        completionLabel: "Review recommended",
      },
    },
  };
}

function typePriorityBoost(t?: FocusActionType): number {
  if (t === "testing_action") return 1000;
  if (t === "working_action") return 800;
  if (t === "campaign_health") return 600;
  if (t === "scaling_opportunity") return 400;
  if (t === "revenue_rescue") return 0;
  return 200;
}

function sortFocusCandidates(candidates: { score: number; item: FocusItem }[]) {
  candidates.sort((a, b) => {
    const sa = a.score + typePriorityBoost(a.item.context?.actionType);
    const sb = b.score + typePriorityBoost(b.item.context?.actionType);
    return sb - sa;
  });
}

/**
 * Collect scored Focus candidates (unsorted / uncapped). Shared by worker Focus and admin queue.
 */
export function collectFocusCandidates(
  options: FocusEngineOptions,
): { score: number; item: FocusItem }[] {
  const now = options.now ?? new Date();
  const cards = options.goalCards;
  const testing = cards.find((c) => c.kind === "testing");
  const working = cards.find((c) => c.kind === "working");
  const revenue = cards.find((c) => c.kind === "revenue");
  const hasAnyGoal = cards.some((c) => c.target > 0);

  if (!hasAnyGoal) {
    return [
      {
        score: 0,
        item: {
          tier: "primary",
          emoji: "📋",
          title: "No goals set",
          text: "No goals set for this month.",
          reason: "Configure Monthly Goals / Import Excel to unlock Today Focus.",
          context: {
            kind: "action",
            actionType: "admin_intervention",
            actionLabel: "Open Monthly Goals",
            progressLabel: "No goal set",
            progressPct: 0,
            navigationPath: "/performance/monthly-goals",
            suggestedAction: "Open Monthly Goals and set or import targets.",
            employeeName: options.employeeName ?? undefined,
          },
        },
      },
    ];
  }

  const candidates: { score: number; item: FocusItem }[] = [];

  if (testing) {
    const a = buildTestingFocusAction(testing, options.slices.testing, options.monthKey, {
      employeeName: options.employeeName,
      isAdmin: options.isAdmin,
      now,
    });
    if (a) candidates.push(a);
  }
  if (working) {
    const a = buildWorkingFocusAction(working, options.slices.working, options.monthKey, {
      employeeName: options.employeeName,
      isAdmin: options.isAdmin,
      now,
    });
    if (a) candidates.push(a);
  }

  const missing = buildMissingOfferCountAction(options.campaigns ?? [], {
    employeeName: options.employeeName,
    isAdmin: options.isAdmin,
  });
  if (missing) candidates.push(missing);

  const scaling = buildScalingOpportunityAction(options.campaigns ?? [], {
    employeeName: options.employeeName,
    isAdmin: options.isAdmin,
    now,
  });
  if (scaling) candidates.push(scaling);

  if (revenue) {
    const a = buildRevenueRescueAction(revenue, options.slices.revenue, options.monthKey, {
      employeeName: options.employeeName,
      isAdmin: options.isAdmin,
      now,
      thresholdPct: options.revenueBehindThresholdPct,
    });
    if (a) candidates.push(a);
  }

  return candidates;
}

/**
 * Build up to `maxActions` (default 5) prioritized Focus Today actions.
 */
export function buildDailyFocusActions(options: FocusEngineOptions): FocusItem[] {
  const max = options.maxActions ?? 5;
  const candidates = collectFocusCandidates(options);
  const hasAnyGoal = options.goalCards.some((c) => c.target > 0);

  if (!hasAnyGoal) {
    return candidates.slice(0, 1).map((c) => c.item);
  }

  sortFocusCandidates(candidates);

  const picked = candidates.slice(0, max).map((c, i) => ({
    ...c.item,
    tier: tierForIndex(i),
  }));

  if (picked.length === 0) {
    return [
      {
        tier: "primary",
        emoji: "✨",
        title: "On pace",
        text: "You’re on pace today. Keep monitoring working campaigns and scaling opportunities.",
        reason: "No material testing/working/revenue gaps detected.",
        context: {
          kind: "action",
          actionLabel: "Review campaigns",
          navigationPath: "/live-campaigns",
          progressPct: 100,
          progressLabel: PROGRESS_LABEL,
        },
      },
    ];
  }

  return picked;
}

/**
 * Admin all-employees Focus: union of each worker's actions, sorted by severity,
 * with employee names required. Max 5 intervention cards.
 */
export function buildAdminInterventionFocus(options: {
  monthKey: string;
  workers: AdminWorkerFocusInput[];
  now?: Date;
  maxActions?: number;
}): FocusItem[] {
  const now = options.now ?? new Date();
  const max = options.maxActions ?? 5;
  const scored: { score: number; item: FocusItem }[] = [];

  for (const worker of options.workers) {
    const candidates = collectFocusCandidates({
      monthKey: options.monthKey,
      goalCards: worker.goalCards,
      slices: worker.slices,
      campaigns: worker.campaigns,
      isAdmin: true,
      employeeName: worker.employeeName,
      now,
      maxActions: 5,
    });
    for (const c of candidates) {
      if (c.item.context?.actionType === "admin_intervention" && /No goals set/i.test(c.item.text)) {
        continue;
      }
      if (c.item.title === "On pace" || c.item.title === "No goals set") continue;
      scored.push({
        score: c.score + typePriorityBoost(c.item.context?.actionType),
        item: {
          ...c.item,
          context: {
            ...c.item.context,
            employeeName: worker.employeeName,
            actionType: c.item.context?.actionType ?? "admin_intervention",
          },
        },
      });
    }
  }

  if (scored.length === 0) {
    return [
      {
        tier: "primary",
        emoji: "✨",
        title: "Team on pace",
        text: "No workers need intervention today. Keep monitoring Working campaigns and Scaling opportunities.",
        reason: "All scoped workers are on pace or have no material gaps.",
        context: {
          kind: "action",
          actionType: "admin_intervention",
          actionLabel: "Review campaigns",
          navigationPath: "/live-campaigns",
          progressPct: 100,
          progressLabel: PROGRESS_LABEL,
        },
      },
    ];
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((c, i) => ({ ...c.item, tier: tierForIndex(i) }));
}

/** @deprecated Prefer buildDailyFocusActions — kept for older call sites. */
export function computeGoalBasedFocus(
  goalCards: GoalCardModel[],
  campaigns: OpsCampaignRowLite[] = [],
  monthKey = "",
): FocusItem[] {
  return buildDailyFocusActions({
    monthKey,
    goalCards,
    slices: { testing: [], working: [], revenue: [] },
    campaigns,
    maxActions: 5,
  });
}

export function ensureThreeFocusItems(items: FocusItem[], goalCards: GoalCardModel[]): FocusItem[] {
  if (items.length >= 1) return items.slice(0, 5);
  return buildDailyFocusActions({
    monthKey: "",
    goalCards,
    slices: { testing: [], working: [], revenue: [] },
    maxActions: 5,
  }).slice(0, 5);
}

/** Reports row action suggestion helper. */
export function suggestReportsAction(input: {
  metric: GoalKind;
  current: number;
  target: number;
  monthKey: string;
  missingOfferCount?: number;
  offTargetCount?: number;
  scalingCount?: number;
  now?: Date;
}): string {
  if (!(input.target > 0)) return "No goal set";
  const pace = evaluatePace(input.current, input.target, input.monthKey, input.now);
  const behind = Math.max(0, ceilCount(pace.expectedByNow - input.current));
  if (input.metric === "testing" && pace.paceGap < 0) {
    return `Create ${Math.max(1, behind)} testing campaign${behind === 1 ? "" : "s"}`;
  }
  if (input.metric === "working" && pace.paceGap < 0) {
    return `Launch/move ${Math.max(1, behind)} working campaign${behind === 1 ? "" : "s"}`;
  }
  if ((input.missingOfferCount ?? 0) > 0) {
    return `Add offer count to ${input.missingOfferCount} campaign${input.missingOfferCount === 1 ? "" : "s"}`;
  }
  if ((input.offTargetCount ?? 0) > 0) {
    return `Review ${input.offTargetCount} campaign${input.offTargetCount === 1 ? "" : "s"} below visits-per-offer target`;
  }
  if ((input.scalingCount ?? 0) > 0) {
    return `Review ${input.scalingCount} scaling opportunit${input.scalingCount === 1 ? "y" : "ies"}`;
  }
  if (input.metric === "revenue" && pace.paceVariancePct <= REVENUE_BEHIND_THRESHOLD_PCT) {
    return "Review top profit/ROI campaigns";
  }
  if (pace.paceGap >= 0) return "On pace";
  return "Watch pace";
}

export function reportsPaceFields(
  current: number,
  target: number,
  monthKey: string,
  now = new Date(),
) {
  const pace = evaluatePace(current, target, monthKey, now);
  return {
    todayTarget: pace.dailyExpected,
    expectedByNow: pace.expectedByNow,
    paceGap: Math.max(0, pace.expectedByNow - current),
    progressPct: paceProgressPct(current, pace.expectedByNow),
    pace,
  };
}
