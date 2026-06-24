import type { WorkerGoalTarget } from "@/lib/worker-goals";

export type GoalMetric = "revenue" | "testingBatches" | "workingCampaigns";

/** Same shape as Monthly Goals table row metric fields — drawer summary layer. */
export type WorkerMonthlyGoalSummary = {
  revenue: { current: number; target: number };
  testing: { current: number; target: number };
  working: { current: number; target: number };
  xpEarned?: number;
};

const GOAL_METRICS: GoalMetric[] = ["revenue", "testingBatches", "workingCampaigns"];

/** Normalize legacy / alias goal kind names to canonical metric keys. */
export function normalizeGoalKind(goalKind: string): GoalMetric | null {
  const key = goalKind.trim();
  if (key === "revenue") return "revenue";
  if (key === "testing" || key === "testingBatches") return "testingBatches";
  if (key === "working" || key === "workingCampaigns") return "workingCampaigns";
  return null;
}

function canonicalGoalMetric(key: string): GoalMetric | null {
  return normalizeGoalKind(key);
}

export function monthlySummaryHasTargets(summary: WorkerMonthlyGoalSummary): boolean {
  return summary.revenue.target > 0 || summary.testing.target > 0 || summary.working.target > 0;
}

export function buildWorkerWideAllocationFromMonthlySummary(
  summary: WorkerMonthlyGoalSummary,
): WorkerGoalNetworkRow {
  return {
    networkName: null,
    isWorkerWide: true,
    revenueTarget: summary.revenue.target > 0 ? summary.revenue.target : null,
    testingTarget: summary.testing.target > 0 ? summary.testing.target : null,
    workingTarget: summary.working.target > 0 ? summary.working.target : null,
    selectedGeoCodes: [],
    overrideCount: 0,
    geoSplitRows: [],
    inferredFromSummary: true,
  };
}

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
  const empId = Number(employeeId);
  return goals.filter(
    (g) =>
      g.isActive &&
      Number(g.employeeId) === empId &&
      (!g.monthKey?.trim() || g.monthKey.trim() === monthKey),
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
    const metric = canonicalGoalMetric(g.metricKey);
    if (metric) {
      metrics[metric] = {
        enabled: true,
        target: String(g.monthlyTarget),
        xp: String(g.xpReward ?? metrics[metric].xp),
      };
      if (g.selectedGeoCodes?.length) {
        selectedGeoCodes = g.selectedGeoCodes;
      }
    }
  }

  const overrides = scoped
    .filter((g) => g.geoCode?.trim())
    .filter((g): g is WorkerGoalTarget & { geoCode: string } => !!g.geoCode?.trim())
    .map((g) => {
      const metric = canonicalGoalMetric(g.metricKey);
      if (!metric) return null;
      return {
        metricKey: metric,
        geoCode: g.geoCode!.trim(),
        target: String(g.monthlyTarget),
      };
    })
    .filter((row): row is { metricKey: GoalMetric; geoCode: string; target: string } => row != null);

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

export const PLAN_CONFIRM_YES = "YES";

export function isPlanConfirmYes(text: string): boolean {
  return text.trim() === PLAN_CONFIRM_YES;
}

export type NetworkPlanSummary = {
  networkName: string | null;
  metrics: { metricKey: GoalMetric; target: number; xp: number }[];
  selectedGeoCodes: string[];
  overrides: { metricKey: GoalMetric; geoCode: string; target: number }[];
};

export function summarizeWorkerPlansByNetwork(
  goals: WorkerGoalTarget[],
  employeeId: number,
  monthKey: string,
): NetworkPlanSummary[] {
  const scoped = goalsForWorkerMonth(goals, employeeId, monthKey);
  const byNet = new Map<string, NetworkPlanSummary>();

  function bucketKey(net: string | null): string {
    return net ?? "__worker_wide__";
  }

  function getBucket(net: string | null): NetworkPlanSummary {
    const key = bucketKey(net);
    let entry = byNet.get(key);
    if (!entry) {
      entry = { networkName: net, metrics: [], selectedGeoCodes: [], overrides: [] };
      byNet.set(key, entry);
    }
    return entry;
  }

  for (const g of scoped) {
    const net = g.affiliateNetworkName?.trim() || null;
    const bucket = getBucket(net);
    const metric = canonicalGoalMetric(g.metricKey);
    if (!metric) continue;
    if (g.geoCode?.trim()) {
      bucket.overrides.push({
        metricKey: metric,
        geoCode: g.geoCode.trim(),
        target: g.monthlyTarget,
      });
      continue;
    }
    bucket.metrics.push({
      metricKey: metric,
      target: g.monthlyTarget,
      xp: g.xpReward ?? 0,
    });
    if (g.selectedGeoCodes?.length) {
      bucket.selectedGeoCodes = g.selectedGeoCodes;
    }
  }

  return [...byNet.values()].sort((a, b) => {
    if (a.networkName == null) return -1;
    if (b.networkName == null) return 1;
    return a.networkName.localeCompare(b.networkName);
  });
}

