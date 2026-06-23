/**
 * Reports — unified entity rows, filter options, and metrics aggregation.
 *
 * Root data rules:
 * - Filter dropdowns come from workspace master catalogs (networks, GEOs, sources)
 *   plus any legacy text on batches/campaigns — never from already-filtered rows.
 * - Report rows = all testing batches + standalone live/production campaigns (no batch_id).
 * - Range metrics join on batchId OR campaignId from GET /performance (campaign_daily_metrics).
 */

import type { Performance, TestingBatch } from "@workspace/api-client-react";

export type StandaloneLiveCampaign = {
  id: number;
  campaignName: string;
  batchId: number | null;
  batchName: string | null;
  batchGeo: string | null;
  batchAffiliateNetwork: string | null;
  employeeName: string | null;
  employeeId?: number | null;
  trafficSourceName: string | null;
  platform: string;
  campaignPurpose: string;
  status: string;
};

/** Canonical campaign-type filter key (stored slug, not display label). */
export type ReportCampaignTypeKey = string;

export const REPORT_CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  testing: "Test",
  working: "Working",
  scaling: "Scaling",
  closed: "Closed",
  review: "Review",
};

const REPORT_CAMPAIGN_TYPE_ORDER = ["testing", "working", "scaling", "review", "closed"] as const;

export function reportCampaignTypeLabel(key: ReportCampaignTypeKey): string {
  return REPORT_CAMPAIGN_TYPE_LABELS[key] ?? key.replace(/_/g, " ");
}

/** Resolve filter key from batch/campaign fields — no invented backend values. */
export function resolveReportCampaignType(row: {
  entityKind: "batch" | "campaign";
  campaignPurpose: string;
  status: string;
}): ReportCampaignTypeKey {
  if (row.entityKind === "batch") return "testing";

  const status = row.status.toLowerCase();
  if (status === "closed") return "closed";
  if (status === "ready_for_winner_review" || status === "tested") return "review";

  const purpose = row.campaignPurpose.trim().toLowerCase();
  if (purpose === "testing" || purpose === "working" || purpose === "scaling") return purpose;
  if (purpose) return purpose;
  return "other";
}

export function buildReportCampaignTypeOptions(
  rows: ReportEntityRow[],
): { key: ReportCampaignTypeKey; label: string }[] {
  const keys = new Set(rows.map((r) => r.campaignType));
  const ordered: { key: ReportCampaignTypeKey; label: string }[] = [];
  for (const key of REPORT_CAMPAIGN_TYPE_ORDER) {
    if (keys.has(key)) ordered.push({ key, label: reportCampaignTypeLabel(key) });
  }
  for (const key of [...keys].sort()) {
    if (key === "other" || REPORT_CAMPAIGN_TYPE_ORDER.includes(key as (typeof REPORT_CAMPAIGN_TYPE_ORDER)[number])) {
      continue;
    }
    ordered.push({ key, label: reportCampaignTypeLabel(key) });
  }
  if (keys.has("other")) ordered.push({ key: "other", label: "Other" });
  return ordered;
}

export type ReportEntityRow = {
  rowKey: string;
  entityKind: "batch" | "campaign";
  id: number;
  batchName: string;
  network: string;
  geo: string;
  trafficSource: string;
  employee: string;
  employeeId: number | null;
  campaignType: ReportCampaignTypeKey;
  campaignPurpose: string;
  status: string;
  clicks: number;
  spend: number;
  revenue: number;
  profit: number;
  roi: number;
  conversions: number;
  winners: number;
  losers: number;
  totalOffers: number;
  daysRunning: number;
  liveAt: string | null;
};

export type MetricBucket = {
  clicks: number;
  spend: number;
  revenue: number;
  profit: number;
  conversions: number;
};

export function emptyMetrics(): MetricBucket {
  return { clicks: 0, spend: 0, revenue: 0, profit: 0, conversions: 0 };
}

