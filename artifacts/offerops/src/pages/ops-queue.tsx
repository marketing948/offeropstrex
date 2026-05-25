import { useMemo, useState } from "react";
import { wsQueryOpts } from "@/lib/ws-query";
import { expLeaderboardTotal } from "@/lib/exp-labels";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetQueues, useGoLiveBatch, useMarkBatchReady, useStartOptimization,
  useCompleteOptimization, getGetQueuesQueryKey,
  useListTestingBatches, useListOffers, useListTodoTasks, useListPerformance,
  useListVoluumMappings, useListEmployees,
  // Pivot Phase 0: VOLUUM_UI_ENABLED gates Voluum-derived UI in this page.
  // The Voluum mapping query keeps importing only because the generated
  // hook is harmless with Voluum off (server returns 410, react-query
  // surfaces empty data).
  useGetAdminDashboardSummary,
  useListSuspiciousBatches,
  getListTestingBatchesQueryKey, getListOffersQueryKey, getListTodoTasksQueryKey, getListEmployeesQueryKey,
  getListPerformanceQueryKey, getListVoluumMappingsQueryKey,
  getGetAdminDashboardSummaryQueryKey, getListSuspiciousBatchesQueryKey,
  type QueueItem, type TestingBatch, type TodoTask, type Performance,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace-context";
import { VOLUUM_UI_ENABLED } from "@/lib/feature-flags";
import { useLocation, Link } from "wouter";
import { LegacyRouteBanner } from "@/components/legacy-route-banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Bar, BarChart, CartesianGrid,
} from "recharts";
import {
  Radio, Zap, CheckCircle2, RefreshCw, TrendingUp, ChevronRight, Clock, Users,
  AlertCircle, Trophy, Target, AlertTriangle, ArrowRight, Flame, MousePointerClick,
  DollarSign, Activity, Globe2, Network, Building2, Layers, BarChart3,
  ArrowUpRight, Star, Crown, Gauge,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useGoalsConfig, computeScores, DEFAULT_CONFIG, getRankForScore, RANK_COLORS,
} from "@/lib/goals-config";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}
function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// Phase 9: 6-state pipeline stages (Bible §6).
const PIPELINE_STAGES = [
  { key: "NEW_BATCH",                     label: "New",              color: "#94a3b8", dot: "#94a3b8" },
  { key: "WAITING_FOR_TRACKER_CAMPAIGNS", label: "Waiting Trackers", color: "#d97706", dot: "#d97706" },
  { key: "OFFER_READY_FOR_LIVE_TESTING",  label: "Ready for Live",   color: "#ea580c", dot: "#ea580c" },
  { key: "LIVE_TESTS",                    label: "Live Tests",       color: "#16a34a", dot: "#16a34a" },
  { key: "TESTED",                        label: "Pick Winners",     color: "#7c3aed", dot: "#7c3aed" },
  { key: "COMPLETED",                     label: "Completed",        color: "#0891b2", dot: "#0891b2" },
] as const;

const PRIORITY_STYLE: Record<string, { cls: string; dot: string }> = {
  critical: { cls: "text-red-700 bg-red-50 border-red-200",     dot: "bg-red-500" },
  high:     { cls: "text-orange-700 bg-orange-50 border-orange-200", dot: "bg-orange-500" },
  medium:   { cls: "text-amber-700 bg-amber-50 border-amber-200",    dot: "bg-amber-400" },
  low:      { cls: "text-blue-700 bg-blue-50 border-blue-200",       dot: "bg-blue-400" },
};

