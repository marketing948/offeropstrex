/**
 * Monthly Goals → Daily Action Plan (pure, testable).
 *
 * Today Focus is driven by employee Monthly Goals (Network → GEO) plus
 * real live-campaign optimizations and scaling/move-to-working candidates.
 * Revenue is never included.
 */

import {
  ceilCount,
  evaluateWorkingDayPace,
  remainingWorkingDaysInMonth,
} from "./ops-v2-metrics.ts";
import { daysLiveForCampaign, isScalingOpportunity } from "./scaling-opportunity.ts";
import {
  countTestingCreatedToday,
  isSameLocalDay,
  toMissionCampaignRows,
  type MissionCampaignRow,
} from "./daily-mission-board.ts";
import type { NetworkGeoSlice, OpsCampaignRowLite } from "./ops-goal-focus.ts";
import {
  DEFAULT_ALERT_RULES,
  evaluateCampaign,
  USE_NEW_ALERT_ENGINE,
  type AlertRulesConfig,
  type OptimizeReason,
} from "@workspace/alert-rules";
import { logAlertDecision } from "../../lib/alert-decision-log.ts";

export type TestingGeoAction = {
  geo: string;
  monthlyTarget: number;
  current: number;
  expectedByNow: number;
  dailyExpected: number;
  gapToPace: number;
  todayRequired: number;
  doneToday: number;
  remaining: number;
};

export type TestingNetworkPlan = {
  network: string;
  todayRequired: number;
  /** Network monthly testing goal (sum of GEO targets). Shown on the simplified row. */
  monthlyGoal: number;
  geoCount: number;
  doneToday: number;
  paceStatus: "behind" | "on_pace" | "completed";
  geos: TestingGeoAction[];
};

export type OptimizationIssueType =
  | "missing_offer_count"
  | "behind_target"
  | "off_target"
  | "underperforming"
  | "abnormal_traffic";

export type OptimizationCampaignRef = {
  id: number;
  name: string;
  network: string;
  geo: string;
  /** Impact/urgency signals for the priority engine (optional). */
  profit?: number;
  roi?: number;
};

export type OptimizationGroup = {
  issueType: OptimizationIssueType;
  label: string;
  campaigns: OptimizationCampaignRef[];
  /** Units that require action today. */
  required: number;
  /** Reliably completed today (missing offer count with updatedAt only). */
  doneToday: number;
  canTrackCompletion: boolean;
};

export type ScalingCandidate = {
  id: number;
  name: string;
  network: string;
  geo: string;
  kind: "scaling" | "move_to_working";
  profit: number;
  roi: number;
  revenue: number;
  visitsPerOffer: number | null;
  /** Meets the winning rule (conversions + revenue + ROI). */
  isWinner: boolean;
};

/** Long-running + low-performance campaign the shutdown rule flags to STOP. */
export type ShutdownCandidate = {
  id: number;
  name: string;
  network: string;
  geo: string;
  daysLive: number;
  conversions: number;
  revenue: number;
  roi: number;
};

export type DailyActionPlanSummary = {
  testsRequired: number;
  testsDone: number;
  optimizationsRequired: number;
  optimizationsDone: number;
  scalingAdvisory: number;
  shutdownAdvisory: number;
  completed: number;
  total: number;
  progressPct: number;
};

export type DailyActionPlan = {
  testingNetworks: TestingNetworkPlan[];
  optimizations: OptimizationGroup[];
  scalingCandidates: ScalingCandidate[];
  moveToWorkingCandidates: ScalingCandidate[];
  shutdownCandidates: ShutdownCandidate[];
  summary: DailyActionPlanSummary;
};

export type WorkerDailyPlanSummary = {
  employeeId: number;
  employeeName: string;
  plan: DailyActionPlan;
  headline: string;
};

/**
 * todayRequired = min(remaining, max(ceil(dailyExpected), ceil(gapToPace)))
 * completed monthly → 0; never negative.
 */
export function computeTodayRequired(
  monthlyTarget: number,
  current: number,
  monthKey: string,
  now = new Date(),
): {
  dailyExpected: number;
  expectedByNow: number;
  gapToPace: number;
  remaining: number;
  todayRequired: number;
} {
  if (!(monthlyTarget > 0)) {
    return {
      dailyExpected: 0,
      expectedByNow: 0,
      gapToPace: 0,
      remaining: 0,
      todayRequired: 0,
    };
  }
  const pace = evaluateWorkingDayPace(monthKey, monthlyTarget, current, now);
  const remaining = Math.max(0, monthlyTarget - current);
  if (remaining <= 0) {
    return {
      dailyExpected: pace.dailyExpected,
      expectedByNow: pace.expectedByNow,
      gapToPace: 0,
      remaining: 0,
      todayRequired: 0,
    };
  }
  const gapToPace = Math.max(0, ceilCount(pace.expectedByNow - current));
  const dailyCeil = Math.max(0, ceilCount(pace.dailyExpected));
  // On pace (no catch-up): still show dailyExpected; never exceed remaining.
  const todayRequired = Math.min(remaining, Math.max(dailyCeil, gapToPace));
  return {
    dailyExpected: pace.dailyExpected,
    expectedByNow: pace.expectedByNow,
    gapToPace,
    remaining,
    todayRequired,
  };
}

