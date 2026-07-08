/**
 * Operations Hub V3.1 — goals, pace, drilldown data, Today's Focus (demo-only).
 */

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  useListPerformance,
  useListAffiliateNetworks,
  useListEmployees,
  getListPerformanceQueryKey,
  getListAffiliateNetworksQueryKey,
  getListEmployeesQueryKey,
  type DashboardBreakdownRow,
  type Performance,
  type TestingBatch,
  type TodoTask,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth";
import { authedJson } from "@/lib/api-fetch";
import { useMonthlyGoalsScope } from "@/lib/performance-engine/use-monthly-goals-scope";
import { fetchBatchHealth, getBatchHealthQueryKey, type BatchHealthResponse } from "@/lib/batch-health-api";
import { DEFAULT_CONFIG, useGoalsConfig, type KpiTarget } from "@/lib/goals-config";
import {
  ACTIVE_TESTING_STATUSES,
  daysRemainingInMonth,
  evaluatePace,
  gapRemaining,
  isWorkingLiveCampaign,
  monthLabel,
  monthToDateRange,
  progressPct,
  resolveGeoRevenueTarget,
  listConfiguredNetworkTargets,
  resolveNetworkTarget,
  type PaceEvaluation,
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
  batchId?: number | null;
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
  offerCount?: number | null;
  liveStartedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  employeeId?: number | null;
  employeeName?: string | null;
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

export type {
  FocusItem,
  FocusItemContext,
  TodaysFocus,
  OperationalFocusInput,
} from "@/components/operations-hub/ops-todays-focus";
export { computeTodaysFocus } from "@/components/operations-hub/ops-todays-focus";
import {
  computeTodaysFocus as computeTodaysFocusImpl,
  buildAdminInterventionFocus,
  enrichSlicesWithPerformance,
  buildPerfBoostBuckets,
  type MetricSliceBundle,
  type NetworkGeoSlice,
  type AdminWorkerFocusInput,
  type TodaysFocus,
} from "@/components/operations-hub/ops-todays-focus";
import {
  currentMonthKey,
  fetchMetricBreakdown,
  type MetricBreakdownResult,
} from "@/lib/performance-engine/api";
import { peGoalsFromWorkerRow } from "@/lib/performance-engine/pe-goals";

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
  allowedNetworkNames?: string[] | null,
): NetworkGroup[] {
  const allowedSet = allowedNetworkNames
    ? new Set(allowedNetworkNames.map((n) => n.trim().toLowerCase()).filter(Boolean))
    : null;
  const isAllowed = (network: string) =>
    !allowedSet || allowedSet.has(network.trim().toLowerCase());

  const networkNames = new Set<string>();
  for (const key of cells.keys()) {
    const { network } = parseCellKey(key);
    if (isAllowed(network)) networkNames.add(network);
  }
  for (const row of breakdownNetworks) {
    const label = row.label || row.key;
    if (isAllowed(label)) networkNames.add(label);
  }
  if (!allowedSet) {
    for (const network of listConfiguredNetworkTargets(kpiTargets, "revenue")) {
      networkNames.add(network);
    }
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
      if (!isAllowed(g.network)) return false;
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
  mtdRevenue: number,
  campaigns: OpsCampaignRow[],
  batches: TestingBatch[],
  networkGroups: NetworkGroup[],
  monthKey: string,
  peGoals: {
    revenue: { current: number; target: number };
    testing: { current: number; target: number };
    working: { current: number; target: number };
  },
): GoalCardModel[] {
  const revenueT = { target: peGoals.revenue.target, usingFallback: peGoals.revenue.target <= 0 };
  const testingT = { target: peGoals.testing.target, usingFallback: peGoals.testing.target <= 0 };
  const workingT = { target: peGoals.working.target, usingFallback: peGoals.working.target <= 0 };

  const workingCount = peGoals.working.current;
  const testingCount = peGoals.testing.current;
  const revenueActual = peGoals.revenue.current;

  return [
    {
      kind: "revenue",
      label: "Revenue",
      icon: "revenue",
      actual: revenueActual,
      target: revenueT.target,
      gap: gapRemaining(revenueActual, revenueT.target),
      pace: evaluatePace(revenueActual, revenueT.target, monthKey),
      format: "currency",
      supportsGeoDrilldown: true,
      networkRows: networkRowsForGoal(
        networkGroups,
        [],
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
      pace: evaluatePace(testingCount, testingT.target, monthKey),
      format: "count",
      supportsGeoDrilldown: false,
      networkRows: networkRowsForGoal(
        networkGroups,
        [],
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
      pace: evaluatePace(workingCount, workingT.target, monthKey),
      format: "count",
      supportsGeoDrilldown: false,
      networkRows: networkRowsForGoal(
        networkGroups,
        [],
        "workingCampaigns",
        (g) => g.totalWorking,
        false,
      ),
    },
  ];
}


export function useOpsDrilldownData(
  batches: TestingBatch[],
  campaigns: OpsCampaignRow[],
  tasks: TodoTask[] = [],
  scopeEmployeeId?: number | "" | null,
) {
  const { activeWorkspaceId } = useWorkspace();
  const { currentEmployee } = useAuth();
  const wsId = activeWorkspaceId ?? 0;
  const { dateFrom, dateTo } = monthToDateRange();
  const { data: cfgRaw } = useGoalsConfig();
  const cfg = cfgRaw ?? DEFAULT_CONFIG;
  const {
    isWorker,
    monthKey,
    peGoals,
    dashboard: monthlyGoalsDashboard,
    isLoading: peGoalsLoading,
  } = useMonthlyGoalsScope(scopeEmployeeId);

  const { data: assignedNetworks = [] } = useQuery({
    queryKey: ["my-affiliate-networks", wsId, currentEmployee?.id],
    enabled: isWorker && !!wsId && !!currentEmployee,
    staleTime: 120_000,
    queryFn: () =>
      authedJson<
        { affiliateNetworkName: string | null }[]
      >(`/api/worker-affiliate-networks?workspace_id=${wsId}&employee_id=${currentEmployee!.id}`),
  });

  const allowedNetworkNames = useMemo(() => {
    if (!isWorker) return null;
    return assignedNetworks
      .map((r) => r.affiliateNetworkName?.trim())
      .filter((n): n is string => Boolean(n));
  }, [isWorker, assignedNetworks]);

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
    return buildNetworkGroups(cells, cfg.kpiTargets, breakdowns?.byNetwork ?? [], allowedNetworkNames);
  }, [batches, enrichedCampaigns, normalizedPerf, cfg.kpiTargets, breakdowns?.byNetwork, allowedNetworkNames]);

  const workerPe = peGoals;

  const goalCards = useMemo(() => {
    const pe =
      workerPe ??
      ({
        revenue: { current: 0, target: 0 },
        testing: { current: 0, target: 0 },
        working: { current: 0, target: 0 },
      } as const);
    return buildGoalCards(mtdRevenue, enrichedCampaigns, batches, networkGroups, monthKey, pe);
  }, [mtdRevenue, enrichedCampaigns, batches, networkGroups, monthKey, workerPe]);

  const hasAnyActivity = networkGroups.some((g) => g.hasActivity) || mtdRevenue > 0;

  const focusEmployeeId =
    isWorker
      ? currentEmployee?.id
      : scopeEmployeeId !== "" && scopeEmployeeId != null
        ? scopeEmployeeId
        : undefined;

  const employeesParams = { workspace_id: wsId };
  const { data: employees = [] } = useListEmployees(
    employeesParams,
    wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(employeesParams), {
      enabled: !isWorker,
    }),
  );

  const focusEmployeeName = useMemo(() => {
    if (focusEmployeeId == null) return null;
    if (isWorker) return currentEmployee?.name ?? null;
    return employees.find((e) => e.id === focusEmployeeId)?.name ?? null;
  }, [focusEmployeeId, isWorker, currentEmployee?.name, employees]);

  const testingBreakdownQ = useQuery({
    queryKey: ["ops-focus-breakdown", wsId, "testing", focusEmployeeId ?? "team", monthKey],
    enabled: !!wsId && !!currentEmployee && focusEmployeeId != null,
    staleTime: 60_000,
    queryFn: () => fetchMetricBreakdown(wsId, monthKey, "testing", focusEmployeeId),
  });
  const workingBreakdownQ = useQuery({
    queryKey: ["ops-focus-breakdown", wsId, "working", focusEmployeeId ?? "team", monthKey],
    enabled: !!wsId && !!currentEmployee && focusEmployeeId != null,
    staleTime: 60_000,
    queryFn: () => fetchMetricBreakdown(wsId, monthKey, "working", focusEmployeeId),
  });
  const revenueBreakdownQ = useQuery({
    queryKey: ["ops-focus-breakdown", wsId, "revenue", focusEmployeeId ?? "team", monthKey],
    enabled: !!wsId && !!currentEmployee && focusEmployeeId != null,
    staleTime: 60_000,
    queryFn: () => fetchMetricBreakdown(wsId, monthKey, "revenue", focusEmployeeId),
  });

  /** Team-wide breakdowns only used when admin has no employee filter (intervention queue). */
  const teamTestingQ = useQuery({
    queryKey: ["ops-focus-breakdown", wsId, "testing", "team", monthKey],
    enabled: !!wsId && !!currentEmployee && !isWorker && focusEmployeeId == null,
    staleTime: 60_000,
    queryFn: () => fetchMetricBreakdown(wsId, monthKey, "testing"),
  });
  const teamWorkingQ = useQuery({
    queryKey: ["ops-focus-breakdown", wsId, "working", "team", monthKey],
    enabled: !!wsId && !!currentEmployee && !isWorker && focusEmployeeId == null,
    staleTime: 60_000,
    queryFn: () => fetchMetricBreakdown(wsId, monthKey, "working"),
  });
  const teamRevenueQ = useQuery({
    queryKey: ["ops-focus-breakdown", wsId, "revenue", "team", monthKey],
    enabled: !!wsId && !!currentEmployee && !isWorker && focusEmployeeId == null,
    staleTime: 60_000,
    queryFn: () => fetchMetricBreakdown(wsId, monthKey, "revenue"),
  });

  const perfBoostBuckets = useMemo(() => {
    const campaignsById = buildCampaignByIdMap(enrichedCampaigns);
    const batchMeta = buildBatchMeta(batches);
    const rows: { network: string; geo?: string | null; revenue: number; profit: number; spend: number }[] =
      [];
    for (const p of normalizedPerf) {
      const attr = resolvePerfAttribution(p, campaignsById, batchMeta);
      if (!attr) continue;
      const revenue = Number(p.revenue ?? 0);
      const spend = Number(p.spend ?? 0);
      const profit = Number(p.profit ?? revenue - spend);
      rows.push({
        network: attr.network,
        geo: attr.geo,
        revenue,
        profit,
        spend,
      });
    }
    // Campaign-level fallback when perf rows are sparse
    for (const c of enrichedCampaigns) {
      const network = resolveAffiliateNetwork(c);
      const geo = resolveCampaignGeo(c);
      const revenue = Number(c.revenue ?? 0);
      const cost = Number(c.cost ?? 0);
      if (!(revenue > 0) && !(cost > 0)) continue;
      rows.push({
        network,
        geo,
        revenue,
        profit: revenue - cost,
        spend: cost,
      });
    }
    return buildPerfBoostBuckets(rows);
  }, [normalizedPerf, enrichedCampaigns, batches]);

  const focusSlices = useMemo((): MetricSliceBundle => {
    function toSlices(data: MetricBreakdownResult | undefined): NetworkGeoSlice[] {
      if (!data) return [];
      const out: NetworkGeoSlice[] = [];
      for (const net of data.networks) {
        for (const g of net.geos ?? []) {
          if (!(g.target > 0)) continue;
          out.push({
            network: net.label,
            geo: g.label,
            current: g.current,
            target: g.target,
          });
        }
      }
      if (out.length > 0) {
        return enrichSlicesWithPerformance(out, perfBoostBuckets);
      }
      return enrichSlicesWithPerformance(
        data.networks
          .filter((n) => n.target > 0)
          .map((n) => ({
            network: n.label,
            geo: null,
            current: n.current,
            target: n.target,
          })),
        perfBoostBuckets,
      );
    }
    const testingSrc =
      focusEmployeeId != null ? testingBreakdownQ.data : teamTestingQ.data;
    const workingSrc =
      focusEmployeeId != null ? workingBreakdownQ.data : teamWorkingQ.data;
    const revenueSrc =
      focusEmployeeId != null ? revenueBreakdownQ.data : teamRevenueQ.data;
    return {
      testing: toSlices(testingSrc),
      working: toSlices(workingSrc),
      revenue: toSlices(revenueSrc),
    };
  }, [
    testingBreakdownQ.data,
    workingBreakdownQ.data,
    revenueBreakdownQ.data,
    teamTestingQ.data,
    teamWorkingQ.data,
    teamRevenueQ.data,
    focusEmployeeId,
    perfBoostBuckets,
  ]);

  const interventionWorkers = useMemo(() => {
    if (isWorker || focusEmployeeId != null) return [];
    return (monthlyGoalsDashboard?.workers ?? [])
      .filter((w) => w.testing.target > 0 || w.working.target > 0)
      .slice(0, 12);
  }, [isWorker, focusEmployeeId, monthlyGoalsDashboard?.workers]);

  const interventionQueries = useQueries({
    queries: interventionWorkers.flatMap((w) =>
      (["testing", "working", "revenue"] as const).map((metric) => ({
        queryKey: ["ops-focus-breakdown", wsId, metric, w.employeeId, monthKey],
        enabled: !!wsId && !!currentEmployee && !isWorker && focusEmployeeId == null,
        staleTime: 60_000,
        queryFn: () => fetchMetricBreakdown(wsId, monthKey, metric, w.employeeId),
      })),
    ),
  });

  const interventionQueryDataKey = interventionQueries
    .map((q) => `${q.status}:${q.dataUpdatedAt}`)
    .join("|");

  const focus = useMemo((): TodaysFocus => {
    const hasGeoTargets = networkGroups.some((g) => g.geos.some((geo) => geo.configured));
    const mk = monthKey || currentMonthKey();
    const operational = { batches, tasks, healthByBatchId, today };

    // Admin all-employees → per-worker intervention queue (not team aggregate)
    if (!isWorker && focusEmployeeId == null) {
      const workers = monthlyGoalsDashboard?.workers ?? [];
      const batchEmployeeById = new Map(batches.map((b) => [b.id, b.employeeId] as const));
      const adminWorkers: AdminWorkerFocusInput[] = workers
        .filter(
          (w) => w.testing.target > 0 || w.working.target > 0,
        )
        .slice(0, 12)
        .map((w) => {
          const pe = peGoalsFromWorkerRow(w);
          const cards = buildGoalCards(
            pe.revenue.current,
            enrichedCampaigns,
            batches,
            networkGroups,
            mk,
            pe,
          );
          const idx = workers.findIndex((x) => x.employeeId === w.employeeId);
          // Prefer per-worker breakdown when loaded; fallback to empty slices (still shows employee-level pace actions)
          const toWorkerSlices = (): MetricSliceBundle => {
            // Match parallel order in interventionQueries: testing/working/revenue per worker index
            const base = idx >= 0 ? idx * 3 : -1;
            const tData =
              base >= 0 ? (interventionQueries[base]?.data as MetricBreakdownResult | undefined) : undefined;
            const wData =
              base >= 0
                ? (interventionQueries[base + 1]?.data as MetricBreakdownResult | undefined)
                : undefined;
            const rData =
              base >= 0
                ? (interventionQueries[base + 2]?.data as MetricBreakdownResult | undefined)
                : undefined;
            const parse = (data: MetricBreakdownResult | undefined): NetworkGeoSlice[] => {
              if (!data) return [];
              const out: NetworkGeoSlice[] = [];
              for (const net of data.networks) {
                for (const g of net.geos ?? []) {
                  if (!(g.target > 0)) continue;
                  out.push({ network: net.label, geo: g.label, current: g.current, target: g.target });
                }
              }
              if (out.length > 0) return enrichSlicesWithPerformance(out, perfBoostBuckets);
              return enrichSlicesWithPerformance(
                data.networks
                  .filter((n) => n.target > 0)
                  .map((n) => ({
                    network: n.label,
                    geo: null,
                    current: n.current,
                    target: n.target,
                  })),
                perfBoostBuckets,
              );
            };
            return {
              testing: parse(tData),
              working: parse(wData),
              revenue: parse(rData),
            };
          };
          const workerCampaigns = enrichedCampaigns.filter((c) => {
            const empId =
              c.employeeId ??
              (c.batchId != null ? batchEmployeeById.get(c.batchId) : null) ??
              null;
            return empId === w.employeeId;
          });
          return {
            employeeId: w.employeeId,
            employeeName: w.name,
            goalCards: cards,
            slices: toWorkerSlices(),
            campaigns: workerCampaigns,
          };
        });

      const items = buildAdminInterventionFocus({
        monthKey: mk,
        workers: adminWorkers,
        maxActions: 5,
      });
      return { items, empty: items.length === 0 };
    }

    return computeTodaysFocusImpl(
      goalCards,
      hasAnyActivity,
      operational,
      enrichedCampaigns,
      hasGeoTargets,
      {
        slices: focusSlices,
        isAdmin: !isWorker,
        employeeName: focusEmployeeName,
        monthKey: mk,
      },
    );
  }, [
    goalCards,
    networkGroups,
    hasAnyActivity,
    batches,
    tasks,
    healthByBatchId,
    today,
    enrichedCampaigns,
    focusSlices,
    isWorker,
    focusEmployeeName,
    focusEmployeeId,
    monthKey,
    monthlyGoalsDashboard,
    interventionQueryDataKey,
    interventionQueries,
    perfBoostBuckets,
  ]);

  const healthLoading = healthQueries.some((q) => q.isLoading);

  /** Per-worker Monthly Goal testing slices + campaigns for Team Daily Focus. */
  const focusTeamWorkers = useMemo(() => {
    if (isWorker || focusEmployeeId != null) return [];
    const workers = monthlyGoalsDashboard?.workers ?? [];
    const batchEmployeeById = new Map(batches.map((b) => [b.id, b.employeeId] as const));
    return workers
      .filter((w) => w.testing.target > 0 || w.working.target > 0)
      .slice(0, 12)
      .map((w) => {
        const idx = workers.findIndex((x) => x.employeeId === w.employeeId);
        const base = idx >= 0 ? idx * 3 : -1;
        const tData =
          base >= 0
            ? (interventionQueries[base]?.data as MetricBreakdownResult | undefined)
            : undefined;
        const testingSlices: NetworkGeoSlice[] = (() => {
          if (!tData) return [];
          const out: NetworkGeoSlice[] = [];
          for (const net of tData.networks) {
            for (const g of net.geos ?? []) {
              if (!(g.target > 0)) continue;
              out.push({
                network: net.label,
                geo: g.label,
                current: g.current,
                target: g.target,
              });
            }
          }
          if (out.length > 0) return out;
          return tData.networks
            .filter((n) => n.target > 0)
            .map((n) => ({
              network: n.label,
              geo: null,
              current: n.current,
              target: n.target,
            }));
        })();
        const workerCampaigns = enrichedCampaigns.filter((c) => {
          const empId =
            c.employeeId ??
            (c.batchId != null ? batchEmployeeById.get(c.batchId) : null) ??
            null;
          return empId === w.employeeId;
        });
        return {
          employeeId: w.employeeId,
          employeeName: w.name,
          testingSlices,
          campaigns: workerCampaigns,
        };
      });
  }, [
    isWorker,
    focusEmployeeId,
    monthlyGoalsDashboard,
    batches,
    enrichedCampaigns,
    interventionQueryDataKey,
    interventionQueries,
  ]);

  return {
    monthLabel: monthLabel(),
    monthKey: monthKey || currentMonthKey(),
    daysRemaining: daysRemainingInMonth(),
    dateFrom,
    dateTo,
    goalCards,
    networkGroups,
    focus,
    focusTestingSlices: focusSlices.testing,
    focusTeamWorkers,
    mtdRevenue,
    attributedRevenueMtd,
    unattributedRevenueMtd: Math.max(0, mtdRevenue - attributedRevenueMtd),
    isLoading: perfLoading || breakdownsLoading || healthLoading || peGoalsLoading,
    isError,
    error,
    refetch,
    isFetching,
    hasAnyActivity,
    isWorker,
    peGoals: workerPe,
  };
}
