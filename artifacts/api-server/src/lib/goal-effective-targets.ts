import type { ServerWorkerGoalTarget } from "./goals-config-server.ts";

export type GeoTargetSource = "inherited" | "custom" | "none";

export type EffectiveGeoTarget = {
  geo: string;
  target: number;
  source: GeoTargetSource;
};

export type MetricTargetKind = "revenue" | "count";

/** network name → geo → current value */
export type NetworkGeoMap = Map<string, Map<string, number>>;

export function sortEligibleGeos(geos: Iterable<string>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of geos) {
    const geo = raw.trim();
    if (!geo || seen.has(geo)) continue;
    seen.add(geo);
    unique.push(geo);
  }
  return unique.sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase()));
}

export function isExplicitNetworkGeoGoal(g: ServerWorkerGoalTarget): boolean {
  return !!(g.affiliateNetworkName?.trim() && g.geoCode?.trim());
}

function isNetworkScopedGoal(g: ServerWorkerGoalTarget): boolean {
  return !!(g.affiliateNetworkName?.trim() && !g.geoCode?.trim());
}

function selectedGeoCodesFromNetworkGoals(
  networkKey: string,
  goals: ServerWorkerGoalTarget[],
  metricKey: ServerWorkerGoalTarget["metricKey"],
  employeeId: number | null,
): string[] | null {
  const codes = new Set<string>();
  let found = false;
  for (const g of goals) {
    if (g.metricKey !== metricKey) continue;
    if (employeeId != null && g.employeeId !== employeeId) continue;
    if (g.affiliateNetworkName?.trim() !== networkKey) continue;
    if (!isNetworkScopedGoal(g)) continue;
    if (!Array.isArray(g.selectedGeoCodes) || g.selectedGeoCodes.length === 0) continue;
    found = true;
    for (const code of g.selectedGeoCodes) {
      const trimmed = code.trim();
      if (trimmed) codes.add(trimmed);
    }
  }
  if (!found || codes.size === 0) return null;
  return sortEligibleGeos([...codes]);
}

export function eligibleGeosForNetwork(
  networkKey: string,
  goals: ServerWorkerGoalTarget[],
  metricKey: ServerWorkerGoalTarget["metricKey"],
  employeeId: number | null,
  activityGeos: Iterable<string>,
): string[] {
  const selected = selectedGeoCodesFromNetworkGoals(networkKey, goals, metricKey, employeeId);
  if (selected != null && selected.length > 0) {
    const geoKeys = new Set<string>(selected);
    for (const g of goals) {
      if (g.metricKey !== metricKey) continue;
      if (employeeId != null && g.employeeId !== employeeId) continue;
      if (g.affiliateNetworkName?.trim() === networkKey && g.geoCode?.trim()) {
        geoKeys.add(g.geoCode.trim());
      }
    }
    return sortEligibleGeos([...geoKeys]);
  }

  const geoKeys = new Set<string>();
  for (const geo of activityGeos) {
    const trimmed = geo.trim();
    if (trimmed) geoKeys.add(trimmed);
  }
  for (const g of goals) {
    if (g.metricKey !== metricKey) continue;
    if (employeeId != null && g.employeeId !== employeeId) continue;
    if (g.affiliateNetworkName?.trim() === networkKey && g.geoCode?.trim()) {
      geoKeys.add(g.geoCode.trim());
    }
  }
  return sortEligibleGeos(
    [...geoKeys].filter((k) => k !== "(unset)" || [...activityGeos].some((g) => g.trim() === "(unset)")),
  );
}

export function resolveEffectiveGeoTargets(input: {
  metricKind: MetricTargetKind;
  networkTarget: number | null;
  explicitGeoTargets: Map<string, number>;
  eligibleGeos: string[];
}): { geos: EffectiveGeoTarget[]; effectiveNetworkTarget: number } {
  const { metricKind, networkTarget, explicitGeoTargets, eligibleGeos } = input;
  const sorted = sortEligibleGeos(eligibleGeos);

  if (sorted.length === 0) {
    const configuredNetwork =
      networkTarget != null && Number.isFinite(networkTarget) && networkTarget > 0 ? networkTarget : 0;
    return { geos: [], effectiveNetworkTarget: configuredNetwork };
  }

  const hasNetworkTarget = networkTarget != null && Number.isFinite(networkTarget) && networkTarget > 0;
  const defaults = new Map<string, number>();

  if (hasNetworkTarget) {
    if (metricKind === "revenue") {
      const share = networkTarget! / sorted.length;
      for (const geo of sorted) defaults.set(geo, share);
    } else {
      const base = Math.floor(networkTarget! / sorted.length);
      const remainder = networkTarget! % sorted.length;
      sorted.forEach((geo, index) => {
        defaults.set(geo, base + (index < remainder ? 1 : 0));
      });
    }
  }

  const geos: EffectiveGeoTarget[] = [];
  let effectiveNetworkTarget = 0;

  for (const geo of sorted) {
    if (explicitGeoTargets.has(geo)) {
      const target = explicitGeoTargets.get(geo)!;
      geos.push({ geo, target, source: "custom" });
      effectiveNetworkTarget += target;
    } else if (hasNetworkTarget && defaults.has(geo)) {
      const target = defaults.get(geo)!;
      geos.push({ geo, target, source: "inherited" });
      effectiveNetworkTarget += target;
    }
  }

  if (!hasNetworkTarget) {
    return { geos, effectiveNetworkTarget };
  }

  return { geos, effectiveNetworkTarget };
}

