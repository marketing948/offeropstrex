/**
 * Operations Hub — Daily Mission Board driven by Monthly Goals → Daily Action Plan.
 *
 * Three fixed groups, always in this order:
 *   1. Testing Tasks of the Day  (blue)
 *   2. Campaigns We Should Scale Today  (green)
 *   3. Campaigns We Should Optimize Today  (amber)
 *
 * Bright, compact accordions. No Revenue anywhere. Workers can mark rows
 * "Done for today" (worker + date scoped convenience layer, not campaign truth).
 */

import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { FocusItem } from "@/components/operations-hub/ops-hub-drilldown-data";
import type {
  MetricSliceBundle,
  OpsCampaignRowLite,
} from "@/components/operations-hub/ops-goal-focus";
import { ProgressBarVisual } from "@/components/operations-hub/goal-progress-row";
import { useAlertRules } from "@/hooks/use-alert-rules";
import {
  buildDailyActionPlan,
  buildTeamDailyPlans,
  type DailyActionPlan,
  type OptimizationGroup,
  type ScalingCandidate,
  type TestingNetworkPlan,
  type WorkerDailyPlanSummary,
} from "@/components/operations-hub/monthly-goal-daily-plan";
import {
  computeEffectiveSummary,
  optimizationKey,
  scalingKey,
  testingGeoKey,
  testingNetworkKey,
} from "@/components/operations-hub/daily-mission-completion";
import { useDailyMissionCompletion } from "@/components/operations-hub/use-daily-mission-completion";
import {
  FlaskConical,
  Sparkles,
  Puzzle,
  TrendingUp,
  CheckCircle2,
  Circle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ColorKey = "sky" | "emerald" | "amber";

const CHECK_RING: Record<ColorKey, string> = {
  sky: "text-sky-600 hover:bg-sky-50",
  emerald: "text-emerald-600 hover:bg-emerald-50",
  amber: "text-amber-600 hover:bg-amber-50",
};

function openFocusNav(
  onSelectFocus: (item: FocusItem) => void,
  path: string,
  title: string,
  text: string,
  actionLabel: string,
) {
  onSelectFocus({
    tier: "primary",
    emoji: "→",
    title,
    text,
    context: {
      navigationPath: path,
      actionLabel,
    },
  });
}

/** Small "Done for today" toggle. Stops row click propagation. */
function DoneCheck({
  done,
  color,
  onToggle,
  disabled,
}: {
  done: boolean;
  color: ColorKey;
  onToggle: () => void;
  disabled?: boolean;
}) {
  if (disabled) return null;
  return (
    <button
      type="button"
      aria-pressed={done}
      title={done ? "Marked done for today" : "Mark done for today"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
        done ? "text-emerald-600" : CHECK_RING[color],
      )}
    >
      {done ? (
        <CheckCircle2 className="h-5 w-5" strokeWidth={2.25} />
      ) : (
        <Circle className="h-5 w-5" strokeWidth={2} />
      )}
    </button>
  );
}

function GeoLine({
  network,
  geo,
  done,
  canComplete,
  onToggle,
}: {
  network: string;
  geo: TestingNetworkPlan["geos"][number];
  done: boolean;
  canComplete: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-sky-100/80 px-3 py-2 text-[12px] first:border-t-0",
        done && "opacity-50",
      )}
    >
      <DoneCheck done={done} color="sky" onToggle={onToggle} disabled={!canComplete} />
      <div className="min-w-0 flex-1">
        <span className={cn("font-bold text-sky-800", done && "line-through")}>{geo.geo}</span>
        <span className="text-slate-600">
          {" "}
          — Open {geo.todayRequired} today · Monthly goal {Math.round(geo.monthlyTarget)} · Done today{" "}
          {geo.doneToday}
        </span>
      </div>
      <span title="Network abbreviation" className="sr-only">
        {network}
      </span>
    </div>
  );
}