export function aggregatePerfRows(rows: Performance[]): MetricBucket {
  const acc = emptyMetrics();
  for (const p of rows) {
    acc.clicks += Number(p.clicks ?? 0);
    acc.spend += Number(p.spend ?? 0);
    acc.revenue += Number(p.revenue ?? 0);
    acc.profit += Number(p.profit ?? 0);
    acc.conversions += Number(p.conversions ?? 0);
  }
  return acc;
}

export function metricsForBatch(batchId: number, perfAll: Performance[]): MetricBucket {
  return aggregatePerfRows(perfAll.filter((p) => p.batchId === batchId));
}

export function metricsForCampaign(campaignId: number, perfAll: Performance[]): MetricBucket {
  return aggregatePerfRows(perfAll.filter((p) => p.campaignId === campaignId));
}

export function roiFromMetrics(m: MetricBucket): number {
  return m.spend > 0 ? ((m.revenue - m.spend) / m.spend) * 100 : 0;
}

export function buildStandaloneCampaignRows(
  campaigns: StandaloneLiveCampaign[],
  perfAll: Performance[],
): ReportEntityRow[] {
  return campaigns
    .filter((c) => c.batchId == null)
    .map((c) => {
      const p = metricsForCampaign(c.id, perfAll);
      return {
        rowKey: `campaign:${c.id}`,
        entityKind: "campaign" as const,
        id: c.id,
        batchName: c.campaignName,
        network: c.batchAffiliateNetwork ?? "—",
        geo: c.batchGeo ?? "—",
        trafficSource: c.trafficSourceName ?? "—",
        employee: c.employeeName ?? "—",
        employeeId: c.employeeId ?? null,
        campaignPurpose: c.campaignPurpose ?? "",
        campaignType: resolveReportCampaignType({
          entityKind: "campaign",
          campaignPurpose: c.campaignPurpose ?? "",
          status: c.status,
        }),
        status: c.status,
        clicks: p.clicks,
        spend: p.spend,
        revenue: p.revenue,
        profit: p.profit,
        roi: roiFromMetrics(p),
        conversions: p.conversions,
        winners: 0,
        losers: 0,
        totalOffers: 0,
        daysRunning: 0,
        liveAt: null,
      };
    });
}

export function buildBatchReportRows(
  batches: TestingBatch[],
  perfAll: Performance[],
  offersByBatch: Map<number, { winners: number; losers: number; total: number }>,
): ReportEntityRow[] {
  return batches.map((b) => {
    const p = metricsForBatch(b.id, perfAll);
    const oc = offersByBatch.get(b.id) ?? { winners: 0, losers: 0, total: 0 };
    const daysRunning = b.liveAt
      ? Math.floor((Date.now() - new Date(b.liveAt).getTime()) / 86400000)
      : 0;
    return {
      rowKey: `batch:${b.id}`,
      entityKind: "batch" as const,
      id: b.id,
      batchName: b.batchName,
      network: b.affiliateNetwork,
      geo: b.geo,
      trafficSource: b.trafficSource,
      employee: b.employeeName ?? "—",
      employeeId: b.employeeId,
      campaignPurpose: "testing",
      campaignType: "testing",
      status: b.status,
      clicks: p.clicks,
      spend: p.spend,
      revenue: p.revenue,
      profit: p.profit,
      roi: roiFromMetrics(p),
      conversions: p.conversions,
      winners: oc.winners,
      losers: oc.losers,
      totalOffers: oc.total,
      daysRunning,
      liveAt: b.liveAt ?? null,
    };
  });
}

export function buildAllReportEntities(
  batches: TestingBatch[],
  standaloneCampaigns: StandaloneLiveCampaign[],
  perfAll: Performance[],
  offersByBatch: Map<number, { winners: number; losers: number; total: number }>,
): ReportEntityRow[] {
  return [
    ...buildBatchReportRows(batches, perfAll, offersByBatch),
    ...buildStandaloneCampaignRows(standaloneCampaigns, perfAll),
  ];
}

export type ReportEntityFilters = {
  employeeId?: number | "";
  network?: string;
  geo?: string;
  source?: string;
  status?: string;
  campaignType?: string;
};

