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

import { useEffect, useMemo, useRef, useState } from "react";
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
  type ShutdownCandidate,
  type TestingNetworkPlan,
  type WorkerDailyPlanSummary,
} from "@/components/operations-hub/monthly-goal-daily-plan";
import {
  computeEffectiveSummary,
  countCompletedGeosToday,
  geoUsageCount,
  isAutoExtraModeActive,
  isExtraLimitReached,
  isOptimizationComplete,
  isScalingComplete,
  isShutdownComplete,
  isTestingGeoComplete,
  isTestingNetworkDailyTargetMet,
  isTestingNetworkVisible,
  optimizationKey,
  orderTestingNetworksByPriority,
  scalingKey,
  selectTopGeosForNetwork,
  selectNextAction,
  shutdownKey,
  testingGeoKey,
  testingNetworkKey,
  type MissionCompletionState,
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
  RefreshCw,
  OctagonX,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { geoFlagLabel } from "@/lib/geo-flag";

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
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-150 active:scale-90",
        done ? "text-emerald-600" : CHECK_RING[color],
      )}
    >
      {done ? (
        <CheckCircle2 className="h-5 w-5 animate-in zoom-in-75 duration-200" strokeWidth={2.25} />
      ) : (
        <Circle className="h-5 w-5" strokeWidth={2} />
      )}
    </button>
  );
}

function GeoLine({
  geo,
  done,
  primary,
  isReuse,
  isExtra,
  canComplete,
  onToggle,
}: {
  geo: TestingNetworkPlan["geos"][number];
  done: boolean;
  primary?: boolean;
  isReuse?: boolean;
  isExtra?: boolean;
  canComplete: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-sky-100/80 px-3 py-2 first:border-t-0",
        done && "opacity-45",
        primary && !done && "bg-sky-100/70",
        isExtra && !done && "bg-amber-50/80",
      )}
    >
      <DoneCheck done={done} color="sky" onToggle={onToggle} disabled={!canComplete} />
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            "font-bold text-slate-900",
            primary ? "text-[13px]" : "text-[12px]",
            done && "text-slate-500 line-through",
            isExtra && !done && "text-amber-950",
          )}
        >
          {isExtra ? (
            <>
              🚀 Next opportunity: {geoFlagLabel(geo.geo)} — Open {geo.todayRequired} test
              {geo.todayRequired === 1 ? "" : "s"}
            </>
          ) : (
            <>
              {geoFlagLabel(geo.geo)} — Open {geo.todayRequired} test
              {geo.todayRequired === 1 ? "" : "s"}
            </>
          )}
          {isReuse && !isExtra && (
            <span className="ml-1.5 text-[11px] font-semibold text-sky-600" title="Reusing a GEO you already completed today">
              🔁
            </span>
          )}
        </span>
        {geo.doneToday > 0 && !done && !isExtra && (
          <span className="ml-1.5 text-[11px] font-medium text-sky-700">· {geo.doneToday} done</span>
        )}
      </div>
      {primary && !done && (
        <span className="shrink-0 rounded-full bg-sky-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">
          Do next
        </span>
      )}
    </div>
  );
}

/**
 * Testing network card — shows up to 3 focused GEO tasks at a time.
 * Completing a GEO removes it from the active pool and the selector back-fills
 * the next best GEO. Refresh rotates tie-break order per network (seed-based).
 */