export function metricTargetKindFor(metricKey: ServerWorkerGoalTarget["metricKey"]): MetricTargetKind {
  return metricKey === "revenue" ? "revenue" : "count";
}

function networkKeysFromGoalsAndActivity(
  goals: ServerWorkerGoalTarget[],
  metricKey: ServerWorkerGoalTarget["metricKey"],
  employeeId: number,
  activity: NetworkGeoMap,
): string[] {
  const keys = new Set<string>();
  for (const net of activity.keys()) keys.add(net);
  for (const g of goals) {
    if (g.metricKey !== metricKey) continue;
    if (g.employeeId !== employeeId) continue;
    const net = g.affiliateNetworkName?.trim();
    if (net) keys.add(net);
  }
  return [...keys].filter((k) => k !== "(unset)" || activity.has(k));
}

export function computeNetworkEffectiveTarget(
  networkKey: string,
  goals: ServerWorkerGoalTarget[],
  metricKey: ServerWorkerGoalTarget["metricKey"],
  employeeId: number | null,
  activityGeos: Iterable<string>,
): { effectiveNetworkTarget: number; geos: EffectiveGeoTarget[] } {
  const scopedGoals = goals.filter((g) => {
    if (g.metricKey !== metricKey) return false;
    if (employeeId != null && g.employeeId !== employeeId) return false;
    return true;
  });

  const networkOnlyTarget = scopedGoals
    .filter((g) => g.affiliateNetworkName?.trim() === networkKey && !g.geoCode?.trim())
    .reduce((sum, g) => sum + g.monthlyTarget, 0);

  const explicitGeoTargets = new Map<string, number>();
  for (const g of scopedGoals) {
    if (g.affiliateNetworkName?.trim() !== networkKey) continue;
    const geo = g.geoCode?.trim();
    if (!geo) continue;
    explicitGeoTargets.set(geo, (explicitGeoTargets.get(geo) ?? 0) + g.monthlyTarget);
  }

  const eligibleGeos = eligibleGeosForNetwork(networkKey, goals, metricKey, employeeId, activityGeos);
  const networkTarget = networkOnlyTarget > 0 ? networkOnlyTarget : null;

  return resolveEffectiveGeoTargets({
    metricKind: metricTargetKindFor(metricKey),
    networkTarget,
    explicitGeoTargets,
    eligibleGeos,
  });
}

export function computeEffectiveMetricTarget(
  goals: ServerWorkerGoalTarget[],
  metricKey: ServerWorkerGoalTarget["metricKey"],
  employeeId: number,
  activity: NetworkGeoMap,
): number {
  const scopedGoals = goals.filter((g) => g.metricKey === metricKey && g.employeeId === employeeId);

  const employeeWide = scopedGoals
    .filter((g) => !g.affiliateNetworkName?.trim() && !g.geoCode?.trim())
    .reduce((sum, g) => sum + g.monthlyTarget, 0);

  const geoOnlyWithoutNetwork = scopedGoals
    .filter((g) => !g.affiliateNetworkName?.trim() && g.geoCode?.trim())
    .reduce((sum, g) => sum + g.monthlyTarget, 0);

  const networkKeys = networkKeysFromGoalsAndActivity(scopedGoals, metricKey, employeeId, activity);
  let networkSum = 0;
  for (const networkKey of networkKeys) {
    const activityGeos = activity.get(networkKey)?.keys() ?? [];
    const { effectiveNetworkTarget } = computeNetworkEffectiveTarget(
      networkKey,
      goals,
      metricKey,
      employeeId,
      activityGeos,
    );
    networkSum += effectiveNetworkTarget;
  }

  return employeeWide + geoOnlyWithoutNetwork + networkSum;
}

export function geoHasConfiguredTarget(target: number, source?: GeoTargetSource): boolean {
  if (source === "inherited" || source === "custom") return true;
  return target > 0;
}

/** Preview inherited per-GEO share for goal plan UI. */
export function previewInheritedGeoShares(
  metricKind: MetricTargetKind,
  networkTarget: number,
  eligibleGeos: string[],
): Map<string, number> {
  const { geos } = resolveEffectiveGeoTargets({
    metricKind,
    networkTarget,
    explicitGeoTargets: new Map(),
    eligibleGeos,
  });
  return new Map(geos.map((g) => [g.geo, g.target]));
}
