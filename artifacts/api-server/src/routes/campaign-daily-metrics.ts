import { Router, type IRouter, type Response } from "express";
import { and, count, eq, gte, inArray, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  campaignDailyMetricsTable,
  campaignsTable,
  db,
  employeesTable,
  testingBatchesTable,
} from "@workspace/db";
import { z } from "zod/v4";
import { checkWorkspaceAccess } from "../lib/workspace-access.ts";
import { recordOperationalEvent } from "../lib/operational-events.ts";
import {
  assertCanUpsertCampaignDailyMetrics,
  CampaignDailyMetricsError,
} from "../lib/campaign-daily-metrics-access.ts";
import { deriveCampaignMetricFields } from "../lib/campaign-daily-metrics-math.ts";
import {
  queryCampaignMetricTotalsMap,
  resolveMetricsDateRange,
} from "../lib/campaign-daily-metrics-aggregate.ts";
import {
  confirmVoluumMetricsImport,
  previewVoluumMetricsImport,
} from "../lib/voluum-metrics-import.ts";
import { appendOperationalActivity } from "../lib/operational-activity-feed.ts";
import {
  appendLiveCampaignVisibilityConditions,
  testingBatchJoin,
} from "../lib/live-campaign-scope.ts";
import { manualMetricsSubmittedTitle, voluumMetricsImportedTitle } from "../lib/operational-activity-titles.ts";
import { resolveCampaignDisplayName } from "../lib/campaign-display-name.ts";

const router: IRouter = Router();

const LIVE_CAMPAIGN_STATUSES = ["live", "tested", "closed"] as const;
type LiveCampaignStatus = (typeof LIVE_CAMPAIGN_STATUSES)[number];

const METRIC_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const numericString = z
  .union([z.number(), z.string()])
  .transform((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : null;
  })
  .pipe(z.string());

const upsertBodySchema = z.object({
  workspaceId: z.number().int().positive(),
  campaignId: z.number().int().positive(),
  date: z.string().regex(METRIC_DATE_RE, "date must be YYYY-MM-DD"),
  cost: numericString.refine((v) => Number(v) >= 0, "cost must be non-negative"),
  revenue: numericString.refine((v) => Number(v) >= 0, "revenue must be non-negative"),
  conversions: z.number().int().nonnegative(),
  visits: z.number().int().nonnegative(),
});

function parsePositiveIntegerQuery(
  raw: unknown,
  name: string,
  res: Response,
): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `${name} must be a positive integer` });
    return null;
  }
  return n;
}

function parseMetricDateQuery(raw: unknown, res: Response): string | null {
  if (raw == null || raw === "") {
    res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
    return null;
  }
  if (typeof raw !== "string" || !METRIC_DATE_RE.test(raw)) {
    res.status(400).json({ error: "date must be YYYY-MM-DD" });
    return null;
  }
  return raw;
}

