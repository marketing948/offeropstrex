import { eq } from "drizzle-orm";
import {
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
} from "@workspace/db";
import type { MetricsDateRange } from "./campaign-daily-metrics-aggregate.ts";
import {
  queryCanonicalEmployeeRevenue,
  queryCanonicalTestingCounts,
  queryCanonicalWorkingCounts,
} from "./canonical-campaign-actuals.ts";
import {
  awardXp,
  currentMonthKey,
  goalCompletionIdempotencyKey,
  monthKeyToRange,
  sumXpByEmployeeForMonth,
  xpLeaderboard,
} from "./xp-award-service.ts";
import {
  findDuplicateGoal,
  goalsForMonth,
  goalsForMonthBreakdown,
  loadGoalsConfig,
  type ServerWorkerGoalTarget,
} from "./goals-config-server.ts";
import { computeEffectiveMetricTarget, type NetworkGeoMap } from "./goal-effective-targets.ts";
import {
  queryRevenueNetworkGeo,
  queryTestingNetworkGeo,
  queryWorkingNetworkGeo,
} from "./metric-breakdown-service.ts";

export type WorkerGoalStatus = "Strong" | "On track" | "Watch" | "Behind";

export type MonthlyGoalsKpi = {
  metricKey: string;
  label: string;
  current: number;
  target: number;
  progressPct: number;
  xpAvailable: number;
  theme: "revenue" | "testing" | "working";
};

export type WorkerMonthlyRow = {
  employeeId: number;
  name: string;
  email: string;
  initials: string;
  revenue: { current: number; target: number; progressPct: number };
  testing: { current: number; target: number; progressPct: number };
  working: { current: number; target: number; progressPct: number };
  profit: number | null;
  xpEarned: number;
  status: WorkerGoalStatus;
  progressSegments: number;
};

