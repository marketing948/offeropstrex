import { useMemo } from "react";
import { useLocation } from "wouter";
import {
  useListPerformance,
  useListTestingBatches,
  getListPerformanceQueryKey,
  getListTestingBatchesQueryKey,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Network, Percent, TrendingUp, Trophy } from "lucide-react";

function fmt$(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

const PERF_DAYS = 14;

export function PerformancePanel() {
  const { activeWorkspaceId } = useWorkspace();
  const [, nav] = useLocation();

  const dateTo = useMemo(() => new Date().toISOString().split("T")[0], []);
  const dateFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - PERF_DAYS);
    return d.toISOString().split("T")[0];
  }, []);

  const wsId = activeWorkspaceId ?? 0;
  const batchParams = { workspace_id: wsId };
  const perfParams = { workspace_id: wsId, date_from: dateFrom, date_to: dateTo };

  const { data: batches = [] } = useListTestingBatches(
    batchParams,
    wsQueryOpts(activeWorkspaceId, getListTestingBatchesQueryKey(batchParams)),
  );
  const { data: records = [], isLoading } = useListPerformance(
    perfParams,
    wsQueryOpts(activeWorkspaceId, getListPerformanceQueryKey(perfParams)),
  );

  const chartData = useMemo(() => {
    const byDate = new Map<string, { date: string; spend: number; revenue: number; profit: number }>();
    for (const r of records) {
      const ex = byDate.get(r.date) ?? { date: r.date, spend: 0, revenue: 0, profit: 0 };
      ex.spend += Number(r.spend ?? 0);
      ex.revenue += Number(r.revenue ?? 0);
      ex.profit += Number(r.profit ?? 0);
      byDate.set(r.date, ex);
    }
    return Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        ...d,
        label: new Date(d.date + "T12:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      }));
  }, [records]);

  const byTrafficSource = useMemo(() => {
    const map = new Map<string, { revenue: number; profit: number; spend: number }>();
    for (const r of records) {
      const batch = batches.find((b) => b.id === r.batchId);
      const key = batch?.trafficSource || "(unset)";
      const ex = map.get(key) ?? { revenue: 0, profit: 0, spend: 0 };
      ex.revenue += Number(r.revenue ?? 0);
      ex.profit += Number(r.profit ?? 0);
      ex.spend += Number(r.spend ?? 0);
      map.set(key, ex);
    }
    return [...map.entries()]
      .map(([name, v]) => ({
        name,
        revenue: v.revenue,
        profit: v.profit,
        roi: v.spend > 0 ? (v.profit / v.spend) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [records, batches]);

  const topBatches = useMemo(() => {
    const map = new Map<number, { revenue: number; profit: number; spend: number }>();
    for (const r of records) {
      const ex = map.get(r.batchId) ?? { revenue: 0, profit: 0, spend: 0 };
      ex.revenue += Number(r.revenue ?? 0);
      ex.profit += Number(r.profit ?? 0);
      ex.spend += Number(r.spend ?? 0);
      map.set(r.batchId, ex);
    }
    return [...map.entries()]
      .map(([batchId, v]) => {
        const batch = batches.find((b) => b.id === batchId);
        return {
          batchId,
          name: batch?.batchName ?? `Batch #${batchId}`,
          ...v,
          roi: v.spend > 0 ? (v.profit / v.spend) * 100 : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [records, batches]);

  const totals = useMemo(() => {
    let spend = 0;
    let revenue = 0;
    for (const r of records) {
      spend += Number(r.spend ?? 0);
      revenue += Number(r.revenue ?? 0);
    }
    const profit = revenue - spend;
    const roi = spend > 0 ? (profit / spend) * 100 : 0;
    return { spend, revenue, profit, roi };
  }, [records]);

  const winnersProfit = useMemo(() => {
    const winnerBatchIds = new Set(
      batches.filter((b) => b.status === "COMPLETED" || b.status === "TESTED").map((b) => b.id),
    );
    let profit = 0;
    for (const r of records) {
      if (winnerBatchIds.has(r.batchId)) profit += Number(r.profit ?? 0);
    }
    return profit;
  }, [records, batches]);

  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No imported metrics in the last {PERF_DAYS} days. Import Voluum CSV on Live Campaigns.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Revenue", value: fmt$(totals.revenue) },
          { label: "Spend", value: fmt$(totals.spend) },
          { label: "ROI", value: fmtPct(totals.roi) },
          { label: "Winners (tested+)", value: fmt$(winnersProfit), sub: "profit in period" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {s.label}
            </p>
            <p className="text-lg font-bold tabular-nums">{s.value}</p>
            {"sub" in s && s.sub && (
              <p className="text-[10px] text-muted-foreground">{s.sub}</p>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {chartData.length > 1 && (
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" /> Spend vs revenue
            </p>
            <div className="h-36 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 0, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    formatter={(v: number) => [`$${Number(v).toFixed(0)}`, ""]}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="hsl(var(--primary)/0.15)" strokeWidth={2} dot={false} name="Revenue" />
                  <Area type="monotone" dataKey="spend" stroke="hsl(var(--muted-foreground))" fill="hsl(var(--muted-foreground)/0.08)" strokeWidth={1.5} dot={false} name="Spend" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {chartData.length > 1 && (
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Percent className="h-3.5 w-3.5" /> Daily profit
            </p>
            <div className="h-36 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData.slice(-10)} margin={{ top: 0, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => [`$${Number(v).toFixed(0)}`, "Profit"]} />
                  <Bar dataKey="profit" fill="#22c55e" radius={[2, 2, 0, 0]} barSize={10} name="Profit" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Network className="h-3.5 w-3.5" /> Traffic sources
          </p>
          <ul className="divide-y divide-border text-sm">
            {byTrafficSource.map((row) => (
              <li key={row.name} className="flex items-center justify-between gap-2 py-2">
                <span className="truncate font-medium">{row.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {fmt$(row.revenue)} · {fmtPct(row.roi)} ROI
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Trophy className="h-3.5 w-3.5" /> Top campaigns (batches)
          </p>
          <ul className="divide-y divide-border text-sm">
            {topBatches.map((row) => (
              <li key={row.batchId}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 py-2 text-left hover:text-primary"
                  onClick={() => nav(`/testing-batches/${row.batchId}`)}
                >
                  <span className="truncate font-medium">{row.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {fmt$(row.revenue)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="text-center">
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => nav("/reports")}
        >
          Full reports →
        </button>
      </p>
    </div>
  );
}
