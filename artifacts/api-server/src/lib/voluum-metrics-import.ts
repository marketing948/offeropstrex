import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { campaignDailyMetricsTable, campaignsTable, db } from "@workspace/db";
import type { checkWorkspaceAccess } from "./workspace-access.ts";
import { resolveCanonicalCampaignOwnerEmployeeId } from "./canonical-campaign-actuals.ts";
import {
  assertCanUpsertCampaignDailyMetrics,
  CampaignDailyMetricsError,
} from "./campaign-daily-metrics-access.ts";
import {
  dedupeVoluumRowsByCampaignId,
  parseVoluumMetricsCsv,
  type VoluumCsvParseResult,
  type VoluumMetricsSkipReason,
} from "./voluum-metrics-csv.ts";

const METRIC_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type AccessResult = Extract<Awaited<ReturnType<typeof checkWorkspaceAccess>>, { allowed: true }>;

export type VoluumImportPreviewRow = {
  lineNumber: number;
  voluumCampaignId: string | null;
  campaignId: number | null;
  campaignName: string | null;
  visits: number | null;
  conversions: number | null;
  cost: string | null;
  revenue: string | null;
  action: "import" | "update" | "skip";
  skipReason?: VoluumMetricsSkipReason;
};

export type VoluumImportSummary = {
  totalRows: number;
  importable: number;
  updating: number;
  skipped: number;
  /** Rows that match an existing (campaign, date) row and are skipped because override is off. */
  skippedExisting: number;
  duplicateCampaignIdsInCsv: number;
};

export type VoluumImportPreviewResult = {
  date: string;
  summary: VoluumImportSummary;
  rows: VoluumImportPreviewRow[];
};

export type VoluumImportConfirmResult = {
  date: string;
  override: boolean;
  imported: number;
  updated: number;
  skipped: number;
  /** Existing rows preserved because override was off (includes confirm-time conflict races). */
  skippedExisting: number;
  skippedBreakdown: Partial<Record<VoluumMetricsSkipReason, number>>;
  duplicateCampaignIdsInCsv: number;
};

type CampaignMatch = {
  id: number;
  voluumCampaignId: string;
  campaignName: string;
  campaign: typeof campaignsTable.$inferSelect;
};

function parseImportBody(
  workspaceId: number,
  date: string,
  csvText: string,
): { workspaceId: number; date: string; csvText: string } | { error: string } {
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    return { error: "workspaceId must be a positive integer" };
  }
  if (!METRIC_DATE_RE.test(date)) {
    return { error: "date must be YYYY-MM-DD" };
  }
  if (typeof csvText !== "string" || csvText.trim() === "") {
    return { error: "csvText is required" };
  }
  return { workspaceId, date, csvText };
}

async function loadCampaignsByVoluumId(workspaceId: number): Promise<Map<string, CampaignMatch>> {
  const rows = await db
    .select({
      id: campaignsTable.id,
      voluumCampaignId: campaignsTable.voluumCampaignId,
      campaignName: campaignsTable.campaignName,
      campaign: campaignsTable,
    })
    .from(campaignsTable)
    .where(
      and(eq(campaignsTable.workspaceId, workspaceId), isNotNull(campaignsTable.voluumCampaignId)),
    );

  const map = new Map<string, CampaignMatch>();
  for (const row of rows) {
    const key = row.voluumCampaignId!.trim();
    if (!key) continue;
    map.set(key, {
      id: row.id,
      voluumCampaignId: key,
      campaignName: row.campaignName,
      campaign: row.campaign,
    });
  }
  return map;
}

async function loadExistingMetricCampaignIds(
  workspaceId: number,
  date: string,
  campaignIds: number[],
): Promise<Set<number>> {
  if (campaignIds.length === 0) return new Set();
  const rows = await db
    .select({ campaignId: campaignDailyMetricsTable.campaignId })
    .from(campaignDailyMetricsTable)
    .where(
      and(
        eq(campaignDailyMetricsTable.workspaceId, workspaceId),
        eq(campaignDailyMetricsTable.date, date),
        inArray(campaignDailyMetricsTable.campaignId, campaignIds),
      ),
    );
  return new Set(rows.map((r) => r.campaignId));
}

async function canUpsertCampaign(
  access: AccessResult,
  workspaceId: number,
  campaign: typeof campaignsTable.$inferSelect,
): Promise<boolean> {
  try {
    await assertCanUpsertCampaignDailyMetrics(access, workspaceId, campaign.id);
    return true;
  } catch (err) {
    if (err instanceof CampaignDailyMetricsError && err.statusCode === 403) {
      return false;
    }
    if (err instanceof CampaignDailyMetricsError) {
      return false;
    }
    throw err;
  }
}

type BuildPlanInput = {
  workspaceId: number;
  date: string;
  csvParse: Extract<VoluumCsvParseResult, { ok: true }>;
  access: AccessResult;
  /** When false, rows matching an existing (campaign, date) row are skipped instead of updated. */
  override: boolean;
};