export type MonthlyGoalsDashboard = {
  monthKey: string;
  kpis: MonthlyGoalsKpi[];
  workers: WorkerMonthlyRow[];
  leaderboard: { employeeId: number; name: string; initials: string; xp: number; rank: number }[];
};

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function progressPct(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

function sumGoalsForMetric(
  goals: ServerWorkerGoalTarget[],
  metricKey: string,
  employeeId?: number,
): { target: number; xpAvailable: number } {
  const filtered = goals.filter((g) => {
    if (g.metricKey !== metricKey) return false;
    if (employeeId != null && g.employeeId !== employeeId) return false;
    return true;
  });
  return {
    target: filtered.reduce((s, g) => s + g.monthlyTarget, 0),
    xpAvailable: filtered.reduce((s, g) => s + (g.xpReward ?? 0), 0),
  };
}

type EmployeeActivityMaps = {
  revenue: NetworkGeoMap;
  testing: NetworkGeoMap;
  working: NetworkGeoMap;
};

function metricKeyToActivityKey(
  metricKey: ServerWorkerGoalTarget["metricKey"],
): keyof EmployeeActivityMaps {
  if (metricKey === "revenue") return "revenue";
  if (metricKey === "testingBatches") return "testing";
  return "working";
}

async function loadEmployeeActivityMaps(
  workspaceId: number,
  range: MetricsDateRange,
  employeeIds: number[],
  monthKey: string,
): Promise<Map<number, EmployeeActivityMaps>> {
  const entries = await Promise.all(
    employeeIds.map(async (employeeId) => {
      const [revenue, testing, working] = await Promise.all([
        queryRevenueNetworkGeo(workspaceId, range, employeeId),
        queryTestingNetworkGeo(workspaceId, employeeId, undefined, monthKey),
        queryWorkingNetworkGeo(workspaceId, employeeId, undefined, monthKey),
      ]);
      return [employeeId, { revenue, testing, working }] as const;
    }),
  );
  return new Map(entries);
}

function effectiveTargetForMetric(
  breakdownGoals: ServerWorkerGoalTarget[],
  metricKey: ServerWorkerGoalTarget["metricKey"],
  activityMaps: Map<number, EmployeeActivityMaps>,
  employeeId?: number,
): number {
  const activityKey = metricKeyToActivityKey(metricKey);
  if (employeeId != null) {
    const activity = activityMaps.get(employeeId)?.[activityKey] ?? new Map();
    return computeEffectiveMetricTarget(breakdownGoals, metricKey, employeeId, activity);
  }
  const employeeIds = [
    ...new Set(breakdownGoals.filter((g) => g.metricKey === metricKey).map((g) => g.employeeId)),
  ];
  return employeeIds.reduce((sum, eid) => {
    const activity = activityMaps.get(eid)?.[activityKey] ?? new Map();
    return sum + computeEffectiveMetricTarget(breakdownGoals, metricKey, eid, activity);
  }, 0);
}

export function deriveWorkerStatus(
  metrics: { revenue: { current: number; target: number }; testing: { current: number; target: number }; working: { current: number; target: number } },
  monthKey: string,
  now = new Date(),
): WorkerGoalStatus {
  const pcts: number[] = [];
  for (const m of [metrics.revenue, metrics.testing, metrics.working]) {
    if (m.target > 0) pcts.push(progressPct(m.current, m.target));
  }
  if (pcts.length === 0) return "On track";

  const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  const [y, mo] = monthKey.split("-").map(Number);
  const monthStart = new Date(y, mo - 1, 1);
  const monthEnd = new Date(y, mo, 0);
  const totalDays = monthEnd.getDate();
  const dayOfMonth = now.getFullYear() === y && now.getMonth() === mo - 1 ? now.getDate() : totalDays;
  const expectedPct = Math.min(100, Math.round((dayOfMonth / totalDays) * 100));

  if (avg >= 95 || avg >= expectedPct + 15) return "Strong";
  if (avg >= expectedPct - 5) return "On track";
  if (avg >= expectedPct - 20) return "Watch";
  return "Behind";
}

function progressSegments(status: WorkerGoalStatus, avgPct: number): number {
  const filled = Math.max(1, Math.min(5, Math.round(avgPct / 20)));
  if (status === "Behind") return Math.max(1, filled - 2);
  if (status === "Watch") return Math.max(2, filled - 1);
  return filled;
}

async function queryEmployeeMetrics(
  workspaceId: number,
  range: MetricsDateRange,
): Promise<Map<number, { revenue: number; profit: number }>> {
  return queryCanonicalEmployeeRevenue(workspaceId, range);
}

async function syncGoalCompletionXp(
  workspaceId: number,
  monthKey: string,
  goals: ServerWorkerGoalTarget[],
  actuals: Map<number, { revenue: number; testing: number; working: number }>,
): Promise<void> {
  const metricActual = (employeeId: number, metricKey: string): number => {
    const a = actuals.get(employeeId);
    if (!a) return 0;
    if (metricKey === "revenue") return a.revenue;
    if (metricKey === "testingBatches") return a.testing;
    if (metricKey === "workingCampaigns") return a.working;
    return 0;
  };

  for (const goal of goals) {
    const xp = goal.xpReward ?? 0;
    if (xp <= 0) continue;
    const actual = metricActual(goal.employeeId, goal.metricKey);
    if (actual < goal.monthlyTarget) continue;

    await awardXp(db, {
      workspaceId,
      employeeId: goal.employeeId,
      monthKey,
      amount: xp,
      sourceType: "goal_completion",
      idempotencyKey: goalCompletionIdempotencyKey(
        workspaceId,
        goal.employeeId,
        goal.id,
        goal.metricKey,
        monthKey,
      ),
      goalId: goal.id,
      metricKey: goal.metricKey,
      metadata: {
        actual,
        target: goal.monthlyTarget,
        affiliateNetworkName: goal.affiliateNetworkName,
        geoCode: goal.geoCode,
      },
    });

    const overXp = goal.overachieveXpReward ?? 0;
    if (overXp > 0 && actual > goal.monthlyTarget) {
      await awardXp(db, {
        workspaceId,
        employeeId: goal.employeeId,
        monthKey,
        amount: overXp,
        sourceType: "goal_completion",
        idempotencyKey: `${goalCompletionIdempotencyKey(workspaceId, goal.employeeId, goal.id, goal.metricKey, monthKey)}:overachieve`,
        goalId: goal.id,
        metricKey: goal.metricKey,
        metadata: { kind: "overachieve", actual, target: goal.monthlyTarget },
      });
    }
  }
}

export async function buildMonthlyGoalsDashboard(
  workspaceId: number,
  monthKey = currentMonthKey(),
  scopeEmployeeId?: number,
): Promise<MonthlyGoalsDashboard> {
  const range: MetricsDateRange = {
    dateFrom: monthKeyToRange(monthKey).dateFromIso,
    dateTo: monthKeyToRange(monthKey).dateToIso,
  };

  const cfg = await loadGoalsConfig(workspaceId);
  const monthGoals = goalsForMonth(cfg.workerGoalTargets, monthKey);
  const breakdownGoals = goalsForMonthBreakdown(cfg.workerGoalTargets, monthKey);

  const [employees, revenueProfit, testingCounts, workingCounts] = await Promise.all([
    db
      .select({
        id: employeesTable.id,
        name: employeesTable.name,
        email: employeesTable.email,
      })
      .from(employeesTable)
      .innerJoin(
        employeeWorkspaceAssignmentsTable,
        eq(employeeWorkspaceAssignmentsTable.employeeId, employeesTable.id),
      )
      .where(eq(employeeWorkspaceAssignmentsTable.workspaceId, workspaceId)),
    queryEmployeeMetrics(workspaceId, range),
    queryCanonicalTestingCounts(workspaceId, monthKey),
    queryCanonicalWorkingCounts(workspaceId, monthKey),
  ]);

  const actuals = new Map<number, { revenue: number; testing: number; working: number }>();
  for (const emp of employees) {
    const rp = revenueProfit.get(emp.id);
    actuals.set(emp.id, {
      revenue: rp?.revenue ?? 0,
      testing: testingCounts.get(emp.id) ?? 0,
      working: workingCounts.get(emp.id) ?? 0,
    });
  }

  await syncGoalCompletionXp(workspaceId, monthKey, monthGoals, actuals);

  const xpByEmployee = await sumXpByEmployeeForMonth(workspaceId, monthKey);
  const activityMaps = await loadEmployeeActivityMaps(
    workspaceId,
    range,
    employees.map((emp) => emp.id),
    monthKey,
  );

  const revGoals = {
    target: effectiveTargetForMetric(breakdownGoals, "revenue", activityMaps, scopeEmployeeId),
    xpAvailable: sumGoalsForMetric(monthGoals, "revenue", scopeEmployeeId).xpAvailable,
  };
  const testGoals = {
    target: effectiveTargetForMetric(breakdownGoals, "testingBatches", activityMaps, scopeEmployeeId),
    xpAvailable: sumGoalsForMetric(monthGoals, "testingBatches", scopeEmployeeId).xpAvailable,
  };
  const workGoals = {
    target: effectiveTargetForMetric(breakdownGoals, "workingCampaigns", activityMaps, scopeEmployeeId),
    xpAvailable: sumGoalsForMetric(monthGoals, "workingCampaigns", scopeEmployeeId).xpAvailable,
  };

  const teamRevenue = [...actuals.values()].reduce((s, a) => s + a.revenue, 0);
  const teamTesting = [...actuals.values()].reduce((s, a) => s + a.testing, 0);
  const teamWorking = [...actuals.values()].reduce((s, a) => s + a.working, 0);

  const scopedActuals =
    scopeEmployeeId != null ? actuals.get(scopeEmployeeId) : undefined;
  const kpiRevenue = scopedActuals?.revenue ?? teamRevenue;
  const kpiTesting = scopedActuals?.testing ?? teamTesting;
  const kpiWorking = scopedActuals?.working ?? teamWorking;

  const kpis: MonthlyGoalsKpi[] = [
    {
      metricKey: "revenue",
      label: "Revenue Goals",
      current: kpiRevenue,
      target: revGoals.target,
      progressPct: progressPct(kpiRevenue, revGoals.target),
      xpAvailable: revGoals.xpAvailable,
      theme: "revenue",
    },
    {
      metricKey: "testingBatches",
      label: "Testing Goals",
      current: kpiTesting,
      target: testGoals.target,
      progressPct: progressPct(kpiTesting, testGoals.target),
      xpAvailable: testGoals.xpAvailable,
      theme: "testing",
    },
    {
      metricKey: "workingCampaigns",
      label: "Working Campaigns",
      current: kpiWorking,
      target: workGoals.target,
      progressPct: progressPct(kpiWorking, workGoals.target),
      xpAvailable: workGoals.xpAvailable,
      theme: "working",
    },
  ];

  const workers: WorkerMonthlyRow[] = employees.map((emp) => {
    const a = actuals.get(emp.id) ?? { revenue: 0, testing: 0, working: 0 };
    const rev = {
      target: effectiveTargetForMetric(breakdownGoals, "revenue", activityMaps, emp.id),
      xpAvailable: sumGoalsForMetric(monthGoals, "revenue", emp.id).xpAvailable,
    };
    const tst = {
      target: effectiveTargetForMetric(breakdownGoals, "testingBatches", activityMaps, emp.id),
      xpAvailable: sumGoalsForMetric(monthGoals, "testingBatches", emp.id).xpAvailable,
    };
    const wrk = {
      target: effectiveTargetForMetric(breakdownGoals, "workingCampaigns", activityMaps, emp.id),
      xpAvailable: sumGoalsForMetric(monthGoals, "workingCampaigns", emp.id).xpAvailable,
    };
    const metrics = {
      revenue: { current: a.revenue, target: rev.target },
      testing: { current: a.testing, target: tst.target },
      working: { current: a.working, target: wrk.target },
    };
    const status = deriveWorkerStatus(metrics, monthKey);
    const avgPct =
      [metrics.revenue, metrics.testing, metrics.working]
        .filter((m) => m.target > 0)
        .map((m) => progressPct(m.current, m.target))
        .reduce((s, p, _, arr) => s + p / arr.length, 0) || 0;

    return {
      employeeId: emp.id,
      name: emp.name,
      email: emp.email,
      initials: initialsFor(emp.name),
      revenue: {
        current: a.revenue,
        target: rev.target,
        progressPct: progressPct(a.revenue, rev.target),
      },
      testing: {
        current: a.testing,
        target: tst.target,
        progressPct: progressPct(a.testing, tst.target),
      },
      working: {
        current: a.working,
        target: wrk.target,
        progressPct: progressPct(a.working, wrk.target),
      },
      profit: revenueProfit.get(emp.id)?.profit ?? null,
      xpEarned: xpByEmployee.get(emp.id) ?? 0,
      status,
      progressSegments: progressSegments(status, avgPct),
    };
  });

  workers.sort((a, b) => b.xpEarned - a.xpEarned || a.name.localeCompare(b.name));

  const board = await xpLeaderboard(workspaceId, monthKey, 10);
  const nameById = new Map(employees.map((e) => [e.id, e]));

  const leaderboard = board.map((row, idx) => {
    const emp = nameById.get(row.employeeId);
    return {
      employeeId: row.employeeId,
      name: emp?.name ?? `Employee #${row.employeeId}`,
      initials: initialsFor(emp?.name ?? "?"),
      xp: row.totalXp,
      rank: idx + 1,
    };
  });

  return { monthKey, kpis, workers, leaderboard };
}

export { findDuplicateGoal, workerGoalRowKey } from "./goals-config-server.ts";
