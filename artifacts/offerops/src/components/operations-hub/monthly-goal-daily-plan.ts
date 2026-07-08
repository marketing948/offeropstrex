/**
 * Monthly Goals → Daily Action Plan (pure, testable).
 *
 * Today Focus is driven by employee Monthly Goals (Network → GEO) plus
 * real live-campaign optimizations and scaling/move-to-working candidates.
 * Revenue is never included.
 */

import { ceilCount, evaluateWorkingDayPace } from "./ops-v2-metrics.ts";
import { isScalingOpportunity } from "./scaling-opportunity.ts";
import {
  countTestingCreatedToday,
  isSameLocalDay,
  toMissionCampaignRows,
  type MissionCampaignRow,
} from "./daily-mission-board.ts";
import type { NetworkGeoSlice, OpsCampaignRowLite } from "./ops-goal-focus.ts";
import { DEFAULT_ALERT_RULES } from "@workspace/alert-rules";

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
  geoCount: number;
  doneToday: number;
  paceStatus: "behind" | "on_pace" | "completed";
  geos: TestingGeoAction[];
};

export type OptimizationIssueType =
  | "missing_offer_count"
  | "behind_target"
  | "off_target";

export type OptimizationCampaignRef = {
  id: number;
  name: string;
  network: string;
  geo: string;
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
  visitsPerOffer: number | null;
};

export type DailyActionPlanSummary = {
  testsRequired: number;
  testsDone: number;
  optimizationsRequired: number;
  optimizationsDone: number;
  scalingAdvisory: number;
  completed: number;
  total: number;
  progressPct: number;
};

