import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InitialsBadge } from "@/components/performance-engine/initials-badge";
import { formatMonthLabel, type WorkerMonthlyRow } from "@/lib/performance-engine/api";
import {
  summarizeWorkerPlansByNetwork,
  type NetworkPlanSummary,
} from "@/lib/performance-engine/goal-plan-utils";
import type { WorkerGoalTarget } from "@/lib/worker-goals";
import { Pencil, X } from "lucide-react";

const METRIC_LABELS: Record<string, string> = {
  revenue: "Revenue",
  testingBatches: "Testing",
  workingCampaigns: "Working",
};

function MetricSummaryCard({
  label,
  current,
  target,
  prefix = "",
}: {
  label: string;
  current: number;
  target: number;
  prefix?: string;
}) {
  const remaining = Math.max(0, target - current);
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div className="rounded-lg border bg-white p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        {target > 0 ? (
          <span className="text-xs text-muted-foreground">{pct}%</span>
        ) : (
          <span className="text-xs text-muted-foreground">No target</span>
        )}
      </div>
      <p className="text-sm">
        <span className="font-medium">
          {prefix}
          {current.toLocaleString()}
        </span>
        {target > 0 && (
          <span className="text-muted-foreground">
            {" "}
            / {prefix}
            {target.toLocaleString()}
          </span>
        )}
      </p>
      {target > 0 && (
        <p className="text-xs text-muted-foreground">
          Remaining: {prefix}
          {remaining.toLocaleString()}
        </p>
      )}
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function NetworkPlanCard({ plan }: { plan: NetworkPlanSummary }) {
  const title = plan.networkName ?? "Worker-wide goals";
  return (
    <div className="rounded-lg border bg-slate-50/80 p-3 space-y-3">
      <p className="text-sm font-semibold break-words">{title}</p>
      {plan.metrics.length === 0 ? (
        <p className="text-xs text-muted-foreground">No metric targets configured.</p>
      ) : (
        <div className="space-y-1">
          {plan.metrics.map((m) => (
            <p key={m.metricKey} className="text-xs">
              {METRIC_LABELS[m.metricKey] ?? m.metricKey}:{" "}
              <span className="font-medium">
                {m.metricKey === "revenue" ? `$${m.target.toLocaleString()}` : m.target}
              </span>
              {m.xp > 0 && <span className="text-muted-foreground"> · {m.xp} XP</span>}
            </p>
          ))}
        </div>
      )}
      {plan.selectedGeoCodes.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Selected GEOs</p>
          <div className="flex flex-wrap gap-1">
            {plan.selectedGeoCodes.map((code) => (
              <span key={code} className="rounded border bg-white px-1.5 py-0.5 text-[11px]">
                {code}
              </span>
            ))}
          </div>
        </div>
      )}
      {plan.overrides.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Custom overrides</p>
          <div className="space-y-1">
            {plan.overrides.map((o) => (
              <p key={`${o.metricKey}-${o.geoCode}`} className="text-xs flex flex-wrap gap-1 items-center">
                <span className="rounded border bg-blue-50 text-blue-800 px-1.5 py-0.5 text-[11px]">
                  {o.geoCode}
                </span>
                <span>{METRIC_LABELS[o.metricKey] ?? o.metricKey}</span>
                <span className="font-medium">
                  {o.metricKey === "revenue" ? `$${o.target}` : o.target}
                </span>
                <span className="rounded bg-blue-100 text-blue-700 px-1 py-0.5 text-[10px]">Custom</span>
              </p>
            ))}
          </div>
        </div>
      )}
      {plan.networkName && plan.selectedGeoCodes.length > 0 && plan.overrides.length === 0 && (
        <p className="text-xs text-muted-foreground">GEO targets inherit from network goals unless overridden.</p>
      )}
    </div>
  );
}

export function MonthlyGoalWorkerDrawer({
  worker,
  monthKey,
  goals,
  open,
  onClose,
  onEditPlan,
}: {
  worker: WorkerMonthlyRow | null;
  monthKey: string;
  goals: WorkerGoalTarget[];
  open: boolean;
  onClose: () => void;
  onEditPlan: (worker: WorkerMonthlyRow) => void;
}) {
  if (!worker) return null;

  const networkPlans = summarizeWorkerPlansByNetwork(goals, worker.employeeId, monthKey);
  const xpTarget = worker.revenue.target > 0 || worker.testing.target > 0 || worker.working.target > 0;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-[480px] overflow-y-auto p-0">
        <SheetHeader className="border-b p-4 pr-12">
          <div className="flex items-start gap-3">
            <InitialsBadge initials={worker.initials} size="lg" />
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-left text-base leading-snug">
                {worker.name} — {formatMonthLabel(monthKey)} Goals
              </SheetTitle>
              {worker.email && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">{worker.email}</p>
              )}
            </div>
            <button type="button" onClick={onClose} className="absolute right-4 top-4 text-muted-foreground">
              <X size={18} />
            </button>
          </div>
        </SheetHeader>

        <div className="p-4 space-y-5">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Goal summary</h3>
            <MetricSummaryCard
              label="Revenue"
              current={worker.revenue.current}
              target={worker.revenue.target}
              prefix="$"
            />
            <MetricSummaryCard
              label="Testing"
              current={worker.testing.current}
              target={worker.testing.target}
            />
            <MetricSummaryCard
              label="Working campaigns"
              current={worker.working.current}
              target={worker.working.target}
            />
            <div className="rounded-lg border bg-blue-50/60 border-blue-100 p-3 text-sm">
              <p>
                XP earned: <strong>{worker.xpEarned.toLocaleString()} XP</strong>
              </p>
              {!xpTarget && (
                <p className="text-xs text-muted-foreground mt-1">No monthly goal targets configured yet.</p>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Network breakdown</h3>
            {networkPlans.length === 0 ? (
              <p className="text-sm text-muted-foreground">No goal plans configured for this month.</p>
            ) : (
              networkPlans.map((plan) => (
                <NetworkPlanCard
                  key={plan.networkName ?? "worker-wide"}
                  plan={plan}
                />
              ))
            )}
          </section>

          <Button className="w-full" onClick={() => onEditPlan(worker)}>
            <Pencil size={14} className="mr-2" />
            Edit Plan
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