export type GeoTargetSource = "inherited" | "custom";

export type WorkerGoalGeoSplitRow = {
  geoCode: string;
  revenueTarget: number | null;
  testingTarget: number | null;
  workingTarget: number | null;
  revenueSource?: GeoTargetSource;
  testingSource?: GeoTargetSource;
  workingSource?: GeoTargetSource;
  hasExplicitZero: boolean;
};

export type WorkerGoalNetworkRow = {
  networkName: string | null;
  isWorkerWide: boolean;
  revenueTarget: number | null;
  testingTarget: number | null;
  workingTarget: number | null;
  selectedGeoCodes: string[];
  overrideCount: number;
  geoSplitRows: WorkerGoalGeoSplitRow[];
  /** Populated when allocation rows are missing but Monthly Goals table targets exist. */
  inferredFromSummary?: boolean;
};

export type WorkerGoalGeoAllocationRow = {
  geoCode: string;
  networkName: string;
  revenueTarget: number | null;
  testingTarget: number | null;
  workingTarget: number | null;
  revenueSource?: GeoTargetSource;
  testingSource?: GeoTargetSource;
  workingSource?: GeoTargetSource;
  hasExplicitZero: boolean;
};

export type WorkerGoalAllocationSummary = {
  workerWideRow: WorkerGoalNetworkRow | null;
  networkRows: WorkerGoalNetworkRow[];
  geoRows: WorkerGoalGeoAllocationRow[];
  counts: {
    workerWideMetricLabels: string[];
    networkCount: number;
    selectedGeoCount: number;
    overrideCount: number;
    hasAnyGoals: boolean;
  };
};

const METRIC_LABELS_SHORT: Record<GoalMetric, string> = {
  revenue: "Revenue",
  testingBatches: "Testing",
  workingCampaigns: "Working",
};

function metricTargetFromPlan(plan: NetworkPlanSummary, key: GoalMetric): number | null {
  const row = plan.metrics.find((m) => m.metricKey === key);
  if (!row) return null;
  return row.target;
}

function buildGeoSplitRows(plan: NetworkPlanSummary): WorkerGoalGeoSplitRow[] {
  if (!plan.networkName || plan.selectedGeoCodes.length === 0) return [];

  const geos = [...plan.selectedGeoCodes].sort((a, b) =>
    a.toUpperCase().localeCompare(b.toUpperCase()),
  );
  const overrideByGeo = new Map<string, Partial<Record<GoalMetric, number>>>();
  for (const o of plan.overrides) {
    const key = o.geoCode.toUpperCase();
    const bucket = overrideByGeo.get(key) ?? {};
    bucket[o.metricKey] = o.target;
    overrideByGeo.set(key, bucket);
  }

  const networkTargets: Record<GoalMetric, number> = {
    revenue: metricTargetFromPlan(plan, "revenue") ?? 0,
    testingBatches: metricTargetFromPlan(plan, "testingBatches") ?? 0,
    workingCampaigns: metricTargetFromPlan(plan, "workingCampaigns") ?? 0,
  };

  const inheritedShares: Record<GoalMetric, Map<string, number>> = {
    revenue: previewInheritedShares("revenue", networkTargets.revenue, geos),
    testingBatches: previewInheritedShares("testingBatches", networkTargets.testingBatches, geos),
    workingCampaigns: previewInheritedShares("workingCampaigns", networkTargets.workingCampaigns, geos),
  };

  return geos.map((geo) => {
    const overrides = overrideByGeo.get(geo.toUpperCase()) ?? {};
    let hasExplicitZero = false;

    function resolve(metric: GoalMetric): { value: number | null; source?: GeoTargetSource } {
      if (metric in overrides) {
        const v = overrides[metric]!;
        if (v === 0) hasExplicitZero = true;
        return { value: v, source: "custom" };
      }
      const netTarget = networkTargets[metric];
      if (netTarget <= 0) return { value: null, source: undefined };
      const inherited = inheritedShares[metric].get(geo);
      if (inherited == null) return { value: null, source: undefined };
      return { value: inherited, source: "inherited" };
    }

    const rev = resolve("revenue");
    const testing = resolve("testingBatches");
    const working = resolve("workingCampaigns");

    return {
      geoCode: geo,
      revenueTarget: rev.value,
      testingTarget: testing.value,
      workingTarget: working.value,
      revenueSource: rev.source,
      testingSource: testing.source,
      workingSource: working.source,
      hasExplicitZero,
    };
  });
}