function TestingNetworkCard({
  plan,
  topGeos,
  doneToday,
  targetMet,
  extraMode,
  activeCount,
  eligibleCount,
  isReuse,
  completionState,
  onRefresh,
  canComplete,
  isPrimaryGeo,
  onCompleteGeo,
  onCompleteExtraGeo,
  onDismissNetwork,
}: {
  plan: TestingNetworkPlan;
  topGeos: TestingNetworkPlan["geos"];
  doneToday: number;
  targetMet: boolean;
  extraMode: boolean;
  extraLimitReached: boolean;
  activeCount: number;
  eligibleCount: number;
  isReuse: boolean;
  completionState: MissionCompletionState;
  onRefresh: () => void;
  canComplete: boolean;
  isPrimaryGeo: (geo: string) => boolean;
  onCompleteGeo: (geo: string) => void;
  onCompleteExtraGeo: (geo: string) => void;
  onDismissNetwork: () => void;
}) {
  const canRefresh = extraMode
    ? eligibleCount > 1
    : !targetMet && eligibleCount > 1;
  const showExtraGeos = targetMet && extraMode && topGeos.length > 0;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border bg-white shadow-sm",
        targetMet && extraMode && "shadow-emerald-100/80 shadow-md ring-1 ring-emerald-100/80",
        targetMet ? "border-emerald-200/90" : "border-sky-200/90",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 border-b px-2.5 py-2.5",
          targetMet
            ? "border-emerald-100 bg-emerald-50/60"
            : "border-sky-100 bg-sky-50/40",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
            targetMet ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700",
          )}
        >
          {targetMet && extraMode ? (
            <span className="text-base leading-none" aria-hidden>
              🚀
            </span>
          ) : targetMet ? (
            <CheckCircle2 className="h-4 w-4" strokeWidth={2.25} />
          ) : (
            <FlaskConical className="h-4 w-4" strokeWidth={2.25} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-slate-900">{plan.network}</p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            <span className={cn("font-semibold", targetMet ? "text-emerald-900" : "text-slate-800")}>
              {plan.todayRequired} test{plan.todayRequired === 1 ? "" : "s"} today
            </span>
            {" · "}
            <span
              className={cn(
                "tabular-nums",
                targetMet ? "font-bold text-emerald-800" : "text-sky-800",
              )}
            >
              {doneToday}/{plan.todayRequired} done
            </span>
            {!targetMet && plan.paceStatus === "behind" && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-800">
                Behind pace
              </span>
            )}
          </p>
        </div>
      </div>
      {targetMet ? (
        <>
          <div className="bg-emerald-50/30 px-3 py-4 text-center">
            <p className="text-sm font-bold text-emerald-800">✅ Done for today</p>
            {extraLimitReached && (
              <p className="mt-2 text-[12px] font-semibold text-emerald-900/90">
                💡 You&apos;ve done great here — try another network
              </p>
            )}
          </div>
          {showExtraGeos && (
            <div className="divide-y divide-amber-100/80 border-t border-amber-100/60 bg-white">
              {topGeos.map((geo) => (
                <GeoLine
                  key={geo.geo}
                  geo={geo}
                  isExtra
                  isReuse={geoUsageCount(completionState, plan.network, geo.geo) > 0}
                  done={false}
                  canComplete={canComplete}
                  onToggle={() => onCompleteExtraGeo(geo.geo)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="divide-y divide-sky-100/80 bg-white">
          {topGeos.map((geo) => (
            <GeoLine
              key={geo.geo}
              geo={geo}
              primary={isPrimaryGeo(geo.geo)}
              isReuse={isTestingGeoComplete(plan.network, geo, completionState)}
              done={false}
              canComplete={canComplete}
              onToggle={() => onCompleteGeo(geo.geo)}
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sky-100 px-3 py-2">
        {!targetMet && (
          <span className="text-[10px] font-medium text-slate-500">
            {isReuse
              ? "All GEOs done — looping with 🔁"
              : activeCount > topGeos.length
                ? `${activeCount} GEOs left in this network`
                : activeCount === 1
                  ? "Single active GEO"
                  : `${topGeos.length} GEOs shown`}
          </span>
        )}
        {extraMode && targetMet && !extraLimitReached && (
          <span className="text-[10px] font-medium text-emerald-700">
            Optional — helps you find more winners
          </span>
        )}
        <div
          className={cn(
            "flex flex-wrap items-center gap-1.5",
            (targetMet || extraMode) && "ml-auto w-full justify-end",
          )}
        >
          {(extraMode || !targetMet) && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={!canRefresh}
              title={
                eligibleCount <= 1
                  ? "Only one GEO in this network"
                  : extraMode
                    ? "Suggest another opportunity"
                    : isReuse
                      ? "Suggest another GEO to repeat"
                      : "Rotate GEO suggestions"
              }
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-all duration-150 active:scale-90",
                extraMode
                  ? "border-amber-200 text-amber-800 hover:bg-amber-50"
                  : "border-sky-200 text-sky-700 hover:bg-sky-100",
                !canRefresh && "cursor-not-allowed opacity-40",
              )}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          )}
          {canComplete && (
            <button
              type="button"
              onClick={onDismissNetwork}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                targetMet
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
              )}
            >
              ✓ Done with this network today
            </button>
          )}
        </div>
      </div>
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
  const reasonLabel = candidate.isWinner
    ? "Winner → scale now"
    : candidate.kind === "scaling"
      ? "Profitable & live long enough → scale"
      : "Testing showing signal → move to working";
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border bg-white shadow-sm",
        candidate.isWinner ? "border-emerald-300 ring-1 ring-emerald-200" : "border-emerald-200/90",
        done && "opacity-60",
      )}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-3">
        <DoneCheck done={done} color="emerald" onToggle={onToggle} disabled={!canComplete} />
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
          {candidate.isWinner ? (
            <Trophy className="h-4 w-4" strokeWidth={2.25} />
          ) : (
            <TrendingUp className="h-4 w-4" strokeWidth={2.25} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={cn("truncate text-sm font-extrabold text-slate-900", done && "line-through")}>
              {candidate.isWinner && (
                <span className="mr-1 rounded bg-emerald-600 px-1 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">
                  Winner
                </span>
              )}
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

function ShutdownCard({
  candidate,
  done,
  canComplete,
  onToggle,
  onReview,
}: {
  candidate: ShutdownCandidate;
  done: boolean;
  canComplete: boolean;
  onToggle: () => void;
  onReview: () => void;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-rose-200/90 bg-white shadow-sm",
        done && "opacity-60",
      )}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-3">
        <DoneCheck done={done} color="amber" onToggle={onToggle} disabled={!canComplete} />
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
          <OctagonX className="h-4 w-4" strokeWidth={2.25} />
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
          <p className="mt-0.5 text-[11px] font-medium text-rose-700">
            {candidate.daysLive} days live · {candidate.conversions} conv · $
            {Math.round(candidate.revenue).toLocaleString()} rev → stop
          </p>
        </div>
        <button
          type="button"
          onClick={onReview}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-rose-700"
        >
          Review
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

const GROUP_STYLE: Record<
  ColorKey,
  { bar: string; chip: string; text: string; count: string; icon: string }
> = {
  sky: {
    bar: "bg-sky-100/70 border-sky-200",
    chip: "bg-sky-600 text-white",
    text: "text-sky-900",
    count: "bg-white/70 text-sky-800",
    icon: "text-sky-700",
  },
  emerald: {
    bar: "bg-emerald-100/70 border-emerald-200",
    chip: "bg-emerald-600 text-white",
    text: "text-emerald-900",
    count: "bg-white/70 text-emerald-800",
    icon: "text-emerald-700",
  },
  amber: {
    bar: "bg-amber-100/70 border-amber-200",
    chip: "bg-amber-600 text-white",
    text: "text-amber-900",
    count: "bg-white/70 text-amber-900",
    icon: "text-amber-700",
  },
};

function GroupHeader({
  color,
  icon: Icon,
  primary,
  title,
  doneLabel,
  collapsed,
  onToggle,
}: {
  color: ColorKey;
  icon: typeof FlaskConical;
  primary?: boolean;
  title: string;
  doneLabel?: string;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const st = GROUP_STYLE[color];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left",
        st.bar,
        primary && "shadow-sm",
      )}
    >
      <span className={cn("flex h-6 w-6 items-center justify-center", st.icon)}>
        <Icon className="h-4.5 w-4.5" strokeWidth={2.5} />
      </span>
      <h3
        className={cn(
          "flex-1 font-extrabold tracking-tight",
          st.text,
          primary ? "text-[15px]" : "text-[13px]",
        )}
      >
        {title}
      </h3>
      {doneLabel && (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
            st.count,
          )}
        >
          {doneLabel}
        </span>
      )}
      {collapsed ? (
        <ChevronRight className={cn("h-4 w-4", st.icon)} />
      ) : (
        <ChevronDown className={cn("h-4 w-4", st.icon)} />
      )}
    </button>
  );
}

function EmptyState({ color, message }: { color: ColorKey; message: string }) {
  const tone =
    color === "sky"
      ? "border-sky-200 bg-sky-50/60 text-sky-700"
      : color === "emerald"
        ? "border-emerald-200 bg-emerald-50/60 text-emerald-800"
        : "border-amber-200 bg-amber-50/60 text-amber-800";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-2xl border border-dashed px-4 py-3 text-[12px] font-medium",
        tone,
      )}
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 opacity-70" />
      {message}
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
  workspaceId,
  employeeId,
}: {
  plan: DailyActionPlan;
  onSelectFocus: (item: FocusItem) => void;
  workspaceId: number | null;
  employeeId: number | null;
}) {
  const { state, toggle, completeGeo, completeExtraGeo, enabled } = useDailyMissionCompletion(
    workspaceId,
    employeeId,
  );
  // Fold live "done for today" marks into the Focus Bar so chips update instantly.
  const s = useMemo(() => computeEffectiveSummary(plan, state), [plan, state]);

  // Per-network Refresh: seed rotates tie-break order for visible GEO rows.
  const [refreshSeedByNetwork, setRefreshSeedByNetwork] = useState<Record<string, number>>({});
  const bumpRefreshSeed = (network: string) =>
    setRefreshSeedByNetwork((m) => ({ ...m, [network]: (m[network] ?? 0) + 1 }));

  const visibleTestingNetworks = useMemo(
    () =>
      orderTestingNetworksByPriority(plan.testingNetworks, state)
        .filter((net) => isTestingNetworkVisible(net, state))
        .map((net) => {
          const targetMet = isTestingNetworkDailyTargetMet(net, state);
          const extraLimitReached = isExtraLimitReached(net, state);
          const extraMode = isAutoExtraModeActive(net, state);
          const topGeos = selectTopGeosForNetwork(
            net,
            state,
            targetMet ? 1 : 3,
            refreshSeedByNetwork[net.network] ?? 0,
          );
          return {
            net,
            topGeos,
            doneToday: countCompletedGeosToday(net, state),
            targetMet,
            extraMode,
            extraLimitReached,
          };
        }),
    [plan.testingNetworks, state, refreshSeedByNetwork],
  );

  const scalingAll = useMemo(
    () => [...plan.scalingCandidates, ...plan.moveToWorkingCandidates],
    [plan.scalingCandidates, plan.moveToWorkingCandidates],
  );
  const scalingVisible = useMemo(
    () => scalingAll.filter((c) => !isScalingComplete(c, state)),
    [scalingAll, state],
  );
  const optimizeVisible = useMemo(
    () => plan.optimizations.filter((g) => !isOptimizationComplete(g, state)),
    [plan.optimizations, state],
  );
  const shutdownAll = plan.shutdownCandidates ?? [];
  const shutdownVisible = useMemo(
    () => shutdownAll.filter((c) => !isShutdownComplete(c, state)),
    [shutdownAll, state],
  );

  // SINGLE SOURCE OF TRUTH: the top task in the same ordered queue is highlighted.
  const nextAction = useMemo(() => selectNextAction(plan, state), [plan, state]);
  const primaryGeoKey = nextAction?.kind === "testing" ? nextAction.key : null;

  // Collapsible groups: Testing open by default, the rest closed.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    testing: false,
    scale: true,
    optimize: true,
    stop: true,
  });
  const toggleGroup = (k: string) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));

  // Micro feedback: transient "+1" whenever the completed count increases.
  const [plusOne, setPlusOne] = useState(false);
  const prevCompleted = useRef(s.completed);
  useEffect(() => {
    if (s.completed > prevCompleted.current) {
      setPlusOne(true);
      const t = setTimeout(() => setPlusOne(false), 900);
      prevCompleted.current = s.completed;
      return () => clearTimeout(t);
    }
    prevCompleted.current = s.completed;
    return undefined;
  }, [s.completed]);

  return (
    <div className="space-y-4">
      {/* ===== Daily progress ===== */}
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
              Daily progress
            </p>
          </div>
          <div className="relative text-right">
            {plusOne && (
              <span className="pointer-events-none absolute -top-3 right-0 animate-in fade-in slide-in-from-bottom-2 text-sm font-black text-emerald-500 duration-300">
                +1
              </span>
            )}
            <p className="text-2xl font-black tabular-nums leading-none text-slate-900">
              {s.completed}
              <span className="text-base font-bold text-slate-400"> / {s.total}</span>
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">completed</p>
          </div>
        </div>
        <div className="mt-3">
          <ProgressBarVisual pct={s.progressPct} size="lg" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-center">
            <p className="text-sm font-black tabular-nums text-sky-800">
              {s.testsDone}/{s.testsRequired}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-sky-700">Tests</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-center">
            <p className="text-sm font-black tabular-nums text-emerald-800">
              {s.scalingDone}/{s.scalingAdvisory}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Scale</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-center">
            <p className="text-sm font-black tabular-nums text-amber-900">
              {s.optimizationsDone}/{s.optimizationsRequired}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">Optimize</p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-center">
            <p className="text-sm font-black tabular-nums text-rose-800">
              {s.shutdownDone}/{s.shutdownAdvisory}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-rose-700">Stop</p>
          </div>
        </div>
      </div>

      {/* ===== 1) Testing Tasks of the Day (primary work block) ===== */}
      <div className="space-y-2">
        <GroupHeader
          color="sky"
          icon={FlaskConical}
          primary
          title="Testing Tasks of the Day"
          doneLabel={`${s.testsDone}/${s.testsRequired} done`}
          collapsed={collapsed.testing}
          onToggle={() => toggleGroup("testing")}
        />
        {!collapsed.testing &&
          (visibleTestingNetworks.length > 0 ? (
            visibleTestingNetworks.map(({ net, topGeos, doneToday, targetMet, extraMode, extraLimitReached }) => {
              const eligibleCount = net.geos.filter((g) => g.todayRequired > 0).length;
              const activeCount = net.geos.filter(
                (g) => g.todayRequired > 0 && !isTestingGeoActiveComplete(net, g, state),
              ).length;
              const isReuse = !targetMet && activeCount === 0;
              return (
                <TestingNetworkCard
                  key={net.network}
                  plan={net}
                  topGeos={topGeos}
                  doneToday={doneToday}
                  targetMet={targetMet}
                  extraMode={extraMode}
                  extraLimitReached={extraLimitReached}
                  activeCount={activeCount}
                  eligibleCount={eligibleCount}
                  isReuse={isReuse}
                  completionState={state}
                  onRefresh={() => bumpRefreshSeed(net.network)}
                  canComplete={enabled}
                  isPrimaryGeo={(geo) => primaryGeoKey === testingGeoKey(net.network, geo)}
                  onCompleteGeo={(geo) => completeGeo(net.network, geo)}
                  onCompleteExtraGeo={(geo) => {
                    completeExtraGeo(net.network, geo);
                    bumpRefreshSeed(net.network);
                  }}
                  onDismissNetwork={() => toggle(testingNetworkKey(net.network))}
                />
              );
            })
          ) : (
            <EmptyState
              color="sky"
              message={
                plan.testingNetworks.length > 0
                  ? "All testing tasks done for today. Nice work!"
                  : "No testing tasks required today."
              }
            />
          ))}
      </div>

      {/* ===== 2) Campaigns We Should Scale Today ===== */}
      <div className="space-y-2">
        <GroupHeader
          color="emerald"
          icon={TrendingUp}
          title="Campaigns We Should Scale Today"
          doneLabel={`${s.scalingDone}/${s.scalingAdvisory} done`}
          collapsed={collapsed.scale}
          onToggle={() => toggleGroup("scale")}
        />
        {!collapsed.scale &&
          (scalingVisible.length > 0 ? (
            scalingVisible.map((c) => (
              <ScalingCard
                key={`${c.kind}:${c.id}`}
                candidate={c}
                canComplete={enabled}
                done={false}
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
            ))
          ) : (
            <EmptyState
              color="emerald"
              message={
                scalingAll.length > 0
                  ? "All scale reviews done for today. Nice work!"
                  : "No campaigns are ready to scale today."
              }
            />
          ))}
      </div>

      {/* ===== 3) Campaigns We Should Optimize Today ===== */}
      <div className="space-y-2">
        <GroupHeader
          color="amber"
          icon={Puzzle}
          title="Campaigns We Should Optimize Today"
          doneLabel={`${s.optimizationsDone}/${s.optimizationsRequired} done`}
          collapsed={collapsed.optimize}
          onToggle={() => toggleGroup("optimize")}
        />
        {!collapsed.optimize &&
          (optimizeVisible.length > 0 ? (
            optimizeVisible.map((g) => (
              <OptimizationCard
                key={g.issueType}
                group={g}
                canComplete={enabled}
                done={false}
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
            ))
          ) : (
            <EmptyState
              color="amber"
              message={
                plan.optimizations.length > 0
                  ? "All optimizations done for today. Nice work!"
                  : "No campaigns need optimization right now."
              }
            />
          ))}
      </div>

      {/* ===== 4) Campaigns We Should STOP ===== */}
      <div className="space-y-2">
        <GroupHeader
          color="amber"
          icon={OctagonX}
          title="Campaigns We Should STOP"
          doneLabel={`${s.shutdownDone}/${s.shutdownAdvisory} done`}
          collapsed={collapsed.stop}
          onToggle={() => toggleGroup("stop")}
        />
        {!collapsed.stop &&
          (shutdownVisible.length > 0 ? (
            shutdownVisible.map((c) => (
              <ShutdownCard
                key={c.id}
                candidate={c}
                canComplete={enabled}
                done={false}
                onToggle={() => toggle(shutdownKey(c.id))}
                onReview={() =>
                  openFocusNav(
                    onSelectFocus,
                    "/live-campaigns",
                    "Stop campaign",
                    `Review ${c.name} to stop`,
                    "Open Live Campaigns",
                  )
                }
              />
            ))
          ) : (
            <EmptyState
              color="amber"
              message={
                shutdownAll.length > 0
                  ? "All stop reviews done for today. Nice work!"
                  : "No campaigns need stopping right now."
              }
            />
          ))}
      </div>
    </div>
  );
}

