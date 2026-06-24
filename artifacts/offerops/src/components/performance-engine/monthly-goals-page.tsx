import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  HelpCircle,
  Plus,
  Trophy,
  Copy,
  Upload,
  Zap,
  AlertCircle,
  RefreshCw,
  Pencil,
} from "lucide-react";
import {
  useListEmployees,
  useListGeos,
  getListEmployeesQueryKey,
  getListGeosQueryKey,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KpiCard } from "@/components/performance-engine/kpi-card";
import { KpiBreakdownPanel } from "@/components/performance-engine/kpi-breakdown-panel";
import { InitialsBadge } from "@/components/performance-engine/initials-badge";
import { SegmentedProgress } from "@/components/performance-engine/segmented-progress";
import { CreateGoalPlanModal, type GoalPlanEditContext } from "@/components/performance-engine/create-goal-plan-modal";
import { MonthlyGoalWorkerDrawer } from "@/components/performance-engine/monthly-goal-worker-drawer";
import { ensureGoalsConfig, useGoalsConfig } from "@/lib/goals-config";
import {
  currentMonthKey,
  fetchMonthlyGoalsDashboard,
  formatMonthLabel,
  shiftMonthKey,
  kpiMetricToBreakdown,
  type MetricBreakdownKind,
  type WorkerMonthlyRow,
} from "@/lib/performance-engine/api";
import { goalsForWorkerMonth, networkNamesInPlan } from "@/lib/performance-engine/goal-plan-utils";
import { Link } from "wouter";