async function buildImportPlan(input: BuildPlanInput): Promise<{
  previewRows: VoluumImportPreviewRow[];
  summary: VoluumImportSummary;
  upsertCandidates: Array<{
    campaignId: number;
    employeeId: number;
    visits: number;
    conversions: number;
    cost: string;
    revenue: string;
    voluumCampaignId: string;
    isUpdate: boolean;
  }>;
}> {
  const { workspaceId, date, csvParse, access, override } = input;
  const campaignByVoluum = await loadCampaignsByVoluumId(workspaceId);

  const previewRows: VoluumImportPreviewRow[] = [];
  for (const row of csvParse.dataRows) {
    if (row.rowSkipReason) {
      previewRows.push({
        lineNumber: row.lineNumber,
        voluumCampaignId: row.voluumCampaignId,
        campaignId: null,
        campaignName: null,
        visits: row.visits,
        conversions: row.conversions,
        cost: row.cost,
        revenue: row.revenue,
        action: "skip",
        skipReason: row.rowSkipReason,
      });
    }
  }

  const { rows: dedupedValid, duplicateCampaignIdsInCsv } = dedupeVoluumRowsByCampaignId(
    csvParse.dataRows,
  );

  const upsertCandidates: Array<{
    campaignId: number;
    visits: number;
    conversions: number;
    cost: string;
    revenue: string;
    voluumCampaignId: string;
    isUpdate: boolean;
  }> = [];

  const matchedCampaignIds: number[] = [];

  for (const row of dedupedValid) {
    const voluumId = row.voluumCampaignId!.trim();
    const match = campaignByVoluum.get(voluumId);
    if (!match) {
      previewRows.push({
        lineNumber: row.lineNumber,
        voluumCampaignId: voluumId,
        campaignId: null,
        campaignName: null,
        visits: row.visits,
        conversions: row.conversions,
        cost: row.cost,
        revenue: row.revenue,
        action: "skip",
        skipReason: "campaign_not_found",
      });
      continue;
    }

    const allowed = await canUpsertCampaign(access, workspaceId, match.campaign);
    if (!allowed) {
      previewRows.push({
        lineNumber: row.lineNumber,
        voluumCampaignId: voluumId,
        campaignId: match.id,
        campaignName: match.campaignName,
        visits: row.visits,
        conversions: row.conversions,
        cost: row.cost,
        revenue: row.revenue,
        action: "skip",
        skipReason: "not_allowed",
      });
      continue;
    }

    matchedCampaignIds.push(match.id);
    const ownerEmployeeId = await resolveCanonicalCampaignOwnerEmployeeId(
      workspaceId,
      match.campaign,
    );
    const metricEmployeeId = ownerEmployeeId ?? access.employee.id;
    upsertCandidates.push({
      campaignId: match.id,
      employeeId: metricEmployeeId,
      visits: row.visits!,
      conversions: row.conversions!,
      cost: row.cost!,
      revenue: row.revenue!,
      voluumCampaignId: voluumId,
      isUpdate: false,
    });
  }

  const existingIds = await loadExistingMetricCampaignIds(workspaceId, date, matchedCampaignIds);
  for (const c of upsertCandidates) {
    c.isUpdate = existingIds.has(c.campaignId);
  }

  // Only rows that will actually be written. When override is off, rows that
  // match an existing (campaign, date) row are removed here and surfaced as
  // skips so existing data is never overwritten.
  const writeCandidates: typeof upsertCandidates = [];
  for (const c of upsertCandidates) {
    const lineNumber =
      dedupedValid.find((r) => r.voluumCampaignId?.trim() === c.voluumCampaignId)?.lineNumber ?? 0;
    const campaignName = campaignByVoluum.get(c.voluumCampaignId)?.campaignName ?? null;
    if (c.isUpdate && !override) {
      previewRows.push({
        lineNumber,
        voluumCampaignId: c.voluumCampaignId,
        campaignId: c.campaignId,
        campaignName,
        visits: c.visits,
        conversions: c.conversions,
        cost: c.cost,
        revenue: c.revenue,
        action: "skip",
        skipReason: "existing_no_override",
      });
      continue;
    }
    writeCandidates.push(c);
    previewRows.push({
      lineNumber,
      voluumCampaignId: c.voluumCampaignId,
      campaignId: c.campaignId,
      campaignName,
      visits: c.visits,
      conversions: c.conversions,
      cost: c.cost,
      revenue: c.revenue,
      action: c.isUpdate ? "update" : "import",
    });
  }

  previewRows.sort((a, b) => a.lineNumber - b.lineNumber);

  let importable = 0;
  let updating = 0;
  let skipped = 0;
  let skippedExisting = 0;
  for (const r of previewRows) {
    if (r.action === "import") importable++;
    else if (r.action === "update") updating++;
    else {
      skipped++;
      if (r.skipReason === "existing_no_override") skippedExisting++;
    }
  }

  const summary: VoluumImportSummary = {
    totalRows: csvParse.dataRows.length,
    importable,
    updating,
    skipped,
    skippedExisting,
    duplicateCampaignIdsInCsv,
  };

  return { previewRows, summary, upsertCandidates: writeCandidates };
}

