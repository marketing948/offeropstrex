import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportKpiCardsSkeleton } from "@/components/operational-state/operational-skeletons";
import { fmtReportMoney } from "@/components/reports/reports-analytics";
import { evaluatePace, gapRemaining, progressPct } from "@/components/operations-hub/ops-v2-metrics";
import { goalKindToUnitLabel } from "@/components/operations-hub/operational-metric-dropdown";
import type { MetricBreakdownKind, MetricBreakdownResult } from "@/lib/performance-engine/api";
import type { PeGoalsTriple } from "@/lib/performance-engine/pe-goals";
import type { ReportsPeGoalDashboard } from "@/lib/reports/use-reports-pe-goal-dashboard";
import { cn } from "@/lib/utils";
import { DollarSign, FlaskConical, Radio } from "lucide-react";

type GoalMetric = MetricBreakdownKind;

const METRIC_META: Record<
  GoalMetric,
  { label: string; icon: typeof DollarSign; accent: string; format: "currency" | "count" }
> = {
  revenue: {
    label: "Revenue",
    icon: DollarSign,
    accent: "border-emerald-500 bg-emerald-50/50",
    format: "currency",
  },
  testing: {
    label: "Testing Pipeline",
    icon: FlaskConical,
    accent: "border-violet-500 bg-violet-50/50",
    format: "count",
  },
  working: {
    label: "Working Campaigns",
    icon: Radio,
    accent: "border-orange-500 bg-orange-50/50",
    format: "count",
  },
};

function unitForMetric(metric: GoalMetric): string | undefined {
  if (metric === "revenue") return undefined;
  return goalKindToUnitLabel(metric);
}

function peMetric(peGoals: PeGoalsTriple, metric: GoalMetric) {
  if (metric === "revenue") return peGoals.revenue;
  if (metric === "testing") return peGoals.testing;
  return peGoals.working;
}

function fmtValue(value: number, format: "currency" | "count", unitLabel?: string) {
  if (format === "currency") return fmtReportMoney(value);
  return unitLabel ? `${value} ${unitLabel}` : String(value);
}

function GoalPerformanceCard({
  metric,
  current,
  target,
  selected,
  onSelect,
}: {
  metric: GoalMetric;
  current: number;
  target: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = METRIC_META[metric];
  const Icon = meta.icon;
  const unitLabel = unitForMetric(metric);
  const pct = target > 0 ? progressPct(current, target) : 0;
  const remaining = target > 0 ? gapRemaining(current, target) : 0;
  const pace = evaluatePace(current, target);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col rounded-xl border-2 bg-white p-4 text-left shadow-sm transition-all hover:shadow-md",
        selected ? `ring-2 ring-offset-1 ${meta.accent}` : "border-slate-200",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", meta.accent)}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-bold uppercase tracking-wide text-slate-600">{meta.label}</span>
      </div>
      <p className="mt-3 text-2xl font-black tabular-nums text-slate-900">
        {fmtValue(current, meta.format, unitLabel)}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        Target {target > 0 ? fmtValue(target, meta.format, unitLabel) : "Not configured"}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-slate-400 to-slate-600"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
        <span>{target > 0 ? `${pct}%` : "—"}</span>
        <span>{target > 0 ? `${fmtValue(remaining, meta.format, unitLabel)} left` : pace.paceStatus}</span>
      </div>
    </button>
  );
}

function geoTargetConfigured(
  target: number,
  targetSource?: "inherited" | "custom" | "none",
): boolean {
  return targetSource === "inherited" || targetSource === "custom" || target > 0;
}

