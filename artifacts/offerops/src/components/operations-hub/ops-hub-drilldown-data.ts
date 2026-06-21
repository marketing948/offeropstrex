/**
 * Operations Hub V3.1 — goals, pace, drilldown data, Today's Focus (demo-only).
 */

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  useListPerformance,
  useListAffiliateNetworks,
  getListPerformanceQueryKey,
  getListAffiliateNetworksQueryKey,
  type DashboardBreakdownRow,
  type Performance,
  type TestingBatch,
  type TodoTask,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { authedJson } from "@/lib/api-fetch";
import { fetchBatchHealth, getBatchHealthQueryKey, type BatchHealthResponse } from "@/lib/batch-health-api";
import {
  buildMissionControlRows,
  recommendationSummary,
} from "@/lib/mission-control-health";
import { DEFAULT_CONFIG, useGoalsConfig, type KpiTarget } from "@/lib/goals-config";
import {
  ACTIVE_TESTING_STATUSES,
  daysRemainingInMonth,
  evaluatePace,
  gapRemaining,
  isWorkingLiveCampaign,
  monthLabel,
  monthToDateRange,
  OPS_V2_DEMO_FALLBACKS,
  progressPct,
  resolveGeoRevenueTarget,
  resolveKpiTarget,
  listConfiguredNetworkTargets,
  resolveNetworkTarget,
  type PaceEvaluation,
  type PaceStatus,
} from "@/components/operations-hub/ops-v2-metrics";
import {
  buildBatchMeta,
  buildCampaignByIdMap,
  enrichCampaignRows,
  normGeoName,
  normNetworkName,
  normalizePerfRows,
  resolveAffiliateNetwork,
  resolveCampaignGeo,
  resolvePerfAttribution,
  sumAttributedRevenue,
  type OpsPerformanceRow,
} from "@/components/operations-hub/ops-network-attribution";

export type OpsCampaignRow = {
  id?: number;
  affiliateNetworkId?: number | null;
  campaignName?: string | null;
  status: string;
  campaignPurpose?: string | null;
  geo?: string | null;
  batchGeo?: string | null;
  batchAffiliateNetwork?: string | null;
  affiliateNetworkName?: string | null;
  revenue?: number | string | null;
  cost?: number | string | null;
  roi?: number | string | null;
  conversions?: number | null;
  clicks?: number | null;
  liveStartedAt?: string | null;
  updatedAt?: string | null;
};

type DashboardBreakdowns = { byNetwork: DashboardBreakdownRow[] };

export type GeoMetrics = {
  geo: string;
  revenue: number;
  working: number;
  testing: number;
};

export type GeoProgressRow = {
  geo: string;
  actual: number;
  target: number | null;
  progressPct: number | null;
  gap: number | null;
  configured: boolean;
  hasActivity: boolean;
};

export type NetworkProgressRow = {
  network: string;
  actual: number;
  target: number | null;
  progressPct: number | null;
  gap: number | null;
  configured: boolean;
  hasActivity: boolean;
  geos: GeoProgressRow[];
};

export type NetworkGroup = {
  network: string;
  geos: GeoProgressRow[];
  totalRevenue: number;
  totalWorking: number;
  totalTesting: number;
  hasActivity: boolean;
};

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
  networkRows: NetworkProgressRow[];
  supportsGeoDrilldown: boolean;
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

function normNetwork(network: string | null | undefined): string {
  return normNetworkName(network);
}

function normGeo(geo: string | null | undefined): string {
  return normGeoName(geo);
}

function cellKey(network: string, geo: string): string {
  return `${network}\0${geo}`;
}

function parseCellKey(key: string): { network: string; geo: string } {
  const [network, geo] = key.split("\0");
  return { network: network ?? "(unset)", geo: geo ?? "(unset)" };
}

function hasActivity(m: { revenue: number; working: number; testing: number }): boolean {
  return m.revenue > 0 || m.working > 0 || m.testing > 0;
}

