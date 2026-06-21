/**
 * Operations Hub — metric network breakdown (revenue / testing / working).
 */

import { useEffect, useMemo, useState } from "react";
import type {
  GoalCardModel,
  GoalKind,
  NetworkGroup,
} from "@/components/operations-hub/ops-hub-drilldown-data";
import {
  resolveNetworkTarget,
  progressPct,
  listConfiguredNetworkTargets,
} from "@/components/operations-hub/ops-v2-metrics";
import {
  goalKindToEmptyMessage,
  goalKindToSectionTitle,
  goalKindToUnitLabel,
  goalKindToViewButtonLabel,
} from "@/components/operations-hub/operational-metric-dropdown";
import { useGoalsConfig, DEFAULT_CONFIG } from "@/lib/goals-config";
import { Button } from "@/components/ui/button";
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
}: {
  label: string;
  actual: number;
  target: number | null;
  progressPctValue: number | null;
  configured: boolean;
  theme: MetricTheme;
}) {
  const pct = progressPctValue ?? 0;
  const barWidth = configured && progressPctValue != null ? Math.min(100, pct) : 0;

  return (
    <div>
      <div className="flex items-center gap-3 border-t border-slate-100 py-3 pl-6 pr-4">
        <div className={`ml-2 w-0.5 self-stretch rounded-full ${theme.geoGuide}`} aria-hidden />
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 text-sm font-semibold text-slate-700">{label}</span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-600">
          {fmt$(actual)}
          {configured && target != null && (
            <span className="font-medium text-slate-400"> / {fmt$(target)}</span>
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
  networkGroups,
  mtdRevenue,
  attributedRevenueMtd,
  unattributedRevenueMtd,
  loading,
}: {
  selectedMetric: GoalKind;
  goalCards: GoalCardModel[];
  networkGroups: NetworkGroup[];
  mtdRevenue: number;
  attributedRevenueMtd: number;
  unattributedRevenueMtd: number;
  loading?: boolean;
}) {
  const { data: cfgRaw } = useGoalsConfig();
  const kpiTargets = (cfgRaw ?? DEFAULT_CONFIG).kpiTargets;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [viewOpen, setViewOpen] = useState(true);

  const activeCard = useMemo(
    () => goalCards.find((c) => c.kind === selectedMetric),
    [goalCards, selectedMetric],
  );

  const theme = METRIC_THEMES[selectedMetric];
  const SectionIcon = theme.Icon;
  const sectionTitle = goalKindToSectionTitle(selectedMetric);
  const viewLabel = goalKindToViewButtonLabel(selectedMetric);
  const emptyMessage = goalKindToEmptyMessage(selectedMetric);
  const unitLabel = goalKindToUnitLabel(selectedMetric);
  const format = activeCard?.format ?? "currency";

  useEffect(() => {
    setExpanded(new Set());
  }, [selectedMetric]);

  const revenueGroups = useMemo(() => {
    if (selectedMetric !== "revenue") return [];
    const configuredNetworks = listConfiguredNetworkTargets(kpiTargets, "revenue");
    return networkGroups
      .filter(
        (g) =>
          g.hasActivity ||
          configuredNetworks.includes(g.network) ||
          g.geos.some((geo) => geo.configured),
      )
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [selectedMetric, networkGroups, kpiTargets]);

  const countRows = activeCard?.networkRows ?? [];

  function toggleNetwork(network: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(network)) next.delete(network);
      else next.add(network);
      return next;
    });
  }

  const hasRows =
    selectedMetric === "revenue" ? revenueGroups.length > 0 : countRows.length > 0;

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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`rounded-lg px-4 text-xs font-bold shadow-sm ${theme.button}`}
          onClick={() => setViewOpen((v) => !v)}
        >
          {viewLabel}
          <ChevronDown
            className={`ml-1.5 h-3.5 w-3.5 transition-transform ${viewOpen ? "rotate-180" : ""}`}
          />
        </Button>
      </div>

      {loading ? (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : !viewOpen ? null : !hasRows ? (
        <p className="mt-5 text-sm text-slate-500">{emptyMessage}</p>
      ) : selectedMetric === "revenue" ? (
        <div className="mt-5 space-y-2">
          {revenueGroups.map((group) => {
            const { target, configured } = resolveNetworkTarget(
              kpiTargets,
              "revenue",
              group.network,
            );
            const networkPct =
              configured && target != null ? progressPct(group.totalRevenue, target) : null;
            const isExpanded = expanded.has(group.network);
            const visibleGeos = group.geos.filter((g) => g.hasActivity || g.configured);

            return (
              <div
                key={group.network}
                className="overflow-hidden rounded-xl border border-slate-200/60 bg-white shadow-sm"
              >
                <NetworkMetricRow
                  label={group.network}
                  actual={group.totalRevenue}
                  target={configured ? target : null}
                  progressPctValue={networkPct}
                  configured={configured}
                  format="currency"
                  theme={theme}
                  expandable={visibleGeos.length > 0}
                  expanded={isExpanded}
                  onToggle={() => toggleNetwork(group.network)}
                />
                {isExpanded &&
                  visibleGeos.map((geo) => (
                    <GeoMetricRow
                      key={`${group.network}-${geo.geo}`}
                      label={geo.geo}
                      actual={geo.actual}
                      target={geo.configured ? geo.target : null}
                      progressPctValue={geo.progressPct}
                      configured={geo.configured}
                      theme={theme}
                    />
                  ))}
                {isExpanded && visibleGeos.length === 0 && (
                  <p className="border-t border-slate-100 px-6 py-3 text-xs text-slate-500">
                    No GEO-level target configured
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          {countRows.map((row) => (
            <div
              key={row.network}
              className="overflow-hidden rounded-xl border border-slate-200/60 bg-white shadow-sm"
            >
              <NetworkMetricRow
                label={row.network}
                actual={row.actual}
                target={row.configured ? row.target : null}
                progressPctValue={row.progressPct}
                configured={row.configured}
                format="count"
                unitLabel={unitLabel}
                theme={theme}
              />
            </div>
          ))}
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
            Targets are monthly. {sectionTitle} goals are configured per network in Settings →
            Goal Engine.
          </span>
        </p>
      )}
    </section>
  );
}
