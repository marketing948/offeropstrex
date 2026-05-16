// Pivot Phase 6 (Task #29): all dashboard endpoints aggregate from
// the manual workflow tables (testing_batches, campaigns, batch_results,
// todo_tasks, imported_offers). The legacy daily_reports + performance
// (Voluum) sources are no longer read here. Schema field names from the
// pre-pivot AdminDashboardSummary / EmployeeDashboardSummary etc. are
// preserved so the OpenAPI contract and existing FE consumers keep
// working — only the data origin changes.
import { Router, type IRouter } from "express";
import { eq, and, or, gte, lt, count, sum, sql, inArray } from "drizzle-orm";
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

  // If an explicit date range is supplied, prefer it over the weekly
  // window so admin filters drive every KPI in the response.
  const periodStart = dateFromRaw ?? weekStart;
  const periodEnd = dateToRaw;
  const week = await computeProgress(workspaceId, employeeId, periodStart, periodEnd);

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

  // P&L: aggregate batch_results joined to batches so we can apply the
  // employee/geo/network/traffic-source filters that already live on the
  // batch row. date_from/date_to scope batch_results.created_at when
  // present (interpreted as the period the result was recorded).
  const dateFrom = dateFromRaw ? startOfDay(dateFromRaw) : undefined;
  const dateToExclusive = dateToRaw
    ? new Date(startOfDay(dateToRaw).getTime() + 24 * 60 * 60 * 1000)
    : undefined;

  const [perf] = await db
    .select({
      cost: sum(batchResultsTable.cost),
      revenue: sum(batchResultsTable.revenue),
    })
    .from(batchResultsTable)
    .innerJoin(
      testingBatchesTable,
      eq(batchResultsTable.batchId, testingBatchesTable.id),
    )
    .where(
      and(
        eq(batchResultsTable.workspaceId, workspaceId),
        ...(employeeId ? [eq(testingBatchesTable.employeeId, employeeId)] : []),
        ...(geo ? [eq(testingBatchesTable.geo, geo)] : []),
        ...(affiliateNetwork
          ? [eq(testingBatchesTable.affiliateNetwork, affiliateNetwork)]
          : []),
        ...(trafficSource
          ? [eq(testingBatchesTable.trafficSource, trafficSource)]
          : []),
        ...(dateFrom ? [gte(batchResultsTable.createdAt, dateFrom)] : []),
        ...(dateToExclusive ? [lt(batchResultsTable.createdAt, dateToExclusive)] : []),
      ),
    );

  const totalCost = Number(perf?.cost ?? 0);
  const totalRevenue = Number(perf?.revenue ?? 0);
  const totalProfit = totalRevenue - totalCost;
  const averageRoi = totalCost > 0
    ? Math.round((totalProfit / totalCost) * 100)
    : 0;

  // Phase 6 manual-workflow KPIs: total batches created (lifetime),
  // winners found within the active period, and a campaign status
  // distribution (live / testing / tested / closed) computed at
  // query time over the manual `campaigns` table.
  const [totalBatchesRow] = await db
    .select({ c: count() })
    .from(testingBatchesTable)
    .where(eq(testingBatchesTable.workspaceId, workspaceId));

  const winnersStart = startOfDay(periodStart);
  const winnersEnd = periodEnd
    ? new Date(startOfDay(periodEnd).getTime() + 24 * 60 * 60 * 1000)
    : undefined;
  const [winnersRow] = await db
    .select({ s: sum(batchResultsTable.winnersCount) })
    .from(batchResultsTable)
    .innerJoin(testingBatchesTable, eq(batchResultsTable.batchId, testingBatchesTable.id))
    .where(
      and(
        eq(batchResultsTable.workspaceId, workspaceId),
        gte(batchResultsTable.createdAt, winnersStart),
        ...(winnersEnd ? [lt(batchResultsTable.createdAt, winnersEnd)] : []),
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

  const weekStart = getWeekStart();
  const monthStart = getMonthStart();

  const goals = await db
    .select()
    .from(goalsTable)
    .where(eq(goalsTable.employeeId, employee_id))
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

  // Scope leaderboard to workspace members (admins always included).
  const assignments = await db
    .select({ employeeId: employeeWorkspaceAssignmentsTable.employeeId })
    .from(employeeWorkspaceAssignmentsTable)
    .where(eq(employeeWorkspaceAssignmentsTable.workspaceId, workspaceId));
  const assignedIds = assignments.map(a => a.employeeId);

  const empConditions = [
    and(eq(employeesTable.status, "active"), eq(employeesTable.role, "admin"))!,
  ];
  if (assignedIds.length > 0) {
    empConditions.push(
      and(eq(employeesTable.status, "active"), inArray(employeesTable.id, assignedIds))!,
    );
  }
  const employees = await db
    .select()
    .from(employeesTable)
    .where(or(...empConditions));

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

  const conditions = [];
  if (params.data.period_type) {
    conditions.push(eq(goalsTable.periodType, params.data.period_type));
  }
  if (params.data.employee_id) {
    conditions.push(eq(goalsTable.employeeId, params.data.employee_id));
  }

  const goals = conditions.length > 0
    ? await db.select().from(goalsTable).where(and(...conditions))
    : await db.select().from(goalsTable);

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

// Phase 6: four breakdown views over manual data — by worker, by
// traffic source, by GEO, by affiliate network. Metrics aggregated
// from batch_results per group; batch counts and winner totals come
// from the batch row + result row directly.
router.get("/dashboard/breakdowns", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  // One pass over batches (LEFT JOIN batch_results) so groups with no
  // results still appear with zeroed metrics.
  const rows = await db
    .select({
      batchId: testingBatchesTable.id,
      employeeId: testingBatchesTable.employeeId,
      employeeName: employeesTable.name,
      trafficSource: testingBatchesTable.trafficSource,
      geo: testingBatchesTable.geo,
      affiliateNetwork: testingBatchesTable.affiliateNetwork,
      status: testingBatchesTable.status,
      clicks: batchResultsTable.clicks,
      cost: batchResultsTable.cost,
      revenue: batchResultsTable.revenue,
      conversions: batchResultsTable.conversions,
      winnersCount: batchResultsTable.winnersCount,
      hasResult: sql<number>`CASE WHEN ${batchResultsTable.id} IS NOT NULL THEN 1 ELSE 0 END`,
    })
    .from(testingBatchesTable)
    .leftJoin(
      employeesTable,
      eq(testingBatchesTable.employeeId, employeesTable.id),
    )
    .leftJoin(
      batchResultsTable,
      eq(batchResultsTable.batchId, testingBatchesTable.id),
    )
    .where(eq(testingBatchesTable.workspaceId, workspaceId));

  type Bucket = {
    key: string;
    label: string;
    batches: number;
    tested: number;
    clicks: number;
    cost: number;
    revenue: number;
    conversions: number;
    winners: number;
  };

  function makeBucket(key: string, label: string): Bucket {
    return {
      key,
      label,
      batches: 0,
      tested: 0,
      clicks: 0,
      cost: 0,
      revenue: 0,
      conversions: 0,
      winners: 0,
    };
  }

  const byWorker = new Map<string, Bucket>();
  const byTrafficSource = new Map<string, Bucket>();
  const byGeo = new Map<string, Bucket>();
  const byNetwork = new Map<string, Bucket>();

  function add(map: Map<string, Bucket>, key: string, label: string, r: typeof rows[number]) {
    let b = map.get(key);
    if (!b) {
      b = makeBucket(key, label);
      map.set(key, b);
    }
    b.batches += 1;
    if (r.hasResult) {
      b.tested += 1;
      b.clicks += Number(r.clicks ?? 0);
      b.cost += Number(r.cost ?? 0);
      b.revenue += Number(r.revenue ?? 0);
      b.conversions += Number(r.conversions ?? 0);
      b.winners += Number(r.winnersCount ?? 0);
    }
  }

  for (const r of rows) {
    add(
      byWorker,
      String(r.employeeId),
      r.employeeName ?? `Employee #${r.employeeId}`,
      r,
    );
    add(
      byTrafficSource,
      r.trafficSource || "(unset)",
      r.trafficSource || "(unset)",
      r,
    );
    add(byGeo, r.geo || "(unset)", r.geo || "(unset)", r);
    add(
      byNetwork,
      r.affiliateNetwork || "(unset)",
      r.affiliateNetwork || "(unset)",
      r,
    );
  }

  function finalize(map: Map<string, Bucket>) {
    return Array.from(map.values()).map(b => {
      const profit = b.revenue - b.cost;
      const roi = b.cost > 0 ? Math.round((profit / b.cost) * 100) : 0;
      return {
        key: b.key,
        label: b.label,
        batches: b.batches,
        tested: b.tested,
        clicks: b.clicks,
        cost: b.cost,
        revenue: b.revenue,
        profit,
        roi,
        conversions: b.conversions,
        winners: b.winners,
      };
    });
  }

  res.json({
    byWorker: finalize(byWorker),
    byTrafficSource: finalize(byTrafficSource),
    byGeo: finalize(byGeo),
    byNetwork: finalize(byNetwork),
  });
});

export default router;
