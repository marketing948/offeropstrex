import { useState, useMemo, useEffect } from "react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useListPerformance, useListTestingBatches, getListPerformanceQueryKey, getListTestingBatchesQueryKey } from "@workspace/api-client-react";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  BarChart2,
  Percent,
} from "lucide-react";

const CHART_COLORS = {
  spend: "hsl(var(--muted-foreground))",
  revenue: "hsl(var(--primary))",
  profit: "#22c55e",
  roi: "#f59e0b",
};

function fmt$(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number) {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.name === "ROI" ? fmtPct(p.value) : fmt$(p.value)}
        </p>
      ))}
    </div>
  );
};

export default function PerformancePage() {
  const { currentEmployee } = useAuth();
  const isAdmin = currentEmployee?.role === "admin";

  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("all");

  const { activeWorkspaceId } = useWorkspace();
  const batchListParams = isAdmin
    ? { workspace_id: activeWorkspaceId ?? 0 }
    : { employee_id: currentEmployee?.id, workspace_id: activeWorkspaceId ?? 0 };
  const { data: batches } = useListTestingBatches(
    batchListParams,
    wsQueryOpts(activeWorkspaceId, getListTestingBatchesQueryKey(batchListParams)),
  );

  // Reset stale batch selection when workspace changes
  useEffect(() => {
    setSelectedBatchId("all");
  }, [activeWorkspaceId]);

  const queryParams = useMemo(() => {
    const p: Record<string, any> = { workspace_id: activeWorkspaceId ?? 0 };
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    if (selectedBatchId !== "all") p.batch_id = Number(selectedBatchId);
    return p;
  }, [dateFrom, dateTo, selectedBatchId, activeWorkspaceId]);

  const { data: records, isLoading } = useListPerformance(queryParams, wsQueryOpts(activeWorkspaceId, getListPerformanceQueryKey(queryParams)));

  // Aggregate by date
  const chartData = useMemo(() => {
    if (!records) return [];
    const byDate = new Map<string, { date: string; spend: number; revenue: number; profit: number; conversions: number }>();
    for (const r of records) {
      const existing = byDate.get(r.date) ?? { date: r.date, spend: 0, revenue: 0, profit: 0, conversions: 0 };
      existing.spend += Number(r.spend ?? 0);
      existing.revenue += Number(r.revenue ?? 0);
      existing.profit += Number(r.profit ?? 0);
      existing.conversions += r.conversions ?? 0;
      byDate.set(r.date, existing);
    }
    return Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({
        ...d,
        spend: Math.round(d.spend * 100) / 100,
        revenue: Math.round(d.revenue * 100) / 100,
        profit: Math.round(d.profit * 100) / 100,
        ROI: d.spend > 0 ? Math.round((d.profit / d.spend) * 10000) / 100 : 0,
      }));
  }, [records]);

  // Aggregate by batch
  const batchData = useMemo(() => {
    if (!records || !batches) return [];
    const byBatch = new Map<number, { batchId: number; name: string; spend: number; revenue: number; profit: number }>();
    for (const r of records) {
      const existing = byBatch.get(r.batchId) ?? { batchId: r.batchId, name: "", spend: 0, revenue: 0, profit: 0 };
      existing.spend += Number(r.spend ?? 0);
      existing.revenue += Number(r.revenue ?? 0);
      existing.profit += Number(r.profit ?? 0);
      byBatch.set(r.batchId, existing);
    }
    return Array.from(byBatch.values()).map(b => {
      const batch = batches.find(bt => bt.id === b.batchId);
      return {
        ...b,
        name: batch?.batchName ?? `Batch #${b.batchId}`,
        spend: Math.round(b.spend * 100) / 100,
        revenue: Math.round(b.revenue * 100) / 100,
        profit: Math.round(b.profit * 100) / 100,
      };
    }).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [records, batches]);

  // KPIs
  const kpis = useMemo(() => {
    if (!records || records.length === 0) return null;
    const totalSpend = records.reduce((s, r) => s + Number(r.spend ?? 0), 0);
    const totalRevenue = records.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
    const totalProfit = records.reduce((s, r) => s + Number(r.profit ?? 0), 0);
    const totalConversions = records.reduce((s, r) => s + (r.conversions ?? 0), 0);
    const roi = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0;
    const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;
    return { totalSpend, totalRevenue, totalProfit, roi, totalConversions, avgCpa };
  }, [records]);

  const kpiCards = [
    {
      label: "Total Spend",
      value: kpis ? fmt$(kpis.totalSpend) : null,
      icon: DollarSign,
      color: "text-muted-foreground",
    },
    {
      label: "Total Revenue",
      value: kpis ? fmt$(kpis.totalRevenue) : null,
      icon: TrendingUp,
      color: "text-primary",
    },
    {
      label: "Total Profit",
      value: kpis ? fmt$(kpis.totalProfit) : null,
      icon: kpis && kpis.totalProfit >= 0 ? TrendingUp : TrendingDown,
      color: kpis && kpis.totalProfit >= 0 ? "text-green-400" : "text-destructive",
    },
    {
      label: "Avg ROI",
      value: kpis ? fmtPct(kpis.roi) : null,
      icon: Percent,
      color: kpis && kpis.roi >= 0 ? "text-amber-400" : "text-destructive",
    },
    {
      label: "Conversions",
      value: kpis ? kpis.totalConversions.toLocaleString() : null,
      icon: Activity,
      color: "text-primary",
    },
    {
      label: "Avg CPA",
      value: kpis ? fmt$(kpis.avgCpa) : null,
      icon: BarChart2,
      color: "text-muted-foreground",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Performance</h1>
          <p className="text-muted-foreground mt-1 text-sm">Spend, revenue and profit trends across your campaigns.</p>
        </div>
        {records && (
          <Badge variant="outline" className="text-muted-foreground">
            {records.length} record{records.length !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {/* Filters */}
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardContent className="pt-4">
          <div className="flex gap-4 flex-wrap items-end">
            <div className="space-y-1.5 min-w-[140px]">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="bg-background/50 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5 min-w-[140px]">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="bg-background/50 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">Batch</Label>
              <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                <SelectTrigger className="bg-background/50 h-9 text-sm">
                  <SelectValue placeholder="All batches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All batches</SelectItem>
                  {batches?.map(b => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.batchName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {kpiCards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-card/50 backdrop-blur border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <Icon size={14} className={color} />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isLoading ? (
                <Skeleton className="h-6 w-16 bg-muted/50" />
              ) : (
                <span className={`text-lg font-bold ${color}`}>{value ?? "—"}</span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Spend vs Revenue Area Chart */}
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp size={16} className="text-primary" />
            Spend vs Revenue Over Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full bg-muted/50" />
          ) : chartData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.revenue} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS.revenue} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.spend} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={CHART_COLORS.spend} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.profit} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS.profit} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={v => `$${v}`}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: "12px", color: "hsl(var(--muted-foreground))" }}
                  />
                  <Area type="monotone" dataKey="spend" stroke={CHART_COLORS.spend} fill="url(#colorSpend)" strokeWidth={2} name="Spend" dot={false} />
                  <Area type="monotone" dataKey="revenue" stroke={CHART_COLORS.revenue} fill="url(#colorRevenue)" strokeWidth={2} name="Revenue" dot={false} />
                  <Area type="monotone" dataKey="profit" stroke={CHART_COLORS.profit} fill="url(#colorProfit)" strokeWidth={2} name="Profit" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
              No performance data for this period.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ROI Over Time */}
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Percent size={16} className="text-amber-400" />
              ROI Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-52 w-full bg-muted/50" />
            ) : chartData.length > 0 ? (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="colorRoi" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS.roi} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={CHART_COLORS.roi} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={v => `${v}%`} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="ROI" stroke={CHART_COLORS.roi} fill="url(#colorRoi)" strokeWidth={2} name="ROI" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data</div>
            )}
          </CardContent>
        </Card>

        {/* Revenue by Batch */}
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart2 size={16} className="text-primary" />
              Revenue by Batch
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-52 w-full bg-muted/50" />
            ) : batchData.length > 0 ? (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={batchData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" tickFormatter={v => `$${v}`} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={90}
                      tickFormatter={v => v.length > 14 ? v.slice(0, 14) + "…" : v}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Revenue" barSize={14} />
                    <Bar dataKey="spend" fill="hsl(var(--muted-foreground) / 0.5)" radius={[0, 4, 4, 0]} name="Spend" barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Data Table */}
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity size={16} className="text-primary" />
            Daily Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full bg-muted/50" />)}
            </div>
          ) : records && records.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Batch</th>
                    <th className="px-4 py-3 font-medium text-right">Spend</th>
                    <th className="px-4 py-3 font-medium text-right">Revenue</th>
                    <th className="px-4 py-3 font-medium text-right">Profit</th>
                    <th className="px-4 py-3 font-medium text-right">ROI</th>
                    <th className="px-4 py-3 font-medium text-right">Conv.</th>
                    <th className="px-4 py-3 font-medium text-right">CPA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...records].sort((a, b) => b.date.localeCompare(a.date)).map(r => {
                    const batch = batches?.find(b => b.id === r.batchId);
                    const profit = Number(r.profit ?? 0);
                    return (
                      <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 text-muted-foreground">{r.date}</td>
                        <td className="px-4 py-2.5 max-w-[180px] truncate">
                          <span title={batch?.batchName ?? ""} className="text-foreground">
                            {batch?.batchName ?? `#${r.batchId}`}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{fmt$(Number(r.spend ?? 0))}</td>
                        <td className="px-4 py-2.5 text-right text-primary font-medium">{fmt$(Number(r.revenue ?? 0))}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${profit >= 0 ? "text-green-400" : "text-destructive"}`}>
                          {fmt$(profit)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-amber-400">
                          {r.roi !== null ? fmtPct(Number(r.roi)) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{r.conversions ?? 0}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {r.cpa !== null ? fmt$(Number(r.cpa)) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No records found for the selected filters.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