export type DailyActionPlan = {
  testingNetworks: TestingNetworkPlan[];
  optimizations: OptimizationGroup[];
  scalingCandidates: ScalingCandidate[];
  moveToWorkingCandidates: ScalingCandidate[];
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
      weight: Math.max(1, g.gapToPace),
      remaining: Math.max(0, g.remaining),
    }))
    .filter((g) => g.remaining > 0);

  if (eligible.length === 0) return [];

  // Sort: most behind first, then geo code for stability
  eligible.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
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

  if (remaining > 0 && out[0]) {
    const bump = Math.min(remaining, eligible[0]!.remaining - out[0].count);
    if (bump > 0) out[0] = { ...out[0], count: out[0].count + bump };
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

    let geos: TestingGeoAction[] = [];

    if (geoSlices.length > 0) {
      // Prefer independent per-GEO monthly math (overrides already in target).
      geos = geoSlices.map((s) => {
        const geo = s.geo!.trim();
        const math = computeTodayRequired(s.target, s.current, monthKey, now);
        const doneToday = countTestingDoneForSlice(rows, network, geo, now);
        return {
          geo,
          monthlyTarget: s.target,
          current: s.current,
          expectedByNow: math.expectedByNow,
          dailyExpected: math.dailyExpected,
          gapToPace: math.gapToPace,
          todayRequired: math.todayRequired,
          doneToday: Math.min(math.todayRequired, doneToday),
          remaining: math.remaining,
        };
      });

      // If every GEO has todayRequired 0 but network is behind, nothing to show.
      // If GEOs share equal inherited targets and we only want to redistribute a
      // network-level budget, prefer sum of per-GEO todayRequired (natural behind priority).
    } else if (networkOnly.length > 0) {
      // Aggregate network-only slice(s)
      const current = networkOnly.reduce((s, x) => s + x.current, 0);
      const target = networkOnly.reduce((s, x) => s + x.target, 0);
      const math = computeTodayRequired(target, current, monthKey, now);
      const doneToday = countTestingDoneForSlice(rows, network, null, now);
      geos = [
        {
          geo: "ALL",
          monthlyTarget: target,
          current,
          expectedByNow: math.expectedByNow,
          dailyExpected: math.dailyExpected,
          gapToPace: math.gapToPace,
          todayRequired: math.todayRequired,
          doneToday: Math.min(math.todayRequired, doneToday),
          remaining: math.remaining,
        },
      ];
    }

    geos = geos.filter((g) => g.todayRequired > 0 || g.doneToday > 0);
    // Drop fully completed with nothing left today
    geos = geos.filter((g) => g.todayRequired > 0);

    if (geos.length === 0) continue;

    const todayRequired = geos.reduce((s, g) => s + g.todayRequired, 0);
    const doneToday = Math.min(
      todayRequired,
      geos.reduce((s, g) => s + g.doneToday, 0),
    );
    const anyBehind = geos.some((g) => g.gapToPace > 0);
    const allDoneMonth = geos.every((g) => g.remaining <= 0);

    plans.push({
      network,
      todayRequired,
      geoCount: geos.filter((g) => g.geo !== "ALL").length || geos.length,
      doneToday,
      paceStatus: allDoneMonth ? "completed" : anyBehind ? "behind" : "on_pace",
      geos: geos.sort((a, b) => {
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
  } = {},
): OptimizationGroup[] {
  const now = opts.now ?? new Date();
  const vpoTarget =
    opts.visitsPerOfferTarget ?? DEFAULT_ALERT_RULES.testing.visitsPerOffer;
  const rows = toMissionCampaignRows(campaigns);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const missing: OptimizationCampaignRef[] = [];
  const behind: OptimizationCampaignRef[] = [];
  const off: OptimizationCampaignRef[] = [];

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
    };

    const offerCount = adapted?.offerCount ?? (c.offerCount != null ? Number(c.offerCount) : null);
    if (offerCount == null || offerCount <= 0) {
      missing.push(ref);
      continue;
    }

    const clicks = campaignClicks(c);
    const visitsPerOffer = clicks / Math.max(1, offerCount);
    const ratio = vpoTarget > 0 ? visitsPerOffer / vpoTarget : 0;
    if (ratio <= 0) continue; // no traffic yet — don't invent a task
    if (ratio < 0.7) off.push(ref);
    else if (ratio < 1) behind.push(ref);
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

  return groups;
}

/** Conservative MVP: testing live with profit/ROI > 0 and enough data. */
export function isMoveToWorkingCandidate(
  c: OpsCampaignRowLite,
  opts: { now?: Date; visitsPerOfferTarget?: number } = {},
): boolean {
  if ((c.campaignPurpose ?? "").toLowerCase() !== "testing") return false;
  if (c.status !== "live") return false;
  const profit = campaignProfit(c);
  const roi = campaignRoi(c);
  if (!(profit > 0 || roi > 0)) return false;
  const offerCount = c.offerCount != null ? Number(c.offerCount) : 0;
  if (!(offerCount > 0)) return false;
  const vpoTarget =
    opts.visitsPerOfferTarget ?? DEFAULT_ALERT_RULES.testing.visitsPerOffer;
  const clicks = campaignClicks(c);
  const visitsPerOffer = clicks / offerCount;
  const conversions = Number((c as OpsCampaignRowLite).conversions ?? 0);
  // Enough traffic toward visits-per-offer target, or conversions prove signal.
  return visitsPerOffer >= vpoTarget * 0.7 || (Number.isFinite(conversions) && conversions > 0);
}

export function buildScalingCandidates(
  campaigns: OpsCampaignRowLite[],
  opts: { now?: Date; visitsPerOfferTarget?: number } = {},
): { scaling: ScalingCandidate[]; moveToWorking: ScalingCandidate[] } {
  const now = opts.now ?? new Date();
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

    if (
      isScalingOpportunity({
        campaignPurpose: c.campaignPurpose,
        status: c.status,
        profit: campaignProfit(c),
        roi: campaignRoi(c),
        liveStartedAt: c.liveStartedAt,
        createdAt: c.createdAt,
        now,
      })
    ) {
      scaling.push({
        id,
        name: campaignName(adapted ?? c),
        network,
        geo,
        kind: "scaling",
        profit: campaignProfit(c),
        roi: campaignRoi(c),
        visitsPerOffer,
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
        visitsPerOffer,
      });
    }
  }

  return { scaling, moveToWorking };
}

function summarizePlan(
  testingNetworks: TestingNetworkPlan[],
  optimizations: OptimizationGroup[],
  scalingCount: number,
): DailyActionPlanSummary {
  const testsRequired = testingNetworks.reduce((s, n) => s + n.todayRequired, 0);
  const testsDone = testingNetworks.reduce((s, n) => s + n.doneToday, 0);
  const optimizationsRequired = optimizations.reduce((s, g) => s + g.required, 0);
  const optimizationsDone = optimizations.reduce(
    (s, g) => s + (g.canTrackCompletion ? Math.min(g.required, g.doneToday) : 0),
    0,
  );
  // Scaling is advisory — counts toward total visibility but not completed
  const scalingAdvisory = scalingCount;
  const total = testsRequired + optimizationsRequired + scalingAdvisory;
  const completed = Math.min(total, testsDone + optimizationsDone);
  const progressPct =
    total <= 0 ? 100 : Math.min(100, Math.round((completed / total) * 100));

  return {
    testsRequired,
    testsDone: Math.min(testsDone, testsRequired),
    optimizationsRequired,
    optimizationsDone: Math.min(optimizationsDone, optimizationsRequired),
    scalingAdvisory,
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
}): DailyActionPlan {
  const now = input.now ?? new Date();
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
  });
  const { scaling, moveToWorking } = buildScalingCandidates(campaigns, {
    now,
    visitsPerOfferTarget: input.visitsPerOfferTarget,
  });
  const summary = summarizePlan(
    testingNetworks,
    optimizations,
    scaling.length + moveToWorking.length,
  );

  return {
    testingNetworks,
    optimizations,
    scalingCandidates: scaling,
    moveToWorkingCandidates: moveToWorking,
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
): WorkerDailyPlanSummary[] {
  const out: WorkerDailyPlanSummary[] = [];
  for (const w of workers) {
    const plan = buildDailyActionPlan({
      monthKey,
      testingSlices: w.testingSlices,
      campaigns: w.campaigns,
      now,
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
