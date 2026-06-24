import type { MetricsDateRange } from "./campaign-daily-metrics-aggregate.ts";
import {
  goalsForMonthBreakdown,
  loadGoalsConfig,
  type ServerWorkerGoalTarget,
} from "./goals-config-server.ts";
import {
  computeEffectiveMetricTarget,
  computeNetworkEffectiveTarget,
  distributeTargetAcrossKeys,
  eligibleGeosForNetwork,
  metricTargetKindFor,
  resolveEffectiveGeoTargets,
  sortEligibleNetworks,
  type GeoTargetSource,
  type MetricTargetKind,
  type NetworkGeoMap,
} from "./goal-effective-targets.ts";
import { loadAssignedNetworksForEmployee } from "./worker-network-access.ts";
import {
  queryRevenueNetworkGeo,
  queryTestingNetworkGeo,
  queryWorkingNetworkGeo,
} from "./metric-breakdown-service.ts";
import { buildMonthlyGoalsDashboard } from "./monthly-goals-service.ts";
import { monthKeyToRange } from "./xp-award-service.ts";

const METRIC_KEYS = ["revenue", "testingBatches", "workingCampaigns"] as const;
type GoalMetricKey = (typeof METRIC_KEYS)[number];

export type NetworkAllocationSource =
  | "auto-from-worker-wide"
  | "network-explicit"
  | "unallocated";

export type GeoAllocationSource = "inherited" | "custom" | "custom-zero" | "none";

export type GoalAllocationGeoRow = {
  affiliateNetworkName: string;
  geoCode: string;
  revenueTarget: number | null;
  testingTarget: number | null;
  workingTarget: number | null;
  revenueSource?: GeoAllocationSource;
  testingSource?: GeoAllocationSource;
  workingSource?: GeoAllocationSource;
};

export type GoalAllocationNetworkRow = {
  affiliateNetworkName: string;
  revenueTarget: number | null;
  testingTarget: number | null;
  workingTarget: number | null;
  revenueSource?: NetworkAllocationSource;
  testingSource?: NetworkAllocationSource;
  workingSource?: NetworkAllocationSource;
  geoCount: number;
  overrideCount: number;
  geoSplitRows: GoalAllocationGeoRow[];
};

export type GoalAllocationWorkerWideUnallocated = {
  revenueTarget: number | null;
  testingTarget: number | null;
  workingTarget: number | null;
  message: string;
};

export type GoalAllocationResult = {
  employeeId: number;
  monthKey: string;
  overview: {
    revenue: { current: number; target: number };
    testing: { current: number; target: number };
    working: { current: number; target: number };
    xpEarned: number;
  };
  workerWideUnallocated: GoalAllocationWorkerWideUnallocated | null;
  networks: GoalAllocationNetworkRow[];
  geos: GoalAllocationGeoRow[];
  counts: {
    hasAnyGoals: boolean;
    networkCount: number;
    selectedGeoCount: number;
    overrideCount: number;
  };
};

type MetricNetworkResolution = {
  target: number;
  source: NetworkAllocationSource;
};

function workerWideTarget(
  goals: ServerWorkerGoalTarget[],
  metricKey: GoalMetricKey,
  employeeId: number,
): number {
  return goals
    .filter(
      (g) =>
        g.metricKey === metricKey &&
        g.employeeId === employeeId &&
        !g.affiliateNetworkName?.trim() &&
        !g.geoCode?.trim(),
    )
    .reduce((sum, g) => sum + g.monthlyTarget, 0);
}

function explicitNetworkTargets(
  goals: ServerWorkerGoalTarget[],
  metricKey: GoalMetricKey,
  employeeId: number,
): Map<string, number> {
  const explicit = new Map<string, number>();
  for (const g of goals) {
    if (g.metricKey !== metricKey || g.employeeId !== employeeId) continue;
    const net = g.affiliateNetworkName?.trim();
    if (!net || g.geoCode?.trim()) continue;
    explicit.set(net, (explicit.get(net) ?? 0) + g.monthlyTarget);
  }
  return explicit;
}

function geoOverrideCountForNetwork(
  goals: ServerWorkerGoalTarget[],
  employeeId: number,
  networkName: string,
): number {
  return goals.filter(
    (g) =>
      g.employeeId === employeeId &&
      g.affiliateNetworkName?.trim() === networkName &&
      Boolean(g.geoCode?.trim()),
  ).length;
}

function selectedGeoCodesForNetwork(
  goals: ServerWorkerGoalTarget[],
  employeeId: number,
  networkName: string,
): string[] {
  const codes = new Set<string>();
  for (const g of goals) {
    if (g.employeeId !== employeeId) continue;
    if (g.affiliateNetworkName?.trim() !== networkName) continue;
    if (!Array.isArray(g.selectedGeoCodes)) continue;
    for (const code of g.selectedGeoCodes) {
      const trimmed = code.trim();
      if (trimmed) codes.add(trimmed);
    }
  }
  return sortEligibleNetworks([...codes]);
}

