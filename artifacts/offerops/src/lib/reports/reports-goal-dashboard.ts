/**
 * Reports Goal Dashboard — drilldown of Operation Hub goals (Revenue, Testing, Working).
 * Uses Reports unified entities + the same KPI target keys as Operation Hub.
 */

import type { KpiTarget } from "@/lib/goals-config";
import {
  evaluatePace,
  gapRemaining,
  OPS_V2_DEMO_FALLBACKS,
  progressPct,
  resolveGeoRevenueTarget,
  resolveKpiTarget,
  resolveNetworkTarget,
} from "@/components/operations-hub/ops-v2-metrics";
import {
  aggregateBreakdown,
  type ReportBreakdownItem,
  type ReportEntityRow,
} from "@/lib/reports/reports-data";

export type GoalRowStatus =
  | "On track"
  | "Behind"
  | "No target"
  | "No data"
  | "Contributing"
  | "Needs volume";

export type GoalSectionSummary = {
  current: number;
  target: number | null;
  targetConfigured: boolean;
  usingFallback: boolean;
  remaining: number | null;
  progressPct: number | null;
  noGoalMessage: string | null;
};

export type GoalEmployeeRow = {
  employeeId: number;
  name: string;
  count: number;
  goal: number | null;
  goalConfigured: boolean;
  progressPct: number | null;
  remaining: number | null;
  topNetwork: string;
  topGeo: string;
  networks: ReportBreakdownItem[];
  geos: ReportBreakdownItem[];
  status: GoalRowStatus;
};

export type GoalNetworkRow = {
  network: string;
  count: number;
  goal: number | null;
  goalConfigured: boolean;
  progressPct: number | null;
  remaining: number | null;
  topGeo: string;
  geos: ReportBreakdownItem[];
  employees: ReportBreakdownItem[];
  status: GoalRowStatus;
};

export type GoalGeoRow = {
  geo: string;
  count: number;
  goal: number | null;
  goalConfigured: boolean;
  progressPct: number | null;
  remaining: number | null;
  topNetwork: string;
  networks: ReportBreakdownItem[];
  employees: ReportBreakdownItem[];
  campaigns: number;
  status: GoalRowStatus;
};

export type GoalSectionModel = {
  summary: GoalSectionSummary;
  employees: GoalEmployeeRow[];
  byNetwork: GoalNetworkRow[];
  byGeo: GoalGeoRow[];
};

export type ReportsGoalDashboardModel = {
  revenue: GoalSectionModel;
  testing: GoalSectionModel;
  working: GoalSectionModel;
};

export function scopeEntitiesForDashboard(
  entities: ReportEntityRow[],
  isAdmin: boolean,
  currentEmployeeId: number | undefined,
): ReportEntityRow[] {
  if (isAdmin || currentEmployeeId == null) return entities;
  return entities.filter((r) => r.employeeId === currentEmployeeId);
}

