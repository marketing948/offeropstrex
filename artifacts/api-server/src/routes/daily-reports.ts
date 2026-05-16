import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, dailyReportsTable, employeesTable } from "@workspace/db";
import {
  CreateDailyReportBody,
  UpdateDailyReportBody,
  GetDailyReportParams,
  UpdateDailyReportParams,
  ListDailyReportsQueryParams,
  ListWeeklyReportsQueryParams,
} from "@workspace/api-zod";
import { requireWorkspaceFromQuery, requireWorkspaceAccess } from "../lib/workspace-access";
import { requireWorkspaceFromBody } from "../lib/require-workspace";

const router: IRouter = Router();

function serializeReport(report: typeof dailyReportsTable.$inferSelect, employeeName?: string | null) {
  return {
    ...report,
    createdAt: report.createdAt.toISOString(),
    employeeName: employeeName ?? null,
  };
}

router.get("/daily-reports", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const params = ListDailyReportsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [eq(dailyReportsTable.workspaceId, workspaceId)];
  if (params.data.employee_id) {
    conditions.push(eq(dailyReportsTable.employeeId, params.data.employee_id));
  }
  if (params.data.date_from) {
    conditions.push(gte(dailyReportsTable.reportDate, params.data.date_from));
  }
  if (params.data.date_to) {
    conditions.push(lte(dailyReportsTable.reportDate, params.data.date_to));
  }

  const reports = await db
    .select({
      report: dailyReportsTable,
      employeeName: employeesTable.name,
    })
    .from(dailyReportsTable)
    .leftJoin(employeesTable, eq(dailyReportsTable.employeeId, employeesTable.id))
    .where(and(...conditions))
    .orderBy(dailyReportsTable.reportDate);

  res.json(reports.map(r => serializeReport(r.report, r.employeeName)));
});

router.post("/daily-reports", async (req, res): Promise<void> => {
  const parsed = CreateDailyReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const workspaceId = await requireWorkspaceFromBody(req, res);
  if (workspaceId === null) return;

  const [report] = await db
    .insert(dailyReportsTable)
    .values({ ...(parsed.data as typeof dailyReportsTable.$inferInsert), workspaceId })
    .returning();
  res.status(201).json(serializeReport(report));
});

router.get("/daily-reports/:id", async (req, res): Promise<void> => {
  const params = GetDailyReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [result] = await db
    .select({ report: dailyReportsTable, employeeName: employeesTable.name })
    .from(dailyReportsTable)
    .leftJoin(employeesTable, eq(dailyReportsTable.employeeId, employeesTable.id))
    .where(eq(dailyReportsTable.id, params.data.id));

  if (!result) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  if ((await requireWorkspaceAccess(req, res, result.report.workspaceId)) === null) return;

  res.json(serializeReport(result.report, result.employeeName));
});

router.patch("/daily-reports/:id", async (req, res): Promise<void> => {
  const params = UpdateDailyReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateDailyReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select({ workspaceId: dailyReportsTable.workspaceId }).from(dailyReportsTable).where(eq(dailyReportsTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Report not found" }); return; }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  const [report] = await db
    .update(dailyReportsTable)
    .set(parsed.data as Partial<typeof dailyReportsTable.$inferInsert>)
    .where(eq(dailyReportsTable.id, params.data.id))
    .returning();

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  res.json(serializeReport(report));
});

router.get("/weekly-reports", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const params = ListWeeklyReportsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [eq(dailyReportsTable.workspaceId, workspaceId)];
  if (params.data.employee_id) {
    conditions.push(eq(dailyReportsTable.employeeId, params.data.employee_id));
  }

  const reports = await db
    .select({
      report: dailyReportsTable,
      employeeName: employeesTable.name,
    })
    .from(dailyReportsTable)
    .leftJoin(employeesTable, eq(dailyReportsTable.employeeId, employeesTable.id))
    .where(and(...conditions))
    .orderBy(dailyReportsTable.reportDate);

  const weeklyMap = new Map<string, {
    employeeId: number;
    employeeName: string;
    weekStart: string;
    weekEnd: string;
    totalOffersUploaded: number;
    totalBatchesCreated: number;
    totalBatchesTested: number;
    totalCampaignsMovedToMain: number;
    totalCampaignsClosed: number;
    reportCount: number;
  }>();

  for (const { report, employeeName } of reports) {
    const date = new Date(report.reportDate);
    const dayOfWeek = date.getDay();
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekEndStr = weekEnd.toISOString().split("T")[0];
    const key = `${report.employeeId}-${weekStartStr}`;

    const existing = weeklyMap.get(key);
    if (existing) {
      existing.totalOffersUploaded += report.offersUploaded;
      existing.totalBatchesCreated += report.batchesCreated;
      existing.totalBatchesTested += report.batchesTested;
      existing.totalCampaignsMovedToMain += report.campaignsMovedToMain;
      existing.totalCampaignsClosed += report.campaignsClosed;
      existing.reportCount += 1;
    } else {
      weeklyMap.set(key, {
        employeeId: report.employeeId,
        employeeName: employeeName ?? "Unknown",
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
        totalOffersUploaded: report.offersUploaded,
        totalBatchesCreated: report.batchesCreated,
        totalBatchesTested: report.batchesTested,
        totalCampaignsMovedToMain: report.campaignsMovedToMain,
        totalCampaignsClosed: report.campaignsClosed,
        reportCount: 1,
      });
    }
  }

  res.json(Array.from(weeklyMap.values()).reverse());
});

export default router;