function eligibleNetworksForMetric(
  assignedNetworks: string[],
  explicitNetworks: Iterable<string>,
  activityNetworks: Iterable<string>,
): string[] {
  return sortEligibleNetworks([...assignedNetworks, ...explicitNetworks, ...activityNetworks]);
}

function resolveNetworkTargetsForMetric(
  goals: ServerWorkerGoalTarget[],
  metricKey: GoalMetricKey,
  employeeId: number,
  assignedNetworks: string[],
  activityNetworks: string[],
): Map<string, MetricNetworkResolution> {
  const workerWide = workerWideTarget(goals, metricKey, employeeId);
  const explicit = explicitNetworkTargets(goals, metricKey, employeeId);
  const eligible = eligibleNetworksForMetric(assignedNetworks, explicit.keys(), activityNetworks);
  const metricKind = metricTargetKindFor(metricKey);
  const result = new Map<string, MetricNetworkResolution>();

  const networkKeys = sortEligibleNetworks([...eligible, ...explicit.keys()]);

  if (workerWide > 0) {
    const autoShares = distributeTargetAcrossKeys(metricKind, workerWide, eligible);
    for (const net of networkKeys) {
      if (explicit.has(net)) {
        result.set(net, { target: explicit.get(net)!, source: "network-explicit" });
      } else if (autoShares.has(net)) {
        result.set(net, { target: autoShares.get(net)!, source: "auto-from-worker-wide" });
      }
    }
    return result;
  }

  for (const [net, target] of explicit) {
    result.set(net, { target, source: "network-explicit" });
  }
  return result;
}

function explicitGeoTargetsForNetwork(
  goals: ServerWorkerGoalTarget[],
  metricKey: GoalMetricKey,
  employeeId: number,
  networkName: string,
): Map<string, number> {
  const explicit = new Map<string, number>();
  for (const g of goals) {
    if (g.metricKey !== metricKey || g.employeeId !== employeeId) continue;
    if (g.affiliateNetworkName?.trim() !== networkName) continue;
    const geo = g.geoCode?.trim();
    if (!geo) continue;
    explicit.set(geo, (explicit.get(geo) ?? 0) + g.monthlyTarget);
  }
  return explicit;
}

function hasExplicitNetworkGoalRow(
  goals: ServerWorkerGoalTarget[],
  metricKey: GoalMetricKey,
  employeeId: number,
  networkName: string,
): boolean {
  return goals.some(
    (g) =>
      g.metricKey === metricKey &&
      g.employeeId === employeeId &&
      g.affiliateNetworkName?.trim() === networkName &&
      !g.geoCode?.trim() &&
      g.monthlyTarget > 0,
  );
}

function mapGeoSource(source: GeoTargetSource, target: number): GeoAllocationSource {
  if (source === "custom" && target === 0) return "custom-zero";
  if (source === "custom") return "custom";
  if (source === "inherited") return "inherited";
  return "none";
}

function resolveGeoTargetsForNetworkMetric(input: {
  goals: ServerWorkerGoalTarget[];
  metricKey: GoalMetricKey;
  employeeId: number;
  networkName: string;
  networkResolution: MetricNetworkResolution;
  activityGeos: Iterable<string>;
}): { geos: { geoCode: string; target: number; source: GeoAllocationSource }[]; effectiveTarget: number } {
  const { goals, metricKey, employeeId, networkName, networkResolution, activityGeos } = input;
  const metricKind = metricTargetKindFor(metricKey);

  if (
    networkResolution.source === "network-explicit" &&
    hasExplicitNetworkGoalRow(goals, metricKey, employeeId, networkName)
  ) {
    const { geos, effectiveNetworkTarget } = computeNetworkEffectiveTarget(
      networkName,
      goals,
      metricKey,
      employeeId,
      activityGeos,
    );
    return {
      effectiveTarget: effectiveNetworkTarget,
      geos: geos.map((g) => ({
        geoCode: g.geo,
        target: g.target,
        source: mapGeoSource(g.source, g.target),
      })),
    };
  }

  const eligibleGeos = eligibleGeosForNetwork(
    networkName,
    goals,
    metricKey,
    employeeId,
    activityGeos,
  );
  const explicitGeoTargets = explicitGeoTargetsForNetwork(goals, metricKey, employeeId, networkName);
  const networkTarget = networkResolution.target > 0 ? networkResolution.target : null;
  const { geos, effectiveNetworkTarget } = resolveEffectiveGeoTargets({
    metricKind,
    networkTarget,
    explicitGeoTargets,
    eligibleGeos,
  });

  return {
    effectiveTarget: effectiveNetworkTarget > 0 ? effectiveNetworkTarget : networkResolution.target,
    geos: geos.map((g) => ({
      geoCode: g.geo,
      target: g.target,
      source: mapGeoSource(g.source, g.target),
    })),
  };
}