// ─────────────────────────────────────────────────────────────────
// Stat Card
// ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon: Icon, color, urgent, onClick,
}: {
  label: string; value: React.ReactNode; sub?: string;
  icon: React.ElementType; color: string; urgent?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border p-4 transition-all hover:shadow-md group ${
        urgent
          ? "border-orange-300 bg-orange-50 ring-1 ring-orange-200 animate-pulse-slow"
          : "border-border bg-card hover:border-primary/30"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center`} style={{ background: `${color}18` }}>
          <Icon size={16} style={{ color }} />
        </div>
      </div>
      <p className="text-3xl font-black tracking-tight" style={{ color: urgent ? "#ea580c" : "hsl(var(--foreground))" }}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Action Item
// ─────────────────────────────────────────────────────────────────
interface ActionItem {
  id: string;
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  employee: string | null;
  batchName: string | null;
  batchId: number | null;
  actionLabel: string;
  actionFn?: () => void;
  type: string;
}

function ActionCard({ item, onMutate }: { item: ActionItem; onMutate?: () => void }) {
  const [, nav] = useLocation();
  const ps = PRIORITY_STYLE[item.priority] ?? PRIORITY_STYLE.medium;
  return (
    <div className={`rounded-lg border px-4 py-3 flex items-start gap-3 ${ps.cls}`}>
      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${ps.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 justify-between flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">{item.title}</p>
            <p className="text-xs opacity-75 mt-0.5">{item.description}</p>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {item.batchName && (
                <span className="text-[10px] font-medium opacity-70 flex items-center gap-1">
                  <Layers size={9} /> {item.batchName}
                </span>
              )}
              {item.employee && (
                <span className="text-[10px] font-medium opacity-70 flex items-center gap-1">
                  <Users size={9} /> {item.employee}
                </span>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 flex-shrink-0 border-current"
            onClick={() => {
              if (item.actionFn) { item.actionFn(); onMutate?.(); }
              else if (item.batchId) nav(`/testing-batches/${item.batchId}`);
              else nav("/tasks");
            }}
          >
            {item.actionLabel} <ArrowRight size={11} className="ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────
export default function OpsQueue() {
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const isAdmin = currentEmployee?.role === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, nav] = useLocation();
  const [pipelineFilter, setPipelineFilter] = useState<string | null>(null);
  const [perfPeriod] = useState<"7" | "14" | "30">("30");

  // ── Data fetching ──
  const wsParams = { workspace_id: activeWorkspaceId ?? 0 };
  const queueParams = isAdmin
    ? { workspace_id: activeWorkspaceId ?? 0 }
    : { employee_id: currentEmployee?.id, workspace_id: activeWorkspaceId ?? 0 };
  const { data: queues, isLoading: loadingQ } = useGetQueues(
    queueParams,
    wsQueryOpts(activeWorkspaceId, getGetQueuesQueryKey(queueParams), { refetchInterval: 30_000 }),
  );

  const batchParams = isAdmin
    ? { workspace_id: activeWorkspaceId ?? 0 }
    : { employee_id: currentEmployee?.id, workspace_id: activeWorkspaceId ?? 0 };
  const { data: allBatches = [], isLoading: loadingB } = useListTestingBatches(
    batchParams,
    wsQueryOpts(activeWorkspaceId, getListTestingBatchesQueryKey(batchParams), { refetchInterval: 60_000 }),
  );
  const { data: allOffers = [] } = useListOffers(wsParams, wsQueryOpts(activeWorkspaceId, getListOffersQueryKey(wsParams)));
  const { data: allTasks = [] } = useListTodoTasks(wsParams, wsQueryOpts(activeWorkspaceId, getListTodoTasksQueryKey(wsParams)));
  const { data: mappings = [] } = useListVoluumMappings(wsParams, wsQueryOpts(activeWorkspaceId, getListVoluumMappingsQueryKey(wsParams), { enabled: VOLUUM_UI_ENABLED && !!activeWorkspaceId }));
  const { data: employees = [] } = useListEmployees(wsParams, wsQueryOpts(activeWorkspaceId, getListEmployeesQueryKey(wsParams)));
  const { data: summary } = useGetAdminDashboardSummary(wsParams, wsQueryOpts(activeWorkspaceId, getGetAdminDashboardSummaryQueryKey(wsParams)));
  // Phase 10e: admin-only suspicious-batch review queue.
  const { data: suspicious = [] } = useListSuspiciousBatches(
    wsParams,
    wsQueryOpts(activeWorkspaceId, getListSuspiciousBatchesQueryKey(wsParams), { enabled: isAdmin && !!activeWorkspaceId, refetchInterval: 60_000 }),
  );
  const { data: cfgRaw } = useGoalsConfig();
  const cfg = cfgRaw ?? DEFAULT_CONFIG;

  // Performance last N days
  const perfFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - Number(perfPeriod));
    return d.toISOString().split("T")[0];
  }, [perfPeriod]);
  const perfParams = { date_from: perfFrom, workspace_id: activeWorkspaceId ?? 0 };
  const { data: perfRecords = [] } = useListPerformance(
    perfParams,
    wsQueryOpts(activeWorkspaceId, getListPerformanceQueryKey(perfParams)),
  );

  // ── Invalidation helpers ──
  const invalidateQ = () => queryClient.invalidateQueries({ queryKey: getGetQueuesQueryKey(queueParams) });
  const goLive   = useGoLiveBatch({ mutation: { onSuccess: () => { invalidateQ(); toast({ title: "Batch is now Live" }); } } });
  const markReady= useMarkBatchReady({ mutation: { onSuccess: () => { invalidateQ(); toast({ title: "Moved to Optimization Queue" }); } } });
  const startOpt = useStartOptimization({ mutation: { onSuccess: () => { invalidateQ(); toast({ title: "Optimization started" }); } } });
  const completeOpt = useCompleteOptimization({ mutation: { onSuccess: () => { invalidateQ(); toast({ title: "Optimization complete!" }); } } });
  const anyPending = goLive.isPending || markReady.isPending || startOpt.isPending || completeOpt.isPending;

  // ── Computed stats ──
  const stats = useMemo(() => {
    // Phase 9: 6-state mapping. `readyForOpt` is now the TESTED gate
    // (clicks threshold met → worker must classify winners).
    // `optimizing` (no longer a real state) folds into TESTED for
    // back-compat with downstream readers. `scaling` (also retired)
    // maps to COMPLETED.
    const liveBatches    = allBatches.filter(b => b.status === "LIVE_TESTS");
    const readyForOpt    = allBatches.filter(b => b.status === "TESTED");
    const optimizing     = allBatches.filter(b => b.status === "TESTED");
    const scaling        = allBatches.filter(b => b.status === "COMPLETED");
    const activeBatches  = [...liveBatches, ...readyForOpt];

    // Click cap proximity — batches with ≥70% of threshold
    const perfByBatch = new Map<number, number>();
    for (const p of perfRecords) {
      perfByBatch.set(p.batchId, (perfByBatch.get(p.batchId) ?? 0) + Number(p.clicks ?? 0));
    }
    const nearCap = liveBatches.filter(b => {
      if (!b.clicksThreshold || b.clicksThreshold <= 0) return false;
      const clicks = perfByBatch.get(b.id) ?? 0;
      const pct = clicks / b.clicksThreshold;
      return pct >= 0.7 && pct < 1.0;
    });

    // Tasks
    const now = new Date();
    // Phase 2 enums: status DONE replaces "completed"; find_winners
    // is the canonical CampaignOps scale-prep task.
    const overdueTasks = allTasks.filter(t =>
      t.status !== "DONE" && t.dueDate && new Date(t.dueDate) < now
    );
    const pendingScale = allTasks.filter(t =>
      t.status !== "DONE" && (t.taskType === "find_winners" || t.taskType === "FIND_WINNERS")
    );

    // Winners unscaled
    const winners = allOffers.filter(o => o.status === "winner");
    const scaledBatchIds = new Set(scaling.map(b => b.id));
    const unscaledWinners = winners.filter(o => !scaledBatchIds.has(o.batchId ?? -1));

    // Pipeline counts
    const byStatus: Record<string, number> = {};
    for (const b of allBatches) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;

    return {
      liveBatches, readyForOpt, optimizing, scaling, activeBatches,
      nearCap, overdueTasks, pendingScale, winners, unscaledWinners, byStatus, perfByBatch,
    };
  }, [allBatches, allOffers, allTasks, perfRecords]);

  // ── Performance charts ──
  const { chartData, kpis } = useMemo(() => {
    const byDate = new Map<string, { date: string; spend: number; revenue: number; profit: number; conversions: number }>();
    for (const r of perfRecords) {
      const ex = byDate.get(r.date) ?? { date: r.date, spend: 0, revenue: 0, profit: 0, conversions: 0 };
      ex.spend    += Number(r.spend    ?? 0);
      ex.revenue  += Number(r.revenue  ?? 0);
      ex.profit   += Number(r.profit   ?? 0);
      ex.conversions += Number(r.conversions ?? 0);
      byDate.set(r.date, ex);
    }
    const sorted = Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({
        ...d,
        profit: Math.round(d.profit * 100) / 100,
        revenue: Math.round(d.revenue * 100) / 100,
        spend: Math.round(d.spend * 100) / 100,
        label: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      }));

    const totalSpend   = sorted.reduce((s, d) => s + d.spend, 0);
    const totalRevenue = sorted.reduce((s, d) => s + d.revenue, 0);
    const totalProfit  = sorted.reduce((s, d) => s + d.profit, 0);
    const roi = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0;

    return { chartData: sorted, kpis: { totalSpend, totalRevenue, totalProfit, roi } };
  }, [perfRecords]);

  // ── Strategic insights ──
  const insights = useMemo(() => {
    const list: { icon: React.ElementType; color: string; label: string; value: string; sub?: string }[] = [];

    // Best GEO by profit
    const byGeo = new Map<string, number>();
    for (const r of perfRecords) {
      const batch = allBatches.find(b => b.id === r.batchId);
      if (!batch?.geo) continue;
      byGeo.set(batch.geo, (byGeo.get(batch.geo) ?? 0) + Number(r.profit ?? 0));
    }
    const topGeo = [...byGeo.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topGeo) list.push({ icon: Globe2, color: "#16a34a", label: "Top GEO", value: topGeo[0], sub: `${fmt$(topGeo[1])} profit` });

    // Best traffic source by profit
    const byTS = new Map<string, number>();
    for (const r of perfRecords) {
      const batch = allBatches.find(b => b.id === r.batchId);
      if (!batch?.trafficSource) continue;
      byTS.set(batch.trafficSource, (byTS.get(batch.trafficSource) ?? 0) + Number(r.profit ?? 0));
    }
    const topTS = [...byTS.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topTS) list.push({ icon: Network, color: "#7c3aed", label: "Top Traffic Source", value: topTS[0], sub: `${fmt$(topTS[1])} profit` });

    // Best network
    const byNet = new Map<string, number>();
    for (const r of perfRecords) {
      const batch = allBatches.find(b => b.id === r.batchId);
      if (!batch?.affiliateNetwork) continue;
      byNet.set(batch.affiliateNetwork, (byNet.get(batch.affiliateNetwork) ?? 0) + Number(r.profit ?? 0));
    }
    const topNet = [...byNet.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topNet) list.push({ icon: Building2, color: "#0891b2", label: "Top Network", value: topNet[0], sub: `${fmt$(topNet[1])} profit` });

    // Highest ROI batch (active)
    const roiByBatch = new Map<number, { spend: number; profit: number }>();
    for (const r of perfRecords) {
      const ex = roiByBatch.get(r.batchId) ?? { spend: 0, profit: 0 };
      ex.spend += Number(r.spend ?? 0);
      ex.profit += Number(r.profit ?? 0);
      roiByBatch.set(r.batchId, ex);
    }
    let topRoi = 0, topRoiBatch: TestingBatch | undefined;
    for (const [bid, d] of roiByBatch.entries()) {
      if (d.spend < 10) continue;
      const roi = d.profit / d.spend * 100;
      if (roi > topRoi) { topRoi = roi; topRoiBatch = allBatches.find(b => b.id === bid); }
    }
    if (topRoiBatch) list.push({ icon: TrendingUp, color: "#22c55e", label: "Highest ROI Batch", value: topRoiBatch.batchName, sub: `${fmtPct(topRoi)} ROI` });

    // Stuck batches (live > 14 days with no opt)
    const stuck = allBatches.filter(b =>
      b.status === "LIVE_TESTS" && daysSince(b.liveAt) > 14
    );
    if (stuck.length > 0) list.push({ icon: AlertTriangle, color: "#dc2626", label: "Stuck Batches", value: `${stuck.length}`, sub: "Live > 14 days without optimization" });

    // Unmapped active batches
    const mappedBatchIds = new Set(mappings.map(m => m.batchId));
    const unmapped = stats.liveBatches.filter(b => !mappedBatchIds.has(b.id));
    if (VOLUUM_UI_ENABLED && unmapped.length > 0) list.push({ icon: Flame, color: "#f59e0b", label: "Unmapped Tracker Campaigns", value: `${unmapped.length}`, sub: "Live batches without Voluum mapping" });

    return list;
  }, [perfRecords, allBatches, mappings, stats.liveBatches]);

  // ── Action items ──
  // Phase 10a: spec-canonical ordering (Bible §10):
  //   1. Overdue tasks (flashing).
  //   2. Open create_voluum_campaign_* tasks.
  //   3. Open find_winners / PAUSE_TRAFFIC_SOURCE_CAMPAIGNS tasks
  //      ready to close.
  //   4. Click-cap-reached batches awaiting optimization start.
  //   5. Other secondary signals (near cap, unscaled winners, stuck).
  // We tag each item with an explicit `sortKey` so priority colors
  // are decoupled from the spec ordering.
  const actionItems = useMemo((): (ActionItem & { sortKey: number })[] => {
    const items: (ActionItem & { sortKey: number })[] = [];

    // 1. Overdue tasks (flashing — highest priority per spec). The
    // engine sets `flashing=true` on tasks it wants surfaced; we also
    // fall back to `dueDate < now` so the panel still works if the
    // engine hasn't backfilled the flag. Sorted oldest-overdue-first
    // inside the bucket.
    const now = new Date();
    const flashingOrOverdue = allTasks
      .filter(t => {
        if (t.status === "DONE") return false;
        const flashing = (t as { flashing?: boolean }).flashing === true;
        const overdue = !!t.dueDate && new Date(t.dueDate) < now;
        return flashing || overdue;
      })
      .sort((a, b) => {
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
        return ad - bd;
      });
    for (const t of flashingOrOverdue) {
      const days = t.dueDate ? Math.floor((now.getTime() - new Date(t.dueDate).getTime()) / 86_400_000) : 0;
      items.push({
        id: `task-${t.id}`, priority: "critical", sortKey: 1,
        title: `Overdue task: ${t.title}`,
        description: `${days > 0 ? `${days}d overdue · ` : ""}${t.taskType.replace(/_/g, " ")}`,
        employee: t.employeeName ?? null, batchName: t.batchName ?? null, batchId: t.relatedBatchId ?? null,
        type: "overdue", actionLabel: "View Task",
      });
    }

    // 2. Open create_voluum_campaign_* tasks — block the whole pipeline.
    const trackerTasks = allTasks.filter(t =>
      t.status !== "DONE" &&
      (
        t.taskType === "create_voluum_campaign_ios" ||
        t.taskType === "create_voluum_campaign_android" ||
        t.taskType === "CREATE_IOS_TRACKER_CAMPAIGN" ||
        t.taskType === "CREATE_ANDROID_TRACKER_CAMPAIGN"
      )
    );
    for (const t of trackerTasks) {
      if (items.find(i => i.id === `task-${t.id}`)) continue;
      const platform = t.taskType === "create_voluum_campaign_ios" || t.taskType === "CREATE_IOS_TRACKER_CAMPAIGN"
        ? "iOS"
        : "Android";
      items.push({
        id: `task-${t.id}`, priority: "high", sortKey: 2,
        title: `Create ${platform} Tracker Campaign`,
        description: t.title,
        employee: t.employeeName ?? null, batchName: t.batchName ?? null, batchId: t.relatedBatchId ?? null,
        type: "create_tracker", actionLabel: "Open Task",
      });
    }

    // 3. find_winners / PAUSE_TRAFFIC_SOURCE_CAMPAIGNS tasks ready to close.
    const closeReadyTasks = allTasks.filter(t =>
      t.status !== "DONE" &&
      (
        t.taskType === "find_winners" ||
        t.taskType === "FIND_WINNERS" ||
        t.taskType === "PAUSE_TRAFFIC_SOURCE_CAMPAIGNS"
      )
    );
    for (const t of closeReadyTasks) {
      if (items.find(i => i.id === `task-${t.id}`)) continue;
      const isPause = t.taskType === "PAUSE_TRAFFIC_SOURCE_CAMPAIGNS";
      items.push({
        id: `task-${t.id}`, priority: "high", sortKey: 3,
        title: isPause ? "Pause Live Campaigns ready to close" : "Find Winners ready to close",
        description: t.title,
        employee: t.employeeName ?? null, batchName: t.batchName ?? null, batchId: t.relatedBatchId ?? null,
        type: isPause ? "pause" : "find_winners", actionLabel: "Open Task",
      });
    }

    // 4. Click-cap-reached batches awaiting optimization start.
    for (const b of stats.readyForOpt) {
      items.push({
        id: `rfo-${b.id}`, priority: "critical", sortKey: 4,
        title: "Click cap reached — optimization pending",
        description: `${b.batchName} is ready for optimization. Start now.`,
        employee: b.employeeName ?? null, batchName: b.batchName, batchId: b.id,
        type: "ready_for_opt",
        actionLabel: "Start Optimization",
        actionFn: () => startOpt.mutate({ id: b.id }),
      });
    }

    // 5a. Unscaled winners.
    if (stats.unscaledWinners.length > 0) {
      const batchIds = [...new Set(stats.unscaledWinners.map(o => o.batchId).filter(Boolean) as number[])];
      for (const bid of batchIds) {
        const count = stats.unscaledWinners.filter(o => o.batchId === bid).length;
        const batch = allBatches.find(b => b.id === bid);
        items.push({
          id: `winner-${bid}`, priority: "high", sortKey: 5,
          title: `${count} winner${count !== 1 ? "s" : ""} not moved to scale`,
          description: `Complete optimization to unlock scale task.`,
          employee: batch?.employeeName ?? null, batchName: batch?.batchName ?? null, batchId: bid,
          type: "winners", actionLabel: "View Batch",
        });
      }
    }

    // 5b. Near click cap (action needed soon).
    for (const b of stats.nearCap) {
      const clicks = stats.perfByBatch.get(b.id) ?? 0;
      const pct = b.clicksThreshold ? Math.round((clicks / b.clicksThreshold) * 100) : 0;
      items.push({
        id: `cap-${b.id}`, priority: "medium", sortKey: 6,
        title: `Live Campaign near click cap (${pct}%)`,
        description: `${clicks.toLocaleString()} / ${b.clicksThreshold?.toLocaleString()} clicks — prepare optimization.`,
        employee: b.employeeName ?? null, batchName: b.batchName, batchId: b.id,
        type: "near_cap", actionLabel: "View Live Campaign",
      });
    }

    // 5c. Stuck batches (live > 14 days).
    for (const b of allBatches) {
      if (b.status !== "LIVE_TESTS" || daysSince(b.liveAt) <= 14) continue;
      items.push({
        id: `stuck-${b.id}`, priority: "low", sortKey: 7,
        title: `Stuck batch — ${daysSince(b.liveAt)}d without optimization`,
        description: `${b.affiliateNetwork} · ${b.geo} · ${b.trafficSource}`,
        employee: b.employeeName ?? null, batchName: b.batchName, batchId: b.id,
        type: "stuck", actionLabel: "Review Batch",
      });
    }

    return items.sort((a, b) => a.sortKey - b.sortKey);
  }, [stats, allBatches, allTasks, startOpt]);

  // ── Employee activity / leaderboard ──
  const leaderboard = useMemo(() => {
    const scores = computeScores(employees, allBatches, allOffers, allTasks, cfg);
    return scores.map(s => ({
      ...s,
      rank: getRankForScore(s.total, cfg),
      rankColor: RANK_COLORS[getRankForScore(s.total, cfg).color] ?? RANK_COLORS.slate,
    }));
  }, [employees, allBatches, allOffers, allTasks, cfg]);

  // ── Filtered pipeline view ──
  const filteredBatches = useMemo(() => {
    if (!pipelineFilter) return [];
    return allBatches.filter(b => b.status === pipelineFilter);
  }, [allBatches, pipelineFilter]);

  const isLoading = loadingQ || loadingB;

  return (
    <div className="space-y-8 max-w-[1400px]">
      <LegacyRouteBanner
        title="Legacy operations view"
        description="This older hub layout is kept for internal reference. Use Operations Hub for day-to-day work."
        canonicalHref="/ops"
        canonicalLabel="Go to Operations Hub"
      />

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
            <h1 className="text-2xl font-black tracking-tight">Legacy operations queue</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Superseded by Operations Hub — action queue and pipeline snapshot (internal).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {actionItems.filter(i => i.priority === "critical").length > 0 && (
            <Badge className="bg-red-500 text-white gap-1 animate-pulse">
              <AlertCircle size={11} />
              {actionItems.filter(i => i.priority === "critical").length} critical
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => invalidateQ()}>
            <RefreshCw size={13} className="mr-1.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* ── 1. LIVE OPERATIONS ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Gauge size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Live Operations</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {VOLUUM_UI_ENABLED && (
            <StatCard label="Tracker Campaigns" value={isLoading ? "—" : stats.liveBatches.length}   icon={Radio}         color="#16a34a" onClick={() => nav("/tracker-campaigns")} />
          )}
          <StatCard label="In Testing"       value={isLoading ? "—" : stats.activeBatches.length}  icon={Activity}      color="#2563eb" />
          <StatCard label="Near Click Cap"   value={isLoading ? "—" : stats.nearCap.length}        icon={MousePointerClick} color="#f59e0b" urgent={stats.nearCap.length > 0} />
          {/* Phase 10a: KPI labels mirror the 6-state vocabulary.
              "Pick Winners" = batches in TESTED awaiting classification;
              "Find Winners" = open FIND_WINNERS tasks (the per-offer
              version of the same gate). */}
          <StatCard label="Pick Winners"     value={isLoading ? "—" : stats.readyForOpt.length}    icon={Trophy}        color="#7c3aed" urgent={stats.readyForOpt.length > 0} onClick={() => nav("/ops")} />
          <StatCard label="Find Winners"     value={isLoading ? "—" : stats.pendingScale.length}   icon={Target}        color="#ea580c" urgent={stats.pendingScale.length > 0} onClick={() => nav("/tasks")} />
          <StatCard label="Overdue Tasks"    value={isLoading ? "—" : stats.overdueTasks.length}   icon={AlertTriangle} color="#dc2626" urgent={stats.overdueTasks.length > 0} onClick={() => nav("/tasks")} />
        </div>

        {/* Quick links */}
        <div className="flex gap-2 mt-3 flex-wrap">
          {[
            ...(VOLUUM_UI_ENABLED
              ? [{ label: "View Tracker Campaigns", href: "/tracker-campaigns", icon: Radio }]
              : []),
            { label: "Optimization Queue", href: "/ops", icon: Zap },
            { label: "Open Tasks", href: "/tasks", icon: CheckCircle2 },
            { label: "All Batches", href: "/testing-batches", icon: Layers },
          ].map(l => (
            <Link key={l.href} href={l.href}>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                <l.icon size={11} /> {l.label}
              </Button>
            </Link>
          ))}
        </div>
      </section>

      {/* ── 2 + 7. ACTION CENTER / TODAY'S PRIORITIES ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Action Center</h2>
          {actionItems.length > 0 && (
            <Badge variant="outline" className="ml-auto text-xs">{actionItems.length} item{actionItems.length !== 1 ? "s" : ""}</Badge>
          )}
        </div>
        {isLoading ? (
          <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        ) : actionItems.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border p-8 text-center">
            <CheckCircle2 size={28} className="mx-auto text-green-500 mb-2" />
            <p className="font-semibold text-sm">All clear — no actions required</p>
            <p className="text-xs text-muted-foreground mt-1">Everything is running smoothly.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {actionItems.slice(0, 10).map(item => (
              <ActionCard key={item.id} item={item} onMutate={() => invalidateQ()} />
            ))}
            {actionItems.length > 10 && (
              <p className="text-xs text-muted-foreground text-center pt-1">
                +{actionItems.length - 10} more items — check Tasks for full list.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── 2b. SUSPICIOUS BATCH REVIEW (admin-only, Phase 10e) ── */}
      {isAdmin && suspicious.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-red-500" />
            <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Suspicious Batch Updates</h2>
            <Badge className="ml-auto bg-red-500 text-white text-xs">{suspicious.length}</Badge>
          </div>
          <Card className="border-red-200 bg-red-50/40">
            <CardContent className="p-0">
              <div className="divide-y divide-red-100">
                {suspicious.slice(0, 8).map(s => (
                  <button
                    key={s.batchId}
                    onClick={() => nav(`/testing-batches/${s.batchId}`)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-red-100/50 transition-colors"
                  >
                    <AlertTriangle size={13} className="text-red-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{s.batchName ?? `Batch #${s.batchId}`}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {[s.affiliateNetwork, s.geo].filter(Boolean).join(" · ") || "—"}
                        {" · "}
                        last flagged {new Date(s.lastNotifiedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-white">
                      {s.unresolvedCount} unresolved
                    </Badge>
                    <ChevronRight size={13} className="text-red-400 flex-shrink-0" />
                  </button>
                ))}
                {suspicious.length > 8 && (
                  <div className="px-4 py-2 text-xs text-muted-foreground">
                    +{suspicious.length - 8} more flagged batches
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── 3. PERFORMANCE SNAPSHOT ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Performance Snapshot</h2>
          <span className="text-[10px] text-muted-foreground ml-1">(last {perfPeriod} days)</span>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: "Spend",   value: fmt$(kpis.totalSpend),   color: "text-muted-foreground", icon: DollarSign },
            { label: "Revenue", value: fmt$(kpis.totalRevenue),  color: "text-primary",          icon: TrendingUp },
            { label: "Profit",  value: fmt$(kpis.totalProfit),   color: kpis.totalProfit >= 0 ? "text-green-600" : "text-red-600", icon: ArrowUpRight },
            { label: "ROI",     value: fmtPct(kpis.roi),         color: kpis.roi >= 0 ? "text-amber-600" : "text-red-600", icon: Gauge },
          ].map(k => (
            <div key={k.label} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground font-medium">{k.label}</span>
                <k.icon size={13} className={k.color} />
              </div>
              <p className={`text-2xl font-black ${k.color}`}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* Charts */}
        {chartData.length > 1 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Profit trend */}
            <Card className="border">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Daily Profit Trend</CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-3">
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={chartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0}   />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => `$${Math.round(v)}`} />
                    <Tooltip contentStyle={{ fontSize: 11, borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }} formatter={(v: any) => [`$${Number(v).toFixed(0)}`, "Profit"]} />
                    <Area type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={2} fill="url(#gProfit)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Revenue vs Spend */}
            <Card className="border">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revenue vs Spend</CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-3">
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={chartData.slice(-14)} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => `$${Math.round(v)}`} />
                    <Tooltip contentStyle={{ fontSize: 11, borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }} formatter={(v: any, name: string) => [`$${Number(v).toFixed(0)}`, name]} />
                    <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} barSize={12} name="Revenue" />
                    <Bar dataKey="spend"   fill="hsl(var(--muted-foreground)/0.3)" radius={[2, 2, 0, 0]} barSize={12} name="Spend" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No performance data in the last {perfPeriod} days. {VOLUUM_UI_ENABLED ? "Run a Voluum sync in Settings." : "Performance metrics will appear once batches are tested."}
          </div>
        )}

        {/* Additional summary stats from dashboard */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {[
              { label: "Offers Uploaded (Week)", value: summary.offersUploadedThisWeek ?? "—" },
              { label: "Batches Tested (Week)",  value: summary.batchesTestedThisWeek ?? "—" },
              { label: "Closed (Week)",          value: summary.campaignsClosed ?? "—" },
              { label: "Open Tasks",             value: summary.openTasksCount ?? "—" },
            ].map(s => (
              <div key={s.label} className="rounded-lg border bg-muted/20 px-3 py-2.5 text-center">
                <p className="text-lg font-black">{s.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 5. TESTING PIPELINE ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <ArrowRight size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Testing Pipeline</h2>
          <span className="text-[10px] text-muted-foreground ml-1">Click a stage to filter batches</span>
        </div>

        {/* Stage flow */}
        <div className="flex items-stretch gap-1 overflow-x-auto pb-2">
          {PIPELINE_STAGES.map((stage, i) => {
            const count = stats.byStatus[stage.key] ?? 0;
            const isActive = pipelineFilter === stage.key;
            return (
              <div key={stage.key} className="flex items-center gap-1 min-w-0">
                <button
                  onClick={() => setPipelineFilter(isActive ? null : stage.key)}
                  className={`flex flex-col items-center px-4 py-3 rounded-xl border-2 transition-all min-w-[90px] ${
                    isActive
                      ? "border-current shadow-md scale-105"
                      : "border-border bg-card hover:border-current/40 hover:shadow-sm"
                  }`}
                  style={{ borderColor: isActive ? stage.color : undefined, color: stage.color }}
                >
                  <span className="text-3xl font-black" style={{ color: stage.color }}>{count}</span>
                  <span className="text-[10px] font-semibold mt-0.5 text-center leading-tight" style={{ color: isActive ? stage.color : "hsl(var(--muted-foreground))" }}>
                    {stage.label}
                  </span>
                </button>
                {i < PIPELINE_STAGES.length - 1 && (
                  <ChevronRight size={14} className="text-muted-foreground/40 flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>

        {/* Filtered list */}
        {pipelineFilter && filteredBatches.length > 0 && (
          <div className="mt-3 rounded-xl border bg-muted/20 overflow-hidden">
            <div className="px-4 py-2 border-b bg-card flex items-center gap-2">
              <span className="text-xs font-semibold">{PIPELINE_STAGES.find(s => s.key === pipelineFilter)?.label}</span>
              <Badge variant="outline" className="text-xs">{filteredBatches.length}</Badge>
              <button onClick={() => setPipelineFilter(null)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Clear</button>
            </div>
            <div className="divide-y">
              {filteredBatches.slice(0, 8).map(b => (
                <div
                  key={b.id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => nav(`/testing-batches/${b.id}`)}
                >
                  <div>
                    <p className="text-sm font-medium hover:text-primary">{b.batchName}</p>
                    <p className="text-xs text-muted-foreground">{b.affiliateNetwork} · {b.geo} · {b.trafficSource}</p>
                  </div>
                  {b.employeeName && (
                    <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
                      <Users size={10} /> {b.employeeName}
                    </span>
                  )}
                  <ChevronRight size={13} className="text-muted-foreground flex-shrink-0" />
                </div>
              ))}
              {filteredBatches.length > 8 && (
                <div className="px-4 py-2 text-xs text-muted-foreground">+{filteredBatches.length - 8} more</div>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── 4. EMPLOYEE ACTIVITY ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Crown size={14} className="text-muted-foreground" />
            <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Employee Activity</h2>
          </div>
          <Card className="border">
            <CardContent className="p-0">
              <div className="divide-y">
                {leaderboard.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No data yet.</p>
                ) : leaderboard.slice(0, 6).map((s, i) => {
                  const medals = ["🥇", "🥈", "🥉"];
                  const isMe = s.employeeId === currentEmployee?.id;
                  return (
                    <div key={s.employeeId} className={`flex items-center gap-3 px-4 py-3 ${isMe ? "bg-primary/5" : "hover:bg-muted/20"} transition-colors`}>
                      <span className="text-sm font-bold w-6 text-center">{i < 3 ? medals[i] : `#${i + 1}`}</span>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${s.rankColor.bg} ${s.rankColor.text}`}>
                        {s.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-sm font-medium ${isMe ? "text-primary font-bold" : ""}`}>{s.name}</span>
                          {isMe && <span className="text-[10px] text-primary">(you)</span>}
                        </div>
                        <span className={`text-[10px] font-semibold ${s.rankColor.text}`}>{s.rank.name}</span>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-black">{expLeaderboardTotal(s.total)}</p>
                        <div className="flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
                          {s.winners > 0 && <span className="text-green-600 font-medium flex items-center gap-0.5"><Trophy size={9} />{s.winners}</span>}
                          <span>{s.batches}B</span>
                          {s.optimizations > 0 && <span>{s.optimizations}O</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {leaderboard.length > 6 && (
                <div className="border-t px-4 py-2">
                  <Link href="/profile"><span className="text-xs text-primary hover:underline cursor-pointer">View full leaderboard →</span></Link>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── 6. STRATEGIC INSIGHTS ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Star size={14} className="text-muted-foreground" />
            <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Strategic Insights</h2>
          </div>
          <Card className="border h-full">
            <CardContent className="p-0">
              {insights.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <Activity size={24} className="text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">{VOLUUM_UI_ENABLED ? "Insights appear once performance data is synced from Voluum." : "Insights appear once batches start producing performance data."}</p>
                  {VOLUUM_UI_ENABLED && (
                    <Link href="/settings">
                      <Button variant="outline" size="sm" className="mt-3 text-xs">Open Settings → Sync</Button>
                    </Link>
                  )}
                </div>
              ) : (
                <div className="divide-y">
                  {insights.map((ins, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${ins.color}18` }}>
                        <ins.icon size={15} style={{ color: ins.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{ins.label}</p>
                        <p className="text-sm font-bold leading-snug truncate">{ins.value}</p>
                        {ins.sub && <p className="text-[10px] text-muted-foreground">{ins.sub}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* ── Kanban Queue (collapsed, accessible via tab) ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Zap size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">Optimization Queue</h2>
          <span className="text-[10px] text-muted-foreground ml-1">Active workflow lanes</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {/* Phase 10a: lanes are relabeled to the 6-state lifecycle
              vocabulary, but they still consume the existing
              QueueSummary shape (liveTesting/readyForOptimization/
              optimizing/retestsPending/scaling) since the /queues
              endpoint backend rename ships in a separate phase.
              Mapping:
                liveTesting        → "Live Tests" lane (LIVE_TESTS)
                readyForOptimization → "Pick Winners" lane (TESTED)
                optimizing         → "Pick Winners cont." (TESTED)
                retestsPending     → retests (engine-driven)
                scaling            → "Completed" lane (COMPLETED)
              The only worker action surfaced is the Live-Tests-Started
              confirmation; every other transition is engine-driven. */}
          {[
            {
              title: "Live Tests", icon: Radio, color: "#16a34a",
              items: queues?.liveTesting ?? [],
              renderAction: null,
            },
            {
              title: "Pick Winners", icon: Trophy, color: "#7c3aed",
              items: queues?.readyForOptimization ?? [],
              renderAction: (item: QueueItem) =>
                ({ label: "Open", fn: () => nav(`/testing-batches/${item.id}`) }),
            },
            {
              title: "Classifying", icon: Target, color: "#d97706",
              items: queues?.optimizing ?? [],
              renderAction: null,
            },
            {
              title: "Retests", icon: RefreshCw, color: "#7c3aed",
              items: queues?.retestsPending ?? [],
              renderAction: null,
            },
            {
              title: "Completed", icon: CheckCircle2, color: "#0891b2",
              items: queues?.scaling ?? [],
              renderAction: null,
            },
          ].map(lane => (
            <div key={lane.title} className="flex-shrink-0 w-[220px]">
              <div className="flex items-center gap-1.5 mb-2 px-0.5">
                <lane.icon size={12} style={{ color: lane.color }} />
                <span className="text-xs font-semibold text-foreground">{lane.title}</span>
                <span className="ml-auto text-[10px] font-black px-1.5 py-0.5 rounded-full text-white" style={{ background: lane.color }}>
                  {isLoading ? "…" : lane.items.length}
                </span>
              </div>
              <div
                className="rounded-xl p-1.5 space-y-1.5 min-h-[80px]"
                style={{ background: `${lane.color}08`, border: `1.5px solid ${lane.color}22` }}
              >
                {isLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : lane.items.length === 0 ? (
                  <div className="flex items-center justify-center h-16">
                    <p className="text-[10px] text-muted-foreground text-center px-2">Empty</p>
                  </div>
                ) : lane.items.slice(0, 3).map(item => {
                  const action = lane.renderAction ? lane.renderAction(item) : null;
                  return (
                    <div
                      key={item.id}
                      className="bg-white rounded-lg border border-border p-2.5 cursor-pointer hover:shadow-sm transition-shadow"
                      onClick={() => nav(`/testing-batches/${item.id}`)}
                    >
                      <p className="text-xs font-semibold truncate text-foreground">{item.batchName}</p>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{item.geo} · {item.trafficSource}</p>
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                        {item.offerCounts.winner > 0 && <span className="text-green-600 font-medium"><Trophy size={8} className="inline mr-0.5" />{item.offerCounts.winner}W</span>}
                        {item.offerCounts.pending > 0 && <span>{item.offerCounts.pending}P</span>}
                      </div>
                      {action && (
                        <Button
                          size="sm"
                          className="w-full h-6 text-[10px] mt-1.5"
                          disabled={anyPending}
                          onClick={e => { e.stopPropagation(); action.fn(); }}
                        >
                          {action.label}
                        </Button>
                      )}
                    </div>
                  );
                })}
                {lane.items.length > 3 && (
                  <p className="text-[10px] text-muted-foreground text-center py-1">+{lane.items.length - 3} more</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