function serializeMetric(row: typeof campaignDailyMetricsTable.$inferSelect) {
  const derived = deriveCampaignMetricFields(row.cost, row.revenue, row.visits);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    campaignId: row.campaignId,
    date: row.date,
    employeeId: row.employeeId,
    cost: row.cost,
    revenue: row.revenue,
    conversions: row.conversions,
    visits: row.visits,
    profit: derived.profit,
    roi: derived.roi,
    epc: derived.epc,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const voluumImportBodySchema = z.object({
  workspaceId: z.number().int().positive(),
  date: z.string().regex(METRIC_DATE_RE, "date must be YYYY-MM-DD"),
  csvText: z.string().min(1),
  // When true, overwrite existing rows for matching (campaign, date). Default
  // false: existing rows are preserved and matching CSV rows are skipped.
  override: z.boolean().optional().default(false),
});

router.get("/campaign-daily-metrics", async (req, res): Promise<void> => {
  const wsId = Number(req.query["workspace_id"]);
  if (!Number.isInteger(wsId) || wsId <= 0) {
    res.status(400).json({ error: "workspace_id is required" });
    return;
  }

  const access = await checkWorkspaceAccess(req, wsId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return;
  }

  const dateFromRaw = req.query["date_from"];
  const dateToRaw = req.query["date_to"];
  const hasRange =
    dateFromRaw != null &&
    String(dateFromRaw).trim() !== "" &&
    dateToRaw != null &&
    String(dateToRaw).trim() !== "";

  let metricDate: string | null = null;
  let range: { dateFrom: string; dateTo: string } | null = null;

  if (hasRange) {
    const resolved = resolveMetricsDateRange(String(dateFromRaw), String(dateToRaw));
    if ("error" in resolved) {
      res.status(400).json({ error: resolved.error });
      return;
    }
    range = resolved;
  } else {
    metricDate = parseMetricDateQuery(req.query["date"], res);
    if (metricDate === null) return;
  }

  const statusRaw = req.query["status"];
  const status = statusRaw == null || statusRaw === "" ? "live" : statusRaw;
  if (typeof status !== "string" || !LIVE_CAMPAIGN_STATUSES.includes(status as LiveCampaignStatus)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  const employeeId = parsePositiveIntegerQuery(req.query["employee_id"], "employee_id", res);
  if (res.headersSent) return;
  const workerId = parsePositiveIntegerQuery(req.query["worker_id"], "worker_id", res);
  if (res.headersSent) return;
  if (employeeId !== null && workerId !== null && employeeId !== workerId) {
    res.status(400).json({ error: "employee_id and worker_id must match when both are provided" });
    return;
  }
  const requestedWorkerId = employeeId ?? workerId;

  const conditions = [
    eq(campaignsTable.workspaceId, wsId),
    eq(campaignsTable.status, status as LiveCampaignStatus),
  ];
  appendLiveCampaignVisibilityConditions(access, requestedWorkerId, conditions);

  const batchJoin = testingBatchJoin(wsId);
  const visibleCampaignIds = await db
    .select({ id: campaignsTable.id })
    .from(campaignsTable)
    .leftJoin(testingBatchesTable, batchJoin)
    .where(and(...conditions));

  const ids = visibleCampaignIds.map((r) => r.id);
  if (ids.length === 0) {
    res.json(
      range
        ? { dateFrom: range.dateFrom, dateTo: range.dateTo, items: [] }
        : { date: metricDate, items: [] },
    );
    return;
  }

  if (range) {
    const totalsMap = await queryCampaignMetricTotalsMap(wsId, range, ids);
    const items = ids
      .map((id) => totalsMap.get(id))
      .filter((row): row is NonNullable<typeof row> => row != null)
      .map((row) => ({
        campaignId: row.campaignId,
        cost: String(row.cost),
        revenue: String(row.revenue),
        conversions: row.conversions,
        visits: row.visits,
        profit: String(row.profit),
        roi: row.roi != null ? String(row.roi) : null,
        epc: row.epc != null ? String(row.epc) : null,
      }));
    res.json({ dateFrom: range.dateFrom, dateTo: range.dateTo, items });
    return;
  }

  const rows = await db
    .select()
    .from(campaignDailyMetricsTable)
    .where(
      and(
        eq(campaignDailyMetricsTable.workspaceId, wsId),
        eq(campaignDailyMetricsTable.date, metricDate),
        inArray(campaignDailyMetricsTable.campaignId, ids),
      ),
    );

  res.json({
    date: metricDate,
    items: rows.map(serializeMetric),
  });
});

router.put("/campaign-daily-metrics", async (req, res): Promise<void> => {
  const parsed = upsertBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { workspaceId, campaignId, date, cost, revenue, conversions, visits } = parsed.data;

  const access = await checkWorkspaceAccess(req, workspaceId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return;
  }

  try {
    await assertCanUpsertCampaignDailyMetrics(access, workspaceId, campaignId);
  } catch (err) {
    if (err instanceof CampaignDailyMetricsError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    throw err;
  }

  const [campaign] = await db
    .select({
      workspaceId: campaignsTable.workspaceId,
      campaignName: campaignsTable.campaignName,
      platform: campaignsTable.platform,
      batchId: campaignsTable.batchId,
    })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.workspaceId, workspaceId)))
    .limit(1);

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const now = new Date();
  const [row] = await db
    .insert(campaignDailyMetricsTable)
    .values({
      workspaceId,
      campaignId,
      date,
      employeeId: access.employee.id,
      cost,
      revenue,
      conversions,
      visits,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [campaignDailyMetricsTable.campaignId, campaignDailyMetricsTable.date],
      set: {
        employeeId: access.employee.id,
        cost,
        revenue,
        conversions,
        visits,
        workspaceId,
        updatedAt: now,
      },
    })
    .returning();

  const [batchRow] =
    campaign.batchId != null
      ? await db
          .select({ batchName: testingBatchesTable.batchName })
          .from(testingBatchesTable)
          .where(eq(testingBatchesTable.id, campaign.batchId))
          .limit(1)
      : [undefined];
  const displayName = resolveCampaignDisplayName({
    campaignName: campaign.campaignName,
    batchName: batchRow?.batchName,
    platform: campaign.platform,
  });
  void appendOperationalActivity(db, {
    workspaceId,
    eventType: "manual_metrics_submitted",
    entityType: "campaign",
    entityId: campaignId,
    actorEmployeeId: access.employee.id,
    title: manualMetricsSubmittedTitle(displayName, date),
    metadata: { date, cost, revenue, conversions, visits },
  });

  res.json(serializeMetric(row));
});