function metricKeyToActivityMap(
  activity: { revenue: NetworkGeoMap; testing: NetworkGeoMap; working: NetworkGeoMap },
  metricKey: GoalMetricKey,
): NetworkGeoMap {
  if (metricKey === "revenue") return activity.revenue;
  if (metricKey === "testingBatches") return activity.testing;
  return activity.working;
}

function mergeNetworkRows(
  goals: ServerWorkerGoalTarget[],
  employeeId: number,
  assignedNetworks: string[],
  activity: { revenue: NetworkGeoMap; testing: NetworkGeoMap; working: NetworkGeoMap },
): GoalAllocationNetworkRow[] {
  const networkNames = new Set<string>();
  for (const metricKey of METRIC_KEYS) {
    const activityMap = metricKeyToActivityMap(activity, metricKey);
    const activityNetworks = [...activityMap.keys()];
    const explicit = explicitNetworkTargets(goals, metricKey, employeeId);
    for (const net of eligibleNetworksForMetric(assignedNetworks, explicit.keys(), activityNetworks)) {
      networkNames.add(net);
    }
  }

  const rows: GoalAllocationNetworkRow[] = [];

  for (const networkName of sortEligibleNetworks(networkNames)) {
    const revenueResolution = resolveNetworkTargetsForMetric(
      goals,
      "revenue",
      employeeId,
      assignedNetworks,
      [...activity.revenue.keys()],
    ).get(networkName);
    const testingResolution = resolveNetworkTargetsForMetric(
      goals,
      "testingBatches",
      employeeId,
      assignedNetworks,
      [...activity.testing.keys()],
    ).get(networkName);
    const workingResolution = resolveNetworkTargetsForMetric(
      goals,
      "workingCampaigns",
      employeeId,
      assignedNetworks,
      [...activity.working.keys()],
    ).get(networkName);

    if (!revenueResolution && !testingResolution && !workingResolution) continue;

    const geoByCode = new Map<string, GoalAllocationGeoRow>();

    function applyMetric(
      metricKey: GoalMetricKey,
      resolution: MetricNetworkResolution | undefined,
      targetKey: "revenueTarget" | "testingTarget" | "workingTarget",
      sourceKey: "revenueSource" | "testingSource" | "workingSource",
      activityGeos: Iterable<string>,
    ): MetricNetworkResolution | undefined {
      if (!resolution || resolution.target <= 0) return undefined;
      const { geos, effectiveTarget } = resolveGeoTargetsForNetworkMetric({
        goals,
        metricKey,
        employeeId,
        networkName,
        networkResolution: resolution,
        activityGeos,
      });
      for (const geo of geos) {
        let row = geoByCode.get(geo.geoCode);
        if (!row) {
          row = {
            affiliateNetworkName: networkName,
            geoCode: geo.geoCode,
            revenueTarget: null,
            testingTarget: null,
            workingTarget: null,
          };
          geoByCode.set(geo.geoCode, row);
        }
        if (targetKey === "revenueTarget") {
          row.revenueTarget = geo.target;
          row.revenueSource = geo.source;
        } else if (targetKey === "testingTarget") {
          row.testingTarget = geo.target;
          row.testingSource = geo.source;
        } else {
          row.workingTarget = geo.target;
          row.workingSource = geo.source;
        }
      }
      return { target: effectiveTarget, source: resolution.source };
    }

    const revenueFinal = applyMetric(
      "revenue",
      revenueResolution,
      "revenueTarget",
      "revenueSource",
      activity.revenue.get(networkName)?.keys() ?? [],
    );
    const testingFinal = applyMetric(
      "testingBatches",
      testingResolution,
      "testingTarget",
      "testingSource",
      activity.testing.get(networkName)?.keys() ?? [],
    );
    const workingFinal = applyMetric(
      "workingCampaigns",
      workingResolution,
      "workingTarget",
      "workingSource",
      activity.working.get(networkName)?.keys() ?? [],
    );

    const selectedGeoCodes = selectedGeoCodesForNetwork(goals, employeeId, networkName);
    const geoSplitRows = [...geoByCode.values()].sort((a, b) =>
      a.geoCode.toUpperCase().localeCompare(b.geoCode.toUpperCase()),
    );

    rows.push({
      affiliateNetworkName: networkName,
      revenueTarget: revenueFinal?.target ?? null,
      testingTarget: testingFinal?.target ?? null,
      workingTarget: workingFinal?.target ?? null,
      revenueSource: revenueFinal?.source,
      testingSource: testingFinal?.source,
      workingSource: workingFinal?.source,
      geoCount: selectedGeoCodes.length > 0 ? selectedGeoCodes.length : geoSplitRows.length,
      overrideCount: geoOverrideCountForNetwork(goals, employeeId, networkName),
      geoSplitRows,
    });
  }

  return rows.sort((a, b) => a.affiliateNetworkName.localeCompare(b.affiliateNetworkName));
}

