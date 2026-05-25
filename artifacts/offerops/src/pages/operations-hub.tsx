/**
 * Operations Hub — live operational overview at /ops.
 * UI-only restructuring; existing APIs unchanged.
 */

import { useMemo } from "react";
import { useLocation } from "wouter";
import {
  useListTestingBatches,
  useListTodoTasks,
  useListPerformance,
  useListCampaigns,
  useListEmployees,
  getListTestingBatchesQueryKey,
  getListTodoTasksQueryKey,
  getListPerformanceQueryKey,
  getListCampaignsQueryKey,
  getListEmployeesQueryKey,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { DateFilterBar } from "@/components/date-filter-bar";
import { useDateFilterState } from "@/hooks/use-date-filter-state";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CompactKpi } from "@/components/operations-hub/compact-kpi";
import { BatchAttentionPanel } from "@/components/operations-hub/batch-attention-panel";
import { PerformancePanel } from "@/components/operations-hub/performance-panel";
import { ActivityAlertsPanel } from "@/components/operations-hub/activity-alerts-panel";
import {
  Activity,
  AlertTriangle,
  CheckSquare,
  Layers,
  Radio,
  TrendingUp,
  Trophy,
  Users,
  Zap,
  ArrowRight,
  Network,
} from "lucide-react";

function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function PipelineWidget({
  label,
  count,
  hint,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  hint?: string;
  tone?: "default" | "urgent";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-3 text-left transition-colors hover:border-primary/30 hover:shadow-sm ${
        tone === "urgent" && count > 0
          ? "border-amber-300/80 bg-amber-50/50 dark:bg-amber-950/20"
          : "border-border bg-card"
      } ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{count}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </button>
  );
}