/**
 * Network daily test total — the ONLY correct daily figure for a network.
 *
 *   networkRemaining      = max(0, monthlyTarget - current)
 *   remainingWorkingDays  = Mon–Fri days left in the month (including today)
 *   todayNeededNetwork    = ceil(networkRemaining / remainingWorkingDays)
 *
 * Completed → 0. Never negative. Never exceeds remaining.
 * This is computed ONCE per network; GEO counts are distributed from it (never summed up).
 */
export function computeNetworkTodayRequired(
  monthlyTarget: number,
  current: number,
  monthKey: string,
  now = new Date(),
): number {
  const remaining = Math.max(0, monthlyTarget - current);
  if (remaining <= 0) return 0;
  const remainingDays = remainingWorkingDaysInMonth(monthKey, now);
  if (remainingDays <= 0) {
    // Month is over (or unparseable with no time left): ask for everything remaining.
    return remaining;
  }
  const needed = Math.ceil(remaining / remainingDays);
  return Math.min(remaining, Math.max(0, needed));
}

function campaignName(c: MissionCampaignRow | OpsCampaignRowLite): string {
  const raw = (c as { campaignName?: string | null }).campaignName;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (c.id != null) return `Campaign #${c.id}`;
  return "Campaign";
}

function campaignNetwork(c: MissionCampaignRow): string {
  return c.network?.trim() || "(unset)";
}

function campaignGeo(c: MissionCampaignRow): string {
  return c.geo?.trim() || "";
}

function campaignProfit(c: OpsCampaignRowLite | MissionCampaignRow): number {
  const revenue = Number((c as OpsCampaignRowLite).revenue ?? 0);
  const cost = Number((c as OpsCampaignRowLite).cost ?? 0);
  return revenue - cost;
}

function campaignRoi(c: OpsCampaignRowLite | MissionCampaignRow): number {
  const raw = Number((c as OpsCampaignRowLite).roi ?? 0);
  return Math.abs(raw) <= 1 && raw !== 0 ? raw * 100 : raw;
}