function buildGeoProgressRow(
  network: string,
  geo: string,
  metrics: GeoMetrics,
  kpiTargets: KpiTarget[],
): GeoProgressRow {
  const { target, configured } = resolveGeoRevenueTarget(kpiTargets, geo, network);
  const active = hasActivity(metrics);
  if (!configured || target == null) {
    return {
      geo,
      actual: metrics.revenue,
      target: null,
      progressPct: null,
      gap: null,
      configured: false,
      hasActivity: active,
    };
  }
  return {
    geo,
    actual: metrics.revenue,
    target,
    progressPct: progressPct(metrics.revenue, target),
    gap: gapRemaining(metrics.revenue, target),
    configured: true,
    hasActivity: active,
  };
}

function sortGeosWorstFirst(geos: GeoProgressRow[]): GeoProgressRow[] {
  return [...geos].sort((a, b) => {
    if (a.configured && b.configured) return (b.gap ?? 0) - (a.gap ?? 0);
    if (a.configured && !b.configured) return -1;
    if (!a.configured && b.configured) return 1;
    return b.actual - a.actual;
  });
}

export function aggregateNetworkGeo(
  batches: TestingBatch[],
  campaigns: OpsCampaignRow[],
  perfRecords: Performance[],
): Map<string, GeoMetrics> {
  const batchMeta = buildBatchMeta(batches);
  const campaignsById = buildCampaignByIdMap(campaigns);
  const cells = new Map<string, GeoMetrics>();

  function ensure(network: string, geo: string): GeoMetrics {
    const key = cellKey(network, geo);
    let cell = cells.get(key);
    if (!cell) {
      cell = { geo, revenue: 0, working: 0, testing: 0 };
      cells.set(key, cell);
    }
    return cell;
  }

  for (const r of perfRecords as OpsPerformanceRow[]) {
    const attr = resolvePerfAttribution(r, campaignsById, batchMeta);
    if (!attr) continue;
    ensure(attr.network, attr.geo).revenue += Number(r.revenue ?? 0);
  }

  for (const b of batches) {
    if (!(ACTIVE_TESTING_STATUSES as readonly string[]).includes(b.status)) continue;
    ensure(normNetwork(b.affiliateNetwork), normGeo(b.geo)).testing += 1;
  }

  for (const c of campaigns.filter(isWorkingLiveCampaign)) {
    ensure(resolveAffiliateNetwork(c), resolveCampaignGeo(c)).working += 1;
  }

  return cells;
}