router.post("/campaign-daily-metrics/voluum-import/preview", async (req, res): Promise<void> => {
  const parsed = voluumImportBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const access = await checkWorkspaceAccess(req, parsed.data.workspaceId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return;
  }

  const result = await previewVoluumMetricsImport({
    workspaceId: parsed.data.workspaceId,
    date: parsed.data.date,
    csvText: parsed.data.csvText,
    access,
    override: parsed.data.override,
  });

  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.json(result);
});

router.post("/campaign-daily-metrics/voluum-import/confirm", async (req, res): Promise<void> => {
  const parsed = voluumImportBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const access = await checkWorkspaceAccess(req, parsed.data.workspaceId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return;
  }

  const result = await confirmVoluumMetricsImport({
    workspaceId: parsed.data.workspaceId,
    date: parsed.data.date,
    csvText: parsed.data.csvText,
    access,
    override: parsed.data.override,
  });

  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  if (result.imported + result.updated > 0) {
    void appendOperationalActivity(db, {
      workspaceId: parsed.data.workspaceId,
      eventType: "voluum_metrics_imported",
      entityType: "workspace",
      entityId: parsed.data.workspaceId,
      actorEmployeeId: access.employee.id,
      title: voluumMetricsImportedTitle(parsed.data.date, result.imported, result.updated),
      metadata: {
        date: parsed.data.date,
        override: result.override,
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
        skippedExisting: result.skippedExisting,
        duplicateCampaignIdsInCsv: result.duplicateCampaignIdsInCsv,
      },
    });
  }

  res.json(result);
});

// ── Admin: bulk delete daily metrics by employee + date range ──────────────
//
// SAFETY MODEL:
//  * Admin-only (role enforced server-side, plus workspace membership).
//  * Scope is always workspace + employee_id (the actor recorded on the metric
//    row) + [dateFrom, dateTo]. It only ever touches campaign_daily_metrics.
//  * No soft-delete column exists, so delete is hard. It is gated by a separate
//    preview endpoint, an explicit confirmationText, and an audit event.
//  * Campaign definitions, goals, XP, users, and workspaces are never touched.

const DELETE_CONFIRMATION_TEXT = "DELETE DATA";
const DELETE_SAMPLE_LIMIT = 25;

const adminDeleteFilterSchema = z.object({
  workspaceId: z.number().int().positive(),
  employeeId: z.number().int().positive(),
  dateFrom: z.string().regex(METRIC_DATE_RE, "dateFrom must be YYYY-MM-DD"),
  dateTo: z.string().regex(METRIC_DATE_RE, "dateTo must be YYYY-MM-DD"),
});

const adminDeleteConfirmSchema = adminDeleteFilterSchema.extend({
  confirmationText: z.string(),
});

function metricsDeleteWhere(workspaceId: number, employeeId: number, dateFrom: string, dateTo: string) {
  return and(
    eq(campaignDailyMetricsTable.workspaceId, workspaceId),
    eq(campaignDailyMetricsTable.employeeId, employeeId),
    gte(campaignDailyMetricsTable.date, dateFrom),
    lte(campaignDailyMetricsTable.date, dateTo),
  );
}