function campaignClicks(c: OpsCampaignRowLite): number {
  const n = Number(c.clicks ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function campaignRevenue(c: OpsCampaignRowLite | MissionCampaignRow): number {
  const n = Number((c as OpsCampaignRowLite).revenue ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function campaignConversions(c: OpsCampaignRowLite | MissionCampaignRow): number {
  const n = Number((c as OpsCampaignRowLite).conversions ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** Winning rule: enough conversions + revenue + ROI → flag as WINNER. */
function isWinningCampaign(c: OpsCampaignRowLite, rules: AlertRulesConfig): boolean {
  return (
    campaignConversions(c) >= rules.winning.minConversions &&
    campaignRevenue(c) >= rules.winning.minRevenue &&
    campaignRoi(c) >= rules.winning.minROI
  );
}

function campaignCost(c: OpsCampaignRowLite): number {
  const n = Number((c as OpsCampaignRowLite).cost ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type BoardDecision = {
  isWinner: boolean;
  isScaling: boolean;
  isShutdown: boolean;
  optimizeReason: OptimizeReason;
};

function withVpoTarget(rules: AlertRulesConfig, vpo: number): AlertRulesConfig {
  return { ...rules, testing: { ...rules.testing, visitsPerOffer: vpo } };
}

/**
 * Single decision point for a campaign's alert flags. When the new alert engine
 * flag is on it delegates to the shared `evaluateCampaign` (one brain); the
 * legacy branch preserves the pre-unification logic verbatim for safe rollout.
 * Both branches are settings-driven — no hardcoded thresholds.
 */
function campaignDecision(
  c: OpsCampaignRowLite,
  offerCount: number | null,
  rules: AlertRulesConfig,
  vpoTarget: number,
  now: Date,
): BoardDecision {
  if (USE_NEW_ALERT_ENGINE) {
    const out = evaluateCampaign(
      {
        purpose: c.campaignPurpose,
        status: c.status,
        liveStartedAt: c.liveStartedAt,
        createdAt: c.createdAt,
      },
      {
        revenue: campaignRevenue(c),
        cost: campaignCost(c),
        // Raw ROI; the evaluator normalizes fractions→percent internally.
        roi: Number((c as OpsCampaignRowLite).roi ?? 0),
        conversions: campaignConversions(c),
        clicks: campaignClicks(c),
        offerCount,
      },
      withVpoTarget(rules, vpoTarget),
      now,
    );
    logAlertDecision(c.id, "mission-board", out);
    return {
      isWinner: out.isWinner,
      isScaling: out.isScaling,
      isShutdown: out.isShutdown,
      optimizeReason: out.optimizeReason,
    };
  }

  // ----- legacy (pre-unification) decision — preserved behind the flag -----
  const isWinner = isWinningCampaign(c, rules);
  const isScaling = isScalingOpportunity({
    campaignPurpose: c.campaignPurpose,
    status: c.status,
    profit: campaignProfit(c),
    roi: campaignRoi(c),
    revenue: campaignRevenue(c),
    liveStartedAt: c.liveStartedAt,
    createdAt: c.createdAt,
    now,
    thresholds: {
      minLiveDays: rules.scaling.minLiveDaysForScale,
      minProfit: rules.scaling.minProfitForScale,
      minRoiPercent: rules.scaling.minRoiPercentForScale,
      minRevenue: rules.scaling.minRevenueForScale,
    },
  });

  const purpose = (c.campaignPurpose ?? "").toLowerCase();
  const managed = purpose === "working" || purpose === "scaling";
  const live = daysLiveForCampaign(c.liveStartedAt, c.createdAt, now);

  let isShutdown = false;
  if (managed && c.status === "live" && !isWinner) {
    isShutdown =
      live != null &&
      live >= rules.shutdown.minDaysLive &&
      campaignConversions(c) <= rules.shutdown.maxConversions &&
      campaignRevenue(c) <= rules.shutdown.maxRevenue;
  }

  let optimizeReason: OptimizeReason = null;
  if (managed && c.status === "live") {
    if (offerCount == null || offerCount <= 0) {
      optimizeReason = "missing_offer_count";
    } else {
      const vpo = campaignClicks(c) / Math.max(1, offerCount);
      const ratio = vpoTarget > 0 ? vpo / vpoTarget : 0;
      const maxExpectedVpo = rules.traffic.maxExpectedVisitsPerOffer;
      if (ratio > 0 && ratio < rules.optimization.offTargetRatio) {
        optimizeReason = "off_target";
      } else if (
        ratio >= rules.optimization.offTargetRatio &&
        ratio < rules.optimization.behindTargetRatio
      ) {
        optimizeReason = "behind_target";
      } else if (maxExpectedVpo > 0 && vpo > maxExpectedVpo) {
        optimizeReason = "abnormal_traffic";
      } else {
        const roi = campaignRoi(c);
        if (
          !isScaling &&
          live != null &&
          live >= rules.optimization.minDaysLive &&
          roi < rules.optimization.roiMinThreshold
        ) {
          optimizeReason = "underperforming";
        }
      }
    }
  }

  return { isWinner, isScaling, isShutdown, optimizeReason };
}

/**
 * Allocate an integer `total` across geos, prioritizing those most behind pace.
 * GEO todayRequired from monthly math is preferred; this helper splits a network
 * budget when geos lack explicit per-GEO targets (equal inherited targets).
 */
export function allocateTodayRequiredAcrossGeos(
  total: number,
  geos: { geo: string; gapToPace: number; remaining: number }[],
): { geo: string; count: number }[] {
  const n = Math.max(0, Math.round(total));
  if (n <= 0 || geos.length === 0) return [];

  const eligible = geos
    .map((g) => ({
      geo: g.geo,
      // Weight by how far behind pace, falling back to remaining so equal-pace
      // GEOs still split by size. Always ≥ 1 so every eligible GEO can receive.
      weight: Math.max(1, g.gapToPace > 0 ? g.gapToPace : Math.max(0, g.remaining)),
      gapToPace: Math.max(0, g.gapToPace),
      remaining: Math.max(0, g.remaining),
    }))
    .filter((g) => g.remaining > 0);

  if (eligible.length === 0) return [];

  // Priority: most behind pace → larger remaining → geo code (stable tie-break).
  eligible.sort((a, b) => {
    if (b.gapToPace !== a.gapToPace) return b.gapToPace - a.gapToPace;
    if (b.remaining !== a.remaining) return b.remaining - a.remaining;
    return a.geo.localeCompare(b.geo);
  });

  const weightSum = eligible.reduce((s, g) => s + g.weight, 0);
  const out: { geo: string; count: number }[] = [];
  let remaining = n;

  for (let i = 0; i < eligible.length && remaining > 0; i++) {
    const row = eligible[i]!;
    const isLast = i === eligible.length - 1;
    let share = isLast
      ? remaining
      : Math.max(1, Math.round((row.weight / weightSum) * n));
    share = Math.min(share, remaining, row.remaining);
    if (share <= 0) continue;
    out.push({ geo: row.geo, count: share });
    remaining -= share;
  }

  // Distribute any leftover to the highest-priority GEO(s) with room left.
  if (remaining > 0) {
    for (const row of eligible) {
      if (remaining <= 0) break;
      const existing = out.find((o) => o.geo === row.geo);
      const used = existing?.count ?? 0;
      const room = row.remaining - used;
      if (room <= 0) continue;
      const bump = Math.min(remaining, room);
      if (existing) existing.count += bump;
      else out.push({ geo: row.geo, count: bump });
      remaining -= bump;
    }
  }

  return out.filter((r) => r.count > 0);
}

function countTestingDoneForSlice(
  campaigns: MissionCampaignRow[],
  network: string,
  geo: string | null | undefined,
  now: Date,
): number {
  return countTestingCreatedToday(campaigns, {
    now,
    network,
    geo: geo?.trim() ? geo : null,
  }).count;
}

/**
 * Build testing plan grouped by Affiliate Network → expandable GEO actions.
 * Uses Monthly Goal metric-breakdown slices (effective targets including overrides).
 */
export function buildTestingNetworkPlans(
  testingSlices: NetworkGeoSlice[],
  campaigns: OpsCampaignRowLite[] | MissionCampaignRow[],
  monthKey: string,
  now = new Date(),
): TestingNetworkPlan[] {
  const rows = toMissionCampaignRows(campaigns);
  const byNetwork = new Map<string, NetworkGeoSlice[]>();

  for (const s of testingSlices) {
    if (!(s.target > 0)) continue;
    const net = s.network.trim();
    if (!net) continue;
    const list = byNetwork.get(net) ?? [];
    list.push(s);
    byNetwork.set(net, list);
  }

  const plans: TestingNetworkPlan[] = [];

  for (const [network, slices] of byNetwork) {
    const geoSlices = slices.filter((s) => Boolean(s.geo?.trim()));
    const networkOnly = slices.filter((s) => !s.geo?.trim());

    // 1) Network daily total FIRST (single ceil, never per-GEO summed).
    const networkTarget =
      geoSlices.length > 0
        ? geoSlices.reduce((s, x) => s + x.target, 0)
        : networkOnly.reduce((s, x) => s + x.target, 0);
    const networkCurrent =
      geoSlices.length > 0
        ? geoSlices.reduce((s, x) => s + x.current, 0)
        : networkOnly.reduce((s, x) => s + x.current, 0);

    if (!(networkTarget > 0)) continue;

    const todayNeededNetwork = computeNetworkTodayRequired(
      networkTarget,
      networkCurrent,
      monthKey,
      now,
    );
    const networkRemaining = Math.max(0, networkTarget - networkCurrent);

    // 2) Build GEO metrics (pace inputs only — NOT their own daily ceil totals).
    let geos: TestingGeoAction[];
    if (geoSlices.length > 0) {
      geos = geoSlices.map((s) => {
        const geo = s.geo!.trim();
        const math = computeTodayRequired(s.target, s.current, monthKey, now);
        return {
          geo,
          monthlyTarget: s.target,
          current: s.current,
          expectedByNow: math.expectedByNow,
          dailyExpected: math.dailyExpected,
          gapToPace: math.gapToPace,
          todayRequired: 0, // distributed below from the network total
          doneToday: 0,
          remaining: math.remaining,
        };
      });
    } else {
      const math = computeTodayRequired(networkTarget, networkCurrent, monthKey, now);
      geos = [
        {
          geo: "ALL",
          monthlyTarget: networkTarget,
          current: networkCurrent,
          expectedByNow: math.expectedByNow,
          dailyExpected: math.dailyExpected,
          gapToPace: math.gapToPace,
          todayRequired: 0,
          doneToday: 0,
          remaining: math.remaining,
        },
      ];
    }

    // 3) Distribute exactly `todayNeededNetwork` integer units across GEOs.
    if (todayNeededNetwork > 0) {
      const alloc = allocateTodayRequiredAcrossGeos(
        todayNeededNetwork,
        geos.map((g) => ({
          geo: g.geo,
          gapToPace: g.gapToPace,
          remaining: g.remaining,
        })),
      );
      const byGeo = new Map(alloc.map((a) => [a.geo, a.count]));
      for (const g of geos) {
        g.todayRequired = byGeo.get(g.geo) ?? 0;
      }
    }

    // 4) Done today counted per matching Network/GEO testing campaigns (honest).
    for (const g of geos) {
      const done = countTestingDoneForSlice(
        rows,
        network,
        g.geo === "ALL" ? null : g.geo,
        now,
      );
      g.doneToday = Math.min(g.todayRequired, done);
    }

    const geosWithWork = geos.filter((g) => g.todayRequired > 0 || g.doneToday > 0);
    if (geosWithWork.length === 0 || todayNeededNetwork <= 0) continue;

    const doneToday = Math.min(
      todayNeededNetwork,
      geosWithWork.reduce((s, g) => s + g.doneToday, 0),
    );
    const anyBehind = geos.some((g) => g.gapToPace > 0);
    const allDoneMonth = networkRemaining <= 0;

    plans.push({
      network,
      todayRequired: todayNeededNetwork,
      monthlyGoal: networkTarget,
      geoCount: geosWithWork.filter((g) => g.geo !== "ALL").length || geosWithWork.length,
      doneToday,
      paceStatus: allDoneMonth ? "completed" : anyBehind ? "behind" : "on_pace",
      geos: geosWithWork.sort((a, b) => {
        if (b.todayRequired !== a.todayRequired) return b.todayRequired - a.todayRequired;
        if (b.gapToPace !== a.gapToPace) return b.gapToPace - a.gapToPace;
        return a.geo.localeCompare(b.geo);
      }),
    });
  }

  return plans.sort((a, b) => {
    if (b.todayRequired !== a.todayRequired) return b.todayRequired - a.todayRequired;
    return a.network.localeCompare(b.network);
  });
}

/**
 * When a network has selected GEOs with equal inherited monthly shares but we
 * want to split a single network todayRequired by behind-pace priority.
 * (Used by tests + fallback when callers pass network budget + geo list.)
 */
export function splitNetworkTodayAcrossSelectedGeos(
  networkTodayRequired: number,
  geoSlices: NetworkGeoSlice[],
  monthKey: string,
  now = new Date(),
): TestingGeoAction[] {
  const prepared = geoSlices
    .filter((s) => s.geo?.trim() && s.target > 0)
    .map((s) => {
      const math = computeTodayRequired(s.target, s.current, monthKey, now);
      return {
        geo: s.geo!.trim(),
        monthlyTarget: s.target,
        current: s.current,
        expectedByNow: math.expectedByNow,
        dailyExpected: math.dailyExpected,
        gapToPace: math.gapToPace,
        remaining: math.remaining,
        todayRequired: 0,
        doneToday: 0,
      };
    });

  const alloc = allocateTodayRequiredAcrossGeos(
    networkTodayRequired,
    prepared.map((g) => ({
      geo: g.geo,
      gapToPace: g.gapToPace,
      remaining: g.remaining,
    })),
  );
  const byGeo = new Map(alloc.map((a) => [a.geo, a.count]));
  return prepared
    .map((g) => ({
      ...g,
      todayRequired: byGeo.get(g.geo) ?? 0,
    }))
    .filter((g) => g.todayRequired > 0);
}

export function buildOptimizationGroups(
  campaigns: OpsCampaignRowLite[],
  opts: {
    now?: Date;
    visitsPerOfferTarget?: number;
    rules?: AlertRulesConfig;
  } = {},
): OptimizationGroup[] {
  const now = opts.now ?? new Date();
  const rules = opts.rules ?? DEFAULT_ALERT_RULES;
  const vpoTarget =
    opts.visitsPerOfferTarget ?? rules.testing.visitsPerOffer;
  const rows = toMissionCampaignRows(campaigns);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const missing: OptimizationCampaignRef[] = [];
  const behind: OptimizationCampaignRef[] = [];
  const off: OptimizationCampaignRef[] = [];
  const underperforming: OptimizationCampaignRef[] = [];
  const abnormal: OptimizationCampaignRef[] = [];

  for (const c of campaigns) {
    const purpose = (c.campaignPurpose ?? "").toLowerCase();
    if (purpose !== "working" && purpose !== "scaling") continue;
    if (c.status !== "live") continue;
    const id = c.id;
    if (id == null) continue;
    const adapted = byId.get(id);
    const network = adapted?.network?.trim() || "(unset)";
    const geo = adapted?.geo?.trim() || "—";
    const ref: OptimizationCampaignRef = {
      id,
      name: campaignName(adapted ?? c),
      network,
      geo,
      profit: campaignProfit(c),
      roi: campaignRoi(c),
    };

    const offerCount = adapted?.offerCount ?? (c.offerCount != null ? Number(c.offerCount) : null);
    const reason = campaignDecision(c, offerCount, rules, vpoTarget, now).optimizeReason;
    switch (reason) {
      case "missing_offer_count":
        missing.push(ref);
        break;
      case "off_target":
        off.push(ref);
        break;
      case "behind_target":
        behind.push(ref);
        break;
      case "abnormal_traffic":
        abnormal.push(ref);
        break;
      case "underperforming":
        underperforming.push(ref);
        break;
      default:
        break;
    }
  }

  // Priority engine: within each group, highest impact (profit) first, then
  // urgency (lower ROI first).
  const byImpactThenUrgency = (a: OptimizationCampaignRef, b: OptimizationCampaignRef) => {
    const pd = (b.profit ?? 0) - (a.profit ?? 0);
    if (pd !== 0) return pd;
    return (a.roi ?? 0) - (b.roi ?? 0);
  };
  for (const list of [missing, behind, off, underperforming, abnormal]) {
    list.sort(byImpactThenUrgency);
  }

  const groups: OptimizationGroup[] = [];

  if (missing.length > 0) {
    // Fixed today = working/scaling live with offerCount>0 and updatedAt today.
    // Cap at current open count (honest progress against this issue type).
    let doneToday = 0;
    for (const c of rows) {
      if (c.campaignPurpose !== "working" && c.campaignPurpose !== "scaling") continue;
      if (c.status !== "live") continue;
      if (!(c.offerCount != null && c.offerCount > 0)) continue;
      if (!isSameLocalDay(c.updatedAt, now)) continue;
      doneToday++;
    }
    doneToday = Math.min(missing.length, doneToday);

    groups.push({
      issueType: "missing_offer_count",
      label: `Add offer count to ${missing.length} campaign${missing.length === 1 ? "" : "s"}`,
      campaigns: missing,
      required: missing.length,
      doneToday,
      canTrackCompletion: true,
    });
  }

  if (behind.length > 0) {
    groups.push({
      issueType: "behind_target",
      label: `Review ${behind.length} campaign${behind.length === 1 ? "" : "s"} behind visits-per-offer target`,
      campaigns: behind,
      required: behind.length,
      doneToday: 0,
      canTrackCompletion: false,
    });
  }

  if (off.length > 0) {
    groups.push({
      issueType: "off_target",
      label: `Review ${off.length} campaign${off.length === 1 ? "" : "s"} off target`,
      campaigns: off,
      required: off.length,
      doneToday: 0,
      canTrackCompletion: false,
    });
  }

  if (underperforming.length > 0) {
    groups.push({
      issueType: "underperforming",
      label: `Review ${underperforming.length} underperforming campaign${underperforming.length === 1 ? "" : "s"}`,
      campaigns: underperforming,
      required: underperforming.length,
      doneToday: 0,
      canTrackCompletion: false,
    });
  }

  if (abnormal.length > 0) {
    groups.push({
      issueType: "abnormal_traffic",
      label: `Review ${abnormal.length} campaign${abnormal.length === 1 ? "" : "s"} with abnormal traffic`,
      campaigns: abnormal,
      required: abnormal.length,
      doneToday: 0,
      canTrackCompletion: false,
    });
  }

  return groups;
}

/** Conservative MVP: testing live with profit/ROI > 0 and enough data. */
export function isMoveToWorkingCandidate(
  c: OpsCampaignRowLite,
  opts: { now?: Date; visitsPerOfferTarget?: number; rules?: AlertRulesConfig } = {},
): boolean {
  if ((c.campaignPurpose ?? "").toLowerCase() !== "testing") return false;
  if (c.status !== "live") return false;
  const profit = campaignProfit(c);
  const roi = campaignRoi(c);
  if (!(profit > 0 || roi > 0)) return false;
  const offerCount = c.offerCount != null ? Number(c.offerCount) : 0;
  if (!(offerCount > 0)) return false;
  const vpoTarget =
    opts.visitsPerOfferTarget ??
    opts.rules?.testing.visitsPerOffer ??
    DEFAULT_ALERT_RULES.testing.visitsPerOffer;
  const clicks = campaignClicks(c);
  const visitsPerOffer = clicks / offerCount;
  const conversions = Number((c as OpsCampaignRowLite).conversions ?? 0);
  // Enough traffic toward visits-per-offer target, or conversions prove signal.
  return visitsPerOffer >= vpoTarget * 0.7 || (Number.isFinite(conversions) && conversions > 0);
}

export function buildScalingCandidates(
  campaigns: OpsCampaignRowLite[],
  opts: { now?: Date; visitsPerOfferTarget?: number; rules?: AlertRulesConfig } = {},
): { scaling: ScalingCandidate[]; moveToWorking: ScalingCandidate[] } {
  const now = opts.now ?? new Date();
  const rules = opts.rules ?? DEFAULT_ALERT_RULES;
  const vpoTarget = opts.visitsPerOfferTarget ?? rules.testing.visitsPerOffer;
  const rows = toMissionCampaignRows(campaigns);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const scaling: ScalingCandidate[] = [];
  const moveToWorking: ScalingCandidate[] = [];

  for (const c of campaigns) {
    const id = c.id;
    if (id == null) continue;
    const adapted = byId.get(id);
    const network = adapted?.network?.trim() || "(unset)";
    const geo = adapted?.geo?.trim() || "—";
    const offerCount = adapted?.offerCount ?? (c.offerCount != null ? Number(c.offerCount) : null);
    const clicks = campaignClicks(c);
    const visitsPerOffer =
      offerCount != null && offerCount > 0 ? clicks / offerCount : null;

    const decision = campaignDecision(c, offerCount, rules, vpoTarget, now);
    const winner = decision.isWinner;
    const scaleReady = decision.isScaling;
    // Winners always surface in Scale Today even if they miss the scale bar.
    if (scaleReady || winner) {
      scaling.push({
        id,
        name: campaignName(adapted ?? c),
        network,
        geo,
        kind: "scaling",
        profit: campaignProfit(c),
        roi: campaignRoi(c),
        revenue: campaignRevenue(c),
        visitsPerOffer,
        isWinner: winner,
      });
      continue;
    }

    if (isMoveToWorkingCandidate(c, opts)) {
      moveToWorking.push({
        id,
        name: campaignName(adapted ?? c),
        network,
        geo,
        kind: "move_to_working",
        profit: campaignProfit(c),
        roi: campaignRoi(c),
        revenue: campaignRevenue(c),
        visitsPerOffer,
        isWinner: false,
      });
    }
  }

  // Priority engine: winners first, then highest impact (profit, then revenue).
  const byScalePriority = (a: ScalingCandidate, b: ScalingCandidate) => {
    if (a.isWinner !== b.isWinner) return a.isWinner ? -1 : 1;
    if (b.profit !== a.profit) return b.profit - a.profit;
    return b.revenue - a.revenue;
  };
  scaling.sort(byScalePriority);
  moveToWorking.sort(byScalePriority);

  return { scaling, moveToWorking };
}

/**
 * Shutdown rule → long-running working/scaling campaigns with low performance
 * (few conversions, low revenue) that should be stopped. Winners are excluded.
 */
export function buildShutdownCandidates(
  campaigns: OpsCampaignRowLite[],
  opts: { now?: Date; rules?: AlertRulesConfig } = {},
): ShutdownCandidate[] {
  const now = opts.now ?? new Date();
  const rules = opts.rules ?? DEFAULT_ALERT_RULES;
  const vpoTarget = rules.testing.visitsPerOffer;
  const rows = toMissionCampaignRows(campaigns);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ShutdownCandidate[] = [];

  for (const c of campaigns) {
    const id = c.id;
    if (id == null) continue;
    const offerCount = c.offerCount != null ? Number(c.offerCount) : null;
    if (!campaignDecision(c, offerCount, rules, vpoTarget, now).isShutdown) continue;
    const daysLive = daysLiveForCampaign(c.liveStartedAt, c.createdAt, now) ?? 0;
    const conversions = campaignConversions(c);
    const revenue = campaignRevenue(c);
    const adapted = byId.get(id);
    out.push({
      id,
      name: campaignName(adapted ?? c),
      network: adapted?.network?.trim() || "(unset)",
      geo: adapted?.geo?.trim() || "—",
      daysLive,
      conversions,
      revenue,
      roi: campaignRoi(c),
    });
  }

  // Most wasted first: longest live, then lowest revenue.
  out.sort((a, b) => (b.daysLive - a.daysLive) || (a.revenue - b.revenue));
  return out;
}

function summarizePlan(
  testingNetworks: TestingNetworkPlan[],
  optimizations: OptimizationGroup[],
  scalingCount: number,
  shutdownCount: number,
): DailyActionPlanSummary {
  const testsRequired = testingNetworks.reduce((s, n) => s + n.todayRequired, 0);
  const testsDone = testingNetworks.reduce((s, n) => s + n.doneToday, 0);
  const optimizationsRequired = optimizations.reduce((s, g) => s + g.required, 0);
  const optimizationsDone = optimizations.reduce(
    (s, g) => s + (g.canTrackCompletion ? Math.min(g.required, g.doneToday) : 0),
    0,
  );
  // Scaling + shutdown are advisory — visible in total but not "completed".
  const scalingAdvisory = scalingCount;
  const shutdownAdvisory = shutdownCount;
  const total = testsRequired + optimizationsRequired + scalingAdvisory + shutdownAdvisory;
  const completed = Math.min(total, testsDone + optimizationsDone);
  const progressPct =
    total <= 0 ? 100 : Math.min(100, Math.round((completed / total) * 100));

  return {
    testsRequired,
    testsDone: Math.min(testsDone, testsRequired),
    optimizationsRequired,
    optimizationsDone: Math.min(optimizationsDone, optimizationsRequired),
    scalingAdvisory,
    shutdownAdvisory,
    completed,
    total,
    progressPct,
  };
}

/** Build full worker Daily Action Plan from Monthly Goal slices + live campaigns. */
export function buildDailyActionPlan(input: {
  monthKey: string;
  testingSlices: NetworkGeoSlice[];
  campaigns?: OpsCampaignRowLite[];
  now?: Date;
  visitsPerOfferTarget?: number;
  rules?: AlertRulesConfig;
}): DailyActionPlan {
  const now = input.now ?? new Date();
  const rules = input.rules ?? DEFAULT_ALERT_RULES;
  const campaigns = input.campaigns ?? [];
  const testingNetworks = buildTestingNetworkPlans(
    input.testingSlices,
    campaigns,
    input.monthKey,
    now,
  );
  const optimizations = buildOptimizationGroups(campaigns, {
    now,
    visitsPerOfferTarget: input.visitsPerOfferTarget,
    rules,
  });
  const { scaling, moveToWorking } = buildScalingCandidates(campaigns, {
    now,
    visitsPerOfferTarget: input.visitsPerOfferTarget,
    rules,
  });
  const shutdownCandidates = buildShutdownCandidates(campaigns, { now, rules });
  const summary = summarizePlan(
    testingNetworks,
    optimizations,
    scaling.length + moveToWorking.length,
    shutdownCandidates.length,
  );

  return {
    testingNetworks,
    optimizations,
    scalingCandidates: scaling,
    moveToWorkingCandidates: moveToWorking,
    shutdownCandidates,
    summary,
  };
}

export function headlineForWorkerPlan(
  employeeName: string,
  plan: DailyActionPlan,
): string {
  const parts: string[] = [];
  if (plan.summary.testsRequired > 0) {
    parts.push(
      `Open ${plan.summary.testsRequired} test${plan.summary.testsRequired === 1 ? "" : "s"} today`,
    );
  }
  if (plan.summary.optimizationsRequired > 0) {
    parts.push(
      `Fix ${plan.summary.optimizationsRequired} optimization${plan.summary.optimizationsRequired === 1 ? "" : "s"}`,
    );
  }
  if (plan.summary.scalingAdvisory > 0) {
    parts.push(
      `Review ${plan.summary.scalingAdvisory} scaling opportunit${plan.summary.scalingAdvisory === 1 ? "y" : "ies"}`,
    );
  }
  if (parts.length === 0) return `${employeeName} — on pace today`;
  return `${employeeName} — ${parts.join(" · ")}`;
}

export function buildTeamDailyPlans(
  workers: {
    employeeId: number;
    employeeName: string;
    testingSlices: NetworkGeoSlice[];
    campaigns?: OpsCampaignRowLite[];
  }[],
  monthKey: string,
  now = new Date(),
  rules?: AlertRulesConfig,
): WorkerDailyPlanSummary[] {
  const out: WorkerDailyPlanSummary[] = [];
  for (const w of workers) {
    const plan = buildDailyActionPlan({
      monthKey,
      testingSlices: w.testingSlices,
      campaigns: w.campaigns,
      now,
      rules,
    });
    if (plan.summary.total <= 0) continue;
    out.push({
      employeeId: w.employeeId,
      employeeName: w.employeeName,
      plan,
      headline: headlineForWorkerPlan(w.employeeName, plan),
    });
  }
  return out.sort((a, b) => b.plan.summary.total - a.plan.summary.total);
}

/** Proof helper: plans must never include revenue Focus actions. */
export function planContainsRevenue(plan: DailyActionPlan): boolean {
  const blob = JSON.stringify(plan).toLowerCase();
  return blob.includes("revenue_rescue") || blob.includes("revenue rescue");
}
