/**
 * Operations Hub — metric network breakdown (revenue / testing / working).
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  GoalCardModel,
  GoalKind,
} from "@/components/operations-hub/ops-hub-drilldown-data";
import { progressPct } from "@/components/operations-hub/ops-v2-metrics";
import {
  goalKindToEmptyMessage,
  goalKindToSectionTitle,
  goalKindToUnitLabel,
  goalKindToViewButtonLabel,
} from "@/components/operations-hub/operational-metric-dropdown";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace-context";
import {
  currentMonthKey,
  fetchMetricBreakdown,
  type MetricBreakdownKind,
} from "@/lib/performance-engine/api";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Info,
  Radio,
} from "lucide-react";

type MetricTheme = {
  iconBg: string;
  iconColor: string;
  rowBg: string;
  rowHover: string;
  bar: string;
  barMuted: string;
  geoGuide: string;
  button: string;
  Icon: typeof BarChart3;
};

const METRIC_THEMES: Record<GoalKind, MetricTheme> = {
  revenue: {
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
    rowBg: "bg-emerald-50/60",
    rowHover: "hover:bg-emerald-50",
    bar: "bg-gradient-to-r from-emerald-500 to-green-400",
    barMuted: "bg-slate-300/60",
    geoGuide: "bg-emerald-200/80",
    button: "border-emerald-300 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-50",
    Icon: BarChart3,
  },
  testing: {
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
    rowBg: "bg-violet-50/60",
    rowHover: "hover:bg-violet-50",
    bar: "bg-gradient-to-r from-violet-500 to-purple-400",
    barMuted: "bg-slate-300/60",
    geoGuide: "bg-violet-200/80",
    button: "border-violet-300 bg-violet-50/50 text-violet-700 hover:bg-violet-50",
    Icon: FlaskConical,
  },
  working: {
    iconBg: "bg-orange-100",
    iconColor: "text-orange-600",
    rowBg: "bg-orange-50/60",
    rowHover: "hover:bg-orange-50",
    bar: "bg-gradient-to-r from-orange-500 to-amber-400",
    barMuted: "bg-slate-300/60",
    geoGuide: "bg-orange-200/80",
    button: "border-orange-300 bg-orange-50/50 text-orange-700 hover:bg-orange-50",
    Icon: Radio,
  },
};

function metricKindForGoal(kind: GoalKind): MetricBreakdownKind {
  if (kind === "revenue") return "revenue";
  if (kind === "testing") return "testing";
  return "working";
}

function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function formatActualTarget(
  actual: number,
  target: number | null,
  configured: boolean,
  format: "currency" | "count",
  unitLabel?: string,
) {
  if (format === "currency") {
    if (configured && target != null) {
      return (
        <>
          {fmt$(actual)}
          <span className="font-medium text-slate-400"> / {fmt$(target)}</span>
        </>
      );
    }
    return (
      <>
        {fmt$(actual)}
        <span className="ml-1 text-xs font-medium text-slate-400">· No target configured</span>
      </>
    );
  }

  if (configured && target != null) {
    return (
      <>
        {actual}
        <span className="font-medium text-slate-400"> / {target}</span>
        {unitLabel && <span className="font-medium text-slate-400"> {unitLabel}</span>}
      </>
    );
  }

  return (
    <>
      {actual} active{unitLabel ? ` ${unitLabel}` : ""}
      <span className="ml-1 text-xs font-medium text-slate-400">· No target configured</span>
    </>
  );
}

function geoTargetConfigured(
  target: number,
  targetSource?: "inherited" | "custom" | "none",
): boolean {
  return targetSource === "inherited" || targetSource === "custom" || target > 0;
}

function GeoTargetBadge({ source }: { source?: "inherited" | "custom" | "none" }) {
  if (source === "inherited") {
    return (
      <span className="ml-1.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Inherited
      </span>
    );
  }
  if (source === "custom") {
    return (
      <span className="ml-1.5 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-600">
        Custom
      </span>
    );
  }
  return null;
}

function pctPillClass(pct: number | null, configured: boolean) {
  if (!configured || pct == null) {
    return "bg-slate-100 text-slate-500 border-slate-200";
  }
  if (pct >= 100) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (pct >= 50) return "bg-emerald-50 text-emerald-600 border-emerald-200/80";
  return "bg-amber-50 text-amber-700 border-amber-200/80";
}

function NetworkMetricRow({
  label,
  actual,
  target,
  progressPctValue,
  configured,
  format,
  unitLabel,
  theme,
  expandable,
  expanded,
  onToggle,
}: {
  label: string;
  actual: number;
  target: number | null;
  progressPctValue: number | null;
  configured: boolean;
  format: "currency" | "count";
  unitLabel?: string;
  theme: MetricTheme;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const pct = progressPctValue ?? 0;
  const barWidth = configured && progressPctValue != null ? Math.min(100, pct) : 0;

  return (
    <button
      type="button"
      disabled={!expandable}
      onClick={onToggle}
      className={`w-full rounded-xl px-4 py-4 text-left transition-colors ${theme.rowBg} ${
        expandable ? `cursor-pointer ${theme.rowHover}` : "cursor-default"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${theme.iconColor}`}>
          {expandable ? (
            expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : (
            <span className="w-4" />
          )}
        </span>
        <span className="min-w-0 flex-1 text-base font-bold text-slate-900">{label}</span>
        <span className="shrink-0 text-sm font-bold tabular-nums text-slate-700">
          {formatActualTarget(actual, target, configured, format, unitLabel)}
        </span>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold tabular-nums ${pctPillClass(progressPctValue, configured)}`}
        >
          {configured && progressPctValue != null ? `${Math.round(pct)}%` : "—"}
        </span>
      </div>
      <div className="mt-3 ml-9 h-2 overflow-hidden rounded-full bg-slate-200/70">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            configured ? theme.bar : theme.barMuted
          }`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </button>
  );
}

function GeoMetricRow({
  label,
  actual,
  target,
  progressPctValue,
  configured,
  theme,
  format = "currency",
  targetSource,
}: {
  label: string;
  actual: number;
  target: number | null;
  progressPctValue: number | null;
  configured: boolean;
  theme: MetricTheme;
  format?: "currency" | "count";
  targetSource?: "inherited" | "custom" | "none";
}) {
  const pct = progressPctValue ?? 0;
  const barWidth = configured && progressPctValue != null ? Math.min(100, pct) : 0;

  return (
    <div>
      <div className="flex items-center gap-3 border-t border-slate-100 py-3 pl-6 pr-4">
        <div className={`ml-2 w-0.5 self-stretch rounded-full ${theme.geoGuide}`} aria-hidden />
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 text-sm font-semibold text-slate-700">
          {label}
          <GeoTargetBadge source={targetSource} />
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-600">
          {format === "currency" ? (
            <>
              {fmt$(actual)}
              {configured && target != null && (
                <span className="font-medium text-slate-400"> / {fmt$(target)}</span>
              )}
            </>
          ) : (
            <>
              {actual}
              {configured && target != null && (
                <span className="font-medium text-slate-400"> / {target}</span>
              )}
            </>
          )}
        </span>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${pctPillClass(progressPctValue, configured)}`}
        >
          {configured && progressPctValue != null ? `${Math.round(pct)}%` : "—"}
        </span>
      </div>
      <div className="mb-2 ml-[3.25rem] mr-4 h-1.5 overflow-hidden rounded-full bg-slate-200/60">
        <div
          className={`h-full rounded-full ${configured ? theme.bar : theme.barMuted}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}

export function RevenueByNetworkSection({
  selectedMetric,
  goalCards,
  mtdRevenue,
  attributedRevenueMtd,
  unattributedRevenueMtd,
  loading,
  scopeEmployeeId,
}: {
  selectedMetric: GoalKind | null;
  goalCards: GoalCardModel[];
  mtdRevenue: number;
  attributedRevenueMtd: number;
  unattributedRevenueMtd: number;
  loading?: boolean;
  scopeEmployeeId?: number | "" | null;
}) {
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const isWorker = currentEmployee?.role !== "admin";
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /** Closed until user selects a metric card; open while a metric is selected. */
  const viewOpen = selectedMetric != null;
  const activeMetric: GoalKind = selectedMetric ?? "revenue";

  const breakdownEmployeeId =
    isWorker
      ? currentEmployee!.id
      : scopeEmployeeId !== "" && scopeEmployeeId != null
        ? scopeEmployeeId
        : undefined;

  const breakdownQ = useQuery({
    queryKey: ["ops-metric-breakdown", activeWorkspaceId, activeMetric, breakdownEmployeeId ?? "team", currentMonthKey()],
    enabled: !!activeWorkspaceId && !!currentEmployee && viewOpen,
    staleTime: 60_000,
    queryFn: () =>
      fetchMetricBreakdown(
        activeWorkspaceId!,
        currentMonthKey(),
        metricKindForGoal(activeMetric),
        breakdownEmployeeId,
      ),
  });

  const breakdown = breakdownQ.data;
  const usePeBreakdown = breakdownQ.isSuccess && !!breakdown;

  const activeCard = goalCards.find((c) => c.kind === activeMetric);

  const theme = METRIC_THEMES[activeMetric];
  const SectionIcon = theme.Icon;
  const sectionTitle = goalKindToSectionTitle(activeMetric);
  const viewLabel = goalKindToViewButtonLabel(activeMetric);
  const emptyMessage = goalKindToEmptyMessage(activeMetric);
  const unitLabel = goalKindToUnitLabel(activeMetric);
  const format = activeCard?.format ?? "currency";

  useEffect(() => {
    setExpanded(new Set());
  }, [selectedMetric]);

  if (!viewOpen) {
    return null;
  }

  const breakdownNetworks = breakdown?.networks ?? [];
  const breakdownHasRows = breakdownNetworks.length > 0 || (breakdown?.summary.target ?? 0) > 0;

  function toggleNetwork(network: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(network)) next.delete(network);
      else next.add(network);
      return next;
    });
  }

  const hasRows = usePeBreakdown && breakdownHasRows;

  const summaryTarget = breakdown?.summary.target ?? activeCard?.target ?? null;
  const summaryCurrent = breakdown?.summary.current ?? activeCard?.actual ?? 0;
  const summaryConfigured = (summaryTarget ?? 0) > 0;
  const summaryPct =
    breakdown?.summary.percent ??
    (summaryConfigured && summaryTarget ? progressPct(summaryCurrent, summaryTarget) : null);

  return (
    <section
      className="rounded-[18px] border border-slate-200/80 bg-white p-5 shadow-md shadow-slate-200/40 md:p-6"
      aria-labelledby="ops-metric-network"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${theme.iconBg} ${theme.iconColor}`}
          >
            <SectionIcon className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <div>
            <h2
              id="ops-metric-network"
              className="text-sm font-extrabold uppercase tracking-[0.14em] text-slate-900"
            >
              {sectionTitle}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">Monthly target vs current (MTD)</p>
          </div>
        </div>
        <div
          className={`inline-flex items-center rounded-lg border px-4 py-2 text-xs font-bold shadow-sm ${theme.button}`}
        >
          {viewLabel}
          <ChevronDown className="ml-1.5 h-3.5 w-3.5 rotate-180" />
        </div>
      </div>

      {loading || breakdownQ.isLoading ? (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : breakdownQ.isError ? (
        <p className="mt-5 text-sm text-red-600">
          Could not load goal breakdown.{" "}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => void breakdownQ.refetch()}
          >
            Retry
          </button>
        </p>
      ) : !hasRows ? (
        <p className="mt-5 text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="mt-5 space-y-3">
          <div className={`rounded-xl border px-4 py-4 ${theme.rowBg}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-bold uppercase tracking-wide text-slate-600">Total</span>
              <span className="text-sm font-bold tabular-nums text-slate-800">
                {formatActualTarget(
                  summaryCurrent,
                  summaryConfigured ? summaryTarget : null,
                  summaryConfigured,
                  format,
                  unitLabel,
                )}
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-bold tabular-nums ${pctPillClass(summaryPct, summaryConfigured)}`}
              >
                {summaryConfigured && summaryPct != null ? `${summaryPct}%` : "—"}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200/70">
              <div
                className={`h-full rounded-full transition-all duration-500 ${summaryConfigured ? theme.bar : theme.barMuted}`}
                style={{ width: `${summaryConfigured && summaryPct != null ? Math.min(100, summaryPct) : 0}%` }}
              />
            </div>
          </div>
          <div className="space-y-2">
            {breakdownNetworks.map((net) => {
              const configured = net.target > 0;
              const isExpanded = expanded.has(net.key);
              const visibleGeos = net.geos ?? [];
              return (
                <div
                  key={net.key}
                  className="overflow-hidden rounded-xl border border-slate-200/60 bg-white shadow-sm"
                >
                  <NetworkMetricRow
                    label={net.label}
                    actual={net.current}
                    target={configured ? net.target : null}
                    progressPctValue={configured ? net.percent : null}
                    configured={configured}
                    format={format}
                    unitLabel={unitLabel}
                    theme={theme}
                    expandable={visibleGeos.length > 0 || net.target > 0}
                    expanded={isExpanded}
                    onToggle={() => toggleNetwork(net.key)}
                  />
                  {isExpanded &&
                    visibleGeos.map((geo) => {
                      const configured = geoTargetConfigured(geo.target, geo.targetSource);
                      return (
                      <GeoMetricRow
                        key={`${net.key}-${geo.key}`}
                        label={geo.label}
                        actual={geo.current}
                        target={configured ? geo.target : null}
                        progressPctValue={configured ? geo.percent : null}
                        configured={configured}
                        theme={theme}
                        format={format}
                        targetSource={geo.targetSource}
                      />
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && selectedMetric === "revenue" && (
        <p className="mt-5 flex items-start gap-2 rounded-lg bg-blue-50/60 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          <span>
            Targets are monthly. Revenue goals are configured per network and GEO.
            {unattributedRevenueMtd > 0.01 && (
              <>
                {" "}
                ${Math.round(unattributedRevenueMtd).toLocaleString()} of $
                {Math.round(mtdRevenue).toLocaleString()} MTD is not attributed to a network yet.
              </>
            )}
            {Math.abs(attributedRevenueMtd - mtdRevenue) <= 0.01 && mtdRevenue > 0 && (
              <> Attributed network total matches the Revenue hero card.</>
            )}
          </span>
        </p>
      )}

      {!loading && selectedMetric !== "revenue" && (
        <p className="mt-5 flex items-start gap-2 rounded-lg bg-blue-50/60 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          <span>
            Targets are monthly. {sectionTitle} goals use Performance Engine monthly goal plans.
          </span>
        </p>
      )}
    </section>
  );
}
