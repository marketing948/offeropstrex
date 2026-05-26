import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  useGetAdminDashboardSummary,
  useGetBatchStatusBreakdown,
  useGetEmployeeLeaderboard,
  useListOffers,
  useListTestingBatches,
  useListTodoTasks,
  useListSuspiciousBatches,
  useListNotifications,
  useListEmployees,
  getGetAdminDashboardSummaryQueryKey,
  getGetEmployeeLeaderboardQueryKey,
  getGetBatchStatusBreakdownQueryKey,
  getListTestingBatchesQueryKey,
  getListOffersQueryKey,
  getListTodoTasksQueryKey,
  getListSuspiciousBatchesQueryKey,
  getListNotificationsQueryKey,
  getListEmployeesQueryKey,
  type DashboardBreakdowns,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { useAlertRules } from "@/hooks/use-alert-rules";
import { useAuth } from "@/lib/auth";
import { authedJson } from "@/lib/api-fetch";
import { DateFilterBar } from "@/components/date-filter-bar";
import { useDateFilterState } from "@/hooks/use-date-filter-state";
import {
  fetchOperationalActivityRange,
  formatActivityTime,
  OPERATIONAL_ACTIVITY_EVENT_LABELS,
  type OperationalActivityEventType,
} from "@/lib/operational-activity";
import {
  buildExecutiveAlerts,
  buildPipelineSignals,
  buildWinnerLifecycleRows,
  buildWorkforceRows,
  countBurnRiskCampaigns,
  type LiveCampaignRow,
} from "@/lib/executive-dashboard";
import { AlertCard } from "@/components/executive-dashboard/alert-card";
import { DashboardSection } from "@/components/executive-dashboard/section-shell";
import { CompactKpi } from "@/components/operations-hub/compact-kpi";
import { KpiStripSkeleton } from "@/components/operational-state/operational-skeletons";
import { OperationalEmpty } from "@/components/operational-state/operational-empty";
import { OperationalError } from "@/components/operational-state/operational-error";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CircleDollarSign,
  Flame,
  Layers,
  Radio,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Zap,
  Globe2,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function fmt$(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

type LiveCampaignsApiResponse = {
  items: Array<{
    id: number;
    campaignName: string;
    batchId: number | null;
    batchName: string | null;
    campaignPurpose: string;
    status: string;
    liveStartedAt: string | null;
    clicks: number | null;
    conversions: number | null;
    roi: string | null;
    employeeName: string | null;
  }>;
};

export function ExecutiveDashboardView() {
  const { activeWorkspaceId } = useWorkspace();
  const { rules } = useAlertRules();
  const { currentEmployee } = useAuth();
  const [, navigate] = useLocation();
  const wsId = activeWorkspaceId ?? 0;

  const {
    preset,
    dateFrom,
    dateTo,
    setPreset,
    setCustomRange,
  } = useDateFilterState({
    storageKey: "offerops.dateFilter.executive",
    defaultPreset: "last7",
    syncUrl: true,
  });

  const [employeeFilter, setEmployeeFilter] = useState<string>("all");

  const summaryParams = useMemo(
    () => ({
      workspace_id: wsId,
      date_from: dateFrom,
      date_to: dateTo,
      ...(employeeFilter !== "all" ? { employee_id: Number(employeeFilter) } : {}),
    }),
    [wsId, dateFrom, dateTo, employeeFilter],
  );

  const leaderboardParams = useMemo(
    () => ({
      workspace_id: wsId,
      date_from: dateFrom,
      date_to: dateTo,
    }),
    [wsId, dateFrom, dateTo],
  );

  const wsParams = { workspace_id: wsId };

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    error: summaryErr,
    refetch: refetchSummary,
  } = useGetAdminDashboardSummary(
    summaryParams,
    wsQueryOpts(activeWorkspaceId, getGetAdminDashboardSummaryQueryKey(summaryParams)),
  );

  const { data: leaderboard = [], isLoading: leaderboardLoading } = useGetEmployeeLeaderboard(
    leaderboardParams,
    wsQueryOpts(activeWorkspaceId, getGetEmployeeLeaderboardQueryKey(leaderboardParams)),
  );

  const { data: batches = [] } = useListTestingBatches(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListTestingBatchesQueryKey(wsParams)),
  );

  const { data: tasks = [] } = useListTodoTasks(
    { ...wsParams, status_filter: "all" as const },
    wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey({ ...wsParams, status_filter: "all" })),
  );

  const { data: offers = [] } = useListOffers(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListOffersQueryKey(wsParams)),
  );

  const { data: employees = [] } = useListEmployees(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(wsParams)),
  );

  const { data: statusBreakdown = [] } = useGetBatchStatusBreakdown(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getGetBatchStatusBreakdownQueryKey(wsParams)),
  );

  const { data: suspicious = [] } = useListSuspiciousBatches(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListSuspiciousBatchesQueryKey(wsParams)),
  );

  const notifParams = {
    workspace_id: wsId,
    employee_id: currentEmployee?.id ?? 0,
  };
  const { data: notifications = [] } = useListNotifications(
    notifParams,
    wsQueryOpts(activeWorkspaceId, getListNotificationsQueryKey(notifParams)),
  );

  const { data: breakdowns, isLoading: breakdownsLoading } = useQuery<DashboardBreakdowns>({
    queryKey: ["dashboard-breakdowns", wsId, dateFrom, dateTo],
    enabled: !!activeWorkspaceId,
    queryFn: () =>
      authedJson(
        `/api/dashboard/breakdowns?workspace_id=${wsId}&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`,
      ),
  });

  const { data: campaignsResponse, isLoading: campaignsLoading } = useQuery<LiveCampaignsApiResponse>({
    queryKey: ["executive-live-campaigns", wsId],
    enabled: !!activeWorkspaceId,
    queryFn: () =>
      authedJson(`/api/live-campaigns?workspace_id=${wsId}&limit=300&offset=0`),
  });

  const activityQuery = useQuery({
    queryKey: ["executive-activity", wsId, dateFrom, dateTo],
    enabled: !!activeWorkspaceId && !!dateFrom && !!dateTo,
    queryFn: () =>
      fetchOperationalActivityRange({
        workspace_id: wsId,
        date_from: dateFrom,
        date_to: dateTo,
        limitPerDay: 25,
      }),
  });

  const campaigns: LiveCampaignRow[] = useMemo(() => {
    return (campaignsResponse?.items ?? []).map((c) => ({
      id: c.id,
      campaignName: c.campaignName,
      batchId: c.batchId,
      batchName: c.batchName,
      campaignPurpose: c.campaignPurpose,
      status: c.status,
      liveStartedAt: c.liveStartedAt,
      clicks: Number(c.clicks ?? 0),
      conversions: Number(c.conversions ?? 0),
      roi: Number(c.roi ?? 0),
      employeeName: c.employeeName,
    }));
  }, [campaignsResponse?.items]);

  const activeTestingBatches = useMemo(
    () => batches.filter((b) => b.status === "LIVE_TESTS").length,
    [batches],
  );

  const scaleReadyBatches = useMemo(
    () => batches.filter((b) => b.status === "TESTED").length,
    [batches],
  );

  const burnRiskCount = useMemo(
    () => countBurnRiskCampaigns(campaigns, offers),
    [campaigns, offers],
  );

  const syncFailures = useMemo(
    () => notifications.filter((n) => n.type === "API_SYNC_FAILURE" && !n.read).length,
    [notifications],
  );

  const alerts = useMemo(
    () =>
      buildExecutiveAlerts({
        batches,
        tasks,
        offers,
        campaigns,
        suspiciousCount: suspicious.length,
        syncFailureCount: syncFailures,
        rules,
      }),
    [batches, tasks, offers, campaigns, suspicious.length, syncFailures, rules],
  );

  const winnerRows = useMemo(
    () => buildWinnerLifecycleRows(batches, offers, tasks),
    [batches, offers, tasks],
  );

  const pipelineSignals = useMemo(() => buildPipelineSignals(batches), [batches]);

  const workforce = useMemo(
    () =>
      buildWorkforceRows({
        leaderboard,
        byWorker: breakdowns?.byWorker,
        offers,
        batches,
      }),
    [leaderboard, breakdowns?.byWorker, offers, batches],
  );

  const strategicChart = useMemo(() => {
    const rows = [...(breakdowns?.byGeo ?? [])]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 6)
      .map((r) => ({ name: r.label, profit: Math.round(r.profit) }));
    return rows;
  }, [breakdowns?.byGeo]);

  const timelineItems = activityQuery.data ?? [];

  const kpiLoading = summaryLoading || campaignsLoading;

  if (summaryError) {
    return (
      <OperationalError
        title="Couldn't load executive overview"
        error={summaryErr}
        onRetry={() => void refetchSummary()}
      />
    );
  }

  return (
    <div className="space-y-8 pb-10">
      <header className="space-y-4">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <BarChart3 className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-widest">
              Executive Overview
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight">Management intelligence</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Is the business and operational pipeline functioning correctly? High-level signals,
            workforce visibility, and intervention points — not day-to-day execution.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card/50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <DateFilterBar
              preset={preset}
              onPresetChange={setPreset}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onCustomRangeChange={setCustomRange}
            />
          </div>
          <div className="w-full sm:w-48">
            <Label className="text-xs text-muted-foreground">Employee</Label>
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="All employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <DashboardSection
        id="exec-snapshot"
        title="Executive snapshot"
        description="Business health and operational pressure at a glance."
        icon={TrendingUp}
      >
        {kpiLoading ? (
          <KpiStripSkeleton count={8} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <CompactKpi label="Revenue" value={fmt$(summary?.totalRevenue ?? 0)} icon={CircleDollarSign} />
            <CompactKpi
              label="Profit"
              value={fmt$(summary?.totalProfit ?? 0)}
              icon={TrendingUp}
              tone={(summary?.totalProfit ?? 0) >= 0 ? "positive" : "warning"}
            />
            <CompactKpi label="ROI" value={fmtPct(summary?.averageRoi ?? 0)} icon={Activity} />
            <CompactKpi label="Active campaigns" value={summary?.campaignsLive ?? 0} icon={Radio} />
            <CompactKpi label="Testing batches" value={activeTestingBatches} icon={Layers} />
            <CompactKpi label="Winners (period)" value={summary?.winnersFoundThisWeek ?? 0} icon={Trophy} />
            <CompactKpi label="Scale-ready" value={scaleReadyBatches} icon={Target} />
            <CompactKpi
              label="Burn-risk"
              value={burnRiskCount}
              icon={Flame}
              tone={burnRiskCount > 0 ? "warning" : "neutral"}
            />
          </div>
        )}
      </DashboardSection>

      <DashboardSection
        id="exec-attention"
        title="Requires attention"
        description="Intervention signals ranked by severity — click to drill down."
        icon={AlertTriangle}
      >
        {alerts.length === 0 ? (
          <OperationalEmpty
            icon={Zap}
            title="No intervention signals right now"
            description="Pipeline and campaigns look steady for this period. Check Operations Hub for live execution."
            actionLabel="Open Operations Hub"
            onAction={() => navigate("/ops")}
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {alerts.slice(0, 12).map((a) => (
              <AlertCard key={a.id} alert={a} />
            ))}
          </div>
        )}
        {alerts.length > 12 && (
          <p className="text-center text-xs text-muted-foreground">
            +{alerts.length - 12} more signals — refine date range or open Work Queue
          </p>
        )}
      </DashboardSection>

      <DashboardSection
        id="exec-workforce"
        title="Workforce intelligence"
        description="Who is moving the operation forward in this period."
        icon={Users}
      >
        {leaderboardLoading ? (
          <Skeleton className="h-48 w-full rounded-lg" />
        ) : workforce.length === 0 ? (
          <OperationalEmpty
            title="No workforce data for this range"
            description="Adjust the date filter or confirm employees are assigned to this workspace."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Employee</th>
                  <th className="px-3 py-2 text-right font-semibold">Tests launched</th>
                  <th className="px-3 py-2 text-right font-semibold">Campaigns live</th>
                  <th className="px-3 py-2 text-right font-semibold">Winners</th>
                  <th className="px-3 py-2 text-right font-semibold">Scaled</th>
                  <th className="px-3 py-2 text-right font-semibold">Profit</th>
                  <th className="px-3 py-2 text-right font-semibold">ROI</th>
                  <th className="px-3 py-2 text-right font-semibold">Open tasks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {workforce.map((row) => (
                  <tr key={row.employeeId} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5">
                      <Link href={row.href} className="font-medium text-primary hover:underline">
                        {row.name}
                      </Link>
                      {row.activityNote && (
                        <p className="text-[10px] text-amber-700 dark:text-amber-400">{row.activityNote}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.testsLaunched}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.campaignsLaunched}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-green-700">{row.winnersFound}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.winnersScaled}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">{fmt$(row.profit)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(row.roi)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.openTasks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardSection>

      <div className="grid gap-8 lg:grid-cols-2">
        <DashboardSection
          id="exec-winners"
          title="Winner lifecycle"
          description="Prevent winners from stalling between test and scale."
          icon={Trophy}
        >
          {winnerRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No winner lifecycle activity in scope.</p>
          ) : (
            <ul className="space-y-2">
              {winnerRows.slice(0, 8).map((row) => (
                <li key={row.batchId}>
                  <Link
                    href={row.href}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5 hover:border-primary/30"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.batchName}</p>
                      <p className="text-xs text-muted-foreground">{row.stateLabel}</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums">
                      {row.winnerCount}W
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashboardSection>

        <DashboardSection
          id="exec-pipeline"
          title="Pipeline health"
          description="Whether the operational machine is moving."
          icon={Layers}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {pipelineSignals.map((s) => (
              <Link
                key={s.id}
                href={s.href}
                className="rounded-lg border border-border bg-card px-3 py-3 hover:border-primary/30"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{s.count}</p>
              </Link>
            ))}
          </div>
          {statusBreakdown.length > 0 && (
            <div className="mt-3 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusBreakdown} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="status"
                    width={100}
                    tick={{ fontSize: 9 }}
                    tickFormatter={(v: string) => v.replace(/_/g, " ")}
                  />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </DashboardSection>
      </div>

      <DashboardSection
        id="exec-strategic"
        title="Strategic performance"
        description="Lightweight business intelligence — top GEOs in period."
        icon={Globe2}
      >
        {breakdownsLoading ? (
          <Skeleton className="h-36 w-full rounded-lg" />
        ) : strategicChart.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Import daily metrics or widen the date range for GEO profitability.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-44 rounded-lg border border-border bg-card p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={strategicChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v: number) => [fmt$(v), "Profit"]} />
                  <Bar dataKey="profit" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Top traffic sources
              </p>
              {[...(breakdowns?.byTrafficSource ?? [])]
                .sort((a, b) => b.profit - a.profit)
                .slice(0, 4)
                .map((r) => (
                  <div key={r.key} className="flex justify-between gap-2 border-b border-border/60 py-1.5">
                    <span className="truncate">{r.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {fmt$(r.profit)} · {fmtPct(r.roi)}
                    </span>
                  </div>
                ))}
              <Link href="/reports" className="inline-block text-xs font-medium text-primary hover:underline">
                Full reports →
              </Link>
            </div>
          </div>
        )}
      </DashboardSection>

      <DashboardSection
        id="exec-timeline"
        title="Operational timeline"
        description="Recent operational memory for this period."
        icon={Activity}
      >
        {activityQuery.isLoading ? (
          <Skeleton className="h-32 w-full rounded-lg" />
        ) : activityQuery.isError ? (
          <p className="text-sm text-muted-foreground">Activity feed unavailable for this range.</p>
        ) : timelineItems.length === 0 ? (
          <OperationalEmpty
            title="No operational events in this range"
            description="Activity will appear as tasks complete, campaigns go live, and metrics import."
            actionLabel="View Activity"
            onAction={() => navigate("/activity")}
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {timelineItems.slice(0, 15).map((item) => (
              <li key={item.id} className="flex gap-3 px-4 py-3">
                <time className="w-14 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {formatActivityTime(item.createdAt)}
                </time>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">{item.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {OPERATIONAL_ACTIVITY_EVENT_LABELS[
                      item.eventType as OperationalActivityEventType
                    ] ?? item.eventType}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-center">
          <Link href="/activity" className="text-xs font-medium text-primary hover:underline">
            Full activity log →
          </Link>
        </p>
      </DashboardSection>
    </div>
  );
}
