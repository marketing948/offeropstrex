import type { WorkerGoalTarget } from "@/lib/worker-goals";

export type GoalMetric = "revenue" | "testingBatches" | "workingCampaigns";

export function previewInheritedShares(
  metric: GoalMetric,
  networkTarget: number,
  geoCodes: string[],
): Map<string, number> {
  const sorted = [...new Set(geoCodes.map((g) => g.trim()).filter(Boolean))].sort((a, b) =>
    a.toUpperCase().localeCompare(b.toUpperCase()),
  );
  if (sorted.length === 0 || networkTarget <= 0) return new Map();

  const result = new Map<string, number>();
  if (metric === "revenue") {
    const share = networkTarget / sorted.length;
    for (const geo of sorted) result.set(geo, share);
    return result;
  }

  const base = Math.floor(networkTarget / sorted.length);
  const remainder = networkTarget % sorted.length;
  sorted.forEach((geo, index) => {
    result.set(geo, base + (index < remainder ? 1 : 0));
  });
  return result;
}

export function formatSharePreview(
  metric: GoalMetric,
  target: number,
  geoCount: number,
): string {
  if (geoCount <= 0 || target <= 0) return "";
  if (metric === "revenue") {
    const each = target / geoCount;
    return `$${target.toLocaleString()} ÷ ${geoCount} GEOs = $${each.toLocaleString(undefined, { maximumFractionDigits: 2 })} each`;
  }
  const base = Math.floor(target / geoCount);
  const remainder = target % geoCount;
  if (remainder === 0) {
    return `${target} campaigns ÷ ${geoCount} GEOs = ${base} each`;
  }
  return `${target} campaigns ÷ ${geoCount} GEOs = ${base}–${base + 1} each (${remainder} GEOs get +1)`;
}

export function goalsForWorkerMonth(
  goals: WorkerGoalTarget[],
  employeeId: number,
  monthKey: string,
): WorkerGoalTarget[] {
  return goals.filter(
    (g) =>
      g.isActive &&
      g.employeeId === employeeId &&
      (g.monthKey == null || g.monthKey === monthKey),
  );
}

export function networkNamesInPlan(goals: WorkerGoalTarget[]): string[] {
  const names = new Set<string>();
  for (const g of goals) {
    const net = g.affiliateNetworkName?.trim();
    if (net) names.add(net);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function loadPlanFromGoals(
  goals: WorkerGoalTarget[],
  employeeId: number,
  monthKey: string,
  networkName: string | null,
): {
  selectedGeoCodes: string[];
  metrics: Record<GoalMetric, { enabled: boolean; target: string; xp: string }>;
  overrides: { metricKey: GoalMetric; geoCode: string; target: string }[];
} {
  const scoped = goalsForWorkerMonth(goals, employeeId, monthKey).filter((g) => {
    const net = g.affiliateNetworkName?.trim() ?? "";
    if (networkName) return net === networkName;
    return !net;
  });

  const metrics: Record<GoalMetric, { enabled: boolean; target: string; xp: string }> = {
    revenue: { enabled: false, target: "", xp: "500" },
    testingBatches: { enabled: false, target: "", xp: "200" },
    workingCampaigns: { enabled: false, target: "", xp: "300" },
  };

  let selectedGeoCodes: string[] = [];
  for (const g of scoped) {
    if (g.geoCode?.trim()) continue;
    if (g.metricKey === "revenue" || g.metricKey === "testingBatches" || g.metricKey === "workingCampaigns") {
      metrics[g.metricKey] = {
        enabled: true,
        target: String(g.monthlyTarget),
        xp: String(g.xpReward ?? metrics[g.metricKey].xp),
      };
      if (g.selectedGeoCodes?.length) {
        selectedGeoCodes = g.selectedGeoCodes;
      }
    }
  }

  const overrides = scoped
    .filter((g) => g.geoCode?.trim())
    .filter(
      (g): g is WorkerGoalTarget & { metricKey: GoalMetric; geoCode: string } =>
        (g.metricKey === "revenue" ||
          g.metricKey === "testingBatches" ||
          g.metricKey === "workingCampaigns") &&
        !!g.geoCode?.trim(),
    )
    .map((g) => ({
      metricKey: g.metricKey,
      geoCode: g.geoCode.trim(),
      target: String(g.monthlyTarget),
    }));

  return { selectedGeoCodes, metrics, overrides };
}

export function buildPlanHydrationKey(params: {
  mode: "create" | "edit";
  employeeId: number;
  monthKey: string;
  networkName?: string | null;
}): string {
  const net = (params.networkName ?? "").trim();
  return `${params.mode}:${params.employeeId}:${params.monthKey}:${net}`;
}

export function shouldRehydratePlanForm(params: {
  open: boolean;
  hydrationKey: string | null;
  lastHydratedKey: string | null;
  isDirty: boolean;
}): boolean {
  if (!params.open || params.hydrationKey == null) return false;
  if (params.isDirty) return false;
  return params.lastHydratedKey !== params.hydrationKey;
}
