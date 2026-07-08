/**
 * Operations Hub — Daily Mission Board driven by Monthly Goals → Daily Action Plan.
 * Bright, compact Network accordion + Optimizations + Scaling. No Revenue.
 */

import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { FocusItem } from "@/components/operations-hub/ops-hub-drilldown-data";
import type {
  MetricSliceBundle,
  OpsCampaignRowLite,
} from "@/components/operations-hub/ops-goal-focus";
import { ProgressBarVisual } from "@/components/operations-hub/goal-progress-row";
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
  FlaskConical,
  Sparkles,
  Puzzle,
  TrendingUp,
  CheckCircle2,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

function GeoLine({ geo }: { geo: TestingNetworkPlan["geos"][number] }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-sky-100/80 px-3 py-2 text-[12px] first:border-t-0">
      <div className="min-w-0">
        <span className="font-bold text-sky-800">{geo.geo}</span>
        <span className="text-slate-600">
          {" "}
          — Open {geo.todayRequired} test{geo.todayRequired === 1 ? "" : "s"} today
        </span>
      </div>
      <div className="tabular-nums text-[11px] text-slate-500">
        Current{" "}
        <span className="font-semibold text-slate-700">
          {Math.round(geo.current)} / {Math.round(geo.monthlyTarget)}
        </span>
        {" · "}Expected{" "}
        <span className="font-semibold text-slate-700">{Math.ceil(geo.expectedByNow)}</span>
        {" · "}Gap{" "}
        <span className={cn("font-semibold", geo.gapToPace > 0 ? "text-amber-700" : "text-emerald-700")}>
          {geo.gapToPace}
        </span>
        {geo.doneToday > 0 && (
          <>
            {" · "}
            <span className="font-semibold text-sky-700">{geo.doneToday} done</span>
          </>
        )}
      </div>
    </div>
  );
}

