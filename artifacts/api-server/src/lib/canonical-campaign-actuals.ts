import { and, eq, gte, inArray, lte, sql, sum } from "drizzle-orm";
import {
  affiliateNetworksTable,
  campaignDailyMetricsTable,
  campaignsTable,
  db,
  testingBatchesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import type { MetricsDateRange } from "./campaign-daily-metrics-math.ts";
import type { NetworkGeoMap } from "./goal-effective-targets.ts";
import { monthKeyToRange } from "./xp-award-service.ts";

export const ACTIVE_TESTING_BATCH_STATUSES = [
  "NEW_BATCH",
  "WAITING_FOR_TRACKER_CAMPAIGNS",
  "OFFER_READY_FOR_LIVE_TESTING",
  "LIVE_TESTS",
] as const;

export const WORKING_CAMPAIGN_PURPOSES = ["working", "scaling"] as const;

function addNetworkGeo(map: NetworkGeoMap, network: string, geo: string, value: number): void {
  const net = network.trim() || "(unset)";
  const g = geo.trim() || "(unset)";
  let geoMap = map.get(net);
  if (!geoMap) {
    geoMap = new Map();
    map.set(net, geoMap);
  }
  geoMap.set(g, (geoMap.get(g) ?? 0) + value);
}

/** Employee owner: campaign creator, else batch assignee. */
export const canonicalCampaignEmployeeId = sql<number>`coalesce(${campaignsTable.createdByEmployeeId}, ${testingBatchesTable.employeeId})`;

/** Network label for goal surfaces: campaign network name, else batch text. */
export const canonicalCampaignNetworkName = sql<string>`coalesce(nullif(trim(${affiliateNetworksTable.name}), ''), nullif(trim(${testingBatchesTable.affiliateNetwork}), ''), '(unset)')`;

/** GEO code for goal surfaces: campaign geo, else batch geo. */
export const canonicalCampaignGeoCode = sql<string>`coalesce(nullif(trim(${campaignsTable.geo}), ''), nullif(trim(${testingBatchesTable.geo}), ''), '(unset)')`;

/** Traffic source label: campaign workspace source name, else batch text. */
export const canonicalCampaignTrafficSource = sql<string>`coalesce(nullif(trim(${workspaceTrafficSourcesTable.name}), ''), nullif(trim(${testingBatchesTable.trafficSource}), ''), '(unset)')`;

export function campaignMetricsJoin() {
  return and(
    eq(campaignDailyMetricsTable.campaignId, campaignsTable.id),
    eq(campaignDailyMetricsTable.workspaceId, campaignsTable.workspaceId),
  );
}

export function batchAttributionJoin(workspaceId: number) {
  return and(
    eq(campaignsTable.batchId, testingBatchesTable.id),
    eq(testingBatchesTable.workspaceId, workspaceId),
  );
}

export function affiliateNetworkAttributionJoin() {
  return eq(campaignsTable.affiliateNetworkId, affiliateNetworksTable.id);
}

export function trafficSourceAttributionJoin() {
  return eq(campaignsTable.trafficSourceId, workspaceTrafficSourcesTable.id);
}

/** Metric owner for matched campaigns: creator, else batch assignee. */
export async function resolveCanonicalCampaignOwnerEmployeeId(
  workspaceId: number,
  campaign: Pick<typeof campaignsTable.$inferSelect, "id" | "createdByEmployeeId" | "batchId">,
): Promise<number | null> {
  if (campaign.createdByEmployeeId != null) {
    return campaign.createdByEmployeeId;
  }
  if (campaign.batchId == null) return null;

  const [batch] = await db
    .select({ employeeId: testingBatchesTable.employeeId })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.id, campaign.batchId),
        eq(testingBatchesTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  return batch?.employeeId ?? null;
}

function workingCampaignConditions(workspaceId: number, monthKey?: string) {
  const conditions = [
    eq(campaignsTable.workspaceId, workspaceId),
    eq(campaignsTable.status, "live"),
    inArray(campaignsTable.campaignPurpose, [...WORKING_CAMPAIGN_PURPOSES]),
  ];
  if (monthKey) {
    const range = monthKeyToRange(monthKey);
    conditions.push(gte(campaignsTable.liveStartedAt, new Date(`${range.dateFromIso}T00:00:00.000Z`)));
    conditions.push(lte(campaignsTable.liveStartedAt, new Date(`${range.dateToIso}T23:59:59.999Z`)));
  }
  return conditions;
}

function testingBatchConditions(workspaceId: number, monthKey?: string) {
  const conditions = [
    eq(testingBatchesTable.workspaceId, workspaceId),
    inArray(testingBatchesTable.status, [...ACTIVE_TESTING_BATCH_STATUSES]),
  ];
  if (monthKey) {
    const range = monthKeyToRange(monthKey);
    conditions.push(gte(testingBatchesTable.createdAt, new Date(`${range.dateFromIso}T00:00:00.000Z`)));
    conditions.push(lte(testingBatchesTable.createdAt, new Date(`${range.dateToIso}T23:59:59.999Z`)));
  }
  return conditions;
}

/** Live working/scaling campaigns per employee (manual + batch-linked). */
export async function queryCanonicalWorkingCounts(
  workspaceId: number,
  monthKey?: string,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      employeeId: canonicalCampaignEmployeeId,
      count: sql<number>`count(*)::int`,
    })
    .from(campaignsTable)
    .leftJoin(testingBatchesTable, batchAttributionJoin(workspaceId))
    .where(and(...workingCampaignConditions(workspaceId, monthKey)))
    .groupBy(canonicalCampaignEmployeeId);

  const map = new Map<number, number>();
  for (const r of rows) {
    const employeeId = Number(r.employeeId);
    if (!Number.isFinite(employeeId)) continue;
    map.set(employeeId, Number(r.count ?? 0));
  }
  return map;
}

