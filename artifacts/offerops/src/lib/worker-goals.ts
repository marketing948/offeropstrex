/**
 * Worker Goals — per employee × network × GEO × metric targets.
 * Drives Operation Hub hero cards and Reports Goal Dashboard.
 */

import {
  OPS_V2_DEMO_FALLBACKS,
  resolveGeoRevenueTarget,
  resolveKpiTarget,
  resolveNetworkTarget,
} from "@/components/operations-hub/ops-v2-metrics";
import type { KpiTarget } from "@/lib/goals-config";

export type WorkerGoalMetricKey = "revenue" | "testingBatches" | "workingCampaigns";

export interface WorkerGoalTarget {
  id: string;
  employeeId: number;
  employeeName?: string;
  affiliateNetworkId?: number | null;
  affiliateNetworkName?: string | null;
  geoId?: number | null;
  geoCode?: string | null;
  metricKey: WorkerGoalMetricKey | string;
  monthlyTarget: number;
  isActive: boolean;
  monthKey?: string | null;
  xpReward?: number | null;
  overachieveXpReward?: number | null;
  color?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventPointRule {
  id: string;
  eventKey: string;
  label: string;
  points: number;
  isActive: boolean;
  description?: string;
  category?: "manual" | "campaign" | "report" | "optimization" | "batch" | "custom";
}

export const WORKER_GOAL_METRIC_OPTIONS: { value: WorkerGoalMetricKey; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "testingBatches", label: "Testing Pipeline" },
  { value: "workingCampaigns", label: "Working Campaigns" },
];

export function workerGoalMetricLabel(key: string): string {
  return WORKER_GOAL_METRIC_OPTIONS.find((o) => o.value === key)?.label ?? key;
}

