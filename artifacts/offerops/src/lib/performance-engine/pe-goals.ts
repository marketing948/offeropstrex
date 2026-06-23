import type { MonthlyGoalsDashboard, WorkerMonthlyRow } from "@/lib/performance-engine/api";

export type PeGoalMetric = {
  current: number;
  target: number;
};

export type PeGoalsTriple = {
  revenue: PeGoalMetric;
  testing: PeGoalMetric;
  working: PeGoalMetric;
};

export function peGoalsFromWorkerRow(row: WorkerMonthlyRow): PeGoalsTriple {
  return {
    revenue: { current: row.revenue.current, target: row.revenue.target },
    testing: { current: row.testing.current, target: row.testing.target },
    working: { current: row.working.current, target: row.working.target },
  };
}

/** Team aggregate or scoped employee — from Performance Engine monthly-goals dashboard. */
export function peGoalsFromDashboard(
  dashboard: MonthlyGoalsDashboard,
  scopeEmployeeId?: number | null,
): PeGoalsTriple {
  if (scopeEmployeeId != null) {
    const row = dashboard.workers.find((w) => w.employeeId === scopeEmployeeId);
    if (row) return peGoalsFromWorkerRow(row);
  }

  const byKey = (key: string) => dashboard.kpis.find((k) => k.metricKey === key);
  const revenue = byKey("revenue");
  const testing = byKey("testingBatches");
  const working = byKey("workingCampaigns");

  return {
    revenue: { current: revenue?.current ?? 0, target: revenue?.target ?? 0 },
    testing: { current: testing?.current ?? 0, target: testing?.target ?? 0 },
    working: { current: working?.current ?? 0, target: working?.target ?? 0 },
  };
}
