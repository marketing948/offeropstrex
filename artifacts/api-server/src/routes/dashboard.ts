// Pivot Phase 6 (Task #29): all dashboard endpoints aggregate from
// the manual workflow tables (testing_batches, campaigns, batch_results,
// todo_tasks, imported_offers). The legacy daily_reports + performance
// (Voluum) sources are no longer read here. Schema field names from the
// pre-pivot AdminDashboardSummary / EmployeeDashboardSummary etc. are
// preserved so the OpenAPI contract and existing FE consumers keep
// working — only the data origin changes.
import { Router, type IRouter } from "express";
import { eq, and, gte, lt, count, sum, sql, inArray } from "drizzle-orm";
import {
  db,
  testingBatchesTable,
  todoTasksTable,
  employeesTable,
  employeeWorkspaceAssignmentsTable,
  goalsTable,
  campaignsTable,
  batchResultsTable,
  importedOffersTable,
} from "@workspace/db";
import {
  GetEmployeeDashboardSummaryQueryParams,
  GetGoalProgressQueryParams,
} from "@workspace/api-zod";
import { requireWorkspaceFromQuery } from "../lib/workspace-access";
import {
  breakdownScopeFromWorker,
  requireWorkspaceWithNetworkScope,
} from "../lib/worker-network-access";
import {
  queryDashboardBreakdowns,
  queryWorkspaceMetricTotals,
  resolveMetricsDateRange,
} from "../lib/campaign-daily-metrics-aggregate.ts";

const router: IRouter = Router();

function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - (day === 0 ? 6 : day - 1);
  const weekStart = new Date(now.setDate(diff));
  return weekStart.toISOString().split("T")[0];
}

function getMonthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];
}

function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function startOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

const OPEN_TASK_STATUSES = ["TODO", "IN_PROGRESS"] as const;
const TESTED_BATCH_STATUSES = ["TESTED", "COMPLETED"] as const;

type ProgressRow = {
  offersUploaded: number;
  batchesCreated: number;
  batchesTested: number;
  campaignsMovedToMain: number;
  campaignsClosed: number;
};

async function computeProgress(
  workspaceId: number,
  employeeId: number | undefined,
  periodStart: string,
  periodEnd?: string,
): Promise<ProgressRow> {
  const periodStartDate = startOfDay(periodStart);
  // Period end is exclusive: the day AFTER periodEnd at 00:00, so a row
  // stamped 23:59 on periodEnd is included but a row stamped 00:00 the
  // next day is not.
  const periodEndExclusive = periodEnd
    ? new Date(startOfDay(periodEnd).getTime() + 24 * 60 * 60 * 1000)
    : undefined;

  // Offers: scope to employee through the parent batch when requested.
  // Rows with batch_id NULL are dropped from per-employee counts because
  // we cannot attribute them.
  let offersCount = 0;
  if (employeeId) {
    const [row] = await db
      .select({ c: count() })
      .from(importedOffersTable)
      .innerJoin(
        testingBatchesTable,
        eq(importedOffersTable.batchId, testingBatchesTable.id),
      )
      .where(
        and(
          eq(importedOffersTable.workspaceId, workspaceId),
          eq(importedOffersTable.status, "imported"),
          gte(importedOffersTable.importedAt, periodStartDate),
          ...(periodEndExclusive ? [lt(importedOffersTable.importedAt, periodEndExclusive)] : []),
          eq(testingBatchesTable.employeeId, employeeId),
        ),
      );
    offersCount = Number(row?.c ?? 0);
  } else {
    const [row] = await db
      .select({ c: count() })
      .from(importedOffersTable)
      .where(
        and(
          eq(importedOffersTable.workspaceId, workspaceId),
          eq(importedOffersTable.status, "imported"),
          gte(importedOffersTable.importedAt, periodStartDate),
          ...(periodEndExclusive ? [lt(importedOffersTable.importedAt, periodEndExclusive)] : []),
        ),
      );
    offersCount = Number(row?.c ?? 0);
  }

  const [batches] = await db
    .select({ c: count() })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.workspaceId, workspaceId),
        gte(testingBatchesTable.createdAt, periodStartDate),
        ...(periodEndExclusive ? [lt(testingBatchesTable.createdAt, periodEndExclusive)] : []),
        ...(employeeId ? [eq(testingBatchesTable.employeeId, employeeId)] : []),
      ),
    );

  // batch_results "tested in period" = result row created in period.
  // Scope to employee via the parent batch when requested.
  let tested = 0;
  if (employeeId) {
    const [row] = await db
      .select({ c: count() })
      .from(batchResultsTable)
      .innerJoin(
        testingBatchesTable,
        eq(batchResultsTable.batchId, testingBatchesTable.id),
      )
      .where(
        and(
          eq(batchResultsTable.workspaceId, workspaceId),
          gte(batchResultsTable.createdAt, periodStartDate),
          ...(periodEndExclusive ? [lt(batchResultsTable.createdAt, periodEndExclusive)] : []),
          eq(testingBatchesTable.employeeId, employeeId),
        ),
      );
    tested = Number(row?.c ?? 0);
  } else {
    const [row] = await db
      .select({ c: count() })
      .from(batchResultsTable)
      .where(
        and(
          eq(batchResultsTable.workspaceId, workspaceId),
          gte(batchResultsTable.createdAt, periodStartDate),
          ...(periodEndExclusive ? [lt(batchResultsTable.createdAt, periodEndExclusive)] : []),
        ),
      );
    tested = Number(row?.c ?? 0);
  }

  // MOVE_WINNERS_TO_SCALED_CAMPAIGN tasks have no completedAt timestamp;
  // we use createdAt as the period proxy. (The rule that emits them
  // creates the task in DONE-eligible state when the batch reaches
  // TESTED, so createdAt approximates "moved to main during period".)
  const [moved] = await db
    .select({ c: count() })
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.workspaceId, workspaceId),
        eq(todoTasksTable.taskType, "MOVE_WINNERS_TO_SCALED_CAMPAIGN"),
        eq(todoTasksTable.status, "DONE"),
        gte(todoTasksTable.createdAt, periodStartDate),
        ...(periodEndExclusive ? [lt(todoTasksTable.createdAt, periodEndExclusive)] : []),
        ...(employeeId ? [eq(todoTasksTable.employeeId, employeeId)] : []),
      ),
    );

  const [closed] = await db
    .select({ c: count() })
    .from(campaignsTable)
    .where(
      and(
        eq(campaignsTable.workspaceId, workspaceId),
        eq(campaignsTable.status, "closed"),
        gte(campaignsTable.updatedAt, periodStartDate),
        ...(periodEndExclusive ? [lt(campaignsTable.updatedAt, periodEndExclusive)] : []),
        ...(employeeId
          ? [
              sql`EXISTS (SELECT 1 FROM ${testingBatchesTable} WHERE ${testingBatchesTable.id} = ${campaignsTable.batchId} AND ${testingBatchesTable.employeeId} = ${employeeId})`,
            ]
          : []),
      ),
    );

  return {
    offersUploaded: offersCount,
    batchesCreated: Number(batches?.c ?? 0),
    batchesTested: tested,
    campaignsMovedToMain: Number(moved?.c ?? 0),
    campaignsClosed: Number(closed?.c ?? 0),
  };
}