/** Returns the admin access result, or null after sending an error response. */
async function requireWorkspaceAdmin(
  req: Parameters<typeof checkWorkspaceAccess>[0],
  res: Response,
  workspaceId: number,
): Promise<Extract<Awaited<ReturnType<typeof checkWorkspaceAccess>>, { allowed: true }> | null> {
  const access = await checkWorkspaceAccess(req, workspaceId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return null;
  }
  if (access.employee.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return access;
}

async function loadAffectedCampaigns(
  client: Pick<NodePgDatabase, "selectDistinct">,
  whereClause: ReturnType<typeof metricsDeleteWhere>,
): Promise<Array<{ id: number; name: string }>> {
  const rows = await client
    .selectDistinct({
      campaignId: campaignDailyMetricsTable.campaignId,
      campaignName: campaignsTable.campaignName,
    })
    .from(campaignDailyMetricsTable)
    .innerJoin(campaignsTable, eq(campaignsTable.id, campaignDailyMetricsTable.campaignId))
    .where(whereClause)
    .orderBy(campaignsTable.campaignName);
  return rows.map((r) => ({ id: r.campaignId, name: r.campaignName }));
}

router.post("/campaign-daily-metrics/admin/delete-preview", async (req, res): Promise<void> => {
  const parsed = adminDeleteFilterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { workspaceId, employeeId, dateFrom, dateTo } = parsed.data;
  if (dateFrom > dateTo) {
    res.status(400).json({ error: "dateFrom must be on or before dateTo" });
    return;
  }

  const access = await requireWorkspaceAdmin(req, res, workspaceId);
  if (access === null) return;

  const [employee] = await db
    .select({ id: employeesTable.id, name: employeesTable.name })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId))
    .limit(1);

  const whereClause = metricsDeleteWhere(workspaceId, employeeId, dateFrom, dateTo);
  const [{ value: matchingRows }] = await db
    .select({ value: count() })
    .from(campaignDailyMetricsTable)
    .where(whereClause);

  const affected = await loadAffectedCampaigns(db, whereClause);

  res.json({
    workspaceId,
    employeeId,
    employeeName: employee?.name ?? null,
    dateFrom,
    dateTo,
    matchingRows: Number(matchingRows ?? 0),
    affectedCampaignsCount: affected.length,
    sampleCampaigns: affected.slice(0, DELETE_SAMPLE_LIMIT),
    confirmationRequired: DELETE_CONFIRMATION_TEXT,
  });
});

router.post("/campaign-daily-metrics/admin/delete", async (req, res): Promise<void> => {
  const parsed = adminDeleteConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { workspaceId, employeeId, dateFrom, dateTo, confirmationText } = parsed.data;
  if (dateFrom > dateTo) {
    res.status(400).json({ error: "dateFrom must be on or before dateTo" });
    return;
  }
  if (confirmationText !== DELETE_CONFIRMATION_TEXT) {
    res.status(400).json({
      error: `confirmationText must be exactly "${DELETE_CONFIRMATION_TEXT}" to confirm deletion`,
    });
    return;
  }

  const access = await requireWorkspaceAdmin(req, res, workspaceId);
  if (access === null) return;

  const [employee] = await db
    .select({ id: employeesTable.id, name: employeesTable.name })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId))
    .limit(1);

  const whereClause = metricsDeleteWhere(workspaceId, employeeId, dateFrom, dateTo);

  let deletedCount = 0;
  let affected: Array<{ id: number; name: string }> = [];
  await db.transaction(async (tx) => {
    // Capture affected scope before deleting (cascade-safe: metrics only).
    affected = await loadAffectedCampaigns(tx, whereClause);
    const deleted = await tx
      .delete(campaignDailyMetricsTable)
      .where(whereClause)
      .returning({ id: campaignDailyMetricsTable.id });
    deletedCount = deleted.length;
  });

  await recordOperationalEvent({
    workspaceId,
    entityType: "workspace",
    entityId: workspaceId,
    eventType: "LIVE_CAMPAIGN_METRICS_BULK_DELETED",
    actorType: "employee",
    actorId: access.employee.id,
    source: "routes.campaign-daily-metrics",
    payloadJson: {
      targetEmployeeId: employeeId,
      targetEmployeeName: employee?.name ?? null,
      dateFrom,
      dateTo,
      deletedCount,
      affectedCampaignsCount: affected.length,
    },
  });

  res.json({
    deleted: deletedCount,
    workspaceId,
    employeeId,
    employeeName: employee?.name ?? null,
    dateFrom,
    dateTo,
    affectedCampaignsCount: affected.length,
    sampleCampaigns: affected.slice(0, DELETE_SAMPLE_LIMIT),
  });
});

export default router;
