import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  fetchMetricBreakdown,
  type MetricBreakdownKind,
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

function BreakdownRows({
  title,
  rows,
  metric,
}: {
  title: string;
  rows: MetricBreakdownResult["networks"];
  metric: MetricBreakdownKind;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</h4>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="rounded-lg border bg-slate-50/60 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium truncate">{row.label}</span>
              <span className="text-muted-foreground shrink-0">
                {metric === "revenue" ? `$${row.current.toLocaleString()}` : row.current.toLocaleString()}
                {row.target > 0 && (
                  <>
                    {" / "}
                    {metric === "revenue" ? `$${row.target.toLocaleString()}` : row.target.toLocaleString()}
                  </>
                )}
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
          </li>
        ))}
      </ul>
    </div>
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
  const q = useQuery({
    queryKey: ["metric-breakdown", workspaceId, monthKey, metric, employeeId ?? "all"],
    enabled: workspaceId > 0,
    queryFn: () => fetchMetricBreakdown(workspaceId, monthKey, metric, employeeId),
  });

  const data = q.data;
  const hasContent =
    (data?.networks.length ?? 0) > 0 ||
    (data?.geos.length ?? 0) > 0 ||
    (data?.items.length ?? 0) > 0;

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
          <div className="grid gap-6 md:grid-cols-2">
            <BreakdownRows title="By Affiliate Network" rows={data!.networks} metric={metric} />
            <BreakdownRows title="By GEO" rows={data!.geos} metric={metric} />
            {data!.items.length > 0 && (
              <div className="md:col-span-2">
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