router.get("/dashboard/admin-summary", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const today = getTodayStr();
  const weekStart = getWeekStart();

  const dateFromRaw = req.query.date_from as string | undefined;
  const dateToRaw = req.query.date_to as string | undefined;
  const employeeId = req.query.employee_id ? Number(req.query.employee_id) : undefined;
  const geo = req.query.geo as string | undefined;
  const affiliateNetwork = req.query.affiliate_network as string | undefined;
  const trafficSource = req.query.traffic_source as string | undefined;

  // Today: only the offers count is reported as a "today" metric.
  const [todayOffers] = await db
    .select({ c: count() })
    .from(importedOffersTable)
    .where(
      and(
        eq(importedOffersTable.workspaceId, workspaceId),
        eq(importedOffersTable.status, "imported"),
        gte(importedOffersTable.importedAt, startOfDay(today)),
      ),
    );

  const metricsRange = resolveMetricsDateRange(dateFromRaw, dateToRaw);
  if ("error" in metricsRange) {
    res.status(400).json({ error: metricsRange.error });
    return;
  }

  const week = await computeProgress(
    workspaceId,
    employeeId,
    metricsRange.dateFrom,
    metricsRange.dateTo,
  );

  // Open tasks (workspace-wide unless scoped to an employee).
  const [openTasks] = await db
    .select({ c: count() })
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.workspaceId, workspaceId),
        inArray(todoTasksTable.status, [...OPEN_TASK_STATUSES]),
        ...(employeeId ? [eq(todoTasksTable.employeeId, employeeId)] : []),
      ),
    );

  const metricTotals = await queryWorkspaceMetricTotals({
    workspaceId,
    dateFrom: metricsRange.dateFrom,
    dateTo: metricsRange.dateTo,
    employeeId,
    geo,
    affiliateNetwork,
    trafficSource,
  });

  const totalCost = metricTotals.cost;
  const totalRevenue = metricTotals.revenue;
  const totalProfit = metricTotals.profit;
  const averageRoi = metricTotals.roi != null
    ? Math.round(metricTotals.roi * 100)
    : 0;

  // Phase 6 manual-workflow KPIs: total batches created (lifetime),
  // winners found within the active period, and a campaign status
  // distribution (live / testing / tested / closed) computed at
  // query time over the manual `campaigns` table.
  const [totalBatchesRow] = await db
    .select({ c: count() })
    .from(testingBatchesTable)
    .where(eq(testingBatchesTable.workspaceId, workspaceId));

  const winnersStart = startOfDay(metricsRange.dateFrom);
  const winnersEndExclusive = new Date(`${metricsRange.dateTo}T00:00:00.000Z`);
  winnersEndExclusive.setUTCDate(winnersEndExclusive.getUTCDate() + 1);
  const [winnersRow] = await db
    .select({ s: sum(batchResultsTable.winnersCount) })
    .from(batchResultsTable)
    .innerJoin(testingBatchesTable, eq(batchResultsTable.batchId, testingBatchesTable.id))
    .where(
      and(
        eq(batchResultsTable.workspaceId, workspaceId),
        gte(batchResultsTable.createdAt, winnersStart),
        lt(batchResultsTable.createdAt, winnersEndExclusive),
        ...(employeeId ? [eq(testingBatchesTable.employeeId, employeeId)] : []),
      ),
    );

  const campaignStatusRows = await db
    .select({ status: campaignsTable.status, c: count() })
    .from(campaignsTable)
    .where(
      and(
        eq(campaignsTable.workspaceId, workspaceId),
        ...(employeeId
          ? [
              sql`EXISTS (SELECT 1 FROM ${testingBatchesTable} WHERE ${testingBatchesTable.id} = ${campaignsTable.batchId} AND ${testingBatchesTable.employeeId} = ${employeeId})`,
            ]
          : []),
      ),
    )
    .groupBy(campaignsTable.status);
  const campaignStatusCounts: Record<string, number> = {};
  for (const r of campaignStatusRows) campaignStatusCounts[r.status] = Number(r.c);

  res.json({
    offersUploadedToday: Number(todayOffers?.c ?? 0),
    offersUploadedThisWeek: week.offersUploaded,
    batchesCreatedThisWeek: week.batchesCreated,
    batchesTestedThisWeek: week.batchesTested,
    campaignsMovedToMain: week.campaignsMovedToMain,
    campaignsClosed: week.campaignsClosed,
    openTasksCount: Number(openTasks?.c ?? 0),
    totalSpend: totalCost,
    totalRevenue,
    totalProfit,
    averageRoi,
    totalBatchesCreated: Number(totalBatchesRow?.c ?? 0),
    winnersFoundThisWeek: Number(winnersRow?.s ?? 0),
    campaignsLive: campaignStatusCounts.live ?? 0,
    campaignsTesting: (campaignStatusCounts.draft ?? 0) + (campaignStatusCounts.ready ?? 0),
    campaignsTested: campaignStatusCounts.tested ?? 0,
    campaignsClosedTotal: campaignStatusCounts.closed ?? 0,
  });
});