function topDimension(
  rows: ReportEntityRow[],
  field: "network" | "geo",
  metric: "revenue" | "count",
): string {
  const valueMap = new Map<string, number>();
  for (const r of rows) {
    const label = (field === "network" ? r.network : r.geo) || "—";
    const v = metric === "revenue" ? r.revenue : 1;
    valueMap.set(label, (valueMap.get(label) ?? 0) + v);
  }
  const sorted = [...valueMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return sorted[0]?.[0] ?? "—";
}

function employeeBreakdown(
  rows: ReportEntityRow[],
  field: "network" | "geo",
): ReportBreakdownItem[] {
  return aggregateBreakdown(rows, field);
}

function deriveStatus(
  actual: number,
  target: number | null,
  configured: boolean,
  kind: "revenue" | "count",
): GoalRowStatus {
  if (!configured || target == null) {
    if (actual > 0) return kind === "revenue" ? "Contributing" : "Contributing";
    return "No target";
  }
  if (actual === 0) return "No data";
  const pace = evaluatePace(actual, target);
  if (pace.paceStatus === "Completed" || pace.paceStatus === "On Track") return "On track";
  if (pace.paceStatus === "Behind Pace") return "Behind";
  if (pace.paceStatus === "Watch") {
    if (kind === "count" && actual < target * 0.5) return "Needs volume";
    return "Behind";
  }
  return "On track";
}

function buildSummary(
  current: number,
  kpiKey: string,
  fallback: number,
  kpiTargets: KpiTarget[],
  noGoalMessage: string,
): GoalSectionSummary {
  const resolved = resolveKpiTarget(kpiTargets, kpiKey, fallback);
  const target = resolved.target;
  const targetConfigured = !resolved.usingFallback;
  return {
    current,
    target,
    targetConfigured,
    usingFallback: resolved.usingFallback,
    remaining: target != null ? gapRemaining(current, target) : null,
    progressPct: target != null ? progressPct(current, target) : null,
    noGoalMessage: targetConfigured ? null : noGoalMessage,
  };
}

function buildEmployeeRows(
  entities: ReportEntityRow[],
  employees: { id: number; name: string }[],
  filterType: "all" | "testing" | "working",
  metric: "revenue" | "count",
): GoalEmployeeRow[] {
  const filtered =
    filterType === "all"
      ? entities
      : entities.filter((r) => r.campaignType === filterType);

  const byEmployee = new Map<number, ReportEntityRow[]>();
  for (const r of filtered) {
    if (r.employeeId == null) continue;
    const list = byEmployee.get(r.employeeId) ?? [];
    list.push(r);
    byEmployee.set(r.employeeId, list);
  }

  const nameById = new Map(employees.map((e) => [e.id, e.name]));

  return [...byEmployee.entries()]
    .map(([employeeId, rows]) => {
      const count =
        metric === "revenue"
          ? rows.reduce((a, r) => a + r.revenue, 0)
          : rows.length;
      return {
        employeeId,
        name: nameById.get(employeeId) ?? rows[0]?.employee ?? "—",
        count,
        goal: null,
        goalConfigured: false,
        progressPct: null,
        remaining: null,
        topNetwork: topDimension(rows, "network", metric),
        topGeo: topDimension(rows, "geo", metric),
        networks: employeeBreakdown(rows, "network"),
        geos: employeeBreakdown(rows, "geo"),
        status: deriveStatus(count, null, false, metric === "revenue" ? "revenue" : "count"),
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function buildNetworkRows(
  entities: ReportEntityRow[],
  kpiTargets: KpiTarget[],
  kpiBaseKey: string,
  filterType: "all" | "testing" | "working",
  metric: "revenue" | "count",
): GoalNetworkRow[] {
  const filtered =
    filterType === "all"
      ? entities
      : entities.filter((r) => r.campaignType === filterType);

  const byNetwork = new Map<string, ReportEntityRow[]>();
  for (const r of filtered) {
    const net = r.network || "—";
    const list = byNetwork.get(net) ?? [];
    list.push(r);
    byNetwork.set(net, list);
  }

  return [...byNetwork.entries()]
    .map(([network, rows]) => {
      const count =
        metric === "revenue"
          ? rows.reduce((a, r) => a + r.revenue, 0)
          : rows.length;
      const { target, configured } = resolveNetworkTarget(kpiTargets, kpiBaseKey, network);
      return {
        network,
        count,
        goal: target,
        goalConfigured: configured,
        progressPct: configured && target != null ? progressPct(count, target) : null,
        remaining: configured && target != null ? gapRemaining(count, target) : null,
        topGeo: topDimension(rows, "geo", metric),
        geos: employeeBreakdown(rows, "geo"),
        employees: aggregateEmployeeNames(rows),
        status: deriveStatus(count, target, configured, metric === "revenue" ? "revenue" : "count"),
      };
    })
    .sort((a, b) => b.count - a.count || a.network.localeCompare(b.network));
}

function aggregateEmployeeNames(rows: ReportEntityRow[]): ReportBreakdownItem[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const name = r.employee || "—";
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildGeoRows(
  entities: ReportEntityRow[],
  kpiTargets: KpiTarget[],
  filterType: "all" | "testing" | "working",
  metric: "revenue" | "count",
): GoalGeoRow[] {
  const filtered =
    filterType === "all"
      ? entities
      : entities.filter((r) => r.campaignType === filterType);

  const byGeo = new Map<string, ReportEntityRow[]>();
  for (const r of filtered) {
    const geo = r.geo || "—";
    const list = byGeo.get(geo) ?? [];
    list.push(r);
    byGeo.set(geo, list);
  }

  return [...byGeo.entries()]
    .map(([geo, rows]) => {
      const count =
        metric === "revenue"
          ? rows.reduce((a, r) => a + r.revenue, 0)
          : rows.length;
      const topNetwork = topDimension(rows, "network", metric);
      const { target, configured } =
        metric === "revenue"
          ? resolveGeoRevenueTarget(kpiTargets, geo, topNetwork !== "—" ? topNetwork : undefined)
          : { target: null, configured: false };

      return {
        geo,
        count,
        goal: target,
        goalConfigured: configured,
        progressPct: configured && target != null ? progressPct(count, target) : null,
        remaining: configured && target != null ? gapRemaining(count, target) : null,
        topNetwork,
        networks: employeeBreakdown(rows, "network"),
        employees: aggregateEmployeeNames(rows),
        campaigns: rows.length,
        status: deriveStatus(count, target, configured, metric === "revenue" ? "revenue" : "count"),
      };
    })
    .sort((a, b) => b.count - a.count || a.geo.localeCompare(b.geo));
}

function buildSection(
  entities: ReportEntityRow[],
  employees: { id: number; name: string }[],
  kpiTargets: KpiTarget[],
  options: {
    filterType: "all" | "testing" | "working";
    kpiKey: string;
    kpiBaseKey: string;
    fallback: number;
    metric: "revenue" | "count";
    noGoalMessage: string;
  },
): GoalSectionModel {
  const filtered =
    options.filterType === "all"
      ? entities
      : entities.filter((r) => r.campaignType === options.filterType);

  const current =
    options.metric === "revenue"
      ? filtered.reduce((a, r) => a + r.revenue, 0)
      : filtered.length;

  const summary = buildSummary(
    current,
    options.kpiKey,
    options.fallback,
    kpiTargets,
    options.noGoalMessage,
  );

  return {
    summary,
    employees: buildEmployeeRows(entities, employees, options.filterType, options.metric),
    byNetwork: buildNetworkRows(
      entities,
      kpiTargets,
      options.kpiBaseKey,
      options.filterType,
      options.metric,
    ),
    byGeo: buildGeoRows(entities, kpiTargets, options.filterType, options.metric),
  };
}

export function buildReportsGoalDashboard(
  entities: ReportEntityRow[],
  employees: { id: number; name: string }[],
  kpiTargets: KpiTarget[] | undefined,
): ReportsGoalDashboardModel {
  const safeKpiTargets = kpiTargets ?? [];
  return {
    revenue: buildSection(entities, employees, safeKpiTargets, {
      filterType: "all",
      kpiKey: "revenue",
      kpiBaseKey: "revenue",
      fallback: OPS_V2_DEMO_FALLBACKS.revenue,
      metric: "revenue",
      noGoalMessage: "No revenue goal configured",
    }),
    testing: buildSection(entities, employees, safeKpiTargets, {
      filterType: "testing",
      kpiKey: "testingBatches",
      kpiBaseKey: "testingBatches",
      fallback: OPS_V2_DEMO_FALLBACKS.testingBatches,
      metric: "count",
      noGoalMessage: "No testing pipeline goal configured",
    }),
    working: buildSection(entities, employees, safeKpiTargets, {
      filterType: "working",
      kpiKey: "workingCampaigns",
      kpiBaseKey: "workingCampaigns",
      fallback: OPS_V2_DEMO_FALLBACKS.workingCampaigns,
      metric: "count",
      noGoalMessage: "No working campaigns goal configured",
    }),
  };
}