/** Active testing batches per employee (optionally scoped to creation month). */
export async function queryCanonicalTestingCounts(
  workspaceId: number,
  monthKey?: string,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      employeeId: testingBatchesTable.employeeId,
      count: sql<number>`count(*)::int`,
    })
    .from(testingBatchesTable)
    .where(and(...testingBatchConditions(workspaceId, monthKey)))
    .groupBy(testingBatchesTable.employeeId);

  const map = new Map<number, number>();
  for (const r of rows) map.set(r.employeeId, Number(r.count ?? 0));
  return map;
}

export async function queryCanonicalWorkingNetworkGeo(
  workspaceId: number,
  employeeId: number | null,
  allowedNetworkNames?: string[],
  monthKey?: string,
): Promise<NetworkGeoMap> {
  const conditions = [...workingCampaignConditions(workspaceId, monthKey)];
  if (employeeId != null) {
    conditions.push(sql`${canonicalCampaignEmployeeId} = ${employeeId}`);
  }
  if (allowedNetworkNames) {
    if (allowedNetworkNames.length === 0) return new Map();
    conditions.push(inArray(sql`${canonicalCampaignNetworkName}`, allowedNetworkNames));
  }

  const rows = await db
    .select({
      network: canonicalCampaignNetworkName,
      geo: canonicalCampaignGeoCode,
      count: sql<number>`count(*)::int`,
    })
    .from(campaignsTable)
    .leftJoin(testingBatchesTable, batchAttributionJoin(workspaceId))
    .leftJoin(affiliateNetworksTable, eq(campaignsTable.affiliateNetworkId, affiliateNetworksTable.id))
    .where(and(...conditions))
    .groupBy(canonicalCampaignNetworkName, canonicalCampaignGeoCode);

  const map: NetworkGeoMap = new Map();
  for (const r of rows) {
    addNetworkGeo(map, String(r.network ?? "(unset)"), String(r.geo ?? "(unset)"), Number(r.count ?? 0));
  }
  return map;
}

