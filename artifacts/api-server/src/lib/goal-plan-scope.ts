export type GoalPlanScopeRow = {
  id?: string;
  employeeId: number;
  monthKey?: string | null;
  affiliateNetworkName?: string | null;
  geoCode?: string | null;
  metricKey: string;
  monthlyTarget?: number;
  selectedGeoCodes?: string[] | null;
  isActive?: boolean;
};

const GOAL_PLAN_METRICS = new Set(["revenue", "testingBatches", "workingCampaigns"]);

/** True when a goal row belongs to a worker/month/network plan scope (network-level or GEO override). */
export function goalMatchesNetworkPlanScope(
  g: Pick<GoalPlanScopeRow, "employeeId" | "monthKey" | "affiliateNetworkName" | "metricKey">,
  employeeId: number,
  monthKey: string,
  affiliateNetworkName: string,
): boolean {
  if (g.employeeId !== employeeId) return false;
  if (!g.monthKey || g.monthKey !== monthKey) return false;
  if (!GOAL_PLAN_METRICS.has(g.metricKey)) return false;
  const net = (g.affiliateNetworkName ?? "").trim();
  return net.length > 0 && net === affiliateNetworkName.trim();
}

export function removeNetworkGoalsFromTargets<T extends GoalPlanScopeRow>(
  goals: T[],
  employeeId: number,
  monthKey: string,
  affiliateNetworkName: string,
): { kept: T[]; removed: T[] } {
  const kept: T[] = [];
  const removed: T[] = [];
  for (const g of goals) {
    if (goalMatchesNetworkPlanScope(g, employeeId, monthKey, affiliateNetworkName)) {
      removed.push(g);
    } else {
      kept.push(g);
    }
  }
  return { kept, removed };
}