function TestingNetworkAccordion({
  plan,
  defaultOpen,
  onOpenTests,
  canComplete,
  isNetworkDone,
  isGeoDone,
  onToggleNetwork,
  onToggleGeo,
}: {
  plan: TestingNetworkPlan;
  defaultOpen?: boolean;
  onOpenTests: () => void;
  canComplete: boolean;
  isNetworkDone: boolean;
  isGeoDone: (geo: string) => boolean;
  onToggleNetwork: () => void;
  onToggleGeo: (geo: string) => void;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-sky-200/90 bg-white shadow-sm",
        isNetworkDone && "opacity-60",
      )}
    >
      <div className="flex items-center gap-1.5 pl-2.5">
        <DoneCheck
          done={isNetworkDone}
          color="sky"
          onToggle={onToggleNetwork}
          disabled={!canComplete}
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 py-3 pr-3 text-left hover:bg-sky-50/60"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
            <FlaskConical className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-sm font-extrabold text-slate-900",
                isNetworkDone && "line-through",
              )}
            >
              {plan.network}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-600">
              <span className="font-semibold text-slate-800">
                Open {plan.todayRequired} test{plan.todayRequired === 1 ? "" : "s"} today
              </span>
              {" · "}Monthly goal {Math.round(plan.monthlyGoal)}
              {" · "}Done today{" "}
              <span className="font-semibold tabular-nums text-sky-800">{plan.doneToday}</span>
              {plan.paceStatus === "behind" && (
                <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-800">
                  Behind pace
                </span>
              )}
            </p>
          </div>
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          )}
        </button>
      </div>
      {open && (
        <div className="border-t border-sky-100 bg-sky-50/40">
          {plan.geos.map((g) => (
            <GeoLine
              key={g.geo}
              network={plan.network}
              geo={g}
              done={isNetworkDone || isGeoDone(g.geo)}
              canComplete={canComplete && !isNetworkDone}
              onToggle={() => onToggleGeo(g.geo)}
            />
          ))}
          <div className="flex justify-end border-t border-sky-100 px-3 py-2">
            <button
              type="button"
              onClick={onOpenTests}
              className="inline-flex items-center gap-1 rounded-full bg-sky-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-sky-700"
            >
              Open test
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScalingCard({
  candidate,
  done,
  canComplete,
  onToggle,
  onReview,
}: {
  candidate: ScalingCandidate;
  done: boolean;
  canComplete: boolean;
  onToggle: () => void;
  onReview: () => void;
}) {
  const reasonLabel =
    candidate.kind === "scaling"
      ? "Profitable & live long enough → scale"
      : "Testing showing signal → move to working";
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-emerald-200/90 bg-white shadow-sm",
        done && "opacity-60",
      )}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-3">
        <DoneCheck done={done} color="emerald" onToggle={onToggle} disabled={!canComplete} />
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
          <TrendingUp className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={cn("truncate text-sm font-extrabold text-slate-900", done && "line-through")}>
              {candidate.name}
            </p>
            <span className="shrink-0 text-[11px] text-slate-500">
              {candidate.network} / {candidate.geo}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-medium text-emerald-800">{reasonLabel}</p>
          <p className="tabular-nums text-[11px] text-slate-500">
            Profit ${Math.round(candidate.profit).toLocaleString()} · ROI {candidate.roi.toFixed(1)}%
            {candidate.visitsPerOffer != null && ` · VPO ${Math.ceil(candidate.visitsPerOffer)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onReview}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-emerald-700"
        >
          Review
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function OptimizationCard({
  group,
  done,
  canComplete,
  onToggle,
  onReview,
}: {
  group: OptimizationGroup;
  done: boolean;
  canComplete: boolean;
  onToggle: () => void;
  onReview: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-amber-200/90 bg-white shadow-sm",
        done && "opacity-60",
      )}
    >
      <div className="flex items-center gap-1.5 pl-2.5">
        <DoneCheck done={done} color="amber" onToggle={onToggle} disabled={!canComplete} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 py-3 pr-3 text-left hover:bg-amber-50/50"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
            <Puzzle className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm font-extrabold text-slate-900", done && "line-through")}>
              {group.label}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-600">
              {group.canTrackCompletion
                ? `${group.doneToday} / ${group.required} fixed today`
                : "Recommended review"}
            </p>
          </div>
          {open ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
        </button>
      </div>
      {open && (
        <div className="space-y-1 border-t border-amber-100 bg-amber-50/30 px-3 py-2">
          {group.campaigns.slice(0, 8).map((c) => (
            <div key={c.id} className="flex justify-between gap-2 text-[12px]">
              <span className="truncate font-semibold text-slate-800">{c.name}</span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {c.network} / {c.geo}
              </span>
            </div>
          ))}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onReview}
              className="inline-flex items-center gap-1 rounded-full bg-amber-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-amber-700"
            >
              Review campaigns
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupHeader({ color, children }: { color: ColorKey; children: React.ReactNode }) {
  const tone =
    color === "sky"
      ? "text-sky-700"
      : color === "emerald"
        ? "text-emerald-800"
        : "text-amber-800";
  return (
    <h3 className={cn("text-[11px] font-extrabold uppercase tracking-wider", tone)}>{children}</h3>
  );
}

function SuccessState({ onSelectFocus }: { onSelectFocus: (item: FocusItem) => void }) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-sky-50 px-5 py-6 text-center">
      <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
      <p className="mt-3 text-base font-bold text-slate-900">You’re on pace today.</p>
      <p className="mt-1 text-sm text-slate-600">
        Keep monitoring working campaigns and look for scaling opportunities.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          onClick={() =>
            openFocusNav(onSelectFocus, "/live-campaigns", "Live Campaigns", "Review Live Campaigns", "Review")
          }
        >
          Review Live Campaigns
        </button>
      </div>
    </div>
  );
}

function WorkerPlanBoard({
  plan,
  onSelectFocus,
  workspaceId,
  employeeId,
}: {
  plan: DailyActionPlan;
  onSelectFocus: (item: FocusItem) => void;
  workspaceId: number | null;
  employeeId: number | null;
}) {
  const { state, isDone, toggle, enabled } = useDailyMissionCompletion(workspaceId, employeeId);
  // Fold live "done for today" marks into the Focus Bar so chips update instantly.
  const s = useMemo(() => computeEffectiveSummary(plan, state), [plan, state]);
  const hasWork = plan.summary.total > 0;
  if (!hasWork) {
    return <SuccessState onSelectFocus={onSelectFocus} />;
  }

  const scalingAll = [...plan.scalingCandidates, ...plan.moveToWorkingCandidates];

  return (
    <div className="space-y-4">
      {/* Focus Bar */}
      <div className="rounded-2xl border border-sky-100 bg-white/95 px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Daily progress</p>
          <p className="text-sm font-extrabold tabular-nums text-slate-900">
            {s.completed} / {s.total} completed
          </p>
        </div>
        <div className="mt-2">
          <ProgressBarVisual pct={s.progressPct} size="md" />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[10px] font-bold text-sky-800">
            Tests: {s.testsDone}/{s.testsRequired}
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
            Scaling: {s.scalingDone}/{s.scalingAdvisory}
          </span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-900">
            Optimizations: {s.optimizationsDone}/{s.optimizationsRequired}
          </span>
        </div>
      </div>

      {/* 1) Testing Tasks of the Day */}
      {plan.testingNetworks.length > 0 && (
        <div className="space-y-2">
          <GroupHeader color="sky">Testing Tasks of the Day</GroupHeader>
          {plan.testingNetworks.map((n, i) => (
            <TestingNetworkAccordion
              key={n.network}
              plan={n}
              defaultOpen={i === 0}
              canComplete={enabled}
              isNetworkDone={isDone(testingNetworkKey(n.network))}
              isGeoDone={(geo) => isDone(testingGeoKey(n.network, geo))}
              onToggleNetwork={() => toggle(testingNetworkKey(n.network))}
              onToggleGeo={(geo) => toggle(testingGeoKey(n.network, geo))}
              onOpenTests={() =>
                openFocusNav(
                  onSelectFocus,
                  "/testing-batches",
                  "Open tests",
                  `Open ${n.todayRequired} tests on ${n.network}`,
                  "Open test",
                )
              }
            />
          ))}
        </div>
      )}

      {/* 2) Campaigns We Should Scale Today */}
      {scalingAll.length > 0 && (
        <div className="space-y-2">
          <GroupHeader color="emerald">Campaigns We Should Scale Today</GroupHeader>
          {scalingAll.map((c) => (
            <ScalingCard
              key={`${c.kind}:${c.id}`}
              candidate={c}
              canComplete={enabled}
              done={isDone(scalingKey(c.kind, c.id))}
              onToggle={() => toggle(scalingKey(c.kind, c.id))}
              onReview={() =>
                openFocusNav(
                  onSelectFocus,
                  "/live-campaigns",
                  c.kind === "scaling" ? "Scaling" : "Move to working",
                  `Review ${c.name}`,
                  "Open Live Campaigns",
                )
              }
            />
          ))}
        </div>
      )}

      {/* 3) Campaigns We Should Optimize Today */}
      {plan.optimizations.length > 0 && (
        <div className="space-y-2">
          <GroupHeader color="amber">Campaigns We Should Optimize Today</GroupHeader>
          {plan.optimizations.map((g) => (
            <OptimizationCard
              key={g.issueType}
              group={g}
              canComplete={enabled}
              done={isDone(optimizationKey(g.issueType))}
              onToggle={() => toggle(optimizationKey(g.issueType))}
              onReview={() =>
                openFocusNav(
                  onSelectFocus,
                  "/live-campaigns",
                  "Review campaigns",
                  g.label,
                  "Review campaigns",
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamPlanBoard({
  workers,
  onSelectFocus,
}: {
  workers: WorkerDailyPlanSummary[];
  onSelectFocus: (item: FocusItem) => void;
}) {
  const [openId, setOpenId] = useState<number | null>(workers[0]?.employeeId ?? null);

  if (workers.length === 0) {
    return <SuccessState onSelectFocus={onSelectFocus} />;
  }

  return (
    <div className="space-y-2">
      {workers.map((w) => {
        const open = openId === w.employeeId;
        return (
          <div
            key={w.employeeId}
            className="overflow-hidden rounded-2xl border border-indigo-200/80 bg-white shadow-sm"
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? null : w.employeeId)}
              className="flex w-full items-center gap-2 px-3.5 py-3 text-left hover:bg-indigo-50/40"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                <Users className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold text-slate-900">{w.headline}</p>
                <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                  Tests {w.plan.summary.testsRequired} · Scaling {w.plan.summary.scalingAdvisory} ·
                  Opts {w.plan.summary.optimizationsRequired}
                </p>
              </div>
              {open ? (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400" />
              )}
            </button>
            {open && (
              <div className="space-y-1.5 border-t border-indigo-100 bg-indigo-50/20 px-3 py-2.5">
                {w.plan.testingNetworks.map((n) => (
                  <p key={n.network} className="text-[12px] text-slate-700">
                    <span className="font-bold">{n.network}</span>: Open {n.todayRequired} test
                    {n.todayRequired === 1 ? "" : "s"} · Monthly goal {Math.round(n.monthlyGoal)}
                  </p>
                ))}
                {w.plan.scalingCandidates.length + w.plan.moveToWorkingCandidates.length > 0 && (
                  <p className="text-[12px] text-emerald-800">
                    Scale review:{" "}
                    {w.plan.scalingCandidates.length + w.plan.moveToWorkingCandidates.length}{" "}
                    campaign
                    {w.plan.scalingCandidates.length + w.plan.moveToWorkingCandidates.length === 1
                      ? ""
                      : "s"}
                  </p>
                )}
                {w.plan.optimizations.map((g) => (
                  <p key={g.issueType} className="text-[12px] text-amber-900">
                    {g.label}
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TodaysFocusCard({
  focus: _focus,
  loading,
  onSelectFocus,
  campaigns = [],
  isWorker = true,
  isAdminAllEmployees = false,
  employeeName = null,
  employeeId = null,
  monthKey,
  testingSlices = [],
  teamWorkers,
}: {
  /** Legacy Focus payload — kept for call-site compatibility; board uses plan builders. */
  focus?: unknown;
  loading?: boolean;
  onSelectFocus: (item: FocusItem) => void;
  campaigns?: OpsCampaignRowLite[];
  isWorker?: boolean;
  isAdminAllEmployees?: boolean;
  employeeName?: string | null;
  employeeId?: number | null;
  monthKey: string;
  testingSlices?: MetricSliceBundle["testing"];
  /** Admin all-employees: per-worker slice + campaign inputs. */
  teamWorkers?: {
    employeeId: number;
    employeeName: string;
    testingSlices: MetricSliceBundle["testing"];
    campaigns?: OpsCampaignRowLite[];
  }[];
}) {
  void _focus;
  void isWorker;
  const { rules, workspaceId } = useAlertRules();

  const scopedCampaigns = useMemo(() => {
    if (employeeId == null) return campaigns;
    return campaigns.filter((c) => c.employeeId == null || c.employeeId === employeeId);
  }, [campaigns, employeeId]);

  const workerPlan = useMemo(() => {
    if (isAdminAllEmployees) return null;
    return buildDailyActionPlan({
      monthKey,
      testingSlices,
      campaigns: scopedCampaigns,
      rules,
    });
  }, [isAdminAllEmployees, monthKey, testingSlices, scopedCampaigns, rules]);

  const teamPlans = useMemo(() => {
    if (!isAdminAllEmployees) return [];
    return buildTeamDailyPlans(teamWorkers ?? [], monthKey, new Date(), rules);
  }, [isAdminAllEmployees, teamWorkers, monthKey, rules]);

  const title = isAdminAllEmployees ? "Team Daily Focus" : "What we need to do today";
  const subtitle = isAdminAllEmployees
    ? `${teamPlans.length} worker${teamPlans.length === 1 ? "" : "s"} need action today`
    : employeeName
      ? `${employeeName} · Monthly Goals → today’s plan`
      : "Monthly Goals → today’s plan";

  return (
    <section
      className="rounded-[22px] border border-sky-200/80 bg-gradient-to-br from-sky-50 via-white to-emerald-50/40 p-5 shadow-[0_8px_28px_rgba(14,165,233,0.08)] md:p-6"
      aria-labelledby="ops-todays-focus"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-600 ring-1 ring-sky-200">
              <Sparkles className="h-4.5 w-4.5" strokeWidth={2.25} />
            </span>
            <div>
              <h2
                id="ops-todays-focus"
                className="text-lg font-extrabold tracking-tight text-slate-900"
              >
                {title}
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>
            </div>
          </div>
        </div>
        <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-sky-700 shadow-sm">
          Daily Mission Board
        </span>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[72px] rounded-2xl bg-sky-100/50" />
            ))}
          </div>
        ) : isAdminAllEmployees ? (
          <TeamPlanBoard workers={teamPlans} onSelectFocus={onSelectFocus} />
        ) : workerPlan ? (
          <WorkerPlanBoard
            plan={workerPlan}
            onSelectFocus={onSelectFocus}
            workspaceId={workspaceId ?? null}
            employeeId={employeeId}
          />
        ) : (
          <SuccessState onSelectFocus={onSelectFocus} />
        )}
      </div>
    </section>
  );
}