export async function queryCanonicalTestingNetworkGeo(
  workspaceId: number,
  employeeId: number | null,
  allowedNetworkNames?: string[],
  monthKey?: string,
): Promise<NetworkGeoMap> {
  const conditions = [...testingBatchConditions(workspaceId, monthKey)];
  if (employeeId != null) {
    conditions.push(eq(testingBatchesTable.employeeId, employeeId));
  }
  if (allowedNetworkNames) {
    if (allowedNetworkNames.length === 0) return new Map();
    conditions.push(inArray(testingBatchesTable.affiliateNetwork, allowedNetworkNames));
  }

  const rows = await db
    .select({
      network: testingBatchesTable.affiliateNetwork,
      geo: testingBatchesTable.geo,
      count: sql<number>`count(*)::int`,
    })
    .from(testingBatchesTable)
    .where(and(...conditions))
    .groupBy(testingBatchesTable.affiliateNetwork, testingBatchesTable.geo);

  const map: NetworkGeoMap = new Map();
  for (const r of rows) {
    addNetworkGeo(map, r.network ?? "(unset)", r.geo ?? "(unset)", Number(r.count ?? 0));
  }
  return map;
}

/** Revenue totals per employee from all campaigns (manual + batch-linked). */
export async function queryCanonicalEmployeeRevenue(
  workspaceId: number,
  range: MetricsDateRange,
): Promise<Map<number, { revenue: number; profit: number }>> {
  const rows = await db
    .select({
      employeeId: canonicalCampaignEmployeeId,
      revenue: sum(campaignDailyMetricsTable.revenue),
      cost: sum(campaignDailyMetricsTable.cost),
    })
    .from(campaignDailyMetricsTable)
    .innerJoin(campaignsTable, campaignMetricsJoin())
    .leftJoin(testingBatchesTable, batchAttributionJoin(workspaceId))
    .where(
      and(
        eq(campaignDailyMetricsTable.workspaceId, workspaceId),
        gte(campaignDailyMetricsTable.date, range.dateFrom),
        lte(campaignDailyMetricsTable.date, range.dateTo),
      ),
    )
    .groupBy(canonicalCampaignEmployeeId);

  const map = new Map<number, { revenue: number; profit: number }>();
  for (const r of rows) {
    const employeeId = Number(r.employeeId);
    if (!Number.isFinite(employeeId)) continue;
    const revenue = Number(r.revenue ?? 0);
    const cost = Number(r.cost ?? 0);
    map.set(employeeId, { revenue, profit: revenue - cost });
  }
  return map;
}

/** Revenue current by network/GEO from all campaign metrics. */
export async function queryCanonicalRevenueNetworkGeo(
  workspaceId: number,
  range: MetricsDateRange,
  employeeId: number | null,
  allowedNetworkNames?: string[],
): Promise<NetworkGeoMap> {
  const conditions = [
    eq(campaignDailyMetricsTable.workspaceId, workspaceId),
    gte(campaignDailyMetricsTable.date, range.dateFrom),
    lte(campaignDailyMetricsTable.date, range.dateTo),
  ];
  if (employeeId != null) {
    conditions.push(sql`${canonicalCampaignEmployeeId} = ${employeeId}`);
  }
  if (allowedNetworkNames) {
    if (allowedNetworkNames.length === 0) return new Map();
    conditions.push(inArray(sql`${canonicalCampaignNetworkName}`, allowedNetworkNames));
  }

  const rows = await db
    .select({
      network: canonicalCampaignNetworkName,
      geo: canonicalCampaignGeoCode,
      revenue: sum(campaignDailyMetricsTable.revenue),
    })
    .from(campaignDailyMetricsTable)
    .innerJoin(campaignsTable, campaignMetricsJoin())
    .leftJoin(testingBatchesTable, batchAttributionJoin(workspaceId))
    .leftJoin(affiliateNetworksTable, eq(campaignsTable.affiliateNetworkId, affiliateNetworksTable.id))
    .where(and(...conditions))
    .groupBy(canonicalCampaignNetworkName, canonicalCampaignGeoCode);

  const map: NetworkGeoMap = new Map();
  for (const r of rows) {
    addNetworkGeo(map, String(r.network ?? "(unset)"), String(r.geo ?? "(unset)"), Number(r.revenue ?? 0));
  }
  return map;
}