function planToNetworkRow(plan: NetworkPlanSummary): WorkerGoalNetworkRow {
  const isWorkerWide = plan.networkName == null;
  return {
    networkName: plan.networkName,
    isWorkerWide,
    revenueTarget: metricTargetFromPlan(plan, "revenue"),
    testingTarget: metricTargetFromPlan(plan, "testingBatches"),
    workingTarget: metricTargetFromPlan(plan, "workingCampaigns"),
    selectedGeoCodes: plan.selectedGeoCodes,
    overrideCount: plan.overrides.length,
    geoSplitRows: buildGeoSplitRows(plan),
  };
}

function geoRowsFromNetworks(networkRows: WorkerGoalNetworkRow[]): WorkerGoalGeoAllocationRow[] {
  const rows: WorkerGoalGeoAllocationRow[] = [];
  for (const net of networkRows) {
    if (!net.networkName) continue;
    for (const geo of net.geoSplitRows) {
      rows.push({
        geoCode: geo.geoCode,
        networkName: net.networkName,
        revenueTarget: geo.revenueTarget,
        testingTarget: geo.testingTarget,
        workingTarget: geo.workingTarget,
        revenueSource: geo.revenueSource,
        testingSource: geo.testingSource,
        workingSource: geo.workingSource,
        hasExplicitZero: geo.hasExplicitZero,
      });
    }
  }
  return rows.sort((a, b) => {
    const geoCmp = a.geoCode.toUpperCase().localeCompare(b.geoCode.toUpperCase());
    if (geoCmp !== 0) return geoCmp;
    if (a.hasExplicitZero !== b.hasExplicitZero) return a.hasExplicitZero ? -1 : 1;
    return a.networkName.localeCompare(b.networkName);
  });
}

function workerWideMetricLabelsFromRow(row: WorkerGoalNetworkRow | null): string[] {
  const labels: string[] = [];
  if (!row) return labels;
  if (row.revenueTarget != null && row.revenueTarget > 0) {
    labels.push(METRIC_LABELS_SHORT.revenue);
  }
  if (row.testingTarget != null && row.testingTarget > 0) {
    labels.push(METRIC_LABELS_SHORT.testingBatches);
  }
  if (row.workingTarget != null && row.workingTarget > 0) {
    labels.push(METRIC_LABELS_SHORT.workingCampaigns);
  }
  return labels;
}

export function summarizeWorkerGoalAllocation(
  goals: WorkerGoalTarget[],
  employeeId: number,
  monthKey: string,
  monthlySummary?: WorkerMonthlyGoalSummary | null,
): WorkerGoalAllocationSummary {
  const plans = summarizeWorkerPlansByNetwork(goals, employeeId, monthKey);
  const workerWidePlan = plans.find((p) => p.networkName == null) ?? null;
  const networkPlans = plans.filter((p) => p.networkName != null);

  let workerWideRow = workerWidePlan ? planToNetworkRow(workerWidePlan) : null;
  let networkRows = networkPlans.map(planToNetworkRow);
  let geoRows = geoRowsFromNetworks(networkRows);

  const hasAllocationGoals = plans.some((p) => p.metrics.length > 0 || p.overrides.length > 0);
  const hasSummaryGoals = monthlySummary != null && monthlySummaryHasTargets(monthlySummary);
  const hasAnyGoals = hasAllocationGoals || hasSummaryGoals;

  if (!hasAllocationGoals && hasSummaryGoals && monthlySummary) {
    workerWideRow = buildWorkerWideAllocationFromMonthlySummary(monthlySummary);
    networkRows = [];
    geoRows = [];
  }

  const selectedGeoSet = new Set<string>();
  let overrideCount = 0;
  for (const row of networkRows) {
    for (const code of row.selectedGeoCodes) selectedGeoSet.add(code);
    overrideCount += row.overrideCount;
  }

  const workerWideMetricLabels = workerWideMetricLabelsFromRow(workerWideRow);

  return {
    workerWideRow,
    networkRows,
    geoRows,
    counts: {
      workerWideMetricLabels,
      networkCount: networkRows.length,
      selectedGeoCount: selectedGeoSet.size,
      overrideCount,
      hasAnyGoals,
    },
  };
}

export function formatAllocationMetric(
  metric: GoalMetric,
  value: number | null | undefined,
): string {
  if (value == null) return "—";
  if (metric === "revenue") return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return String(value);
}
