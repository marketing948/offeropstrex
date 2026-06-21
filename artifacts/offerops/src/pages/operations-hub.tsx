/**
 * Operations Hub — approved operator command center at /ops and /operations.
 */

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useListTestingBatches,
  useListTodoTasks,
  useListPerformance,
  useListCampaigns,
  useListOffers,
  getListTestingBatchesQueryKey,
  getListTodoTasksQueryKey,
  getListPerformanceQueryKey,
  getListCampaignsQueryKey,
  getListOffersQueryKey,
} from "@workspace/api-client-react";
import { wsQueryOpts } from "@/lib/ws-query";
import { useWorkspace } from "@/lib/workspace-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OpsKpiStripCard } from "@/components/operations-hub/ops-kpi-strip";
import {
  OpsOperatorTop,
  useOpsDrilldownData,
} from "@/components/operations-hub/ops-operator-top";
import { TodaysFocusCard } from "@/components/operations-hub/todays-focus-card";
import { RevenueByNetworkSection } from "@/components/operations-hub/revenue-by-network-section";
import { OpenTasksPanel } from "@/components/operations-hub/open-tasks-panel";
import {
  OpsActionDrilldown,
  useOpsDrilldownRoute,
} from "@/components/operations-hub/ops-action-drilldown";
import type { GoalKind, OpsCampaignRow } from "@/components/operations-hub/ops-hub-drilldown-data";
import { classifyOpenTasks } from "@/components/operations-hub/ops-task-counts";
import { CalendarDays, CheckSquare, Hand, Radio, Square, Trophy, Zap } from "lucide-react";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const campaignCast = (campaigns: unknown[]): OpsCampaignRow[] =>
  campaigns as OpsCampaignRow[];

export default function OperationsHub() {
  const { activeWorkspaceId } = useWorkspace();
  const [, nav] = useLocation();
  const wsId = activeWorkspaceId ?? 0;
  const today = todayIso();

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
  const { data: offers = [] } = useListOffers(
    batchParams,
    wsQueryOpts(activeWorkspaceId, getListOffersQueryKey(batchParams)),
  );

  const campaignsTyped = campaignCast(campaigns);
  const drilldownRoute = useOpsDrilldownRoute();
  const drilldown = useOpsDrilldownData(batches, campaignsTyped, tasks);

  const winnersParams = { workspace_id: wsId, date_from: today, date_to: today };
  const { data: todayPerf = [] } = useListPerformance(
    winnersParams,
    wsQueryOpts(activeWorkspaceId, getListPerformanceQueryKey(winnersParams)),
  );

  const stats = useMemo(() => {
    const liveCampaigns = campaigns.filter((c) => c.status === "live").length;
    const taskCounts = classifyOpenTasks(tasks);
    const winnersToday = todayPerf.filter((r) => Number(r.profit ?? 0) > 0).length;
    return {
      liveCampaigns,
      pendingTasks: taskCounts.pending,
      blockedTasks: taskCounts.blocked,
      winnersToday,
    };
  }, [campaigns, tasks, todayPerf]);

  const loading = batchesLoading || tasksLoading || drilldown.isLoading;
  const [selectedMetric, setSelectedMetric] = useState<GoalKind>("revenue");

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-0 w-full bg-[#f4f6f9] px-4 pt-8 pb-8 md:px-8 md:pt-9">
        <div className="mx-auto max-w-[1200px] space-y-6">
          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 shadow-sm">
                  <Zap className="h-5 w-5" strokeWidth={2.5} />
                </div>
                <div>
                  <h1 className="text-2xl font-black uppercase tracking-[0.1em] text-slate-900 md:text-[1.65rem]">
                    Operations Hub
                  </h1>
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-500">
                    Your daily goals, focus, and action queue — not a report.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-4 py-2.5 shadow-sm">
                <CalendarDays className="h-4 w-4 text-violet-600" strokeWidth={2.25} />
                <p className="text-sm font-bold tabular-nums text-slate-800">
                  {drilldown.monthLabel} · {drilldown.daysRemaining} day
                  {drilldown.daysRemaining === 1 ? "" : "s"} left
                </p>
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-violet-600/80">
              <Hand className="h-3.5 w-3.5" strokeWidth={2} />
              Tap a goal to expand network progress
            </p>
          </header>

          <OpsOperatorTop
            batches={batches}
            campaigns={campaignsTyped}
            tasks={tasks}
            loading={loading}
            selectedMetric={selectedMetric}
            onSelectMetric={setSelectedMetric}
          />

          {drilldownRoute && (
            <OpsActionDrilldown
              metric={drilldownRoute.metric}
              network={drilldownRoute.network}
              batches={batches}
              campaigns={campaignsTyped}
              offers={offers}
            />
          )}

          <RevenueByNetworkSection
            selectedMetric={selectedMetric}
            goalCards={drilldown.goalCards}
            networkGroups={drilldown.networkGroups}
            mtdRevenue={drilldown.mtdRevenue}
            attributedRevenueMtd={drilldown.attributedRevenueMtd}
            unattributedRevenueMtd={drilldown.unattributedRevenueMtd}
            loading={loading}
          />

          <TodaysFocusCard focus={drilldown.focus} loading={loading} />

          <OpenTasksPanel tasks={tasks} loading={tasksLoading} />

          <section aria-labelledby="ops-kpi-strip">
            <h2 id="ops-kpi-strip" className="sr-only">
              Quick KPI strip
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OpsKpiStripCard
                label="Live Campaigns"
                value={stats.liveCampaigns}
                sub="Active now"
                icon={Radio}
                theme="green"
                loading={loading}
                onClick={() => nav("/live-campaigns")}
              />
              <OpsKpiStripCard
                label="Tasks Pending"
                value={stats.pendingTasks}
                sub="Needs action"
                icon={CheckSquare}
                theme="amber"
                loading={loading}
                onClick={() => nav("/tasks")}
              />
              <OpsKpiStripCard
                label="Tasks Blocked"
                value={stats.blockedTasks}
                sub="Waiting"
                icon={Square}
                theme="red"
                loading={loading}
                onClick={() => nav("/tasks")}
              />
              <OpsKpiStripCard
                label="Winners Today"
                value={stats.winnersToday}
                sub="Potential winners"
                icon={Trophy}
                theme="purple"
                loading={loading}
              />
            </div>
          </section>
        </div>
      </div>
    </TooltipProvider>
  );
}