export function buildNetworkGroups(
  cells: Map<string, GeoMetrics>,
  kpiTargets: KpiTarget[],
  breakdownNetworks: DashboardBreakdownRow[],
): NetworkGroup[] {
  const networkNames = new Set<string>();
  for (const key of cells.keys()) networkNames.add(parseCellKey(key).network);
  for (const row of breakdownNetworks) networkNames.add(row.label || row.key);
  for (const network of listConfiguredNetworkTargets(kpiTargets, "revenue")) {
    networkNames.add(network);
  }

  const groups: NetworkGroup[] = [];

  for (const network of networkNames) {
    const geoMap = new Map<string, GeoMetrics>();
    for (const [key, metrics] of cells) {
      const parsed = parseCellKey(key);
      if (parsed.network !== network) continue;
      const ex = geoMap.get(parsed.geo);
      if (ex) {
        ex.revenue += metrics.revenue;
        ex.working += metrics.working;
        ex.testing += metrics.testing;
      } else {
        geoMap.set(parsed.geo, { ...metrics, geo: parsed.geo });
      }
    }

    const breakdownRow = breakdownNetworks.find((r) => (r.label || r.key) === network);
    const breakdownRevenue = Number(breakdownRow?.revenue ?? 0);

    const geos = sortGeosWorstFirst(
      [...geoMap.values()].map((m) => buildGeoProgressRow(network, m.geo, m, kpiTargets)),
    );

    let totalRevenue = geos.reduce((s, g) => s + g.actual, 0);
    const totalWorking = geos.reduce((s, g) => s + (geoMap.get(g.geo)?.working ?? 0), 0);
    const totalTesting = geos.reduce((s, g) => s + (geoMap.get(g.geo)?.testing ?? 0), 0);
    if (totalRevenue === 0 && breakdownRevenue > 0) totalRevenue = breakdownRevenue;

    groups.push({
      network,
      geos,
      totalRevenue,
      totalWorking,
      totalTesting,
      hasActivity: totalRevenue > 0 || totalWorking > 0 || totalTesting > 0,
    });
  }

  return groups
    .filter((g) => {
      const { configured } = resolveNetworkTarget(kpiTargets, "revenue", g.network);
      return g.hasActivity || g.geos.length > 0 || configured;
    })
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

function emptyNetworkGroup(network: string): NetworkGroup {
  return {
    network,
    geos: [],
    totalRevenue: 0,
    totalWorking: 0,
    totalTesting: 0,
    hasActivity: false,
  };
}

function networkRowsForGoal(
  groups: NetworkGroup[],
  kpiTargets: KpiTarget[],
  baseKey: string,
  actualFn: (g: NetworkGroup) => number,
  includeGeos: boolean,
): NetworkProgressRow[] {
  const groupByNetwork = new Map(groups.map((g) => [g.network, g]));
  const networkNames = new Set([
    ...groups.map((g) => g.network),
    ...listConfiguredNetworkTargets(kpiTargets, baseKey),
  ]);

  return [...networkNames]
    .map((network) => {
      const group = groupByNetwork.get(network) ?? emptyNetworkGroup(network);
      const actual = actualFn(group);
      const { target, configured } = resolveNetworkTarget(kpiTargets, baseKey, network);
      const row: NetworkProgressRow = {
        network,
        actual,
        target,
        progressPct: configured && target != null ? progressPct(actual, target) : null,
        gap: configured && target != null ? gapRemaining(actual, target) : null,
        configured,
        hasActivity: actual > 0,
        geos: includeGeos ? group.geos.filter((g) => g.hasActivity || g.configured) : [],
      };
      return row;
    })
    .filter((r) => r.hasActivity || r.configured)
    .sort((a, b) => {
      if (a.configured && b.configured) return (b.gap ?? 0) - (a.gap ?? 0);
      if (a.progressPct != null && b.progressPct != null) return a.progressPct - b.progressPct;
      return b.actual - a.actual;
    });
}

export function buildGoalCards(
  kpiTargets: KpiTarget[],
  mtdRevenue: number,
  campaigns: OpsCampaignRow[],
  batches: TestingBatch[],
  networkGroups: NetworkGroup[],
): GoalCardModel[] {
  const revenueT = resolveKpiTarget(kpiTargets, "revenue", OPS_V2_DEMO_FALLBACKS.revenue);
  const testingT = resolveKpiTarget(
    kpiTargets,
    "testingBatches",
    OPS_V2_DEMO_FALLBACKS.testingBatches,
  );
  const workingT = resolveKpiTarget(
    kpiTargets,
    "workingCampaigns",
    OPS_V2_DEMO_FALLBACKS.workingCampaigns,
  );

  const workingCount = campaigns.filter(isWorkingLiveCampaign).length;
  const testingCount = batches.filter((b) =>
    (ACTIVE_TESTING_STATUSES as readonly string[]).includes(b.status),
  ).length;

  return [
    {
      kind: "revenue",
      label: "Revenue",
      icon: "revenue",
      actual: mtdRevenue,
      target: revenueT.target,
      gap: gapRemaining(mtdRevenue, revenueT.target),
      pace: evaluatePace(mtdRevenue, revenueT.target),
      format: "currency",
      supportsGeoDrilldown: true,
      networkRows: networkRowsForGoal(
        networkGroups,
        kpiTargets,
        "revenue",
        (g) => g.totalRevenue,
        true,
      ),
    },
    {
      kind: "testing",
      label: "Testing Pipeline",
      icon: "testing",
      actual: testingCount,
      target: testingT.target,
      gap: gapRemaining(testingCount, testingT.target),
      pace: evaluatePace(testingCount, testingT.target),
      format: "count",
      supportsGeoDrilldown: false,
      networkRows: networkRowsForGoal(
        networkGroups,
        kpiTargets,
        "testingBatches",
        (g) => g.totalTesting,
        false,
      ),
    },
    {
      kind: "working",
      label: "Working Campaigns",
      icon: "working",
      actual: workingCount,
      target: workingT.target,
      gap: gapRemaining(workingCount, workingT.target),
      pace: evaluatePace(workingCount, workingT.target),
      format: "count",
      supportsGeoDrilldown: false,
      networkRows: networkRowsForGoal(
        networkGroups,
        kpiTargets,
        "workingCampaigns",
        (g) => g.totalWorking,
        false,
      ),
    },
  ];
}

type ScoredGeo = {
  network: string;
  geo: GeoProgressRow;
  score: number;
  paceStatus: PaceStatus | null;
};

function scoreGeoOpportunity(geo: GeoProgressRow, group: NetworkGroup): number {
  if (!geo.configured || geo.gap == null || geo.gap <= 0) return -1;
  const metrics = group.geos.find((g) => g.geo === geo.geo);
  let score = geo.gap;
  const testing = group.totalTesting;
  const working = group.totalWorking;
  if (testing <= 1) score += geo.gap * 0.15;
  if (working <= 1) score += geo.gap * 0.1;
  void metrics;
  return score;
}

function geoPaceStatus(geo: GeoProgressRow): PaceStatus | null {
  if (!geo.configured || geo.target == null) return null;
  return evaluatePace(geo.actual, geo.target).paceStatus;
}

function isOverdueTask(task: TodoTask, today: string): boolean {
  if (task.status === "DONE" || task.status === "BLOCKED") return false;
  if (!task.dueDate?.trim()) return false;
  return task.dueDate.slice(0, 10) < today;
}

function batchLabel(batch: TestingBatch): string {
  const network = batch.affiliateNetwork?.trim() || "Unknown network";
  const geo = batch.geo?.trim() || "Unknown GEO";
  return `${network} ${geo}`;
}

export type OperationalFocusInput = {
  batches: TestingBatch[];
  tasks: TodoTask[];
  healthByBatchId: Map<number, BatchHealthResponse | undefined>;
  today: string;
};

function computeGoalBasedFocus(
  goalCards: GoalCardModel[],
  networkGroups: NetworkGroup[],
): FocusItem[] {
  const revenueCard = goalCards.find((g) => g.kind === "revenue")!;
  const testingCard = goalCards.find((g) => g.kind === "testing")!;
  const workingCard = goalCards.find((g) => g.kind === "working")!;

  const scored: ScoredGeo[] = [];
  for (const group of networkGroups) {
    for (const geo of group.geos) {
      const score = scoreGeoOpportunity(geo, group);
      if (score >= 0) {
        scored.push({
          network: group.network,
          geo,
          score,
          paceStatus: geoPaceStatus(geo),
        });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const items: FocusItem[] = [];

  if (scored.length > 0) {
    const top = scored[0]!;
    items.push({
      tier: "primary",
      emoji: "🔥",
      title: "Highest Impact",
      text: `Launch 3–5 tests in ${top.network} ${top.geo.geo}.`,
      reason: `$${Math.round(top.geo.gap ?? 0).toLocaleString()} revenue gap — biggest opportunity to close this month.`,
      context: {
        network: top.network,
        geo: top.geo.geo,
        metricLabel: "Revenue gap",
        metricValue: `$${Math.round(top.geo.gap ?? 0).toLocaleString()}`,
        suggestedAction: `Review testing pipeline for ${top.network} ${top.geo.geo} and launch new batches.`,
        navigationPath: "/testing-batches",
      },
    });
  } else if (testingCard.gap > 0) {
    const net = testingCard.networkRows[0]?.network ?? "your top network";
    items.push({
      tier: "primary",
      emoji: "🔥",
      title: "Highest Impact",
      text: `Launch more tests in ${net}.`,
      reason: `Testing pipeline is ${testingCard.gap} batch${testingCard.gap === 1 ? "" : "es"} behind the monthly target.`,
      context: {
        network: net,
        metricLabel: "Testing gap",
        metricValue: `${testingCard.gap} batch${testingCard.gap === 1 ? "" : "es"}`,
        suggestedAction: "Create or advance testing batches on this network.",
        navigationPath: "/testing-batches",
      },
    });
  } else if (revenueCard.pace.paceStatus === "Behind Pace") {
    items.push({
      tier: "primary",
      emoji: "🔥",
      title: "Highest Impact",
      text: "Push live tests across your top networks today.",
      reason: `Revenue is behind pace — $${Math.round(revenueCard.actual).toLocaleString()} current vs $${Math.round(revenueCard.pace.expectedByToday).toLocaleString()} expected.`,
      context: {
        metricLabel: "Revenue vs pace",
        metricValue: `$${Math.round(revenueCard.actual).toLocaleString()} / $${Math.round(revenueCard.pace.expectedByToday).toLocaleString()}`,
        suggestedAction: "Prioritize networks with the largest revenue gaps.",
        navigationPath: "/live-campaigns",
      },
    });
  } else if (workingCard.gap > 0) {
    items.push({
      tier: "primary",
      emoji: "🔥",
      title: "Highest Impact",
      text: "Move proven winners to working campaigns.",
      reason: `${workingCard.gap} more working campaign${workingCard.gap === 1 ? "" : "s"} needed to hit target.`,
      context: {
        metricLabel: "Working campaigns gap",
        metricValue: `${workingCard.gap} remaining`,
        suggestedAction: "Move tested winners to live working campaigns.",
        navigationPath: "/live-campaigns",
      },
    });
  }

  const quickWinCandidate = scored.find((s) => {
    const group = networkGroups.find((g) => g.network === s.network);
    return group && group.totalTesting <= 1 && group.totalWorking === 0;
  });
  const quickWinNet =
    testingCard.networkRows.find((r) => r.actual === 0 && r.configured) ??
    workingCard.networkRows.find((r) => r.actual === 0 && r.configured);

  if (quickWinCandidate) {
    items.push({
      tier: "secondary",
      emoji: "⚡",
      title: "Quick Win",
      text: `Start a fresh test batch in ${quickWinCandidate.network} ${quickWinCandidate.geo.geo}.`,
      reason: "Low pipeline activity with an open revenue gap — fast to activate.",
      context: {
        network: quickWinCandidate.network,
        geo: quickWinCandidate.geo.geo,
        suggestedAction: "Spin up a small test batch to validate demand quickly.",
        navigationPath: "/testing-batches",
      },
    });
  } else if (quickWinNet) {
    items.push({
      tier: "secondary",
      emoji: "⚡",
      title: "Quick Win",
      text: `Activate ${quickWinNet.network}.`,
      reason: `Zero progress toward the ${quickWinNet.target} network target.`,
      context: {
        network: quickWinNet.network,
        metricLabel: "Network target",
        metricValue: String(quickWinNet.target),
        suggestedAction: `Start activity on ${quickWinNet.network}.`,
        navigationPath: "/testing-batches",
      },
    });
  } else if (workingCard.gap > 0) {
    items.push({
      tier: "secondary",
      emoji: "⚡",
      title: "Quick Win",
      text: "Move a tested winner to Working on Live Campaigns.",
      reason: "Converts existing test success into working revenue faster than new tests.",
      context: {
        suggestedAction: "Promote a proven test winner to a working live campaign.",
        navigationPath: "/live-campaigns",
      },
    });
  }

  const watchGeo = scored.find(
    (s) => s.paceStatus === "Behind Pace" || s.paceStatus === "Watch",
  );
  if (watchGeo) {
    items.push({
      tier: "tertiary",
      emoji: "👀",
      title: "Watch",
      text: `${watchGeo.geo.geo} revenue ${watchGeo.paceStatus === "Behind Pace" ? "dropped behind pace" : "needs monitoring"}.`,
      reason: `${watchGeo.geo.progressPct ?? 0}% of GEO target with ${watchGeo.paceStatus?.toLowerCase() ?? "open"} status.`,
      context: {
        network: watchGeo.network,
        geo: watchGeo.geo.geo,
        metricLabel: "GEO progress",
        metricValue: `${watchGeo.geo.progressPct ?? 0}%`,
        suggestedAction: "Monitor daily revenue and adjust spend or tests if pace slips.",
      },
    });
  } else if (revenueCard.pace.paceStatus === "Watch") {
    items.push({
      tier: "tertiary",
      emoji: "👀",
      title: "Watch",
      text: "Workspace revenue pacing needs a mid-month push.",
      reason: `${revenueCard.pace.progressPct}% actual vs ${revenueCard.pace.expectedProgressPct}% expected by today.`,
      context: {
        metricLabel: "Pace",
        metricValue: `${revenueCard.pace.progressPct}% vs ${revenueCard.pace.expectedProgressPct}% expected`,
        suggestedAction: "Review network breakdown and prioritize lagging sources.",
      },
    });
  } else {
    const behindNet = revenueCard.networkRows.find(
      (r) => r.progressPct != null && r.progressPct < 50,
    );
    if (behindNet) {
      items.push({
        tier: "tertiary",
        emoji: "👀",
        title: "Watch",
        text: `${behindNet.network} revenue at ${behindNet.progressPct}% of network target.`,
        reason: "Network-level progress is lagging other sources.",
        context: {
          network: behindNet.network,
          metricLabel: "Network progress",
          metricValue: `${behindNet.progressPct}%`,
          suggestedAction: `Investigate ${behindNet.network} performance and testing coverage.`,
        },
      });
    }
  }

  return items;
}

function ensureThreeFocusItems(items: FocusItem[], goalCards: GoalCardModel[]): FocusItem[] {
  const result = [...items];
  const revenue = goalCards.find((g) => g.kind === "revenue");
  const testing = goalCards.find((g) => g.kind === "testing");
  const working = goalCards.find((g) => g.kind === "working");

  const fallbacks: FocusItem[] = [];

  if (!result.some((i) => i.title === "Highest Impact") && testing && testing.gap > 0) {
    fallbacks.push({
      tier: "primary",
      emoji: "🔥",
      title: "Highest Impact",
      text: `Launch tests to close the testing pipeline gap (${testing.gap} behind target).`,
      reason: `${testing.actual} of ${testing.target} active batches vs ${testing.pace.expectedByToday} expected by today.`,
    });
  }

  if (!result.some((i) => i.title === "Quick Win") && working && working.gap > 0) {
    fallbacks.push({
      tier: "secondary",
      emoji: "⚡",
      title: "Quick Win",
      text: "Move a tested winner to a working live campaign.",
      reason: `${working.actual} of ${working.target} working campaigns — ${working.gap} remaining this month.`,
    });
  }

  if (!result.some((i) => i.title === "Watch") && revenue) {
    fallbacks.push({
      tier: "tertiary",
      emoji: "👀",
      title: "Watch",
      text:
        revenue.pace.paceStatus === "Behind Pace"
          ? "Workspace revenue is behind pace."
          : "Monitor month-to-date revenue vs target.",
      reason: `$${Math.round(revenue.actual).toLocaleString()} current vs $${Math.round(revenue.pace.expectedByToday).toLocaleString()} expected (${revenue.pace.progressPct}% of target).`,
    });
  }

  for (const item of fallbacks) {
    if (result.length >= 3) break;
    if (!result.some((r) => r.title === item.title)) result.push(item);
  }

  return result.slice(0, 3);
}

export function computeTodaysFocus(
  goalCards: GoalCardModel[],
  networkGroups: NetworkGroup[],
  hasAnyActivity: boolean,
  operational: OperationalFocusInput,
): TodaysFocus {
  const hasGeoTargets = networkGroups.some((g) => g.geos.some((geo) => geo.configured));

  if (!hasAnyActivity && !hasGeoTargets && goalCards[0]?.actual === 0) {
    const hasOps =
      operational.tasks.some((t) => t.status === "BLOCKED") ||
      operational.tasks.some((t) => isOverdueTask(t, operational.today));
    if (!hasOps) return { items: [], empty: true };
  }

  const items: FocusItem[] = [];
  const batchById = new Map(operational.batches.map((b) => [b.id, b]));

  const criticalRows = buildMissionControlRows(
    operational.batches,
    operational.healthByBatchId,
    new Map(operational.batches.map((b) => [b.id, { loading: false, error: false }])),
  ).filter((row) => row.healthState === "critical");

  if (criticalRows.length > 0) {
    const row = criticalRows[0]!;
    items.push({
      tier: "primary",
      emoji: "🔥",
      title: "Highest Impact",
      text: `Resolve critical issue on ${row.batch.batchName}.`,
      reason: row.health
        ? `${recommendationSummary(row.health.recommendations)} — blocking forward progress.`
        : "Batch health flagged as critical.",
      context: {
        batchId: row.batch.id,
        batchName: row.batch.batchName,
        suggestedAction: "Review batch health and resolve the critical blocker.",
        navigationPath: `/testing-batches/${row.batch.id}`,
      },
    });
  }

  const blockedTasks = operational.tasks.filter((t) => t.status === "BLOCKED");
  if (items.length === 0 && blockedTasks.length > 0) {
    const task = blockedTasks[0]!;
    const batch = task.relatedBatchId != null ? batchById.get(task.relatedBatchId) : undefined;
    const label = batch ? batchLabel(batch) : task.title;
    items.push({
      tier: "primary",
      emoji: "🔥",
      title: "Highest Impact",
      text: batch
        ? `Resolve blocked ${label} batch.`
        : `Unblock: ${task.title}.`,
      reason: batch
        ? "This batch is blocking new testing activity."
        : "Blocked task is stopping pipeline flow.",
      context: {
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

  const overdueTasks = operational.tasks.filter((t) => isOverdueTask(t, operational.today));
  if (items.length === 0 && overdueTasks.length > 0) {
    const task = overdueTasks[0]!;
    const batch = task.relatedBatchId != null ? batchById.get(task.relatedBatchId) : undefined;
    items.push({
      tier: "primary",
      emoji: "🔥",
      title: "Highest Impact",
      text: `Complete overdue task: ${task.title}.`,
      reason: batch
        ? `Overdue on ${batchLabel(batch)} — due ${task.dueDate?.slice(0, 10) ?? "past due"}.`
        : `Due ${task.dueDate?.slice(0, 10) ?? "past due"} — delays downstream work.`,
      context: {
        batchId: task.relatedBatchId ?? undefined,
        batchName: batch?.batchName ?? task.batchName ?? undefined,
        taskIds: overdueTasks.map((t) => t.id),
        suggestedAction: "Complete the overdue task to unblock downstream work.",
        navigationPath: task.relatedBatchId
          ? `/testing-batches/${task.relatedBatchId}`
          : "/tasks",
      },
    });
  }

  const goalItems = computeGoalBasedFocus(goalCards, networkGroups);

  if (items.length === 0) {
    items.push(...goalItems);
  } else {
    const secondary =
      blockedTasks.length > 1
        ? {
            tier: "secondary" as const,
            emoji: "⚡",
            title: "Quick Win",
            text: `Clear ${blockedTasks.length - 1} other blocked task${blockedTasks.length - 1 === 1 ? "" : "s"}.`,
            reason: "Reduces queue friction before launching new tests.",
            context: {
              taskIds: blockedTasks.slice(1).map((t) => t.id),
              suggestedAction: "Work through remaining blocked tasks in the queue.",
            },
          }
        : goalItems.find((i) => i.tier === "secondary");
    const tertiary =
      overdueTasks.length > 0
        ? {
            tier: "tertiary" as const,
            emoji: "👀",
            title: "Watch",
            text: `${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"} need attention.`,
            reason: "Overdue work compounds into batch delays by end of week.",
            context: {
              taskIds: overdueTasks.map((t) => t.id),
              suggestedAction: "Review overdue tasks and reprioritize due dates.",
            },
          }
        : goalItems.find((i) => i.tier === "tertiary");

    if (secondary) items.push(secondary);
    if (tertiary) items.push(tertiary);
  }

  if (items.length === 0 && hasAnyActivity) {
    items.push({
      tier: "primary",
      emoji: "✨",
      title: "Highest Impact",
      text: "Goals are on track — review Open Tasks for remaining work.",
      reason: "No critical blockers detected from goals or tasks.",
    });
  }

  return { items: ensureThreeFocusItems(items, goalCards), empty: false };
}

export function useOpsDrilldownData(
  batches: TestingBatch[],
  campaigns: OpsCampaignRow[],
  tasks: TodoTask[] = [],
) {
  const { activeWorkspaceId } = useWorkspace();
  const wsId = activeWorkspaceId ?? 0;
  const { dateFrom, dateTo } = monthToDateRange();
  const { data: cfgRaw } = useGoalsConfig();
  const cfg = cfgRaw ?? DEFAULT_CONFIG;

  const healthQueries = useQueries({
    queries: batches.map((batch) => ({
      queryKey: getBatchHealthQueryKey(batch.id),
      queryFn: () => fetchBatchHealth(batch.id),
      enabled: batches.length > 0,
      staleTime: 30_000,
    })),
  });

  const healthByBatchId = useMemo(() => {
    const map = new Map<number, BatchHealthResponse | undefined>();
    batches.forEach((batch, index) => {
      map.set(batch.id, healthQueries[index]?.data);
    });
    return map;
  }, [batches, healthQueries]);

  const today = new Date().toISOString().slice(0, 10);

  const perfParams = { workspace_id: wsId, date_from: dateFrom, date_to: dateTo };
  const { data: perfRecords = [], isLoading: perfLoading } = useListPerformance(
    perfParams,
    wsQueryOpts(activeWorkspaceId, getListPerformanceQueryKey(perfParams), {
      staleTime: 60_000,
    }),
  );

  const { data: affiliateNetworks = [] } = useListAffiliateNetworks(
    { workspace_id: wsId },
    wsQueryOpts(activeWorkspaceId, getListAffiliateNetworksQueryKey({ workspace_id: wsId })),
  );

  const networkNameById = useMemo(
    () => new Map(affiliateNetworks.map((n) => [n.id, n.name])),
    [affiliateNetworks],
  );

  const enrichedCampaigns = useMemo(
    () => enrichCampaignRows(campaigns, networkNameById),
    [campaigns, networkNameById],
  );

  const normalizedPerf = useMemo(
    () => normalizePerfRows(perfRecords as OpsPerformanceRow[], enrichedCampaigns),
    [perfRecords, enrichedCampaigns],
  );

  const {
    data: breakdowns,
    isLoading: breakdownsLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<DashboardBreakdowns>({
    queryKey: ["ops-hub-breakdowns", wsId, dateFrom, dateTo],
    enabled: !!activeWorkspaceId,
    staleTime: 60_000,
    queryFn: () =>
      authedJson(
        `/api/dashboard/breakdowns?workspace_id=${wsId}&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`,
      ),
  });

  const mtdRevenue = useMemo(
    () => normalizedPerf.reduce((s, r) => s + Number(r.revenue ?? 0), 0),
    [normalizedPerf],
  );

  const attributedRevenueMtd = useMemo(
    () => sumAttributedRevenue(normalizedPerf, enrichedCampaigns, batches),
    [normalizedPerf, enrichedCampaigns, batches],
  );

  const networkGroups = useMemo(() => {
    const cells = aggregateNetworkGeo(batches, enrichedCampaigns, normalizedPerf);
    return buildNetworkGroups(cells, cfg.kpiTargets, breakdowns?.byNetwork ?? []);
  }, [batches, enrichedCampaigns, normalizedPerf, cfg.kpiTargets, breakdowns?.byNetwork]);

  const goalCards = useMemo(
    () => buildGoalCards(cfg.kpiTargets, mtdRevenue, enrichedCampaigns, batches, networkGroups),
    [cfg.kpiTargets, mtdRevenue, enrichedCampaigns, batches, networkGroups],
  );

  const hasAnyActivity = networkGroups.some((g) => g.hasActivity) || mtdRevenue > 0;

  const focus = useMemo(
    () =>
      computeTodaysFocus(goalCards, networkGroups, hasAnyActivity, {
        batches,
        tasks,
        healthByBatchId,
        today,
      }),
    [goalCards, networkGroups, hasAnyActivity, batches, tasks, healthByBatchId, today],
  );

  const healthLoading = healthQueries.some((q) => q.isLoading);

  return {
    monthLabel: monthLabel(),
    daysRemaining: daysRemainingInMonth(),
    dateFrom,
    dateTo,
    goalCards,
    networkGroups,
    focus,
    mtdRevenue,
    attributedRevenueMtd,
    unattributedRevenueMtd: Math.max(0, mtdRevenue - attributedRevenueMtd),
    isLoading: perfLoading || breakdownsLoading || healthLoading,
    isError,
    error,
    refetch,
    isFetching,
    hasAnyActivity,
  };
}
