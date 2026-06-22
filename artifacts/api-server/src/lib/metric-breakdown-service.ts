import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  campaignWinnersTable,
  campaignsTable,
  db,
  testingBatchesTable,
} from "@workspace/db";
import {
  queryBatchMetricTotalsMap,
  type MetricsDateRange,
} from "./campaign-daily-metrics-aggregate.ts";
import { monthKeyToRange } from "./xp-award-service.ts";
import { goalsForMonth, loadGoalsConfig, type ServerWorkerGoalTarget } from "./goals-config-server.ts";

const ACTIVE_TESTING_STATUSES = [
  "NEW_BATCH",
  "WAITING_FOR_TRACKER_CAMPAIGNS",
  "OFFER_READY_FOR_LIVE_TESTING",
  "LIVE_TESTS",
] as const;

export type MetricBreakdownKind = "revenue" | "testing" | "working";

export type BreakdownRow = {
  key: string;
  label: string;
  current: number;
  target: number;
  percent: number;
};

export type MetricBreakdownResult = {
  metric: MetricBreakdownKind;
  scope: {
    workspaceId: number;
    employeeId: number | null;
    month: string;
  };
  summary: {
    current: number;
    target: number;
    percent: number;
    xpAvailable: number;
  };
  networks: BreakdownRow[];
  geos: BreakdownRow[];
  items: { name: string; network: string; geo: string; detail?: string }[];
};