/** Whether a GEO is complete (marked done or timestamp-done). */
function isTestingGeoActiveComplete(
  net: TestingNetworkPlan,
  geo: TestingNetworkPlan["geos"][number],
  state: MissionCompletionState,
): boolean {
  return isTestingGeoComplete(net.network, geo, state);
}

/** Completion band → color. Green ≥70%, Orange 30–70%, Red <30%. */
function completionBand(pct: number): "green" | "orange" | "red" {
  if (pct >= 70) return "green";
  if (pct >= 30) return "orange";
  return "red";
}

/**
 * One labelled daily-progress bar (Tests / Optimize / Scale). Bar fill color
 * reflects completion: green ≥70%, orange 30–70%, red <30%. Nothing required
 * today renders neutral (no work = not "critical").
 */
function StatBar({ label, done, total }: { label: string; done: number; total: number }) {
  const hasWork = total > 0;
  const pct = hasWork ? Math.min(100, Math.round((done / total) * 100)) : 100;
  const band = completionBand(pct);
  const fill = !hasWork
    ? "bg-slate-300"
    : band === "green"
      ? "bg-emerald-500"
      : band === "orange"
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full transition-all duration-500", fill)}
          style={{ width: `${hasWork ? pct : 0}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-[11px] font-bold tabular-nums text-slate-700">
        {done}/{total}
      </span>
    </div>
  );
}

const STATUS_META: Record<
  "green" | "orange" | "red",
  { label: string; badge: string }
> = {
  green: { label: "On track", badge: "bg-emerald-100 text-emerald-700" },
  orange: { label: "Behind pace", badge: "bg-amber-100 text-amber-800" },
  red: { label: "Critical", badge: "bg-rose-100 text-rose-700" },
};

/**
 * Admin daily control panel — one row per employee with clean daily progress
 * bars (Tests / Optimize / Scale). No GEO breakdown, no dropdowns: admins see
 * instantly who is behind today.
 */
function TeamPlanBoard({
  workers,
  onSelectFocus,
}: {
  workers: WorkerDailyPlanSummary[];
  onSelectFocus: (item: FocusItem) => void;
}) {
  if (workers.length === 0) {
    return <SuccessState onSelectFocus={onSelectFocus} />;
  }

  // Priority sort: biggest remaining gap (required - done) first, so admins
  // instantly see who is furthest behind at the top.
  const ranked = [...workers].sort(
    (a, b) => remainingGap(b) - remainingGap(a),
  );

  return (
    <div className="space-y-2.5">
      {ranked.map((w) => {
        const sm = w.plan.summary;
        const status = STATUS_META[completionBand(sm.progressPct)];
        return (
          <div
            key={w.employeeId}
            className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <Users className="h-3.5 w-3.5" />
              </span>
              <p className="min-w-0 flex-1 truncate text-sm font-extrabold text-slate-900">
                {w.employeeName}
              </p>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  status.badge,
                )}
              >
                {status.label}
              </span>
            </div>
            <div className="space-y-1.5">
              <StatBar label="Tests" done={sm.testsDone} total={sm.testsRequired} />
              <StatBar
                label="Optimize"
                done={sm.optimizationsDone}
                total={sm.optimizationsRequired}
              />
              <StatBar label="Scale" done={0} total={sm.scalingAdvisory} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Total remaining daily work for a worker = required − done across all groups. */
function remainingGap(w: WorkerDailyPlanSummary): number {
  return Math.max(0, w.plan.summary.total - w.plan.summary.completed);
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