function buildWorkerWideUnallocated(
  goals: ServerWorkerGoalTarget[],
  employeeId: number,
  assignedNetworks: string[],
): GoalAllocationWorkerWideUnallocated | null {
  const revenue = workerWideTarget(goals, "revenue", employeeId);
  const testing = workerWideTarget(goals, "testingBatches", employeeId);
  const working = workerWideTarget(goals, "workingCampaigns", employeeId);
  const hasWorkerWide = revenue > 0 || testing > 0 || working > 0;
  if (!hasWorkerWide || assignedNetworks.length > 0) return null;

  return {
    revenueTarget: revenue > 0 ? revenue : null,
    testingTarget: testing > 0 ? testing : null,
    workingTarget: working > 0 ? working : null,
    message:
      "No assigned affiliate networks found, so this goal is not distributed yet.",
  };
}

function flattenGeos(networks: GoalAllocationNetworkRow[]): GoalAllocationGeoRow[] {
  const rows: GoalAllocationGeoRow[] = [];
  for (const net of networks) {
    for (const geo of net.geoSplitRows) {
      rows.push(geo);
    }
  }
  return rows.sort((a, b) => {
    const geoCmp = a.geoCode.toUpperCase().localeCompare(b.geoCode.toUpperCase());
    if (geoCmp !== 0) return geoCmp;
    return a.affiliateNetworkName.localeCompare(b.affiliateNetworkName);
  });
}

export async function buildGoalAllocation(
  workspaceId: number,
  employeeId: number,
  monthKey: string,
): Promise<GoalAllocationResult | null> {
  const dashboard = await buildMonthlyGoalsDashboard(workspaceId, monthKey, employeeId);
  const workerRow = dashboard.workers.find((w) => w.employeeId === employeeId);
  if (!workerRow) return null;

  const monthRange = monthKeyToRange(monthKey);
  const range: MetricsDateRange = {
    dateFrom: monthRange.dateFromIso,
    dateTo: monthRange.dateToIso,
  };

  const [cfg, assigned] = await Promise.all([
    loadGoalsConfig(workspaceId),
    loadAssignedNetworksForEmployee(workspaceId, employeeId),
  ]);
  const goals = goalsForMonthBreakdown(cfg.workerGoalTargets, monthKey);

  const [revenueActivity, testingActivity, workingActivity] = await Promise.all([
    queryRevenueNetworkGeo(workspaceId, range, employeeId),
    queryTestingNetworkGeo(workspaceId, employeeId),
    queryWorkingNetworkGeo(workspaceId, employeeId),
  ]);

  const activity = {
    revenue: revenueActivity,
    testing: testingActivity,
    working: workingActivity,
  };

  const networks = mergeNetworkRows(goals, employeeId, assigned.names, activity);
  const workerWideUnallocated = buildWorkerWideUnallocated(goals, employeeId, assigned.names);
  const geos = flattenGeos(networks);

  const selectedGeoSet = new Set<string>();
  let overrideCount = 0;
  for (const net of networks) {
    overrideCount += net.overrideCount;
    for (const geo of net.geoSplitRows) selectedGeoSet.add(geo.geoCode);
    const selected = selectedGeoCodesForNetwork(goals, employeeId, net.affiliateNetworkName);
    for (const code of selected) selectedGeoSet.add(code);
  }

  const hasOverviewGoals =
    workerRow.revenue.target > 0 ||
    workerRow.testing.target > 0 ||
    workerRow.working.target > 0;
  const hasAnyGoals = hasOverviewGoals || networks.length > 0 || workerWideUnallocated != null;

  return {
    employeeId,
    monthKey,
    overview: {
      revenue: { current: workerRow.revenue.current, target: workerRow.revenue.target },
      testing: { current: workerRow.testing.current, target: workerRow.testing.target },
      working: { current: workerRow.working.current, target: workerRow.working.target },
      xpEarned: workerRow.xpEarned,
    },
    workerWideUnallocated,
    networks,
    geos,
    counts: {
      hasAnyGoals,
      networkCount: networks.length,
      selectedGeoCount: selectedGeoSet.size,
      overrideCount,
    },
  };
}