export function normGoalDim(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function workerGoalRowKey(
  g: Pick<WorkerGoalTarget, "employeeId" | "metricKey" | "affiliateNetworkName" | "geoCode" | "monthKey">,
): string {
  return `${g.employeeId}|${g.metricKey}|${normGoalDim(g.affiliateNetworkName)}|${normGoalDim(g.geoCode)}|${(g.monthKey ?? "").trim()}`;
}

export function isDuplicateWorkerGoal(
  goals: WorkerGoalTarget[],
  candidate: WorkerGoalTarget,
  excludeId?: string,
): boolean {
  const key = workerGoalRowKey(candidate);
  return goals.some((g) => g.id !== excludeId && workerGoalRowKey(g) === key);
}

export type GoalTargetFilter = {
  employeeId?: number | null;
  affiliateNetworkName?: string | null;
  geoCode?: string | null;
};

function activeGoalsForMetric(goals: WorkerGoalTarget[], metricKey: string): WorkerGoalTarget[] {
  return goals.filter((g) => g.isActive && g.metricKey === metricKey && g.monthlyTarget > 0);
}

function goalHasNetwork(g: WorkerGoalTarget): boolean {
  return Boolean(g.affiliateNetworkName?.trim());
}

function goalHasGeo(g: WorkerGoalTarget): boolean {
  return Boolean(g.geoCode?.trim());
}

/** Pick goals at the most specific matching level (broader goals do not stack over narrower ones). */
export function pickGoalsForContext(
  goals: WorkerGoalTarget[],
  metricKey: string,
  filter?: GoalTargetFilter,
): WorkerGoalTarget[] {
  const active = activeGoalsForMetric(goals, metricKey);
  const hasFilter =
    filter?.employeeId != null ||
    Boolean(filter?.affiliateNetworkName?.trim()) ||
    Boolean(filter?.geoCode?.trim());

  if (!hasFilter) return active;

  const empId = filter?.employeeId ?? null;
  const net = normGoalDim(filter?.affiliateNetworkName);
  const geo = normGoalDim(filter?.geoCode);

  if (empId != null) {
    const empGoals = active.filter((g) => g.employeeId === empId);
    if (net && geo) {
      const exact = empGoals.filter(
        (g) => normGoalDim(g.affiliateNetworkName) === net && normGoalDim(g.geoCode) === geo,
      );
      if (exact.length) return exact;
      const netOnly = empGoals.filter(
        (g) => normGoalDim(g.affiliateNetworkName) === net && !goalHasGeo(g),
      );
      if (netOnly.length) return netOnly;
      const geoOnly = empGoals.filter(
        (g) => !goalHasNetwork(g) && normGoalDim(g.geoCode) === geo,
      );
      if (geoOnly.length) return geoOnly;
      return empGoals.filter((g) => !goalHasNetwork(g) && !goalHasGeo(g));
    }
    if (net) {
      const forNet = empGoals.filter((g) => normGoalDim(g.affiliateNetworkName) === net);
      if (forNet.length) return forNet;
      return empGoals.filter((g) => !goalHasNetwork(g) && !goalHasGeo(g));
    }
    if (geo) {
      const forGeo = empGoals.filter((g) => normGoalDim(g.geoCode) === geo);
      if (forGeo.length) return forGeo;
      return empGoals.filter((g) => !goalHasNetwork(g) && !goalHasGeo(g));
    }
    const specific = empGoals.filter((g) => goalHasNetwork(g) || goalHasGeo(g));
    if (specific.length) return specific;
    return empGoals.filter((g) => !goalHasNetwork(g) && !goalHasGeo(g));
  }

  if (net && geo) {
    const exact = active.filter(
      (g) => normGoalDim(g.affiliateNetworkName) === net && normGoalDim(g.geoCode) === geo,
    );
    if (exact.length) return exact;
    const netOnly = active.filter(
      (g) => normGoalDim(g.affiliateNetworkName) === net && !goalHasGeo(g),
    );
    if (netOnly.length) return netOnly;
    return active.filter((g) => !goalHasNetwork(g) && normGoalDim(g.geoCode) === geo);
  }
  if (net) return active.filter((g) => normGoalDim(g.affiliateNetworkName) === net);
  if (geo) return active.filter((g) => normGoalDim(g.geoCode) === geo);
  return active;
}

export function sumActiveWorkerGoals(
  goals: WorkerGoalTarget[],
  metricKey: string,
  filter?: GoalTargetFilter,
): number {
  return pickGoalsForContext(goals, metricKey, filter).reduce((sum, g) => sum + g.monthlyTarget, 0);
}

export function hasActiveWorkerGoalsForMetric(
  goals: WorkerGoalTarget[],
  metricKey: string,
  filter?: GoalTargetFilter,
): boolean {
  return sumActiveWorkerGoals(goals, metricKey, filter) > 0;
}

export type ResolvedMetricTarget = {
  target: number;
  configured: boolean;
  fromWorkerGoals: boolean;
};

function fallbackForMetric(metricKey: string): number {
  if (metricKey === "revenue") return OPS_V2_DEMO_FALLBACKS.revenue;
  if (metricKey === "testingBatches") return OPS_V2_DEMO_FALLBACKS.testingBatches;
  if (metricKey === "workingCampaigns") return OPS_V2_DEMO_FALLBACKS.workingCampaigns;
  return 0;
}

/** Resolve monthly target: worker goals first, then legacy network/GEO KPI keys, then global KPI. */
export function resolveMetricTarget(
  metricKey: string,
  kpiTargets: KpiTarget[],
  workerGoalTargets: WorkerGoalTarget[],
  filter?: GoalTargetFilter,
): ResolvedMetricTarget {
  const workerSum = sumActiveWorkerGoals(workerGoalTargets, metricKey, filter);
  if (workerSum > 0) {
    return { target: workerSum, configured: true, fromWorkerGoals: true };
  }

  const hasScope =
    filter?.employeeId != null ||
    Boolean(filter?.affiliateNetworkName?.trim()) ||
    Boolean(filter?.geoCode?.trim());

  if (hasScope) {
    if (filter?.affiliateNetworkName?.trim()) {
      const { target, configured } = resolveNetworkTarget(
        kpiTargets,
        metricKey,
        filter.affiliateNetworkName.trim(),
      );
      if (configured && target != null) {
        return { target, configured: true, fromWorkerGoals: false };
      }
    }
    if (metricKey === "revenue" && filter?.geoCode?.trim()) {
      const { target, configured } = resolveGeoRevenueTarget(
        kpiTargets,
        filter.geoCode.trim(),
        filter.affiliateNetworkName?.trim() || undefined,
      );
      if (configured && target != null) {
        return { target, configured: true, fromWorkerGoals: false };
      }
    }
    return { target: 0, configured: false, fromWorkerGoals: false };
  }

  const global = resolveKpiTarget(kpiTargets, metricKey, fallbackForMetric(metricKey));
  return {
    target: global.target,
    configured: !global.usingFallback,
    fromWorkerGoals: false,
  };
}

export function listWorkerGoalNetworkNames(
  goals: WorkerGoalTarget[],
  metricKey: string,
): string[] {
  const names = new Set<string>();
  for (const g of goals) {
    if (!g.isActive || g.metricKey !== metricKey) continue;
    const name = g.affiliateNetworkName?.trim();
    if (name) names.add(name);
  }
  return [...names];
}

export function summarizeWorkerGoalsByMetric(
  goals: WorkerGoalTarget[],
  filter?: GoalTargetFilter,
): Record<WorkerGoalMetricKey, { count: number; totalTarget: number }> {
  const out: Record<WorkerGoalMetricKey, { count: number; totalTarget: number }> = {
    revenue: { count: 0, totalTarget: 0 },
    testingBatches: { count: 0, totalTarget: 0 },
    workingCampaigns: { count: 0, totalTarget: 0 },
  };
  for (const g of goals) {
    if (!g.isActive || g.monthlyTarget <= 0) continue;
    if (filter?.employeeId != null && g.employeeId !== filter.employeeId) continue;
    if (!(g.metricKey in out)) continue;
    const key = g.metricKey as WorkerGoalMetricKey;
    out[key].count += 1;
    out[key].totalTarget += g.monthlyTarget;
  }
  return out;
}
