/**
 * Live Campaign Drawer — safe view model adapter (pure, testable).
 *
 * The drawer must never crash on a malformed / partial campaign row. This
 * adapter normalizes exactly the fields the drawer renders into explicit,
 * null-safe values. Missing optionals collapse to `null` (rendered as `—` /
 * `Unknown` / hidden section) — never an exception.
 */

import type { MonitoringCampaign, DailyMetricRow } from "@/components/live-campaigns/live-campaigns-monitoring-table";
import { resolveDisplayRoiPercent, profitFromCostRevenue } from "@/lib/campaign-metrics";
import { normalizeGeoCode } from "@/lib/geo-flag";

export type DrawerCampaignPurpose = "testing" | "working" | "scaling" | "unknown";

export type LiveCampaignDrawerModel = {
  id: number | null;
  name: string;
  status: string;
  statusLabel: string;
  purpose: DrawerCampaignPurpose;
  platform: string;
  employeeName: string | null;
  network: string | null;
  geo: string | null;
  /** Canonical 2-letter GEO code when derivable (else null). */
  geoCode: string | null;
  trafficSourceName: string | null;
  cost: number | null;
  revenue: number | null;
  profit: number | null;
  /** Display ROI percent computed from cost/revenue (stored value as fallback). */
  roiPercent: number | null;
  conversions: number | null;
  clicks: number | null;
  winnersCount: number | null;
  offerCount: number | null;
  liveStartedAt: string | null;
  batchId: number | null;
  batchName: string | null;
  voluumCampaignId: string | null;
  isReviewedToday: boolean;
  /** Optional range performance (from Voluum CSV import) — null when no data. */
  range: {
    visits: number;
    conversions: number;
    cost: number;
    revenue: number;
    profit: number;
    roiPercent: number | null;
  } | null;
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function normalizePurpose(v: unknown): DrawerCampaignPurpose {
  const p = str(v)?.toLowerCase();
  if (p === "testing" || p === "test") return "testing";
  if (p === "working") return "working";
  if (p === "scaling") return "scaling";
  return "unknown";
}

export type DrawerRelatedData = {
  rangeMetrics?: DailyMetricRow | null;
  offerCount?: number | null;
  isReviewedToday?: boolean;
};

/**
 * Build a null-safe drawer view model. Accepts unknown/partial input so a
 * malformed API row degrades gracefully instead of throwing during render.
 */
export function toLiveCampaignDrawerModel(
  campaign: MonitoringCampaign | Record<string, unknown> | null | undefined,
  related: DrawerRelatedData = {},
): LiveCampaignDrawerModel | null {
  if (campaign == null || typeof campaign !== "object") return null;
  const c = campaign as Record<string, unknown>;

  const id = num(c.id);
  const cost = num(c.cost);
  const revenue = num(c.revenue);
  const status = str(c.status) ?? "unknown";
  const geo = str(c.batchGeo) ?? str(c.geo);
  const geoCode = geo ? normalizeGeoCode(geo) || null : null;

  const rangeMetrics = related.rangeMetrics ?? null;
  const range =
    rangeMetrics != null
      ? {
          visits: num(rangeMetrics.visits) ?? 0,
          conversions: num(rangeMetrics.conversions) ?? 0,
          cost: num(rangeMetrics.cost) ?? 0,
          revenue: num(rangeMetrics.revenue) ?? 0,
          profit: profitFromCostRevenue(rangeMetrics.cost, rangeMetrics.revenue),
          roiPercent: resolveDisplayRoiPercent(
            rangeMetrics.cost,
            rangeMetrics.revenue,
            rangeMetrics.roi,
          ),
        }
      : null;

  const offerRaw = num(related.offerCount ?? c.offerCount);

  return {
    id: id != null && Number.isInteger(id) ? id : null,
    name: str(c.campaignName) ?? (id != null ? `Campaign #${id}` : "Campaign"),
    status,
    statusLabel: status.replace(/_/g, " "),
    purpose: normalizePurpose(c.campaignPurpose),
    platform: str(c.platform) ?? "unknown",
    employeeName: str(c.employeeName),
    network: str(c.batchAffiliateNetwork) ?? str(c.affiliateNetworkName),
    geo,
    geoCode,
    trafficSourceName: str(c.trafficSourceName),
    cost,
    revenue,
    profit: cost != null || revenue != null ? profitFromCostRevenue(cost, revenue) : null,
    roiPercent: resolveDisplayRoiPercent(cost, revenue, c.roi as number | string | null | undefined),
    conversions: num(c.conversions),
    clicks: num(c.clicks),
    winnersCount: num(c.winnersCount),
    offerCount: offerRaw != null && offerRaw > 0 ? Math.round(offerRaw) : null,
    liveStartedAt: str(c.liveStartedAt),
    batchId: num(c.batchId) != null ? Math.round(num(c.batchId)!) : null,
    batchName: str(c.batchName),
    voluumCampaignId: str(c.voluumCampaignId),
    isReviewedToday: Boolean(related.isReviewedToday),
    range,
  };
}