export async function previewVoluumMetricsImport(params: {
  workspaceId: number;
  date: string;
  csvText: string;
  access: AccessResult;
  override?: boolean;
}): Promise<VoluumImportPreviewResult | { error: string; status: number }> {
  const parsed = parseImportBody(params.workspaceId, params.date, params.csvText);
  if ("error" in parsed) {
    return { error: parsed.error, status: 400 };
  }

  const csvParse = parseVoluumMetricsCsv(parsed.csvText);
  if (!csvParse.ok) {
    return { error: csvParse.error, status: 400 };
  }

  const { previewRows, summary } = await buildImportPlan({
    workspaceId: parsed.workspaceId,
    date: parsed.date,
    csvParse,
    access: params.access,
    override: params.override ?? false,
  });

  return {
    date: parsed.date,
    summary,
    rows: previewRows,
  };
}

export async function confirmVoluumMetricsImport(params: {
  workspaceId: number;
  date: string;
  csvText: string;
  access: AccessResult;
  override?: boolean;
}): Promise<VoluumImportConfirmResult | { error: string; status: number }> {
  const override = params.override ?? false;
  const parsed = parseImportBody(params.workspaceId, params.date, params.csvText);
  if ("error" in parsed) {
    return { error: parsed.error, status: 400 };
  }

  const csvParse = parseVoluumMetricsCsv(parsed.csvText);
  if (!csvParse.ok) {
    return { error: csvParse.error, status: 400 };
  }

  const { previewRows, summary, upsertCandidates } = await buildImportPlan({
    workspaceId: parsed.workspaceId,
    date: parsed.date,
    csvParse,
    access: params.access,
    override,
  });

  const skippedBreakdown: Partial<Record<VoluumMetricsSkipReason, number>> = {};
  for (const row of previewRows) {
    if (row.action === "skip" && row.skipReason) {
      skippedBreakdown[row.skipReason] = (skippedBreakdown[row.skipReason] ?? 0) + 1;
    }
  }

  if (upsertCandidates.length === 0) {
    return {
      date: parsed.date,
      override,
      imported: 0,
      updated: 0,
      skipped: summary.skipped,
      skippedExisting: summary.skippedExisting,
      skippedBreakdown,
      duplicateCampaignIdsInCsv: summary.duplicateCampaignIdsInCsv,
    };
  }

  const now = new Date();
  let imported = 0;
  let updated = 0;
  // Existing rows preserved at confirm time due to a race (row created between
  // preview and confirm) when override is off.
  let skippedExistingRace = 0;

  await db.transaction(async (tx) => {
    for (const row of upsertCandidates) {
      if (override) {
        await tx
          .insert(campaignDailyMetricsTable)
          .values({
            workspaceId: parsed.workspaceId,
            campaignId: row.campaignId,
            date: parsed.date,
            employeeId: row.employeeId,
            cost: row.cost,
            revenue: row.revenue,
            conversions: row.conversions,
            visits: row.visits,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [campaignDailyMetricsTable.campaignId, campaignDailyMetricsTable.date],
            set: {
              employeeId: row.employeeId,
              cost: row.cost,
              revenue: row.revenue,
              conversions: row.conversions,
              visits: row.visits,
              workspaceId: parsed.workspaceId,
              updatedAt: now,
            },
          });
        if (row.isUpdate) updated++;
        else imported++;
      } else {
        // Insert-only: never overwrite an existing (campaign, date) row.
        const inserted = await tx
          .insert(campaignDailyMetricsTable)
          .values({
            workspaceId: parsed.workspaceId,
            campaignId: row.campaignId,
            date: parsed.date,
            employeeId: row.employeeId,
            cost: row.cost,
            revenue: row.revenue,
            conversions: row.conversions,
            visits: row.visits,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [campaignDailyMetricsTable.campaignId, campaignDailyMetricsTable.date],
          })
          .returning({ id: campaignDailyMetricsTable.id });
        if (inserted.length > 0) imported++;
        else skippedExistingRace++;
      }
    }
  });

  return {
    date: parsed.date,
    override,
    imported,
    updated,
    skipped: summary.skipped + skippedExistingRace,
    skippedExisting: summary.skippedExisting + skippedExistingRace,
    skippedBreakdown:
      skippedExistingRace > 0
        ? {
            ...skippedBreakdown,
            existing_no_override:
              (skippedBreakdown.existing_no_override ?? 0) + skippedExistingRace,
          }
        : skippedBreakdown,
    duplicateCampaignIdsInCsv: summary.duplicateCampaignIdsInCsv,
  };
}
