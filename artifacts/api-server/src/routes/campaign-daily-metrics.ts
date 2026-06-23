import { Router, type IRouter, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { campaignDailyMetricsTable, campaignsTable, db, testingBatchesTable } from "@workspace/db";
import { z } from "zod/v4";
import { checkWorkspaceAccess } from "../lib/workspace-access.ts";
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
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
        duplicateCampaignIdsInCsv: result.duplicateCampaignIdsInCsv,
      },
    });
  }

  res.json(result);
});

export default router;