function BreakdownTables({
  metric,
  breakdown,
}: {
  metric: GoalMetric;
  breakdown: MetricBreakdownResult | undefined;
}) {
  const meta = METRIC_META[metric];
  const unitLabel = unitForMetric(metric);
  const networks = breakdown?.networks ?? [];
  const geos = networks.flatMap((n) => n.geos.map((g) => ({ ...g, network: n.label })));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="overflow-hidden border border-slate-200/90 shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/90 px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-600">By Affiliate Network</p>
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 text-left">Network</th>
                <th className="px-3 py-2 text-right">Current</th>
                <th className="px-3 py-2 text-right">Target</th>
                <th className="px-3 py-2 text-right">Progress</th>
                <th className="px-3 py-2 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {networks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-500">
                    No network activity this month.
                  </td>
                </tr>
              ) : (
                networks.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-50/80">
                    <td className="max-w-[12rem] px-3 py-2 align-top">
                      <p className="line-clamp-2 text-sm font-medium text-slate-900" title={row.label}>
                        {row.label}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold">
                      {fmtValue(row.current, meta.format, unitLabel)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-600">
                      {row.target > 0 ? fmtValue(row.target, meta.format, unitLabel) : "No network target"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">
                      {row.target > 0 ? `${row.percent}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-600">
                      {row.target > 0 ? fmtValue(gapRemaining(row.current, row.target), meta.format, unitLabel) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden border border-slate-200/90 shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/90 px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-600">By GEO</p>
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 text-left">GEO</th>
                <th className="px-3 py-2 text-left">Network</th>
                <th className="px-3 py-2 text-right">Current</th>
                <th className="px-3 py-2 text-right">Target</th>
                <th className="px-3 py-2 text-right">Progress</th>
                <th className="px-3 py-2 text-right">Remaining</th>
                <th className="px-3 py-2 text-left">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {geos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-500">
                    No GEO targets configured for this metric.
                  </td>
                </tr>
              ) : (
                geos.map((row) => {
                  const configured = geoTargetConfigured(row.target, row.targetSource);
                  return (
                  <tr key={`${row.network}-${row.key}`} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 text-sm font-medium text-slate-900">{row.label}</td>
                    <td className="max-w-[10rem] px-3 py-2">
                      <p className="line-clamp-2 text-xs text-slate-600" title={row.network}>
                        {row.network}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold">
                      {fmtValue(row.current, meta.format, unitLabel)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-600">
                      {configured ? fmtValue(row.target, meta.format, unitLabel) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">
                      {configured ? `${row.percent}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-600">
                      {configured
                        ? fmtValue(gapRemaining(row.current, row.target), meta.format, unitLabel)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {row.targetSource === "custom" ? (
                        <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-600">
                          Custom
                        </span>
                      ) : row.targetSource === "inherited" ? (
                        <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                          Inherited
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function ReportsGoalDashboardTab({
  dashboard,
}: {
  dashboard: ReportsPeGoalDashboard;
}) {
  const [selectedMetric, setSelectedMetric] = useState<GoalMetric>("revenue");
  const { isAdmin, peGoals, breakdownByMetric, isLoading, monthKey } = dashboard;

  if (isLoading || !peGoals) {
    return (
      <div className="space-y-5">
        <ReportKpiCardsSkeleton count={3} />
        <ReportKpiCardsSkeleton count={4} />
      </div>
    );
  }

  const summary = breakdownByMetric[selectedMetric]?.summary;
  const totalTarget = summary?.target ?? peMetric(peGoals, selectedMetric).target;
  const totalCurrent = summary?.current ?? peMetric(peGoals, selectedMetric).current;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900">
          {isAdmin ? "Goal Performance" : "My Goal Performance"}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Monthly goals from Performance Engine ({monthKey}) — current vs target with network and GEO breakdown.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(["revenue", "testing", "working"] as const).map((metric) => {
          const m = peMetric(peGoals, metric);
          return (
            <GoalPerformanceCard
              key={metric}
              metric={metric}
              current={m.current}
              target={m.target}
              selected={selectedMetric === metric}
              onSelect={() => setSelectedMetric(metric)}
            />
          );
        })}
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">
            Breakdown · {METRIC_META[selectedMetric].label}
          </h3>
          <p className="text-xs text-slate-500">
            Total {fmtValue(totalCurrent, METRIC_META[selectedMetric].format, unitForMetric(selectedMetric))}
            {totalTarget > 0 && (
              <>
                {" "}
                / {fmtValue(totalTarget, METRIC_META[selectedMetric].format, unitForMetric(selectedMetric))}
                {" "}({summary?.percent ?? progressPct(totalCurrent, totalTarget)}%)
              </>
            )}
          </p>
        </div>
        <BreakdownTables metric={selectedMetric} breakdown={breakdownByMetric[selectedMetric]} />
      </section>
    </div>
  );
}