export default function OperationsHub() {
  const { activeWorkspaceId } = useWorkspace();
  const [, nav] = useLocation();
  const wsId = activeWorkspaceId ?? 0;
  const today = todayIso();

  const {
    preset: perfPreset,
    dateFrom: perfDateFrom,
    dateTo: perfDateTo,
    setPreset: setPerfPreset,
    setCustomRange: setPerfCustomRange,
  } = useDateFilterState({
    storageKey: "offerops.dateFilter.ops",
    defaultPreset: "last7",
    syncUrl: false,
  });

  const batchParams = { workspace_id: wsId };
  const { data: batches = [], isLoading: batchesLoading } = useListTestingBatches(
    batchParams,
    wsQueryOpts(activeWorkspaceId, getListTestingBatchesQueryKey(batchParams), {
      staleTime: 30_000,
    }),
  );
  const { data: tasks = [], isLoading: tasksLoading } = useListTodoTasks(
    batchParams,
    wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey(batchParams)),
  );
  const { data: campaigns = [] } = useListCampaigns(
    { workspace_id: wsId },
    wsQueryOpts(activeWorkspaceId, getListCampaignsQueryKey({ workspace_id: wsId })),
  );
  const { data: employees = [] } = useListEmployees(
    batchParams,
    wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(batchParams)),
  );

  const perfParams = { workspace_id: wsId, date_from: perfDateFrom, date_to: perfDateTo };
  const { data: perfRecords = [] } = useListPerformance(
    perfParams,
    wsQueryOpts(activeWorkspaceId, getListPerformanceQueryKey(perfParams)),
  );

  const stats = useMemo(() => {
    const liveCampaigns = campaigns.filter((c) => c.status === "live").length;
    const activeBatches = batches.filter(
      (b) => b.status === "LIVE_TESTS" || b.status === "TESTED",
    ).length;
    const pendingTasks = tasks.filter((t) => t.status !== "DONE").length;
    const blockedTasks = tasks.filter((t) => t.status === "BLOCKED").length;

    let spend = 0;
    let revenue = 0;
    const profitByEmployee = new Map<number, number>();
    for (const r of perfRecords) {
      spend += Number(r.spend ?? 0);
      revenue += Number(r.revenue ?? 0);
      const batch = batches.find((b) => b.id === r.batchId);
      if (batch?.employeeId != null) {
        profitByEmployee.set(
          batch.employeeId,
          (profitByEmployee.get(batch.employeeId) ?? 0) + Number(r.profit ?? 0),
        );
      }
    }
    const profit = revenue - spend;
    const roi = spend > 0 ? (profit / spend) * 100 : 0;

    let topEmployee: { name: string; profit: number } | null = null;
    for (const [empId, p] of profitByEmployee) {
      if (!topEmployee || p > topEmployee.profit) {
        topEmployee = {
          name: employees.find((e) => e.id === empId)?.name ?? `Employee #${empId}`,
          profit: p,
        };
      }
    }

    const testingCount = batches.filter((b) =>
      ["NEW_BATCH", "WAITING_FOR_TRACKER_CAMPAIGNS", "OFFER_READY_FOR_LIVE_TESTING"].includes(
        b.status,
      ),
    ).length;
    const scaleReady = batches.filter((b) => b.status === "TESTED").length;
    const liveTesting = batches.filter((b) => b.status === "LIVE_TESTS").length;
    const weekAgo = Date.now() - 7 * 86_400_000;
    const recentlyCompleted = batches.filter((b) => {
      if (b.status !== "COMPLETED") return false;
      const end = b.testEndDate ?? b.createdAt;
      return end && new Date(end).getTime() >= weekAgo;
    }).length;
    const blockedBatchIds = new Set(
      tasks
        .filter((t) => t.status === "BLOCKED" && t.relatedBatchId)
        .map((t) => t.relatedBatchId!),
    );
    const blockedFlows = blockedBatchIds.size;

    const bySource = new Map<string, { live: number; tested: number }>();
    for (const b of batches) {
      const src = b.trafficSource || "(unset)";
      const ex = bySource.get(src) ?? { live: 0, tested: 0 };
      if (b.status === "LIVE_TESTS") ex.live += 1;
      if (b.status === "TESTED") ex.tested += 1;
      bySource.set(src, ex);
    }
    const trafficSources = [...bySource.entries()]
      .filter(([, v]) => v.live + v.tested > 0)
      .sort((a, b) => b[1].live + b[1].tested - (a[1].live + a[1].tested))
      .slice(0, 4);

    // TODO(ops-hub): Replace with a real "winners found today" signal (e.g.
    // winner_added activity count or batch_results.winners in period). Until
    // then this KPI is a temporary proxy: count of profitable daily metric
    // rows dated today (not actual winner classifications).
    const winnersToday = perfRecords
      .filter((r) => r.date === today && Number(r.profit ?? 0) > 0)
      .length;

    return {
      liveCampaigns,
      activeBatches,
      pendingTasks,
      blockedTasks,
      revenue,
      roi,
      topEmployee,
      testingCount,
      scaleReady,
      liveTesting,
      recentlyCompleted,
      blockedFlows,
      trafficSources,
      winnersToday,
    };
  }, [batches, tasks, campaigns, perfRecords, employees, today]);

  const loading = batchesLoading || tasksLoading;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="mx-auto max-w-6xl space-y-8 overflow-x-hidden px-4 py-5 pb-12 md:px-6">
        <header>
          <div className="flex items-center gap-2 text-primary">
            <Radio className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-widest">
              Operations Hub
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight">Command center</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Operational pipeline, performance, and alerts in one place.
          </p>
        </header>

        {/* Section 1 — KPIs */}
        <section aria-labelledby="ops-kpis">
          <h2 id="ops-kpis" className="sr-only">
            Key metrics
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <CompactKpi
              label="Live campaigns"
              value={stats.liveCampaigns}
              icon={Radio}
              loading={loading}
              onClick={() => nav("/live-campaigns")}
            />
            <CompactKpi
              label="Active batches"
              value={stats.activeBatches}
              icon={Layers}
              loading={loading}
              onClick={() => nav("/testing-batches")}
            />
            <CompactKpi
              label="Tasks pending"
              value={stats.pendingTasks}
              icon={CheckSquare}
              loading={loading}
              tone={stats.pendingTasks > 0 ? "warning" : "neutral"}
              onClick={() => nav("/tasks")}
            />
            <CompactKpi
              label="Tasks blocked"
              value={stats.blockedTasks}
              icon={AlertTriangle}
              loading={loading}
              tone={stats.blockedTasks > 0 ? "critical" : "neutral"}
              onClick={() => nav("/tasks")}
            />
            <CompactKpi
              label="Winners today"
              value={stats.winnersToday}
              icon={Trophy}
              sub="proxy: profitable rows today"
              loading={loading}
            />
            <CompactKpi
              label="Revenue"
              value={fmt$(stats.revenue)}
              icon={TrendingUp}
              sub="7-day window"
              loading={loading}
            />
            <CompactKpi
              label="ROI"
              value={fmtPct(stats.roi)}
              icon={Activity}
              sub="7-day window"
              loading={loading}
              tone={stats.roi >= 0 ? "positive" : "warning"}
            />
            <CompactKpi
              label="Most active"
              value={stats.topEmployee?.name ?? "—"}
              icon={Users}
              sub={
                stats.topEmployee ? fmt$(stats.topEmployee.profit) + " profit" : undefined
              }
              loading={loading}
            />
          </div>
        </section>

        {/* Section 2 — Operational pipeline */}
        <section className="space-y-4" aria-labelledby="ops-pipeline">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <h2
              id="ops-pipeline"
              className="text-sm font-bold uppercase tracking-widest text-muted-foreground"
            >
              Operational pipeline
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <PipelineWidget
              label="Testing batches"
              count={stats.testingCount}
              hint="Pre-live stages"
              onClick={() => nav("/testing-batches")}
            />
            <PipelineWidget
              label="Scale ready"
              count={stats.scaleReady}
              hint="Pick winners"
              tone="urgent"
              onClick={() => nav("/testing-batches")}
            />
            <PipelineWidget
              label="Live testing"
              count={stats.liveTesting}
              onClick={() => nav("/testing-batches")}
            />
            <PipelineWidget
              label="Recently completed"
              count={stats.recentlyCompleted}
              hint="Last 7 days"
            />
            <PipelineWidget
              label="Blocked flows"
              count={stats.blockedFlows}
              tone="urgent"
              onClick={() => nav("/tasks")}
            />
            <div className="col-span-2 sm:col-span-3 lg:col-span-1 rounded-lg border border-border bg-card px-3 py-3">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Network className="h-3 w-3" /> Traffic sources
              </p>
              {stats.trafficSources.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">No active sources</p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs">
                  {stats.trafficSources.map(([src, v]) => (
                    <li key={src} className="flex justify-between gap-2">
                      <span className="truncate font-medium">{src}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {v.live} live · {v.tested} tested
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              Batch health — what needs attention first
            </p>
            <BatchAttentionPanel />
          </div>
        </section>

        {/* Section 3 — Performance */}
        <section className="space-y-3" aria-labelledby="ops-performance">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2
              id="ops-performance"
              className="text-sm font-bold uppercase tracking-widest text-muted-foreground"
            >
              Performance visibility
            </h2>
          </div>
          <DateFilterBar
            preset={perfPreset}
            onPresetChange={setPerfPreset}
            dateFrom={perfDateFrom}
            dateTo={perfDateTo}
            onCustomRangeChange={setPerfCustomRange}
          />
          <PerformancePanel dateFrom={perfDateFrom} dateTo={perfDateTo} />
        </section>

        {/* Section 4 — Activity + alerts */}
        <section className="space-y-3" aria-labelledby="ops-activity">
          <div className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <h2
              id="ops-activity"
              className="text-sm font-bold uppercase tracking-widest text-muted-foreground"
            >
              Activity & alerts
            </h2>
          </div>
          <ActivityAlertsPanel />
        </section>
      </div>
    </TooltipProvider>
  );
}
