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

export type BreakdownGeoRow = {
  key: string;
  label: string;
  current: number;
  target: number;
  percent: number;
};

export type NetworkBreakdownRow = {
  key: string;
  label: string;
  networkId: string;
  current: number;
  target: number;
  percent: number;
  geos: BreakdownGeoRow[];
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
  networks: NetworkBreakdownRow[];
  /** @deprecated Global GEO breakdown — always empty; use networks[].geos */
  geos: BreakdownGeoRow[];
  items: { name: string; network: string; geo: string; detail?: string }[];
};

/** network name → geo → current value */
type NetworkGeoMap = Map<string, Map<string, number>>;

function progressPct(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

function metricKeyFor(kind: MetricBreakdownKind): ServerWorkerGoalTarget["metricKey"] {
  if (kind === "revenue") return "revenue";
  if (kind === "testing") return "testingBatches";
  return "workingCampaigns";
}

function addNetworkGeo(map: NetworkGeoMap, network: string, geo: string, value: number): void {
  let geoMap = map.get(network);
  if (!geoMap) {
    geoMap = new Map();
    map.set(network, geoMap);
  }
  geoMap.set(geo, (geoMap.get(geo) ?? 0) + value);
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

async function queryRevenueNetworkGeo(
  workspaceId: number,
  range: MetricsDateRange,
  employeeId: number | null,
  allowedNetworkNames?: string[],
): Promise<NetworkGeoMap> {
  const conditions = [eq(testingBatchesTable.workspaceId, workspaceId)];
  if (employeeId != null) {
    conditions.push(eq(testingBatchesTable.employeeId, employeeId));
  }
  if (allowedNetworkNames) {
    if (allowedNetworkNames.length === 0) return new Map();
    conditions.push(inArray(testingBatchesTable.affiliateNetwork, allowedNetworkNames));
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
  const map: NetworkGeoMap = new Map();

  for (const b of batches) {
    const m = metricsByBatch.get(b.batchId);
    if (!m) continue;
    const net = b.network?.trim() || "(unset)";
    const geo = b.geo?.trim() || "(unset)";
    addNetworkGeo(map, net, geo, m.revenue);
  }

  return map;
}

async function queryTestingNetworkGeo(
  workspaceId: number,
  employeeId: number | null,
  allowedNetworkNames?: string[],
): Promise<NetworkGeoMap> {
  const conditions = [
    eq(testingBatchesTable.workspaceId, workspaceId),
    inArray(testingBatchesTable.status, [...ACTIVE_TESTING_STATUSES]),
  ];
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
    const net = r.network?.trim() || "(unset)";
    const geo = r.geo?.trim() || "(unset)";
    addNetworkGeo(map, net, geo, Number(r.count ?? 0));
  }
  return map;
}

async function queryWorkingNetworkGeo(
  workspaceId: number,
  employeeId: number | null,
  allowedNetworkNames?: string[],
): Promise<NetworkGeoMap> {
  const conditions = [
    eq(campaignsTable.workspaceId, workspaceId),
    eq(campaignsTable.status, "live"),
    eq(campaignsTable.campaignPurpose, "working"),
  ];
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

  const map: NetworkGeoMap = new Map();
  for (const r of rows) {
    const net = r.network?.trim() || "(unset)";
    const geo = r.geo?.trim() || "(unset)";
    addNetworkGeo(map, net, geo, Number(r.count ?? 0));
  }
  return map;
}

function buildNetworkBreakdown(
  networkGeoCurrent: NetworkGeoMap,
  goals: ServerWorkerGoalTarget[],
  metricKey: ServerWorkerGoalTarget["metricKey"],
  employeeId: number | null,
): NetworkBreakdownRow[] {
  const networkKeys = new Set<string>();
  for (const net of networkGeoCurrent.keys()) networkKeys.add(net);
  for (const g of goals) {
    if (g.metricKey !== metricKey) continue;
    if (employeeId != null && g.employeeId !== employeeId) continue;
    const net = g.affiliateNetworkName?.trim();
    if (net) networkKeys.add(net);
  }

  return [...networkKeys]
    .filter((k) => k !== "(unset)" || networkGeoCurrent.has(k))
    .map((networkKey) => {
      const geoCurrent = networkGeoCurrent.get(networkKey) ?? new Map<string, number>();

      const geoKeys = new Set<string>([...geoCurrent.keys()]);
      for (const g of goals) {
        if (g.metricKey !== metricKey) continue;
        if (employeeId != null && g.employeeId !== employeeId) continue;
        if (g.affiliateNetworkName?.trim() === networkKey && g.geoCode?.trim()) {
          geoKeys.add(g.geoCode.trim());
        }
      }

      const geos: BreakdownGeoRow[] = [...geoKeys]
        .filter((k) => k !== "(unset)" || geoCurrent.get(k))
        .map((geoKey) => {
          const current = geoCurrent.get(geoKey) ?? 0;
          const target = goals
            .filter(
              (g) =>
                g.metricKey === metricKey &&
                g.affiliateNetworkName?.trim() === networkKey &&
                g.geoCode?.trim() === geoKey &&
                (employeeId == null || g.employeeId === employeeId),
            )
            .reduce((s, g) => s + g.monthlyTarget, 0);
          return {
            key: geoKey,
            label: geoKey,
            current,
            target,
            percent: progressPct(current, target),
          };
        })
        .sort((a, b) => b.target - a.target || b.current - a.current || a.label.localeCompare(b.label));

      const current = [...geoCurrent.values()].reduce((s, v) => s + v, 0);
      const networkOnlyTarget = goals
        .filter(
          (g) =>
            g.metricKey === metricKey &&
            g.affiliateNetworkName?.trim() === networkKey &&
            !g.geoCode &&
            (employeeId == null || g.employeeId === employeeId),
        )
        .reduce((s, g) => s + g.monthlyTarget, 0);
      const geoTargetSum = geos.reduce((s, g) => s + g.target, 0);
      const target = networkOnlyTarget > 0 ? networkOnlyTarget : geoTargetSum;

      return {
        key: networkKey,
        label: networkKey,
        networkId: networkKey,
        current,
        target,
        percent: progressPct(current, target),
        geos,
      };
    })
    .filter((n) => n.target > 0 || n.current > 0)
    .sort((a, b) => b.target - a.target || b.current - a.current || a.label.localeCompare(b.label));
}

export async function buildMetricBreakdown(
  workspaceId: number,
  monthKey: string,
  metric: MetricBreakdownKind,
  employeeId: number | null = null,
  allowedNetworkNames?: string[],
): Promise<MetricBreakdownResult> {
  const monthRange = monthKeyToRange(monthKey);
  const range: MetricsDateRange = {
    dateFrom: monthRange.dateFromIso,
    dateTo: monthRange.dateToIso,
  };

  const cfg = await loadGoalsConfig(workspaceId);
  const monthGoals = goalsForMonth(cfg.workerGoalTargets, monthKey);
  const metricKey = metricKeyFor(metric);

  let networkGeo: NetworkGeoMap;
  if (metric === "revenue") {
    networkGeo = await queryRevenueNetworkGeo(workspaceId, range, employeeId, allowedNetworkNames);
  } else if (metric === "testing") {
    networkGeo = await queryTestingNetworkGeo(workspaceId, employeeId, allowedNetworkNames);
  } else {
    networkGeo = await queryWorkingNetworkGeo(workspaceId, employeeId, allowedNetworkNames);
  }

  const totalCurrent = [...networkGeo.values()].reduce(
    (sum, geoMap) => sum + [...geoMap.values()].reduce((s, v) => s + v, 0),
    0,
  );

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

  const networksBuilt = buildNetworkBreakdown(networkGeo, monthGoals, metricKey, employeeId);
  const networks =
    allowedNetworkNames != null
      ? networksBuilt.filter((n) => {
          const allowed = new Set(allowedNetworkNames.map((name) => name.trim()).filter(Boolean));
          return allowed.has(n.key) || allowed.has(n.label);
        })
      : networksBuilt;

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
    if (allowedNetworkNames) {
      if (allowedNetworkNames.length === 0) {
        // skip winner query
      } else {
        winnerConditions.push(inArray(testingBatchesTable.affiliateNetwork, allowedNetworkNames));
      }
    }
    const winners =
      allowedNetworkNames?.length === 0
        ? []
        : await db
            .select({
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
    geos: [],
    items,
  };
}
