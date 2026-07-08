/**
 * Reports → Networks & GEOs — action-oriented standings.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { ReportKpiCardsSkeleton } from "@/components/operational-state/operational-skeletons";
import { formatOpsMetric } from "@/components/operations-hub/ops-v2-metrics";
import { goalKindToUnitLabel } from "@/components/operations-hub/operational-metric-dropdown";
import type { GoalKind } from "@/components/operations-hub/ops-goal-focus";
import {
  buildEmployeeInterventionActionRows,
  buildNetworkGeoActionRowsFromBreakdown,
  type ReportsActionRow,
} from "@/lib/reports/reports-action-rows";
import type { ReportsPeGoalDashboard } from "@/lib/reports/use-reports-pe-goal-dashboard";
import { cn } from "@/lib/utils";
import { DollarSign, FlaskConical, Radio } from "lucide-react";

const METRIC_META: Record<
  GoalKind,
  { label: string; icon: typeof DollarSign; format: "currency" | "count" }
> = {
  revenue: { label: "Revenue", icon: DollarSign, format: "currency" },
  testing: { label: "Testing", icon: FlaskConical, format: "count" },
  working: { label: "Working", icon: Radio, format: "count" },
};

function fmt(value: number, metric: GoalKind): string {
  const format = METRIC_META[metric].format;
  const formatted = formatOpsMetric(value, format);
  if (format === "count") {
    const unit = goalKindToUnitLabel(metric);
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return formatted;
}

function ActionTable({
  title,
  subtitle,
  rows,
  showNetwork,
  showEmployee,
}: {
  title: string;
  subtitle: string;
  rows: ReportsActionRow[];
  showNetwork?: boolean;
  showEmployee?: boolean;
}) {
  const metric = rows[0]?.metric ?? "testing";
  const colSpan = showEmployee ? 9 : showNetwork ? 9 : 8;
  return (
    <Card className="overflow-hidden border border-slate-200/90 shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/90 px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-600">{title}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {showEmployee ? (
                <th className="px-3 py-2 text-left">Employee</th>
              ) : (
                <th className="px-3 py-2 text-left">{showNetwork ? "GEO" : "Network"}</th>
              )}
              {showNetwork && !showEmployee && (
                <th className="px-3 py-2 text-left">Network</th>
              )}
              <th className="px-3 py-2 text-right">Current</th>
              <th className="px-3 py-2 text-right">Target</th>
              <th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-right">Today</th>
              <th className="px-3 py-2 text-right">Gap</th>
              <th className="px-3 py-2 text-right">Progress</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-3 py-6 text-center text-xs text-slate-500">
                  No monthly goals configured for this metric/scope.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key} className="hover:bg-slate-50/80">
                  <td className="px-3 py-2 text-sm font-medium text-slate-900">
                    {showEmployee ? (row.employeeName ?? row.label) : row.label}
                  </td>
                  {showNetwork && !showEmployee && (
                    <td className="max-w-[10rem] px-3 py-2 text-xs text-slate-600">
                      {row.network ?? "—"}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums">
                    {fmt(row.current, metric)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-600">
                    {row.monthlyTarget > 0 ? fmt(row.monthlyTarget, metric) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-600">
                    {row.monthlyTarget > 0 ? fmt(row.expectedByNow, metric) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-600">
                    {row.monthlyTarget > 0 ? fmt(row.todayTarget, metric) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-amber-700">
                    {row.gapToPace > 0 ? fmt(row.gapToPace, metric) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">{row.progressPct}%</td>
                  <td className="px-3 py-2 text-right text-[11px] font-semibold text-slate-800">
                    {row.actionSuggestion}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function ReportsNetworksGeosActionTab({
  dashboard,
}: {
  dashboard: ReportsPeGoalDashboard;
}) {
  const [metric, setMetric] = useState<GoalKind>("testing");
  const {
    peGoals,
    breakdownByMetric,
    isLoading,
    monthKey,
    isAdmin,
    effectiveEmployeeId,
    dashboard: monthlyDash,
  } = dashboard;

  const { networks, geos } = useMemo(
    () =>
      buildNetworkGeoActionRowsFromBreakdown(breakdownByMetric[metric], metric, monthKey),
    [breakdownByMetric, metric, monthKey],
  );

  const employeeRows = useMemo(() => {
    if (!isAdmin || effectiveEmployeeId != null) return [];
    return buildEmployeeInterventionActionRows(monthlyDash?.workers ?? [], monthKey, {
      metrics: [metric],
    });
  }, [isAdmin, effectiveEmployeeId, monthlyDash?.workers, monthKey, metric]);

  if (isLoading || !peGoals) {
    return (
      <div className="space-y-4">
        <ReportKpiCardsSkeleton count={3} />
        <ReportKpiCardsSkeleton count={4} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900">Networks &amp; GEOs — Action Standings</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Where you stand vs monthly goals, expected pace, and what to do next ({monthKey}).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["testing", "working", "revenue"] as const).map((m) => {
          const Icon = METRIC_META[m].icon;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors",
                metric === m
                  ? "border-violet-500 bg-violet-50 text-violet-800"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {METRIC_META[m].label}
            </button>
          );
        })}
      </div>

      {isAdmin && effectiveEmployeeId == null && employeeRows.length > 0 && (
        <ActionTable
          title="Who needs help (by employee)"
          subtitle="Admin all-employees view — biggest worker gaps for this metric."
          rows={employeeRows}
          showEmployee
        />
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ActionTable
          title="By Affiliate Network"
          subtitle="Current · target · expected by now · today target · gap · action."
          rows={networks}
        />
        <ActionTable
          title="By GEO"
          subtitle="Same pacing guidance broken down by Network / GEO."
          rows={geos}
          showNetwork
        />
      </div>
    </div>
  );
}
