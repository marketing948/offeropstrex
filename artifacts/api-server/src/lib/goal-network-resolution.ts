import type { ServerWorkerGoalTarget } from "./goals-config-server.ts";
import {
  computeNetworkEffectiveTarget,
  distributeTargetAcrossKeys,
  eligibleGeosForNetwork,
  metricTargetKindFor,
  resolveEffectiveGeoTargets,
  sortEligibleNetworks,
  type GeoTargetSource,
} from "./goal-effective-targets.ts";

export type GoalMetricKey = ServerWorkerGoalTarget["metricKey"];

export type NetworkAllocationSource =
  | "auto-from-worker-wide"
  | "network-explicit"
  | "unallocated";

export type GeoAllocationSource = "inherited" | "custom" | "custom-zero" | "none";

export type MetricNetworkResolution = {
  target: number;
  source: NetworkAllocationSource;
};

export function workerWideTarget(
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

export function explicitNetworkTargets(
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

export function geoOverrideCountForNetwork(
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

export function selectedGeoCodesForNetwork(
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

export { eligibleNetworksForMetric };

export function resolveNetworkTargetsForMetric(
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

export function resolveGeoTargetsForNetworkMetric(input: {
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