function StatusPill({ status }: { status: WorkerMonthlyRow["status"] }) {
  const cls =
    status === "Strong"
      ? "bg-green-100 text-green-800"
      : status === "On track"
        ? "bg-emerald-50 text-emerald-700"
        : status === "Watch"
          ? "bg-amber-100 text-amber-800"
          : "bg-red-100 text-red-800";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

function MetricCell({
  current,
  target,
  pct,
  prefix = "",
}: {
  current: number;
  target: number;
  pct: number;
  prefix?: string;
}) {
  if (target <= 0) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  return (
    <div>
      <p className="text-sm font-medium">
        {prefix}
        {current.toLocaleString()} / {prefix}
        {target.toLocaleString()}
      </p>
      <p className="text-xs text-muted-foreground">{pct}%</p>
    </div>
  );
}

export function MonthlyGoalsPage() {
  const qc = useQueryClient();
  const { activeWorkspaceId } = useWorkspace();
  const wsId = activeWorkspaceId ?? 0;
  const wsParams = { workspace_id: wsId };

  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [workerFilter, setWorkerFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedBreakdown, setSelectedBreakdown] = useState<MetricBreakdownKind | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editContext, setEditContext] = useState<GoalPlanEditContext | null>(null);
  const [drawerWorker, setDrawerWorker] = useState<WorkerMonthlyRow | null>(null);
  const [howOpen, setHowOpen] = useState(false);

  const { data: goalsCfgRaw } = useGoalsConfig();
  const goalsCfg = ensureGoalsConfig(goalsCfgRaw);

  const scopeEmployeeId = workerFilter !== "all" ? Number(workerFilter) : undefined;

  const dashQ = useQuery({
    queryKey: ["monthly-goals", wsId, monthKey, scopeEmployeeId ?? "all"],
    enabled: wsId > 0,
    queryFn: () => fetchMonthlyGoalsDashboard(wsId, monthKey, scopeEmployeeId),
  });

  const { data: employees = [] } = useListEmployees(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(wsParams)),
  );
  const { data: geos = [] } = useListGeos(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListGeosQueryKey(wsParams)),
  );

  const selectedWorkerName =
    workerFilter !== "all"
      ? (dashQ.data?.workers ?? []).find((w) => String(w.employeeId) === workerFilter)?.name
      : undefined;

  const filteredWorkers = useMemo(() => {
    let rows = dashQ.data?.workers ?? [];
    if (workerFilter !== "all") {
      rows = rows.filter((w) => String(w.employeeId) === workerFilter);
    }
    if (statusFilter !== "all") {
      rows = rows.filter((w) => w.status === statusFilter);
    }
    return rows;
  }, [dashQ.data?.workers, workerFilter, statusFilter]);

  function openCreate() {
    setEditContext(null);
    setCreateOpen(true);
  }

  function openEdit(worker: WorkerMonthlyRow, networkName?: string | null) {
    const workerGoals = goalsForWorkerMonth(goalsCfg.workerGoalTargets, worker.employeeId, monthKey);
    const networks = networkNamesInPlan(workerGoals);
    setEditContext({
      employeeId: worker.employeeId,
      monthKey,
      networkName: networkName !== undefined ? networkName : networks[0] ?? null,
    });
    setCreateOpen(true);
  }

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["monthly-goals", wsId, monthKey] });
    void qc.invalidateQueries({ queryKey: ["metric-breakdown", wsId, monthKey] });
    void qc.invalidateQueries({ queryKey: ["goal-allocation", wsId, monthKey] });
    void qc.invalidateQueries({ queryKey: ["goals-config"] });
  }

  function toggleBreakdown(metricKey: string) {
    const kind = kpiMetricToBreakdown(metricKey);
    if (!kind) return;
    setSelectedBreakdown((prev) => (prev === kind ? null : kind));
  }

  const dashErrorMessage =
    dashQ.error instanceof Error ? dashQ.error.message : dashQ.isError ? "Unknown error" : null;

  return (
    <div className="p-6 lg:p-8 max-w-[1400px]">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Monthly Goals</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}>
            <ChevronLeft size={16} />
          </Button>
          <span className="text-sm font-semibold min-w-[120px] text-center">{formatMonthLabel(monthKey)}</span>
          <Button variant="outline" size="icon" onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}>
            <ChevronRight size={16} />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setHowOpen((v) => !v)}>
            <HelpCircle size={14} className="mr-1.5" />
            How it works
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} className="mr-1.5" />
            Create Monthly Goal Plan
          </Button>
        </div>
      </div>

      {howOpen && (
        <div className="mb-4 rounded-lg border bg-blue-50/50 p-4 text-sm text-muted-foreground">
          Set monthly targets per worker for revenue, testing batches, and working campaigns. Progress is
          calculated from live workspace data. XP is awarded automatically when a goal is completed (once per
          goal). Use XP Rules to configure action-based rewards.
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-6">
        <Select value={workerFilter} onValueChange={(v) => {
          setWorkerFilter(v);
          setSelectedBreakdown(null);
        }}>
          <SelectTrigger className="w-[160px] h-9">
            <SelectValue placeholder="All Workers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workers</SelectItem>
            {(dashQ.data?.workers ?? []).map((w) => (
              <SelectItem key={w.employeeId} value={String(w.employeeId)}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="Strong">Strong</SelectItem>
            <SelectItem value="On track">On track</SelectItem>
            <SelectItem value="Watch">Watch</SelectItem>
            <SelectItem value="Behind">Behind</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-9">
          <Filter size={14} className="mr-1.5" />
          Filters
        </Button>
      </div>

      {dashQ.isError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-red-900">Performance data could not be loaded.</p>
              {dashErrorMessage && (
                <p className="text-xs text-red-700 mt-1 break-words">{dashErrorMessage}</p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => refresh()} className="shrink-0">
              <RefreshCw size={14} className="mr-1.5" />
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* KPI cards */}
      {dashQ.isLoading ? (
        <p className="text-muted-foreground text-sm mb-6">Loading goals…</p>
      ) : dashQ.isError ? null : (
        <div className="grid gap-4 md:grid-cols-3 mb-4">
          {(dashQ.data?.kpis ?? []).map((kpi) => {
            const breakdownKind = kpiMetricToBreakdown(kpi.metricKey);
            return (
              <KpiCard
                key={kpi.metricKey}
                kpi={kpi}
                selected={breakdownKind != null && selectedBreakdown === breakdownKind}
                onClick={() => toggleBreakdown(kpi.metricKey)}
              />
            );
          })}
        </div>
      )}

      {selectedBreakdown && !dashQ.isError && (
        <KpiBreakdownPanel
          workspaceId={wsId}
          monthKey={monthKey}
          metric={selectedBreakdown}
          employeeId={scopeEmployeeId}
          workerName={selectedWorkerName}
          onClose={() => setSelectedBreakdown(null)}
        />
      )}

      {/* Team table */}
      {dashQ.isError ? null : (
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden mb-8">
        <div className="px-4 py-3 border-b">
          <h2 className="font-semibold">Team Goals Overview</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-muted-foreground uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 font-medium">Worker</th>
                <th className="px-4 py-3 font-medium">Revenue</th>
                <th className="px-4 py-3 font-medium">Tests</th>
                <th className="px-4 py-3 font-medium">Working Campaigns</th>
                <th className="px-4 py-3 font-medium">Profit</th>
                <th className="px-4 py-3 font-medium">XP Earned</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Progress</th>
                <th className="px-4 py-3 font-medium w-[100px]">Plan</th>
              </tr>
            </thead>
            <tbody>
              {dashQ.isLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                    Loading team goals…
                  </td>
                </tr>
              ) : filteredWorkers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                    No workers match the current filters. Create a monthly goal plan to get started.
                  </td>
                </tr>
              ) : (
                filteredWorkers.map((w) => (
                  <tr
                    key={w.employeeId}
                    className="border-t hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => setDrawerWorker(w)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <InitialsBadge initials={w.initials} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{w.name}</p>
                          {w.email && <p className="text-xs text-muted-foreground truncate">{w.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <MetricCell {...w.revenue} pct={w.revenue.progressPct} prefix="$" />
                    </td>
                    <td className="px-4 py-3">
                      <MetricCell {...w.testing} pct={w.testing.progressPct} />
                    </td>
                    <td className="px-4 py-3">
                      <MetricCell {...w.working} pct={w.working.progressPct} />
                    </td>
                    <td className="px-4 py-3">
                      {w.profit != null ? (
                        <span className="font-medium">${w.profit.toLocaleString()}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">{w.xpEarned.toLocaleString()} XP</td>
                    <td className="px-4 py-3"><StatusPill status={w.status} /></td>
                    <td className="px-4 py-3">
                      <SegmentedProgress filled={w.progressSegments} status={w.status} />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        onClick={() => openEdit(w)}
                      >
                        <Pencil size={14} className="mr-1" />
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Bottom section */}
      {!dashQ.isError && (
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <h3 className="font-semibold mb-3">Quick Actions</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg border p-3 text-left hover:bg-slate-50 transition-colors"
            >
              <p className="text-sm font-medium">Create Goal Plan</p>
              <p className="text-xs text-muted-foreground">Set goals for a worker or team</p>
            </button>
            <div className="rounded-lg border p-3 opacity-50 cursor-not-allowed" title="Coming soon">
              <p className="text-sm font-medium flex items-center gap-1"><Copy size={14} /> Copy Goal Plan</p>
              <p className="text-xs text-muted-foreground">Coming soon</p>
            </div>
            <div className="rounded-lg border p-3 opacity-50 cursor-not-allowed" title="Coming soon">
              <p className="text-sm font-medium flex items-center gap-1"><Upload size={14} /> Import Goals</p>
              <p className="text-xs text-muted-foreground">Coming soon</p>
            </div>
            <Link
              href="/performance/xp-rules"
              className="rounded-lg border p-3 text-left hover:bg-slate-50 transition-colors block"
            >
              <p className="text-sm font-medium flex items-center gap-1"><Zap size={14} /> Manage XP Rules</p>
              <p className="text-xs text-muted-foreground">Create & edit XP rules</p>
            </Link>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <h3 className="font-semibold mb-3">XP Leaderboard</h3>
          {(dashQ.data?.leaderboard.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No XP earned this month yet.</p>
          ) : (
            <ul className="space-y-2">
              {dashQ.data!.leaderboard.slice(0, 5).map((row) => (
                <li key={row.employeeId} className="flex items-center gap-3">
                  <span className="text-lg w-6 text-center">
                    {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : (
                      <Trophy size={14} className="inline text-muted-foreground" />
                    )}
                  </span>
                  <InitialsBadge initials={row.initials} size="sm" />
                  <span className="flex-1 text-sm font-medium truncate">{row.name}</span>
                  <span className="text-sm font-semibold text-blue-600">{row.xp.toLocaleString()} XP</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      )}

      <MonthlyGoalWorkerDrawer
        worker={drawerWorker}
        workspaceId={wsId}
        monthKey={monthKey}
        open={drawerWorker != null}
        onClose={() => setDrawerWorker(null)}
        onEditPlan={(w, networkName) => {
          setDrawerWorker(null);
          openEdit(w, networkName);
        }}
      />

      <CreateGoalPlanModal
        open={createOpen}
        onOpenChange={(v) => {
          if (!v) setEditContext(null);
          setCreateOpen(v);
        }}
        workspaceId={wsId}
        monthKey={monthKey}
        employees={employees.map((e) => ({ id: e.id, name: e.name }))}
        geos={geos.map((g) => ({ id: g.id, code: g.code }))}
        allGoals={goalsCfg.workerGoalTargets}
        editContext={editContext}
        onSaved={refresh}
      />
    </div>
  );
}