router.get("/dashboard/employee-summary", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const params = GetEmployeeDashboardSummaryQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { employee_id } = params.data;

  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, employee_id));

  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  const [assignment] = await db
    .select({ id: employeeWorkspaceAssignmentsTable.id })
    .from(employeeWorkspaceAssignmentsTable)
    .where(and(
      eq(employeeWorkspaceAssignmentsTable.employeeId, employee_id),
      eq(employeeWorkspaceAssignmentsTable.workspaceId, workspaceId),
    ))
    .limit(1);
  if (!assignment) {
    res.status(404).json({ error: "Employee not found in workspace" });
    return;
  }

  const weekStart = getWeekStart();
  const monthStart = getMonthStart();

  const goals = await db
    .select()
    .from(goalsTable)
    .where(and(eq(goalsTable.workspaceId, workspaceId), eq(goalsTable.employeeId, employee_id)))
    .orderBy(goalsTable.createdAt);

  const weeklyGoal = goals.find(g => g.periodType === "weekly") ?? null;
  const monthlyGoal = goals.find(g => g.periodType === "monthly") ?? null;

  const weeklyProgress = await computeProgress(workspaceId, employee_id, weekStart);
  const monthlyProgress = await computeProgress(workspaceId, employee_id, monthStart);

  const [openTasks] = await db
    .select({ c: count() })
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.workspaceId, workspaceId),
        eq(todoTasksTable.employeeId, employee_id),
        inArray(todoTasksTable.status, [...OPEN_TASK_STATUSES]),
      ),
    );

  const [recent] = await db
    .select({ c: count() })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.workspaceId, workspaceId),
        eq(testingBatchesTable.employeeId, employee_id),
      ),
    );

  const { passwordHash: _pw, ...empData } = employee;

  const serializeGoal = (g: typeof goalsTable.$inferSelect | null) =>
    g
      ? {
          ...g,
          targetProfitOptional:
            g.targetProfitOptional != null ? Number(g.targetProfitOptional) : null,
          createdAt: g.createdAt.toISOString(),
        }
      : null;

  res.json({
    employee: { ...empData, createdAt: empData.createdAt.toISOString() },
    weeklyGoal: serializeGoal(weeklyGoal),
    monthlyGoal: serializeGoal(monthlyGoal),
    weeklyProgress,
    monthlyProgress,
    openTasksCount: Number(openTasks?.c ?? 0),
    recentBatchesCount: Number(recent?.c ?? 0),
  });
});

