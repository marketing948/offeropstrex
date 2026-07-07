import { and, eq, gte, inArray, lt, lte, sql, sum, type SQL } from "drizzle-orm";
import {
  affiliateNetworksTable,
  batchResultsTable,
  campaignDailyMetricsTable,
  campaignsTable,
  db,
  employeesTable,
  testingBatchesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import {
  affiliateNetworkAttributionJoin,
  batchAttributionJoin,
  canonicalCampaignEmployeeId,
  canonicalCampaignGeoCode,
  canonicalCampaignNetworkName,
  canonicalCampaignTrafficSource,
  campaignMetricsJoin,
  trafficSourceAttributionJoin,
} from "./canonical-campaign-actuals.ts";
import {
  totalsFromSums,
  type AggregatedMetricTotals,
  type MetricsDateRange,
} from "./campaign-daily-metrics-math.ts";

export {
  getTodayIso,
  getWeekStartIso,
  resolveMetricsDateRange,
  totalsFromSums,
} from "./campaign-daily-metrics-math.ts";
export type { AggregatedMetricTotals, MetricsDateRange };

export type MetricsAggregateFilters = MetricsDateRange & {
  workspaceId: number;
  batchId?: number;
  employeeId?: number;
  geo?: string;
  affiliateNetwork?: string;
  trafficSource?: string;
  /** Worker scope: restrict to these affiliate network names (batch column). */
  allowedAffiliateNetworkNames?: string[];
};

export type PerformanceListRow = {
  id: number;
  campaignId: number;
  batchId: number | null;
  campaignName: string;
  employeeId: number | null;
  affiliateNetwork: string;
  geo: string;
  trafficSource: string;
  date: string;
  spend: number;
  clicks: number;
  conversions: number;
  revenue: number;
  profit: number;
  roi: number | null;
  cpa: number | null;
  epc: number | null;
  cvr: number | null;
};

export type BatchMetricsBucket = {
  batchId: number;
  visits: number;
  conversions: number;
  cost: number;
  revenue: number;
};

function metricFilterConditions(filters: MetricsAggregateFilters): SQL[] {
  const conditions: SQL[] = [
    eq(campaignDailyMetricsTable.workspaceId, filters.workspaceId),
    eq(campaignsTable.workspaceId, filters.workspaceId),
    gte(campaignDailyMetricsTable.date, filters.dateFrom),
    lte(campaignDailyMetricsTable.date, filters.dateTo),
  ];

  if (filters.batchId != null) {
    conditions.push(eq(campaignsTable.batchId, filters.batchId));
  }
  if (filters.employeeId != null) {
    conditions.push(sql`${canonicalCampaignEmployeeId} = ${filters.employeeId}`);
  }
  if (filters.geo) {
    conditions.push(sql`${canonicalCampaignGeoCode} = ${filters.geo}`);
  }
  if (filters.affiliateNetwork) {
    conditions.push(sql`${canonicalCampaignNetworkName} = ${filters.affiliateNetwork}`);
  }
  if (filters.trafficSource) {
    conditions.push(sql`${canonicalCampaignTrafficSource} = ${filters.trafficSource}`);
  }
  if (filters.allowedAffiliateNetworkNames) {
    if (filters.allowedAffiliateNetworkNames.length === 0) {
      conditions.push(sql`1 = 0`);
    } else {
      conditions.push(inArray(canonicalCampaignNetworkName, filters.allowedAffiliateNetworkNames));
    }
  }

  return conditions;
}

function metricsAttributionJoins(workspaceId: number) {
  return {
    batch: batchAttributionJoin(workspaceId),
    network: affiliateNetworkAttributionJoin(),
    trafficSource: trafficSourceAttributionJoin(),
  };
}

export type CampaignMetricRangeTotals = {
  campaignId: number;
  visits: number;
  conversions: number;
  cost: number;
  revenue: number;
  profit: number;
  roi: number | null;
  epc: number | null;
};

/** Per-campaign summed metrics over an inclusive date range. */
export async function queryCampaignMetricTotalsMap(
  workspaceId: number,
  range: MetricsDateRange,
  campaignIds: number[],
): Promise<Map<number, CampaignMetricRangeTotals>> {
  const map = new Map<number, CampaignMetricRangeTotals>();
  if (campaignIds.length === 0) return map;

  const rows = await db
    .select({
      campaignId: campaignDailyMetricsTable.campaignId,
      visits: sum(campaignDailyMetricsTable.visits),
      conversions: sum(campaignDailyMetricsTable.conversions),
      cost: sum(campaignDailyMetricsTable.cost),
      revenue: sum(campaignDailyMetricsTable.revenue),
    })
    .from(campaignDailyMetricsTable)
    .where(
      and(
        eq(campaignDailyMetricsTable.workspaceId, workspaceId),
        gte(campaignDailyMetricsTable.date, range.dateFrom),
        lte(campaignDailyMetricsTable.date, range.dateTo),
        inArray(campaignDailyMetricsTable.campaignId, campaignIds),
      ),
    )
    .groupBy(campaignDailyMetricsTable.campaignId);

  for (const r of rows) {
    const totals = totalsFromSums(
      Number(r.visits ?? 0),
      Number(r.conversions ?? 0),
      Number(r.cost ?? 0),
      Number(r.revenue ?? 0),
    );
    map.set(r.campaignId, {
      campaignId: r.campaignId,
      ...totals,
    });
  }
  return map;
}

/** Workspace totals from imported daily metrics (metrics.date inclusive). */
export async function queryWorkspaceMetricTotals(
  filters: MetricsAggregateFilters,
): Promise<AggregatedMetricTotals> {
  const [row] = await db
    .select({
      visits: sum(campaignDailyMetricsTable.visits),
      conversions: sum(campaignDailyMetricsTable.conversions),
      cost: sum(campaignDailyMetricsTable.cost),
      revenue: sum(campaignDailyMetricsTable.revenue),
    })
    .from(campaignDailyMetricsTable)
    .innerJoin(campaignsTable, campaignMetricsJoin())
    .leftJoin(testingBatchesTable, metricsAttributionJoins(filters.workspaceId).batch)
    .leftJoin(affiliateNetworksTable, metricsAttributionJoins(filters.workspaceId).network)
    .leftJoin(workspaceTrafficSourcesTable, metricsAttributionJoins(filters.workspaceId).trafficSource)
    .where(and(...metricFilterConditions(filters)));

  return totalsFromSums(
    Number(row?.visits ?? 0),
    Number(row?.conversions ?? 0),
    Number(row?.cost ?? 0),
    Number(row?.revenue ?? 0),
  );
}

/** One performance-shaped row per (campaign_id, metrics.date); visits exposed as clicks. */
export async function queryPerformanceListRows(
  filters: MetricsAggregateFilters,
): Promise<PerformanceListRow[]> {
  const joins = metricsAttributionJoins(filters.workspaceId);
  const rows = await db
    .select({
      campaignId: campaignsTable.id,
      batchId: campaignsTable.batchId,
      campaignName: sql<string>`max(${campaignsTable.campaignName})`,
      employeeId: sql<number | null>`max(${canonicalCampaignEmployeeId})`,
      affiliateNetwork: sql<string>`max(${canonicalCampaignNetworkName})`,
      geo: sql<string>`max(${canonicalCampaignGeoCode})`,
      trafficSource: sql<string>`max(${canonicalCampaignTrafficSource})`,
      date: campaignDailyMetricsTable.date,
      visits: sum(campaignDailyMetricsTable.visits),
      conversions: sum(campaignDailyMetricsTable.conversions),
      cost: sum(campaignDailyMetricsTable.cost),
      revenue: sum(campaignDailyMetricsTable.revenue),
      minId: sql<number>`min(${campaignDailyMetricsTable.id})::int`,
    })
    .from(campaignDailyMetricsTable)
    .innerJoin(campaignsTable, campaignMetricsJoin())
    .leftJoin(testingBatchesTable, joins.batch)
    .leftJoin(affiliateNetworksTable, joins.network)
    .leftJoin(workspaceTrafficSourcesTable, joins.trafficSource)
    .where(and(...metricFilterConditions(filters)))
    .groupBy(campaignsTable.id, campaignsTable.batchId, campaignDailyMetricsTable.date)
    .orderBy(campaignDailyMetricsTable.date, campaignsTable.id);

  return rows.map((r) => {
    const cost = Number(r.cost ?? 0);
    const revenue = Number(r.revenue ?? 0);
    const visits = Number(r.visits ?? 0);
    const conversions = Number(r.conversions ?? 0);
    const profit = revenue - cost;
    const roi = cost > 0 ? profit / cost : null;
    const clicks = visits;
    return {
      id: Number(r.minId ?? 0),
      campaignId: r.campaignId,
      batchId: r.batchId,
      campaignName: String(r.campaignName ?? `Campaign #${r.campaignId}`),
      employeeId: r.employeeId != null ? Number(r.employeeId) : null,
      affiliateNetwork: String(r.affiliateNetwork ?? "(unset)"),
      geo: String(r.geo ?? "(unset)"),
      trafficSource: String(r.trafficSource ?? "(unset)"),
      date: String(r.date),
      spend: cost,
      clicks,
      conversions,
      revenue,
      profit,
      roi,
      cpa: conversions > 0 ? cost / conversions : null,
      epc: clicks > 0 ? revenue / clicks : null,
      cvr: clicks > 0 ? (conversions / clicks) * 100 : null,
    };
  });
}

/** Per-batch totals over the date range (batch_id required on campaign). */
export async function queryBatchMetricTotalsMap(
  workspaceId: number,
  range: MetricsDateRange,
): Promise<Map<number, BatchMetricsBucket>> {
  const rows = await db
    .select({
      batchId: campaignsTable.batchId,
      visits: sum(campaignDailyMetricsTable.visits),
      conversions: sum(campaignDailyMetricsTable.conversions),
      cost: sum(campaignDailyMetricsTable.cost),
      revenue: sum(campaignDailyMetricsTable.revenue),
    })
    .from(campaignDailyMetricsTable)
    .innerJoin(campaignsTable, campaignMetricsJoin())
    .where(
      and(
        eq(campaignDailyMetricsTable.workspaceId, workspaceId),
        eq(campaignsTable.workspaceId, workspaceId),
        gte(campaignDailyMetricsTable.date, range.dateFrom),
        lte(campaignDailyMetricsTable.date, range.dateTo),
        sql`${campaignsTable.batchId} IS NOT NULL`,
      ),
    )
    .groupBy(campaignsTable.batchId);

  const map = new Map<number, BatchMetricsBucket>();
  for (const r of rows) {
    if (r.batchId == null) continue;
    map.set(r.batchId, {
      batchId: r.batchId,
      visits: Number(r.visits ?? 0),
      conversions: Number(r.conversions ?? 0),
      cost: Number(r.cost ?? 0),
      revenue: Number(r.revenue ?? 0),
    });
  }
  return map;
}

export type BreakdownBucketRow = {
  key: string;
  label: string;
  batches: number;
  tested: number;
  clicks: number;
  cost: number;
  revenue: number;
  profit: number;
  roi: number;
  conversions: number;
  winners: number;
};

export type DashboardBreakdownsResult = {
  byWorker: BreakdownBucketRow[];
  byTrafficSource: BreakdownBucketRow[];
  byGeo: BreakdownBucketRow[];
  byNetwork: BreakdownBucketRow[];
};

async function queryBatchWinnersInRange(
  workspaceId: number,
  range: MetricsDateRange,
): Promise<Map<number, number>> {
  const periodStart = new Date(`${range.dateFrom}T00:00:00.000Z`);
  const periodEndExclusive = new Date(`${range.dateTo}T00:00:00.000Z`);
  periodEndExclusive.setUTCDate(periodEndExclusive.getUTCDate() + 1);

  const rows = await db
    .select({
      batchId: batchResultsTable.batchId,
      winners: sum(batchResultsTable.winnersCount),
    })
    .from(batchResultsTable)
    .where(
      and(
        eq(batchResultsTable.workspaceId, workspaceId),
        gte(batchResultsTable.createdAt, periodStart),
        lt(batchResultsTable.createdAt, periodEndExclusive),
      ),
    )
    .groupBy(batchResultsTable.batchId);

  const map = new Map<number, number>();
  for (const r of rows) {
    map.set(r.batchId, Number(r.winners ?? 0));
  }
  return map;
}

export type DashboardBreakdownScope = {
  employeeId?: number;
  allowedNetworkNames?: string[];
};

const EMPTY_BREAKDOWNS: DashboardBreakdownsResult = {
  byWorker: [],
  byTrafficSource: [],
  byGeo: [],
  byNetwork: [],
};

export async function queryDashboardBreakdowns(
  workspaceId: number,
  range: MetricsDateRange,
  scope?: DashboardBreakdownScope,
): Promise<DashboardBreakdownsResult> {
  if (scope?.allowedNetworkNames && scope.allowedNetworkNames.length === 0) {
    return EMPTY_BREAKDOWNS;
  }

  const filters: MetricsAggregateFilters = {
    workspaceId,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    employeeId: scope?.employeeId,
    allowedAffiliateNetworkNames: scope?.allowedNetworkNames,
  };

  const [metricRows, winnersByBatch, batchMeta] = await Promise.all([
    queryPerformanceListRows(filters),
    queryBatchWinnersInRange(workspaceId, range),
    db
      .select({
        batchId: testingBatchesTable.id,
        employeeId: testingBatchesTable.employeeId,
        employeeName: employeesTable.name,
        trafficSource: testingBatchesTable.trafficSource,
        geo: testingBatchesTable.geo,
        affiliateNetwork: testingBatchesTable.affiliateNetwork,
      })
      .from(testingBatchesTable)
      .leftJoin(employeesTable, eq(testingBatchesTable.employeeId, employeesTable.id))
      .where(eq(testingBatchesTable.workspaceId, workspaceId)),
  ]);

  const employeeNames = new Map<number, string>();
  for (const b of batchMeta) {
    if (b.employeeId != null) {
      employeeNames.set(b.employeeId, b.employeeName ?? `Employee #${b.employeeId}`);
    }
  }
  const metricEmployeeIds = [
    ...new Set(metricRows.map((r) => r.employeeId).filter((id): id is number => id != null)),
  ];
  if (metricEmployeeIds.length > 0) {
    const employees = await db
      .select({ id: employeesTable.id, name: employeesTable.name })
      .from(employeesTable)
      .where(inArray(employeesTable.id, metricEmployeeIds));
    for (const e of employees) {
      employeeNames.set(e.id, e.name);
    }
  }

  const byWorker = new Map<string, BreakdownBucketRow>();
  const byTrafficSource = new Map<string, BreakdownBucketRow>();
  const byGeo = new Map<string, BreakdownBucketRow>();
  const byNetwork = new Map<string, BreakdownBucketRow>();
  const campaignsSeenByBucket = new Map<string, Set<number>>();

  function makeBucket(key: string, label: string): BreakdownBucketRow {
    return {
      key,
      label,
      batches: 0,
      tested: 0,
      clicks: 0,
      cost: 0,
      revenue: 0,
      profit: 0,
      roi: 0,
      conversions: 0,
      winners: 0,
    };
  }

  function addMetric(
    map: Map<string, BreakdownBucketRow>,
    mapId: string,
    key: string,
    label: string,
    row: PerformanceListRow,
  ): void {
    const bucketKey = `${mapId}:${key}`;
    let b = map.get(key);
    if (!b) {
      b = makeBucket(key, label);
      map.set(key, b);
    }
    let seen = campaignsSeenByBucket.get(bucketKey);
    if (!seen) {
      seen = new Set();
      campaignsSeenByBucket.set(bucketKey, seen);
    }
    if (!seen.has(row.campaignId)) {
      seen.add(row.campaignId);
      b.batches += 1;
    }
    b.tested += 1;
    b.clicks += row.clicks;
    b.cost += row.spend;
    b.revenue += row.revenue;
    b.conversions += row.conversions;
  }

  for (const row of metricRows) {
    if (row.employeeId != null) {
      const empKey = String(row.employeeId);
      const empLabel = employeeNames.get(row.employeeId) ?? `Employee #${row.employeeId}`;
      addMetric(byWorker, "worker", empKey, empLabel, row);
    }

    const trafficKey = row.trafficSource?.trim() || "(unset)";
    addMetric(byTrafficSource, "traffic", trafficKey, trafficKey, row);

    const geoKey = row.geo?.trim() || "(unset)";
    addMetric(byGeo, "geo", geoKey, geoKey, row);

    const networkKey = row.affiliateNetwork?.trim() || "(unset)";
    addMetric(byNetwork, "network", networkKey, networkKey, row);
  }

  for (const b of batchMeta) {
    const winners = winnersByBatch.get(b.batchId) ?? 0;
    if (winners <= 0) continue;

    const workerKey = String(b.employeeId);
    const workerLabel = b.employeeName ?? `Employee #${b.employeeId}`;
    let workerBucket = byWorker.get(workerKey);
    if (!workerBucket) {
      workerBucket = makeBucket(workerKey, workerLabel);
      byWorker.set(workerKey, workerBucket);
    }
    workerBucket.winners += winners;

    const networkKey = b.affiliateNetwork?.trim() || "(unset)";
    let networkBucket = byNetwork.get(networkKey);
    if (!networkBucket) {
      networkBucket = makeBucket(networkKey, networkKey);
      byNetwork.set(networkKey, networkBucket);
    }
    networkBucket.winners += winners;

    const geoKey = b.geo?.trim() || "(unset)";
    let geoBucket = byGeo.get(geoKey);
    if (!geoBucket) {
      geoBucket = makeBucket(geoKey, geoKey);
      byGeo.set(geoKey, geoBucket);
    }
    geoBucket.winners += winners;
  }

  function finalize(map: Map<string, BreakdownBucketRow>): BreakdownBucketRow[] {
    return Array.from(map.values()).map((row) => {
      const profit = row.revenue - row.cost;
      const roi = row.cost > 0 ? Math.round((profit / row.cost) * 100) : 0;
      return { ...row, profit, roi };
    });
  }

  return {
    byWorker: finalize(byWorker),
    byTrafficSource: finalize(byTrafficSource),
    byGeo: finalize(byGeo),
    byNetwork: finalize(byNetwork),
  };
}
