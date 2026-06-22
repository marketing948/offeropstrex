import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InitialsBadge } from "@/components/performance-engine/initials-badge";
import {
  fetchWorkerActivity,
  fetchWorkerBreakdown,
  fetchXpHistory,
  type WorkerMonthlyRow,
} from "@/lib/performance-engine/api";
import { useGoalsConfig, ensureGoalsConfig, DEFAULT_CONFIG } from "@/lib/goals-config";
import { useWorkspace } from "@/lib/workspace-context";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { X } from "lucide-react";

function StatusBadge({ status }: { status: WorkerMonthlyRow["status"] }) {
  const cls =
    status === "Strong" || status === "On track"
      ? "bg-green-100 text-green-800"
      : status === "Watch"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

function GoalBar({
  label,
  current,
  target,
  xp,
}: {
  label: string;
  current: number;
  target: number;
  xp?: number;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div className="rounded-lg border bg-white p-3 space-y-2">
      <div className="flex justify-between text-sm font-medium">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {label === "Revenue" ? `$${current.toLocaleString()}` : current}
          {target > 0 ? ` / ${label === "Revenue" ? `$${target.toLocaleString()}` : target}` : " · No target"}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{target > 0 ? `${pct}%` : "No target configured"}</p>
      {xp != null && xp > 0 && target > 0 && (
        <p className="text-xs text-blue-600">+{xp} XP for completing this goal</p>
      )}
    </div>
  );
}

export function WorkerGoalsDrawer({
  worker,
  monthKey,
  open,
  onClose,
}: {
  worker: WorkerMonthlyRow | null;
  monthKey: string;
  open: boolean;
  onClose: () => void;
}) {
  const { activeWorkspaceId } = useWorkspace();
  const wsId = activeWorkspaceId ?? 0;
  const { data: goalsCfgRaw } = useGoalsConfig();
  const goalsCfg = ensureGoalsConfig(goalsCfgRaw ?? DEFAULT_CONFIG);

  const workerGoals = worker
    ? goalsCfg.workerGoalTargets.filter(
        (g) =>
          g.isActive &&
          g.employeeId === worker.employeeId &&
          (g.monthKey === monthKey || !g.monthKey),
      )
    : [];
  const xpFor = (metric: string) =>
    workerGoals.find((g) => g.metricKey === metric && !g.affiliateNetworkName && !g.geoCode)?.xpReward ?? undefined;

  const breakdownQ = useQuery({
    queryKey: ["worker-breakdown", wsId, worker?.employeeId, monthKey],
    enabled: open && !!worker && wsId > 0,
    queryFn: () => fetchWorkerBreakdown(wsId, worker!.employeeId, monthKey),
  });

  const activityQ = useQuery({
    queryKey: ["worker-activity", wsId, worker?.employeeId, monthKey],
    enabled: open && !!worker && wsId > 0,
    queryFn: () => fetchWorkerActivity(wsId, worker!.employeeId, monthKey),
  });

  const xpQ = useQuery({
    queryKey: ["xp-history", wsId, worker?.employeeId, monthKey],
    enabled: open && !!worker && wsId > 0,
    queryFn: () => fetchXpHistory(wsId, worker!.employeeId, monthKey),
  });

  if (!worker) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-[420px] overflow-y-auto p-0">
        <SheetHeader className="border-b p-4 pr-12">
          <div className="flex items-start gap-3">
            <InitialsBadge initials={worker.initials} size="lg" />
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-left">{worker.name}</SheetTitle>
              <p className="text-xs text-muted-foreground truncate">{worker.email}</p>
              <div className="mt-1"><StatusBadge status={worker.status} /></div>
            </div>
            <button type="button" onClick={onClose} className="absolute right-4 top-4 text-muted-foreground">
              <X size={18} />
            </button>
          </div>
        </SheetHeader>

        <Tabs defaultValue="goals" className="p-4">
          <TabsList className="grid w-full grid-cols-4 h-8">
            <TabsTrigger value="goals" className="text-xs">Goals</TabsTrigger>
            <TabsTrigger value="breakdown" className="text-xs">Breakdown</TabsTrigger>
            <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
            <TabsTrigger value="xp" className="text-xs">XP History</TabsTrigger>
          </TabsList>

          <TabsContent value="goals" className="space-y-3 mt-4">
            <GoalBar label="Revenue" current={worker.revenue.current} target={worker.revenue.target} xp={xpFor("revenue")} />
            <GoalBar label="Testing" current={worker.testing.current} target={worker.testing.target} xp={xpFor("testingBatches")} />
            <GoalBar label="Working" current={worker.working.current} target={worker.working.target} xp={xpFor("workingCampaigns")} />
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900">
              Total XP earned this month: <strong>{worker.xpEarned.toLocaleString()} XP</strong>
            </div>
          </TabsContent>

          <TabsContent value="breakdown" className="space-y-4 mt-4 text-sm">
            {breakdownQ.isLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div>
                  <p className="font-medium mb-2">Network Breakdown</p>
                  {(breakdownQ.data?.networks.length ?? 0) === 0 ? (
                    <p className="text-muted-foreground text-xs">No network goals configured.</p>
                  ) : (
                    breakdownQ.data!.networks.map((n) => (
                      <p key={n.name} className="text-xs py-1">{n.name}: target {n.target}</p>
                    ))
                  )}
                </div>
                <div>
                  <p className="font-medium mb-2">GEO Breakdown</p>
                  {(breakdownQ.data?.geos.length ?? 0) === 0 ? (
                    <p className="text-muted-foreground text-xs">No GEO goals configured.</p>
                  ) : (
                    breakdownQ.data!.geos.map((g) => (
                      <p key={g.code} className="text-xs py-1">{g.code}: target {g.target}</p>
                    ))
                  )}
                </div>
                <div>
                  <p className="font-medium mb-2">Top Winners</p>
                  {(breakdownQ.data?.topWinners.length ?? 0) === 0 ? (
                    <p className="text-muted-foreground text-xs">No breakdown data for this month.</p>
                  ) : (
                    breakdownQ.data!.topWinners.map((w, i) => (
                      <p key={i} className="text-xs py-1">{w.name} · {w.geo} · {w.network}</p>
                    ))
                  )}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="activity" className="mt-4 space-y-2">
            {activityQ.isLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : [...(activityQ.data?.xpEvents ?? []), ...(activityQ.data?.activity ?? [])].length === 0 ? (
              <p className="text-muted-foreground text-sm">No activity recorded for this month.</p>
            ) : (
              <>
                {activityQ.data?.xpEvents.map((e) => (
                  <div key={`xp-${e.id}`} className="rounded border p-2 text-xs">
                    <p className="font-medium text-green-700">+{e.amount} XP — {e.label}</p>
                    <p className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</p>
                  </div>
                ))}
                {activityQ.data?.activity.map((a) => (
                  <div key={a.id} className="rounded border p-2 text-xs">
                    <p className="font-medium">{a.title}</p>
                    <p className="text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </>
            )}
          </TabsContent>

          <TabsContent value="xp" className="mt-4">
            <p className="text-sm font-medium mb-2">Total: {xpQ.data?.totalXp ?? 0} XP</p>
            {(xpQ.data?.chart.length ?? 0) > 0 ? (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={xpQ.data!.chart}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={32} />
                    <Tooltip />
                    <Line type="monotone" dataKey="cumulative" stroke="#2563eb" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No XP data for this month.</p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