router.get("/dashboard/batch-status-breakdown", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const results = await db
    .select({
      status: testingBatchesTable.status,
      count: count(),
    })
    .from(testingBatchesTable)
    .where(eq(testingBatchesTable.workspaceId, workspaceId))
    .groupBy(testingBatchesTable.status);

  res.json(results.map(r => ({ status: r.status, count: r.count })));
});

router.get("/dashboard/employee-leaderboard", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const weekStart = (req.query.date_from as string | undefined) ?? getWeekStart();
  const dateTo = req.query.date_to as string | undefined;

  // Scope leaderboard to explicit workspace members only. Admin role is not
  // global workspace access.
  const assignments = await db
    .select({ employeeId: employeeWorkspaceAssignmentsTable.employeeId })
    .from(employeeWorkspaceAssignmentsTable)
    .where(eq(employeeWorkspaceAssignmentsTable.workspaceId, workspaceId));
  const assignedIds = assignments.map(a => a.employeeId);

  const employees = assignedIds.length > 0
    ? await db
        .select()
        .from(employeesTable)
        .where(and(eq(employeesTable.status, "active"), inArray(employeesTable.id, assignedIds)))
    : [];

  const leaderboard = await Promise.all(
    employees.map(async (emp) => {
      const progress = await computeProgress(workspaceId, emp.id, weekStart, dateTo);

      const [openTasks] = await db
        .select({ c: count() })
        .from(todoTasksTable)
        .where(
          and(
            eq(todoTasksTable.workspaceId, workspaceId),
            eq(todoTasksTable.employeeId, emp.id),
            inArray(todoTasksTable.status, [...OPEN_TASK_STATUSES]),
          ),
        );

      return {
        employeeId: emp.id,
        employeeName: emp.name,
        offersUploaded: progress.offersUploaded,
        batchesCreated: progress.batchesCreated,
        batchesTested: progress.batchesTested,
        campaignsMovedToMain: progress.campaignsMovedToMain,
        openTasks: Number(openTasks?.c ?? 0),
      };
    }),
  );

  res.json(
    leaderboard.sort(
      (a, b) =>
        b.batchesCreated - a.batchesCreated ||
        b.batchesTested - a.batchesTested ||
        b.campaignsMovedToMain - a.campaignsMovedToMain,
    ),
  );
});

router.get("/dashboard/goal-progress", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const params = GetGoalProgressQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [eq(goalsTable.workspaceId, workspaceId)];
  if (params.data.period_type) {
    conditions.push(eq(goalsTable.periodType, params.data.period_type));
  }
  if (params.data.employee_id) {
    conditions.push(eq(goalsTable.employeeId, params.data.employee_id));
  }

  const goals = await db.select().from(goalsTable).where(and(...conditions));

  const result = await Promise.all(
    goals.map(async (goal) => {
      const [emp] = await db
        .select()
        .from(employeesTable)
        .where(eq(employeesTable.id, goal.employeeId));

      const progress = await computeProgress(
        workspaceId,
        goal.employeeId,
        goal.periodStart,
        goal.periodEnd,
      );

      return {
        employeeId: goal.employeeId,
        employeeName: emp?.name ?? "Unknown",
        goal: {
          ...goal,
          targetProfitOptional:
            goal.targetProfitOptional != null
              ? Number(goal.targetProfitOptional)
              : null,
          createdAt: goal.createdAt.toISOString(),
        },
        progress,
      };
    }),
  );

  res.json(result);
});

// Breakdown financial metrics from campaign_daily_metrics (default: current week).
router.get("/dashboard/breakdowns", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const scoped = await requireWorkspaceWithNetworkScope(req, res, workspaceId);
  if (scoped === null) return;

  const dateFromRaw = req.query.date_from as string | undefined;
  const dateToRaw = req.query.date_to as string | undefined;
  const range = resolveMetricsDateRange(dateFromRaw, dateToRaw);
  if ("error" in range) {
    res.status(400).json({ error: range.error });
    return;
  }

  const breakdowns = await queryDashboardBreakdowns(
    workspaceId,
    range,
    breakdownScopeFromWorker(scoped.scope),
  );
  res.json(breakdowns);
});

export default router;
