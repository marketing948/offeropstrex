import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetAdminDashboardSummary,
  useGetBatchStatusBreakdown,
  useGetEmployeeLeaderboard,
  useGetGoalProgress,
  useGetDashboardBreakdowns,
  getGetAdminDashboardSummaryQueryKey,
  getGetBatchStatusBreakdownQueryKey,
  getGetEmployeeLeaderboardQueryKey,
  getGetGoalProgressQueryKey,
  getGetDashboardBreakdownsQueryKey,
} from "@workspace/api-client-react";
import type { DashboardBreakdownRow } from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { authedJson } from "@/lib/api-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  ArrowUpDown,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Flame,
  FolderTree,
  Globe2,
  Layers,
  Network,
  PackageOpen,
  Pause,
  PlayCircle,
  Radio,
  Target,
  TestTube2,
  Trophy,
  TrendingUp,
  Users,
} from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";

type LiveCampaignSummaryRow = {
  id: number;
  campaignName: string;
  platform: "ios" | "android";
  liveStartedAt: string | null;
  batchName: string | null;
  batchGeo: string | null;
  employeeName: string | null;
  trafficSourceName: string | null;
};

type LiveCampaignsResponse = {
  items: LiveCampaignSummaryRow[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
};

export default function Dashboard() {
  const { activeWorkspaceId } = useWorkspace();
  const wsParams = { workspace_id: activeWorkspaceId ?? 0 };
  const goalParams = { workspace_id: activeWorkspaceId ?? 0, period_type: "weekly" as const };
  const { data: summary, isLoading: isLoadingSummary } = useGetAdminDashboardSummary(wsParams, wsQueryOpts(activeWorkspaceId, getGetAdminDashboardSummaryQueryKey(wsParams)));
  const { data: leaderboard, isLoading: isLoadingLeaderboard } = useGetEmployeeLeaderboard(wsParams, wsQueryOpts(activeWorkspaceId, getGetEmployeeLeaderboardQueryKey(wsParams)));
  const { data: statusBreakdown, isLoading: isLoadingStatus } = useGetBatchStatusBreakdown(wsParams, wsQueryOpts(activeWorkspaceId, getGetBatchStatusBreakdownQueryKey(wsParams)));
  const { data: goalProgress, isLoading: isLoadingGoals } = useGetGoalProgress(goalParams, wsQueryOpts(activeWorkspaceId, getGetGoalProgressQueryKey(goalParams)));
  const { data: breakdowns, isLoading: isLoadingBreakdowns } = useGetDashboardBreakdowns(wsParams, wsQueryOpts(activeWorkspaceId, getGetDashboardBreakdownsQueryKey(wsParams)));
  const { data: liveCampaignsResponse, isLoading: isLoadingLiveCampaigns, isError: isLiveCampaignsError, error: liveCampaignsError } = useQuery<LiveCampaignsResponse>({
    queryKey: ["dashboard-live-campaigns", activeWorkspaceId],
    enabled: !!activeWorkspaceId,
    queryFn: () => authedJson(`/api/live-campaigns?workspace_id=${activeWorkspaceId}&status=live&limit=50`),
  });
  const liveCampaigns = liveCampaignsResponse?.items ?? [];
  const liveCampaignsErrorMessage = liveCampaignsError instanceof Error ? liveCampaignsError.message : "Unable to load live campaigns.";

  const liveStats = useMemo(() => {
    const byTrafficSource = new Map<string, number>();
    const byGeo = new Map<string, number>();
    const byWorker = new Map<string, number>();
    for (const campaign of liveCampaigns) {
      byTrafficSource.set(campaign.trafficSourceName ?? "Unassigned", (byTrafficSource.get(campaign.trafficSourceName ?? "Unassigned") ?? 0) + 1);
      byGeo.set(campaign.batchGeo ?? "Unknown", (byGeo.get(campaign.batchGeo ?? "Unknown") ?? 0) + 1);
      byWorker.set(campaign.employeeName ?? "Unassigned", (byWorker.get(campaign.employeeName ?? "Unassigned") ?? 0) + 1);
    }
    const top = (map: Map<string, number>) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 4);
    const recent = [...liveCampaigns]
      .sort((a, b) => (b.liveStartedAt ?? "").localeCompare(a.liveStartedAt ?? ""))
      .slice(0, 5);
    return {
      byTrafficSource: top(byTrafficSource),
      byGeo: top(byGeo),
      byWorker: top(byWorker),
      recent,
    };
  }, [liveCampaigns]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Admin Terminal</h1>
      </div>

      {/* KPI Cards — action-required-first ordering: open tasks lead,
          then this-week production metrics, then financials, then
          campaign-status distribution. */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Open Tasks" value={summary?.openTasksCount} icon={CheckCircle2} isLoading={isLoadingSummary} dot={(summary?.openTasksCount ?? 0) > 0 ? "bg-amber-500" : "bg-green-500"} />
        <KpiCard title="Batches Tested (Week)" value={summary?.batchesTestedThisWeek} icon={TestTube2} isLoading={isLoadingSummary} />
        <KpiCard title="Winners Found (Week)" value={summary?.winnersFoundThisWeek} icon={Trophy} isLoading={isLoadingSummary} dot={(summary?.winnersFoundThisWeek ?? 0) > 0 ? "bg-green-500" : "bg-gray-400"} />
        <KpiCard title="Moved to Main (Week)" value={summary?.campaignsMovedToMain} icon={ArrowUpRight} isLoading={isLoadingSummary} />

        <KpiCard title="Total Batches" value={summary?.totalBatchesCreated} icon={Layers} isLoading={isLoadingSummary} />
        <KpiCard title="Offers Uploaded (Week)" value={summary?.offersUploadedThisWeek} icon={PackageOpen} isLoading={isLoadingSummary} />
        <KpiCard title="Offers Uploaded (Today)" value={summary?.offersUploadedToday} icon={PackageOpen} isLoading={isLoadingSummary} />
        <KpiCard title="Batches Created (Week)" value={summary?.batchesCreatedThisWeek} icon={FolderTree} isLoading={isLoadingSummary} />

        <KpiCard title="Revenue" value={summary ? `$${summary.totalRevenue.toLocaleString()}` : undefined} icon={CircleDollarSign} isLoading={isLoadingSummary} />
        <KpiCard title="Profit" value={summary ? `$${summary.totalProfit.toLocaleString()}` : undefined} icon={TrendingUp} isLoading={isLoadingSummary} dot={(summary?.totalProfit ?? 0) > 0 ? "bg-green-500" : (summary?.totalProfit ?? 0) < 0 ? "bg-red-500" : "bg-gray-400"} />
        <KpiCard title="Avg ROI" value={summary ? `${summary.averageRoi}%` : undefined} icon={Activity} isLoading={isLoadingSummary} dot={(summary?.averageRoi ?? 0) > 0 ? "bg-green-500" : (summary?.averageRoi ?? 0) < 0 ? "bg-red-500" : "bg-gray-400"} />
        <KpiCard title="Spend" value={summary ? `$${summary.totalSpend.toLocaleString()}` : undefined} icon={CircleDollarSign} isLoading={isLoadingSummary} />
      </div>

      {/* Campaign status distribution — required Phase 6 KPI block. */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Campaigns — Live" value={summary?.campaignsLive} icon={PlayCircle} isLoading={isLoadingSummary} dot="bg-green-500" />
        <KpiCard title="Campaigns — Testing" value={summary?.campaignsTesting} icon={Flame} isLoading={isLoadingSummary} dot="bg-blue-500" />
        <KpiCard title="Campaigns — Tested" value={summary?.campaignsTested} icon={CheckCircle2} isLoading={isLoadingSummary} dot="bg-amber-500" />
        <KpiCard title="Campaigns — Closed" value={summary?.campaignsClosedTotal} icon={Pause} isLoading={isLoadingSummary} dot="bg-gray-400" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MiniListCard title="Live by Traffic Source" rows={liveStats.byTrafficSource} isLoading={isLoadingLiveCampaigns} error={isLiveCampaignsError ? liveCampaignsErrorMessage : null} icon={Network} />
        <MiniListCard title="Live by GEO" rows={liveStats.byGeo} isLoading={isLoadingLiveCampaigns} error={isLiveCampaignsError ? liveCampaignsErrorMessage : null} icon={Globe2} />
        <MiniListCard title="Live by Worker" rows={liveStats.byWorker} isLoading={isLoadingLiveCampaigns} error={isLiveCampaignsError ? liveCampaignsErrorMessage : null} icon={Users} />
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Radio size={16} className="text-primary" />
              Recently Launched
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingLiveCampaigns ? (
              <Skeleton className="h-20 w-full bg-muted/50" />
            ) : isLiveCampaignsError ? (
              <div className="text-xs text-destructive">{liveCampaignsErrorMessage}</div>
            ) : liveStats.recent.length === 0 ? (
              <div className="text-xs text-muted-foreground">No live campaigns yet.</div>
            ) : (
              <div className="space-y-2">
                {liveStats.recent.map((campaign) => (
                  <div key={campaign.id} className="text-xs">
                    <div className="font-medium truncate">{campaign.campaignName}</div>
                    <div className="text-muted-foreground">
                      {campaign.platform.toUpperCase()} · {campaign.trafficSourceName ?? "Unassigned"} · {campaign.liveStartedAt ? new Date(campaign.liveStartedAt).toLocaleDateString() : "No date"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Leaderboard */}
        <Card className="col-span-4 bg-card/50 backdrop-blur border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users size={18} className="text-primary" />
              Operator Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingLeaderboard ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full bg-muted/50" />
                <Skeleton className="h-8 w-full bg-muted/50" />
                <Skeleton className="h-8 w-full bg-muted/50" />
              </div>
            ) : leaderboard && leaderboard.length > 0 ? (
              <div className="rounded-md border border-border">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Operator</th>
                      <th className="px-4 py-3 font-medium text-right">Tested</th>
                      <th className="px-4 py-3 font-medium text-right">Main</th>
                      <th className="px-4 py-3 font-medium text-right">Tasks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {leaderboard.map((entry) => (
                      <tr key={entry.employeeId} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">{entry.employeeName}</td>
                        <td className="px-4 py-3 text-right">{entry.batchesTested}</td>
                        <td className="px-4 py-3 text-right text-primary font-bold">{entry.campaignsMovedToMain}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{entry.openTasks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">No data available</div>
            )}
          </CardContent>
        </Card>

        {/* Batch Status Chart */}
        <Card className="col-span-3 bg-card/50 backdrop-blur border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity size={18} className="text-primary" />
              Batch Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingStatus ? (
              <Skeleton className="h-[250px] w-full bg-muted/50" />
            ) : statusBreakdown && statusBreakdown.length > 0 ? (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusBreakdown} layout="vertical" margin={{ top: 0, right: 0, left: 30, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="status" type="category" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                      itemStyle={{ color: "hsl(var(--primary))" }}
                    />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">No data available</div>
            )}
          </CardContent>
        </Card>

        {/* Goal Progress */}
        <Card className="col-span-7 bg-card/50 backdrop-blur border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target size={18} className="text-primary" />
              Weekly Targets
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingGoals ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full bg-muted/50" />
                <Skeleton className="h-12 w-full bg-muted/50" />
              </div>
            ) : goalProgress && goalProgress.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-2">
                {goalProgress.map(gp => (
                  <div key={gp.employeeId} className="space-y-2 p-4 rounded-md border border-border bg-muted/20">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{gp.employeeName}</span>
                      {gp.goal && (
                        <span className="text-xs text-muted-foreground">
                          {gp.progress.batchesTested} / {gp.goal.targetBatchesTested} Batches
                        </span>
                      )}
                    </div>
                    {gp.goal?.targetBatchesTested ? (
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.min(100, (gp.progress.batchesTested / gp.goal.targetBatchesTested) * 100)}%` }}
                        />
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic">No target set</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">No active goals</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Phase 6: four manual-data breakdowns. */}
      <div className="grid gap-4 md:grid-cols-1 xl:grid-cols-2">
        <BreakdownTable title="By Worker" icon={Users} keyLabel="Operator" rows={breakdowns?.byWorker} isLoading={isLoadingBreakdowns} />
        <BreakdownTable title="By Traffic Source" icon={Radio} keyLabel="Source" rows={breakdowns?.byTrafficSource} isLoading={isLoadingBreakdowns} />
        <BreakdownTable title="By GEO" icon={Globe2} keyLabel="GEO" rows={breakdowns?.byGeo} isLoading={isLoadingBreakdowns} />
        <BreakdownTable title="By Affiliate Network" icon={Network} keyLabel="Network" rows={breakdowns?.byNetwork} isLoading={isLoadingBreakdowns} />
      </div>
    </div>
  );
}

function KpiCard({ title, value, icon: Icon, isLoading, dot }: { title: string, value: React.ReactNode, icon: any, isLoading: boolean, dot?: string }) {
  return (
    <Card className="bg-card/50 backdrop-blur border-border hover:border-primary/50 transition-colors">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground inline-flex items-center gap-2">
          {dot && <span className={`w-2 h-2 rounded-full ${dot}`} aria-hidden />}
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24 bg-muted/50" />
        ) : (
          <div className="text-2xl font-bold">{value !== undefined ? value : "-"}</div>
        )}
      </CardContent>
    </Card>
  );
}

function MiniListCard({
  title,
  rows,
  isLoading,
  error,
  icon: Icon,
}: {
  title: string;
  rows: Array<[string, number]>;
  isLoading: boolean;
  error: string | null;
  icon: any;
}) {
  return (
    <Card className="bg-card/50 backdrop-blur border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Icon size={16} className="text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-20 w-full bg-muted/50" />
        ) : error ? (
          <div className="text-xs text-destructive">{error}</div>
        ) : rows.length === 0 ? (
          <div className="text-xs text-muted-foreground">No live campaigns yet.</div>
        ) : (
          <div className="space-y-2">
            {rows.map(([label, count]) => (
              <div key={label} className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-muted-foreground">{label}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type BreakdownSortKey = keyof Pick<
  DashboardBreakdownRow,
  "label" | "batches" | "tested" | "clicks" | "cost" | "revenue" | "profit" | "roi" | "conversions" | "winners"
>;

function BreakdownTable({
  title,
  icon: Icon,
  keyLabel,
  rows,
  isLoading,
}: {
  title: string;
  icon: any;
  keyLabel: string;
  rows: DashboardBreakdownRow[] | undefined;
  isLoading: boolean;
}) {
  const [sortKey, setSortKey] = useState<BreakdownSortKey>("profit");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    if (!rows) return [];
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggle(col: BreakdownSortKey) {
    if (col === sortKey) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir(typeof rows?.[0]?.[col] === "number" ? "desc" : "asc");
    }
  }

  function Th({ col, children, align = "right" }: { col: BreakdownSortKey; children: React.ReactNode; align?: "left" | "right" }) {
    const active = col === sortKey;
    return (
      <th
        onClick={() => toggle(col)}
        className={`px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap ${align === "right" ? "text-right" : "text-left"} ${active ? "text-foreground" : "text-muted-foreground"} hover:text-foreground`}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          <ArrowUpDown size={11} className={active ? "opacity-100" : "opacity-30"} />
          {active && <span className="text-[10px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
        </span>
      </th>
    );
  }

  return (
    <Card className="bg-card/50 backdrop-blur border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon size={18} className="text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {isLoading ? (
          <div className="space-y-2 px-6 pb-6">
            <Skeleton className="h-8 w-full bg-muted/50" />
            <Skeleton className="h-8 w-full bg-muted/50" />
            <Skeleton className="h-8 w-full bg-muted/50" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No data available</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <Th col="label" align="left">{keyLabel}</Th>
                  <Th col="batches">Batches</Th>
                  <Th col="tested">Tested</Th>
                  <Th col="clicks">Visits</Th>
                  <Th col="cost">Spend</Th>
                  <Th col="revenue">Revenue</Th>
                  <Th col="profit">Profit</Th>
                  <Th col="roi">ROI</Th>
                  <Th col="conversions">Conv</Th>
                  <Th col="winners">Win</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map(r => {
                  const dot =
                    r.profit > 0 ? "bg-green-500" :
                    r.profit < 0 ? "bg-red-500" :
                    "bg-gray-400";
                  return (
                    <tr key={r.key} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                          {r.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.batches}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.tested}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.clicks.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">${r.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className="px-3 py-2 text-right tabular-nums">${r.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.profit > 0 ? "text-green-600" : r.profit < 0 ? "text-red-600" : ""}`}>
                        ${r.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.roi > 0 ? "text-green-600" : r.roi < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                        {r.roi}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.conversions}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-green-700 font-semibold">{r.winners > 0 ? r.winners : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
