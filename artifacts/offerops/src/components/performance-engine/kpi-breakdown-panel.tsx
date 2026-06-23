import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  fetchMetricBreakdown,
  type MetricBreakdownKind,
  type MetricBreakdownNetworkRow,
  type MetricBreakdownResult,
} from "@/lib/performance-engine/api";

const TITLES: Record<MetricBreakdownKind, string> = {
  revenue: "Revenue Breakdown",
  testing: "Testing Breakdown",
  working: "Working Campaigns Breakdown",
};

function formatSummary(metric: MetricBreakdownKind, summary: MetricBreakdownResult["summary"]): string {
  if (metric === "revenue") {
    return `$${summary.current.toLocaleString()} / $${summary.target.toLocaleString()}`;
  }
  if (metric === "testing") {
    return `${summary.current.toLocaleString()} / ${summary.target.toLocaleString()} tests`;
  }
  return `${summary.current.toLocaleString()} / ${summary.target.toLocaleString()} campaigns`;
}

function geoTargetConfigured(
  target: number,
  targetSource?: "inherited" | "custom" | "none",
): boolean {
  return targetSource === "inherited" || targetSource === "custom" || target > 0;
}

function formatValue(
  metric: MetricBreakdownKind,
  current: number,
  target?: number,
  targetSource?: "inherited" | "custom" | "none",
): string {
  const hasTarget = target != null && geoTargetConfigured(target, targetSource);
  const cur = metric === "revenue" ? `$${current.toLocaleString()}` : current.toLocaleString();
  if (!hasTarget) return cur;
  const tgt = metric === "revenue" ? `$${target!.toLocaleString()}` : target!.toLocaleString();
  return `${cur} / ${tgt}`;
}

function NetworkRow({
  row,
  metric,
  selected,
  onToggle,
}: {
  row: MetricBreakdownNetworkRow;
  metric: MetricBreakdownKind;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
          selected
            ? "border-blue-300 bg-blue-50/80 shadow-sm"
            : "bg-slate-50/60 hover:bg-slate-100/80 hover:border-slate-300"
        }`}
      >
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-1.5 font-medium truncate min-w-0">
            <ChevronRight
              size={14}
              className={`shrink-0 text-muted-foreground transition-transform ${selected ? "rotate-90" : ""}`}
            />
            <span className="truncate">{row.label}</span>
          </span>
          <span className="text-muted-foreground shrink-0">
            {formatValue(metric, row.current, row.target > 0 ? row.target : undefined)}
          </span>
        </div>
        {row.target > 0 && (
          <div className="mt-1.5 h-1.5 rounded-full bg-white overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500"
              style={{ width: `${Math.min(100, row.percent)}%` }}
            />
          </div>
        )}
      </button>
    </li>
  );
}

export function KpiBreakdownPanel({
  workspaceId,
  monthKey,
  metric,
  workerName,
  employeeId,
  onClose,
}: {
  workspaceId: number;
  monthKey: string;
  metric: MetricBreakdownKind;
  workerName?: string;
  employeeId?: number;
  onClose: () => void;
}) {
  const [selectedNetworkKey, setSelectedNetworkKey] = useState<string | null>(null);

  useEffect(() => {
    setSelectedNetworkKey(null);
  }, [metric, monthKey, employeeId]);

  const q = useQuery({
    queryKey: ["metric-breakdown", workspaceId, monthKey, metric, employeeId ?? "all"],
    enabled: workspaceId > 0,
    queryFn: () => fetchMetricBreakdown(workspaceId, monthKey, metric, employeeId),
  });

  const data = q.data;
  const selectedNetwork = data?.networks.find((n) => n.key === selectedNetworkKey) ?? null;
  const hasContent = (data?.networks.length ?? 0) > 0 || (data?.items.length ?? 0) > 0;

  function toggleNetwork(key: string) {
    setSelectedNetworkKey((prev) => (prev === key ? null : key));
  }

  return (
    <div className="mb-8 rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b bg-slate-50/80">
        <div>
          <h3 className="font-semibold">
            {TITLES[metric]}
            {workerName ? ` — ${workerName}` : ""}
          </h3>
          {data && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Total: {formatSummary(metric, data.summary)}
              {data.summary.target > 0 && ` (${data.summary.percent}% completed)`}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={onClose} aria-label="Close breakdown">
          <X size={16} />
        </Button>
      </div>

      <div className="p-4">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading breakdown…</p>
        ) : q.isError ? (
          <p className="text-sm text-red-600">Could not load breakdown data.</p>
        ) : !hasContent ? (
          <p className="text-sm text-muted-foreground">No breakdown data for this metric yet.</p>
        ) : (
          <div className="space-y-4">
            {data!.networks.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  By Affiliate Network
                </h4>
                <ul className="space-y-2">
                  {data!.networks.map((row) => (
                    <NetworkRow
                      key={row.key}
                      row={row}
                      metric={metric}
                      selected={selectedNetworkKey === row.key}
                      onToggle={() => toggleNetwork(row.key)}
                    />
                  ))}
                </ul>
              </div>
            )}

            {selectedNetwork && (
              <div className="rounded-lg border border-dashed bg-slate-50/40 p-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  GEO breakdown for {selectedNetwork.label}
                </h4>
                {selectedNetwork.geos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No GEO targets configured for this network.</p>
                ) : (
                  <ul className="space-y-2">
                    {selectedNetwork.geos.map((geo) => {
                      const configured = geoTargetConfigured(geo.target, geo.targetSource);
                      return (
                      <li key={geo.key} className="rounded-lg border bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="font-medium">
                            {geo.label}
                            {geo.targetSource === "inherited" && (
                              <span className="ml-1.5 text-[10px] font-semibold uppercase text-slate-500">
                                Inherited
                              </span>
                            )}
                            {geo.targetSource === "custom" && (
                              <span className="ml-1.5 text-[10px] font-semibold uppercase text-blue-600">
                                Custom
                              </span>
                            )}
                          </span>
                          <span className="text-muted-foreground shrink-0">
                            {formatValue(metric, geo.current, geo.target, geo.targetSource)}
                          </span>
                        </div>
                        {configured && (
                          <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-violet-500"
                              style={{ width: `${Math.min(100, geo.percent)}%` }}
                            />
                          </div>
                        )}
                      </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {data!.items.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Top campaigns / winners
                </h4>
                <ul className="space-y-1.5">
                  {data!.items.map((item, i) => (
                    <li key={`${item.name}-${i}`} className="text-sm flex flex-wrap gap-x-2">
                      <span className="font-medium">{item.name}</span>
                      <span className="text-muted-foreground">
                        {item.network} · {item.geo}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {data && data.summary.xpAvailable > 0 && (
          <p className="text-xs font-medium text-blue-700 mt-4">
            +{data.summary.xpAvailable.toLocaleString()} XP available for this metric
          </p>
        )}
      </div>
    </div>
  );
}