export function filterReportEntities(
  rows: ReportEntityRow[],
  filters: ReportEntityFilters,
): ReportEntityRow[] {
  return rows.filter((r) => {
    if (filters.employeeId && r.employeeId !== filters.employeeId) return false;
    if (filters.network && r.network !== filters.network) return false;
    if (filters.geo && r.geo !== filters.geo) return false;
    if (filters.source && r.trafficSource !== filters.source) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.campaignType && r.campaignType !== filters.campaignType) return false;
    return true;
  });
}

export type ReportBreakdownItem = { label: string; count: number };

export function aggregateBreakdown(
  rows: ReportEntityRow[],
  field: "network" | "geo",
): ReportBreakdownItem[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const label = (field === "network" ? r.network : r.geo) || "—";
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export type EmployeeOpsRow = {
  employeeId: number;
  name: string;
  campaigns: number;
  testCount: number;
  workingCount: number;
  scalingCount: number;
  closedCount: number;
  reviewCount: number;
  networks: ReportBreakdownItem[];
  geos: ReportBreakdownItem[];
  clicks: number;
  spend: number;
  revenue: number;
  profit: number;
  roi: number;
};

export function buildEmployeeOpsRows(
  entities: ReportEntityRow[],
  employees: { id: number; name: string }[],
): EmployeeOpsRow[] {
  const byEmployee = new Map<number, ReportEntityRow[]>();
  for (const r of entities) {
    if (r.employeeId == null) continue;
    const list = byEmployee.get(r.employeeId) ?? [];
    list.push(r);
    byEmployee.set(r.employeeId, list);
  }

  const nameById = new Map(employees.map((e) => [e.id, e.name]));

  return [...byEmployee.entries()]
    .map(([employeeId, rows]) => {
      const clicks = rows.reduce((a, r) => a + r.clicks, 0);
      const spend = rows.reduce((a, r) => a + r.spend, 0);
      const revenue = rows.reduce((a, r) => a + r.revenue, 0);
      const profit = rows.reduce((a, r) => a + r.profit, 0);
      return {
        employeeId,
        name: nameById.get(employeeId) ?? rows[0]?.employee ?? "—",
        campaigns: rows.length,
        testCount: rows.filter((r) => r.campaignType === "testing").length,
        workingCount: rows.filter((r) => r.campaignType === "working").length,
        scalingCount: rows.filter((r) => r.campaignType === "scaling").length,
        closedCount: rows.filter((r) => r.campaignType === "closed").length,
        reviewCount: rows.filter((r) => r.campaignType === "review").length,
        networks: aggregateBreakdown(rows, "network"),
        geos: aggregateBreakdown(rows, "geo"),
        clicks,
        spend,
        revenue,
        profit,
        roi: spend > 0 ? ((revenue - spend) / spend) * 100 : 0,
      };
    })
    .sort((a, b) => b.campaigns - a.campaigns || a.name.localeCompare(b.name));
}

export function perfMatchesFilteredEntities(
  perfAll: Performance[],
  filtered: ReportEntityRow[],
): boolean {
  if (perfAll.length === 0 || filtered.length === 0) return false;
  const batchIds = new Set(filtered.filter((r) => r.entityKind === "batch").map((r) => r.id));
  const campaignIds = new Set(filtered.filter((r) => r.entityKind === "campaign").map((r) => r.id));
  return perfAll.some((p) => {
    const hasNumbers = Number(p.clicks ?? 0) > 0 || Number(p.spend ?? 0) > 0 || Number(p.revenue ?? 0) > 0;
    if (!hasNumbers) return false;
    if (p.batchId != null && batchIds.has(p.batchId)) return true;
    if (p.campaignId != null && campaignIds.has(p.campaignId)) return true;
    return false;
  });
}

export function buildMasterStringOptions(
  catalogValues: string[],
  ...legacySources: (string | null | undefined)[]
): string[] {
  const set = new Set<string>();
  for (const v of catalogValues) {
    const t = v.trim();
    if (t) set.add(t);
  }
  for (const v of legacySources) {
    const t = (v ?? "").trim();
    if (t) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export type LiveCampaignsListResponse = {
  items: StandaloneLiveCampaign[];
};