function TestingNetworkAccordion({
  plan,
  defaultOpen,
  onOpenTests,
}: {
  plan: TestingNetworkPlan;
  defaultOpen?: boolean;
  onOpenTests: () => void;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="overflow-hidden rounded-2xl border border-sky-200/90 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left hover:bg-sky-50/60"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
          <FlaskConical className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-slate-900">{plan.network}</p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            Open {plan.todayRequired} test{plan.todayRequired === 1 ? "" : "s"} today
            {plan.geoCount > 0 ? ` across ${plan.geoCount} GEO${plan.geoCount === 1 ? "" : "s"}` : ""}
            {" · "}
            <span className="font-semibold tabular-nums text-sky-800">
              {plan.doneToday} / {plan.todayRequired} done
            </span>
            {" · "}
            <span
              className={cn(
                "font-semibold",
                plan.paceStatus === "behind"
                  ? "text-amber-700"
                  : plan.paceStatus === "completed"
                    ? "text-emerald-700"
                    : "text-slate-600",
              )}
            >
              {plan.paceStatus === "behind"
                ? "Behind pace"
                : plan.paceStatus === "completed"
                  ? "Completed"
                  : "On pace"}
            </span>
          </p>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
        )}
      </button>
      {open && (
        <div className="border-t border-sky-100 bg-sky-50/40">
          {plan.geos.map((g) => (
            <GeoLine key={g.geo} geo={g} />
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

function OptimizationCard({
  group,
  onReview,
}: {
  group: OptimizationGroup;
  onReview: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-amber-200/90 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left hover:bg-amber-50/50"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
          <Puzzle className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-slate-900">{group.label}</p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            {group.canTrackCompletion
              ? `${group.doneToday} / ${group.required} fixed today`
              : "Still requires action"}
          </p>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>
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

function ScalingCard({
  title,
  candidates,
  onReview,
}: {
  title: string;
  candidates: ScalingCandidate[];
  onReview: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (candidates.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-200/90 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left hover:bg-emerald-50/50"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
          <TrendingUp className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-slate-900">{title}</p>
          <p className="mt-0.5 text-[11px] font-medium text-emerald-800">Review recommended</p>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {open && (
        <div className="space-y-1 border-t border-emerald-100 bg-emerald-50/30 px-3 py-2">
          {candidates.slice(0, 8).map((c) => (
            <div key={c.id} className="text-[12px]">
              <div className="flex justify-between gap-2">
                <span className="truncate font-semibold text-slate-800">{c.name}</span>
                <span className="shrink-0 text-slate-500">
                  {c.network} / {c.geo}
                </span>
              </div>
              <p className="tabular-nums text-[11px] text-slate-500">
                Profit ${Math.round(c.profit).toLocaleString()} · ROI {c.roi.toFixed(1)}%
                {c.visitsPerOffer != null && ` · VPO ${Math.ceil(c.visitsPerOffer)}`}
              </p>
            </div>
          ))}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onReview}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-emerald-700"
            >
              Open Live Campaigns
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
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
}: {
  plan: DailyActionPlan;
  onSelectFocus: (item: FocusItem) => void;
}) {
  const s = plan.summary;
  const hasWork = s.total > 0;

  if (!hasWork) {
    return <SuccessState onSelectFocus={onSelectFocus} />;
  }

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
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-900">
            Optimizations: {s.optimizationsDone}/{s.optimizationsRequired}
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
            Scaling: {s.scalingAdvisory} review
          </span>
        </div>
      </div>

      {plan.testingNetworks.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-sky-700">
            Testing Plan
          </h3>
          {plan.testingNetworks.map((n, i) => (
            <TestingNetworkAccordion
              key={n.network}
              plan={n}
              defaultOpen={i === 0}
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

      {plan.optimizations.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-amber-800">
            Optimizations
          </h3>
          {plan.optimizations.map((g) => (
            <OptimizationCard
              key={g.issueType}
              group={g}
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

      {(plan.scalingCandidates.length > 0 || plan.moveToWorkingCandidates.length > 0) && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800">
            Scaling / Move to Working
          </h3>
          <ScalingCard
            title={`Review ${plan.scalingCandidates.length} scaling opportunit${plan.scalingCandidates.length === 1 ? "y" : "ies"}`}
            candidates={plan.scalingCandidates}
            onReview={() =>
              openFocusNav(
                onSelectFocus,
                "/live-campaigns",
                "Scaling",
                "Review scaling opportunities",
                "Open Live Campaigns",
              )
            }
          />
          <ScalingCard
            title={`Move ${plan.moveToWorkingCandidates.length} testing campaign${plan.moveToWorkingCandidates.length === 1 ? "" : "s"} to working`}
            candidates={plan.moveToWorkingCandidates}
            onReview={() =>
              openFocusNav(
                onSelectFocus,
                "/live-campaigns",
                "Move to working",
                "Review testing → working candidates",
                "Open Live Campaigns",
              )
            }
          />
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
                  Tests {w.plan.summary.testsRequired} · Opts {w.plan.summary.optimizationsRequired} ·
                  Scaling {w.plan.summary.scalingAdvisory}
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
                    <span className="font-bold">{n.network}</span>: {n.todayRequired} test
                    {n.todayRequired === 1 ? "" : "s"} across{" "}
                    {n.geos.map((g) => g.geo).join("/")}
                  </p>
                ))}
                {w.plan.optimizations.map((g) => (
                  <p key={g.issueType} className="text-[12px] text-amber-900">
                    {g.label}
                  </p>
                ))}
                {w.plan.scalingCandidates.length > 0 && (
                  <p className="text-[12px] text-emerald-800">
                    Review {w.plan.scalingCandidates.length} scaling opportunit
                    {w.plan.scalingCandidates.length === 1 ? "y" : "ies"}
                  </p>
                )}
                {w.plan.moveToWorkingCandidates.length > 0 && (
                  <p className="text-[12px] text-emerald-800">
                    Move {w.plan.moveToWorkingCandidates.length} to working
                  </p>
                )}
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
    });
  }, [isAdminAllEmployees, monthKey, testingSlices, scopedCampaigns]);

  const teamPlans = useMemo(() => {
    if (!isAdminAllEmployees) return [];
    return buildTeamDailyPlans(teamWorkers ?? [], monthKey);
  }, [isAdminAllEmployees, teamWorkers, monthKey]);

  const title = isAdminAllEmployees
    ? "Team Daily Focus"
    : "What we need to do today";
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
          <WorkerPlanBoard plan={workerPlan} onSelectFocus={onSelectFocus} />
        ) : (
          <SuccessState onSelectFocus={onSelectFocus} />
        )}
      </div>
    </section>
  );
}
