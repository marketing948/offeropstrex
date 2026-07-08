/**
 * Reports Networks / GEOs action standings — pace + action suggestions.
 * Pure helpers (Node-testable). Uses the same Goal Engine pace helpers as Ops Hub.
 */

import {
  reportsPaceFields,
  suggestReportsAction,
  type GoalKind,
} from "../../components/operations-hub/ops-goal-focus.ts";
import type { MetricBreakdownResult, WorkerMonthlyRow } from "../performance-engine/api.ts";

export type ReportsActionRow = {
  key: string;
  dimension: "network" | "geo" | "employee";
  label: string;
  network?: string;
  geo?: string;
  employeeName?: string;
  employeeId?: number;
  metric: GoalKind;
  current: number;
  monthlyTarget: number;
  expectedByNow: number;
  todayTarget: number;
  gapToPace: number;
  progressPct: number;
  actionSuggestion: string;
};

export type ReportsActionHealthHint = {
  missingOfferCount?: number;
  offTargetCount?: number;
  scalingCount?: number;
};

export function buildReportsActionRow(input: {
  key: string;
  dimension: ReportsActionRow["dimension"];
  label: string;
  metric: GoalKind;
  current: number;
  target: number;
  monthKey: string;
  network?: string;
  geo?: string;
  employeeName?: string;
  employeeId?: number;
  health?: ReportsActionHealthHint;
  now?: Date;
}): ReportsActionRow {
  const pace = reportsPaceFields(input.current, input.target, input.monthKey, input.now);
  const actionSuggestion = suggestReportsAction({
    metric: input.metric,
    current: input.current,
    target: input.target,
    monthKey: input.monthKey,
    missingOfferCount: input.health?.missingOfferCount,
    offTargetCount: input.health?.offTargetCount,
    scalingCount: input.health?.scalingCount,
    now: input.now,
  });
  return {
    key: input.key,
    dimension: input.dimension,
    label: input.label,
    network: input.network,
    geo: input.geo,
    employeeName: input.employeeName,
    employeeId: input.employeeId,
    metric: input.metric,
    current: input.current,
    monthlyTarget: input.target,
    expectedByNow: pace.expectedByNow,
    todayTarget: pace.todayTarget,
    gapToPace: pace.paceGap,
    progressPct: pace.progressPct,
    actionSuggestion,
  };
}

/** Network + GEO action rows from a Performance Engine metric-breakdown. */
export function buildNetworkGeoActionRowsFromBreakdown(
  breakdown: MetricBreakdownResult | undefined,
  metric: GoalKind,
  monthKey: string,
  opts: {
    healthByNetwork?: Map<string, ReportsActionHealthHint>;
    healthByGeo?: Map<string, ReportsActionHealthHint>;
    now?: Date;
  } = {},
): { networks: ReportsActionRow[]; geos: ReportsActionRow[] } {
  const networks: ReportsActionRow[] = [];
  const geos: ReportsActionRow[] = [];
  if (!breakdown) return { networks, geos };

  for (const net of breakdown.networks) {
    if (!(net.target > 0) && !(net.current > 0)) continue;
    networks.push(
      buildReportsActionRow({
        key: `net:${metric}:${net.key}`,
        dimension: "network",
        label: net.label,
        network: net.label,
        metric,
        current: net.current,
        target: net.target,
        monthKey,
        health: opts.healthByNetwork?.get(net.label),
        now: opts.now,
      }),
    );
    for (const g of net.geos ?? []) {
      const configured =
        g.targetSource === "inherited" || g.targetSource === "custom" || g.target > 0;
      if (!configured && !(g.current > 0)) continue;
      geos.push(
        buildReportsActionRow({
          key: `geo:${metric}:${net.key}:${g.key}`,
          dimension: "geo",
          label: g.label,
          network: net.label,
          geo: g.label,
          metric,
          current: g.current,
          target: configured ? g.target : 0,
          monthKey,
          health: opts.healthByGeo?.get(`${net.label}|${g.label}`),
          now: opts.now,
        }),
      );
    }
  }

  networks.sort((a, b) => b.gapToPace - a.gapToPace || a.label.localeCompare(b.label));
  geos.sort((a, b) => b.gapToPace - a.gapToPace || a.label.localeCompare(b.label));
  return { networks, geos };
}

/** Admin all-employees: one action row per worker per metric that has a goal. */
export function buildEmployeeInterventionActionRows(
  workers: WorkerMonthlyRow[],
  monthKey: string,
  opts: {
    healthByEmployee?: Map<number, ReportsActionHealthHint>;
    now?: Date;
    metrics?: GoalKind[];
  } = {},
): ReportsActionRow[] {
  const metrics = opts.metrics ?? (["testing", "working", "revenue"] as GoalKind[]);
  const out: ReportsActionRow[] = [];
  for (const w of workers) {
    const health = opts.healthByEmployee?.get(w.employeeId);
    for (const metric of metrics) {
      const m =
        metric === "revenue" ? w.revenue : metric === "testing" ? w.testing : w.working;
      if (!(m.target > 0)) continue;
      out.push(
        buildReportsActionRow({
          key: `emp:${w.employeeId}:${metric}`,
          dimension: "employee",
          label: w.name,
          employeeName: w.name,
          employeeId: w.employeeId,
          metric,
          current: m.current,
          target: m.target,
          monthKey,
          health,
          now: opts.now,
        }),
      );
    }
  }
  return out.sort(
    (a, b) => b.gapToPace - a.gapToPace || a.label.localeCompare(b.label),
  );
}