function progressPct(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

function metricKeyFor(kind: MetricBreakdownKind): ServerWorkerGoalTarget["metricKey"] {
  if (kind === "revenue") return "revenue";
  if (kind === "testing") return "testingBatches";
  return "workingCampaigns";
}

function sumGoalTargets(
  goals: ServerWorkerGoalTarget[],
  metricKey: ServerWorkerGoalTarget["metricKey"],
  employeeId: number | null,
  dim: "network" | "geo" | "total",
  dimValue?: string,
): { target: number; xpAvailable: number } {
  const filtered = goals.filter((g) => {
    if (g.metricKey !== metricKey) return false;
    if (employeeId != null && g.employeeId !== employeeId) return false;
    if (dim === "network") {
      if (!g.affiliateNetworkName) return false;
      if (dimValue && g.affiliateNetworkName !== dimValue) return false;
      return !g.geoCode;
    }
    if (dim === "geo") {
      if (!g.geoCode) return false;
      if (dimValue && g.geoCode !== dimValue) return false;
      return !g.affiliateNetworkName;
    }
    return !g.affiliateNetworkName && !g.geoCode;
  });
  return {
    target: filtered.reduce((s, g) => s + g.monthlyTarget, 0),
    xpAvailable: filtered.reduce((s, g) => s + (g.xpReward ?? 0), 0),
  };
}

async function queryRevenueByNetworkGeo(
  workspaceId: number,
  range: MetricsDateRange,
  employeeId: number | null,
): Promise<{ byNetwork: Map<string, number>; byGeo: Map<string, number> }> {
  const conditions = [eq(testingBatchesTable.workspaceId, workspaceId)];
  if (employeeId != null) {
    conditions.push(eq(testingBatchesTable.employeeId, employeeId));
  }

  const batches = await db
    .select({
      batchId: testingBatchesTable.id,
      network: testingBatchesTable.affiliateNetwork,
      geo: testingBatchesTable.geo,
    })
    .from(testingBatchesTable)
    .where(and(...conditions));

  const metricsByBatch = await queryBatchMetricTotalsMap(workspaceId, range);
  const byNetwork = new Map<string, number>();
  const byGeo = new Map<string, number>();

  for (const b of batches) {
    const m = metricsByBatch.get(b.batchId);
    if (!m) continue;
    const rev = m.revenue;
    const net = b.network?.trim() || "(unset)";
    const geo = b.geo?.trim() || "(unset)";
    byNetwork.set(net, (byNetwork.get(net) ?? 0) + rev);
    byGeo.set(geo, (byGeo.get(geo) ?? 0) + rev);
  }

  return { byNetwork, byGeo };
}

async function queryTestingByNetworkGeo(
  workspaceId: number,
  employeeId: number | null,
): Promise<{ byNetwork: Map<string, number>; byGeo: Map<string, number> }> {
  const conditions = [
    eq(testingBatchesTable.workspaceId, workspaceId),
    inArray(testingBatchesTable.status, [...ACTIVE_TESTING_STATUSES]),
  ];
  if (employeeId != null) {
    conditions.push(eq(testingBatchesTable.employeeId, employeeId));
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

  const byNetwork = new Map<string, number>();
  const byGeo = new Map<string, number>();
  for (const r of rows) {
    const net = r.network?.trim() || "(unset)";
    const geo = r.geo?.trim() || "(unset)";
    const c = Number(r.count ?? 0);
    byNetwork.set(net, (byNetwork.get(net) ?? 0) + c);
    byGeo.set(geo, (byGeo.get(geo) ?? 0) + c);
  }
  return { byNetwork, byGeo };
}

async function queryWorkingByNetworkGeo(
  workspaceId: number,
  employeeId: number | null,
): Promise<{ byNetwork: Map<string, number>; byGeo: Map<string, number> }> {
  const conditions = [
    eq(campaignsTable.workspaceId, workspaceId),
    eq(campaignsTable.status, "live"),
    eq(campaignsTable.campaignPurpose, "working"),
  ];
  if (employeeId != null) {
    conditions.push(eq(testingBatchesTable.employeeId, employeeId));
  }

  const rows = await db
    .select({
      network: testingBatchesTable.affiliateNetwork,
      geo: testingBatchesTable.geo,
      count: sql<number>`count(*)::int`,
    })
    .from(campaignsTable)
    .innerJoin(
      testingBatchesTable,
      and(
        eq(campaignsTable.batchId, testingBatchesTable.id),
        eq(testingBatchesTable.workspaceId, campaignsTable.workspaceId),
      ),
    )
    .where(and(...conditions))
    .groupBy(testingBatchesTable.affiliateNetwork, testingBatchesTable.geo);

  const byNetwork = new Map<string, number>();
  const byGeo = new Map<string, number>();
  for (const r of rows) {
    const net = r.network?.trim() || "(unset)";
    const geo = r.geo?.trim() || "(unset)";
    const c = Number(r.count ?? 0);
    byNetwork.set(net, (byNetwork.get(net) ?? 0) + c);
    byGeo.set(geo, (byGeo.get(geo) ?? 0) + c);
  }
  return { byNetwork, byGeo };
}

function mergeBreakdownRows(
  currentMap: Map<string, number>,
  goals: ServerWorkerGoalTarget[],
  metricKey: ServerWorkerGoalTarget["metricKey"],
  employeeId: number | null,
  dim: "network" | "geo",
): BreakdownRow[] {
  const goalDimKey = dim === "network" ? "affiliateNetworkName" : "geoCode";
  const targetByKey = new Map<string, number>();

  for (const g of goals) {
    if (g.metricKey !== metricKey) continue;
    if (employeeId != null && g.employeeId !== employeeId) continue;
    const key = g[goalDimKey]?.trim();
    if (!key) continue;
    targetByKey.set(key, (targetByKey.get(key) ?? 0) + g.monthlyTarget);
  }

  const keys = new Set([...currentMap.keys(), ...targetByKey.keys()]);
  return [...keys]
    .filter((k) => k !== "(unset)" || currentMap.get(k) || targetByKey.get(k))
    .map((key) => {
      const current = currentMap.get(key) ?? 0;
      const target = targetByKey.get(key) ?? 0;
      return {
        key,
        label: key,
        current,
        target,
        percent: progressPct(current, target),
      };
    })
    .sort((a, b) => b.target - a.target || b.current - a.current || a.label.localeCompare(b.label));
}

export async function buildMetricBreakdown(
  workspaceId: number,
  monthKey: string,
  metric: MetricBreakdownKind,
  employeeId: number | null = null,
): Promise<MetricBreakdownResult> {
  const monthRange = monthKeyToRange(monthKey);
  const range: MetricsDateRange = {
    dateFrom: monthRange.dateFromIso,
    dateTo: monthRange.dateToIso,
  };

  const cfg = await loadGoalsConfig(workspaceId);
  const monthGoals = goalsForMonth(cfg.workerGoalTargets, monthKey);
  const metricKey = metricKeyFor(metric);

  let byNetwork: Map<string, number>;
  let byGeo: Map<string, number>;

  if (metric === "revenue") {
    ({ byNetwork, byGeo } = await queryRevenueByNetworkGeo(workspaceId, range, employeeId));
  } else if (metric === "testing") {
    ({ byNetwork, byGeo } = await queryTestingByNetworkGeo(workspaceId, employeeId));
  } else {
    ({ byNetwork, byGeo } = await queryWorkingByNetworkGeo(workspaceId, employeeId));
  }

  const totalCurrent =
    metric === "revenue"
      ? [...byNetwork.values()].reduce((s, v) => s + v, 0)
      : [...byNetwork.values()].reduce((s, v) => s + v, 0);

  const totalGoals = sumGoalTargets(monthGoals, metricKey, employeeId, "total");
  const scopedTarget =
    totalGoals.target > 0
      ? totalGoals.target
      : monthGoals
          .filter((g) => {
            if (g.metricKey !== metricKey) return false;
            if (employeeId != null && g.employeeId !== employeeId) return false;
            return true;
          })
          .reduce((s, g) => s + g.monthlyTarget, 0);

  const xpAvailable = monthGoals
    .filter((g) => {
      if (g.metricKey !== metricKey) return false;
      if (employeeId != null && g.employeeId !== employeeId) return false;
      return true;
    })
    .reduce((s, g) => s + (g.xpReward ?? 0), 0);

  const networks = mergeBreakdownRows(byNetwork, monthGoals, metricKey, employeeId, "network");
  const geos = mergeBreakdownRows(byGeo, monthGoals, metricKey, employeeId, "geo");

  const items: MetricBreakdownResult["items"] = [];
  if (metric === "revenue" || metric === "working") {
    const winnerConditions = [
      eq(campaignWinnersTable.workspaceId, workspaceId),
      gte(campaignWinnersTable.createdAt, monthRange.dateFrom),
      lt(campaignWinnersTable.createdAt, monthRange.dateToExclusive),
    ];
    if (employeeId != null) {
      winnerConditions.push(eq(testingBatchesTable.employeeId, employeeId));
    }
    const winners = await db
      .select({
        offerId: campaignWinnersTable.offerId,
        campaignId: campaignWinnersTable.campaignId,
        geo: testingBatchesTable.geo,
        network: testingBatchesTable.affiliateNetwork,
        batchName: testingBatchesTable.batchName,
      })
      .from(campaignWinnersTable)
      .innerJoin(campaignsTable, eq(campaignWinnersTable.campaignId, campaignsTable.id))
      .innerJoin(testingBatchesTable, eq(campaignsTable.batchId, testingBatchesTable.id))
      .where(and(...winnerConditions))
      .orderBy(desc(campaignWinnersTable.createdAt))
      .limit(10);
    for (const w of winners) {
      items.push({
        name: w.batchName ?? `Campaign #${w.campaignId}`,
        network: w.network ?? "—",
        geo: w.geo ?? "—",
      });
    }
  }

  return {
    metric,
    scope: { workspaceId, employeeId, month: monthKey },
    summary: {
      current: totalCurrent,
      target: scopedTarget,
      percent: progressPct(totalCurrent, scopedTarget),
      xpAvailable,
    },
    networks,
    geos,
    items,
  };
}
