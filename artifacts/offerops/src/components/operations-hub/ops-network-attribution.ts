/**
 * Single source of truth for affiliate network / GEO attribution across Ops Hub views.
 */

import type { OpsCampaignRow } from "@/components/operations-hub/ops-hub-drilldown-data";

export type OpsPerformanceRow = {
  batchId: number | null;
  campaignId?: number | null;
  revenue?: number | null;
  spend?: number | null;
  profit?: number | null;
  conversions?: number | null;
  clicks?: number | null;
  date?: string;
  id?: number;
};

export function normNetworkName(network: string | null | undefined): string {
  return network?.trim() || "(unset)";
}

export function normGeoName(geo: string | null | undefined): string {
  return geo?.trim() || "(unset)";
}

/** Resolve affiliate network: campaign affiliate_network_id name, then batch network. */
export function resolveAffiliateNetwork(c: {
  affiliateNetworkName?: string | null;
  batchAffiliateNetwork?: string | null;
}): string {
  const fromCampaign = c.affiliateNetworkName?.trim();
  if (fromCampaign) return fromCampaign;
  const fromBatch = c.batchAffiliateNetwork?.trim();
  if (fromBatch) return fromBatch;
  return "(unset)";
}

export function resolveCampaignGeo(c: {
  geo?: string | null;
  batchGeo?: string | null;
}): string {
  return normGeoName(c.geo ?? c.batchGeo);
}

export function networkMatches(
  value: string | null | undefined,
  network: string,
): boolean {
  return (value?.trim() || "").toLowerCase() === network.trim().toLowerCase();
}

export function campaignMatchesNetwork(c: OpsCampaignRow, network: string): boolean {
  return networkMatches(resolveAffiliateNetwork(c), network);
}

export function buildBatchMeta(
  batches: { id: number; affiliateNetwork: string; geo: string }[],
): Map<number, { network: string; geo: string }> {
  return new Map(
    batches.map((b) => [
      b.id,
      { network: normNetworkName(b.affiliateNetwork), geo: normGeoName(b.geo) },
    ]),
  );
}

export function buildCampaignByIdMap(
  campaigns: OpsCampaignRow[],
): Map<number, OpsCampaignRow> {
  const map = new Map<number, OpsCampaignRow>();
  for (const c of campaigns) {
    if (c.id != null) map.set(c.id, c);
  }
  return map;
}

export function resolvePerfAttribution(
  perf: OpsPerformanceRow,
  campaignsById: Map<number, OpsCampaignRow>,
  batchMeta: Map<number, { network: string; geo: string }>,
): { network: string; geo: string } | null {
  if (perf.campaignId != null) {
    const campaign = campaignsById.get(perf.campaignId);
    if (campaign) {
      return {
        network: resolveAffiliateNetwork(campaign),
        geo: resolveCampaignGeo(campaign),
      };
    }
  }
  if (perf.batchId != null) {
    return batchMeta.get(perf.batchId) ?? null;
  }
  return null;
}

export function perfMatchesNetwork(
  perf: OpsPerformanceRow,
  network: string,
  campaignsById: Map<number, OpsCampaignRow>,
  batchMeta: Map<number, { network: string; geo: string }>,
): boolean {
  const attr = resolvePerfAttribution(perf, campaignsById, batchMeta);
  if (!attr) return false;
  return networkMatches(attr.network, network);
}

export function filterPerfByNetwork(
  perf: OpsPerformanceRow[],
  network: string,
  campaignsById: Map<number, OpsCampaignRow>,
  batchMeta: Map<number, { network: string; geo: string }>,
): OpsPerformanceRow[] {
  return perf.filter((p) => perfMatchesNetwork(p, network, campaignsById, batchMeta));
}

/** When /performance omits campaignId on production rows, infer the sole live campaign. */
export function normalizePerfRows(
  perfRecords: OpsPerformanceRow[],
  campaigns: OpsCampaignRow[],
): OpsPerformanceRow[] {
  const needsFix = perfRecords.some(
    (r) =>
      r.campaignId == null &&
      r.batchId == null &&
      Number(r.revenue ?? 0) !== 0,
  );
  if (!needsFix) return perfRecords;

  const withIds = campaigns.filter((c) => c.id != null);
  if (withIds.length !== 1) return perfRecords;

  const onlyId = withIds[0]!.id!;
  return perfRecords.map((r) =>
    r.campaignId == null && r.batchId == null ? { ...r, campaignId: onlyId } : r,
  );
}

export function enrichCampaignRows(
  campaigns: OpsCampaignRow[],
  networkNameById: Map<number, string>,
): OpsCampaignRow[] {
  return campaigns.map((c) => {
    if (c.affiliateNetworkName?.trim()) return c;
    const networkId = c.affiliateNetworkId;
    if (networkId == null) return c;
    const name = networkNameById.get(networkId);
    if (!name) return c;
    return {
      ...c,
      affiliateNetworkName: name,
      batchAffiliateNetwork: c.batchAffiliateNetwork ?? name,
    };
  });
}

export function sumAttributedRevenue(
  perfRecords: OpsPerformanceRow[],
  campaigns: OpsCampaignRow[],
  batches: { id: number; affiliateNetwork: string; geo: string }[],
): number {
  const batchMeta = buildBatchMeta(batches);
  const campaignsById = buildCampaignByIdMap(campaigns);
  let total = 0;
  for (const row of perfRecords) {
    if (resolvePerfAttribution(row, campaignsById, batchMeta)) {
      total += Number(row.revenue ?? 0);
    }
  }
  return total;
}
