/**
 * Operations Hub — Daily Mission Board (Today Focus Option A).
 * Light, scannable daily workflow UI consuming the goal Focus engine.
 */

import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { FocusItem, TodaysFocus } from "@/components/operations-hub/ops-hub-drilldown-data";
import type { OpsCampaignRowLite } from "@/components/operations-hub/ops-goal-focus";
import { ProgressBarVisual } from "@/components/operations-hub/goal-progress-row";
import {
  buildDailyMissionRows,
  buildMissionBoardHeader,
  computeDailyMissionBar,
  type DailyMissionRow,
} from "@/components/operations-hub/daily-mission-board";
import {
  FlaskConical,
  Radio,
  Sparkles,
  Target,
  DollarSign,
  Puzzle,
  TrendingUp,
  Flame,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_STYLE: Record<
  string,
  { badge: string; Icon: typeof Target; label: string }
> = {
  testing: {
    label: "Testing",
    Icon: FlaskConical,
    badge: "border-violet-200 bg-violet-50 text-violet-700",
  },
  working: {
    label: "Working",
    Icon: Radio,
    badge: "border-orange-200 bg-orange-50 text-orange-700",
  },
  scaling: {
    label: "Scaling",
    Icon: TrendingUp,
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  fixes: {
    label: "Fix required",
    Icon: Puzzle,
    badge: "border-amber-200 bg-amber-50 text-amber-800",
  },
  revenue: {
    label: "Revenue rescue",
    Icon: DollarSign,
    badge: "border-rose-200 bg-rose-50 text-rose-700",
  },
  admin: {
    label: "Admin intervention",
    Icon: Flame,
    badge: "border-slate-200 bg-slate-50 text-slate-700",
  },
};

function MissionRow({
  row,
  onSelect,
}: {
  row: DailyMissionRow;
  onSelect: (item: FocusItem) => void;
}) {
  const style = CATEGORY_STYLE[row.mission.category] ?? CATEGORY_STYLE.admin!;
  const Icon = style.Icon;
  const ctx = row.context;
  const where =
    ctx?.network != null
      ? ctx.geo
        ? `${ctx.network} / ${ctx.geo}`
        : ctx.network
      : null;

  const missionPct =
    row.mission.dailyTargetUnits > 0 && row.mission.canTrackCompletion
      ? Math.min(
          100,
          Math.round((row.mission.completedTodayUnits / row.mission.dailyTargetUnits) * 100),
        )
      : ctx?.progressPct ?? null;

  const progressLabel = row.mission.canTrackCompletion
    ? `${row.mission.completedTodayUnits} / ${row.mission.dailyTargetUnits} done today`
    : row.mission.completionLabel;

  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      className="group flex w-full items-stretch gap-3 rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
    >
      <div className="flex w-10 shrink-0 flex-col items-center justify-center">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-50 text-xs font-black text-sky-700 ring-1 ring-sky-100">
          #{row.priority}
        </span>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              style.badge,
            )}
          >
            <Icon className="h-3 w-3" strokeWidth={2.25} />
            {style.label}
          </span>
          {where && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              {where}
            </span>
          )}
          {ctx?.employeeName && (
            <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
              {ctx.employeeName}
            </span>
          )}
        </div>

        <p className="truncate text-sm font-bold leading-snug text-slate-900">{row.text}</p>

        {(ctx?.currentValue || ctx?.expectedByNow || ctx?.paceGapLabel) && (
          <p className="text-[11px] tabular-nums text-slate-500">
            {ctx.currentValue != null && (
              <>
                Current <span className="font-semibold text-slate-700">{ctx.currentValue}</span>
              </>
            )}
            {ctx.expectedByNow != null && (
              <>
                {" · "}Expected <span className="font-semibold text-slate-700">{ctx.expectedByNow}</span>
              </>
            )}
            {ctx.paceGapLabel != null && (
              <>
                {" · "}Gap <span className="font-semibold text-amber-700">{ctx.paceGapLabel}</span>
              </>
            )}
          </p>
        )}

        {missionPct != null && (
          <div className="space-y-1 pt-0.5">
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span className="truncate">{progressLabel}</span>
              <span className="ml-2 shrink-0 font-bold tabular-nums text-slate-700">{missionPct}%</span>
            </div>
            <ProgressBarVisual pct={missionPct} size="sm" />
          </div>
        )}
        {missionPct == null && row.mission.completionLabel && (
          <p className="text-[10px] font-medium text-slate-500">{row.mission.completionLabel}</p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end justify-center gap-1">
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm group-hover:bg-sky-700">
          {ctx?.actionLabel ?? "Open"}
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </button>
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
            onSelectFocus({
              tier: "primary",
              emoji: "📡",
              title: "Live Campaigns",
              text: "Review Live Campaigns",
              context: { navigationPath: "/live-campaigns", actionLabel: "Review Live Campaigns" },
            })
          }
        >
          Review Live Campaigns
        </button>
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          onClick={() =>
            onSelectFocus({
              tier: "secondary",
              emoji: "📊",
              title: "Reports",
              text: "Check Reports",
              context: { navigationPath: "/reports", actionLabel: "Check Reports" },
            })
          }
        >
          Check Reports
        </button>
      </div>
    </div>
  );
}

export function TodaysFocusCard({
  focus,
  loading,
  onSelectFocus,
  campaigns = [],
  isWorker = true,
  isAdminAllEmployees = false,
  employeeName = null,
  employeeId = null,
}: {
  focus: TodaysFocus;
  loading?: boolean;
  onSelectFocus: (item: FocusItem) => void;
  campaigns?: OpsCampaignRowLite[];
  isWorker?: boolean;
  isAdminAllEmployees?: boolean;
  employeeName?: string | null;
  employeeId?: number | null;
}) {
  const rows = useMemo(
    () =>
      buildDailyMissionRows(focus, campaigns, {
        employeeId,
        isAdminAllEmployees,
      }),
    [focus, campaigns, employeeId, isAdminAllEmployees],
  );

  const bar = useMemo(() => computeDailyMissionBar(rows), [rows]);
  const header = useMemo(
    () =>
      buildMissionBoardHeader({
        isWorker,
        isAdminAllEmployees,
        employeeName,
        bar,
        visibleRows: rows.length,
      }),
    [isWorker, isAdminAllEmployees, employeeName, bar, rows.length],
  );

  const showSuccess =
    !loading &&
    (focus.empty ||
      rows.length === 0 ||
      (bar.isSuccess && rows.every((r) => !r.mission.canTrackCompletion || r.mission.completedTodayUnits >= r.mission.dailyTargetUnits)));

  return (
    <section
      className="rounded-[22px] border border-sky-200/80 bg-gradient-to-br from-sky-50 via-white to-violet-50 p-5 shadow-[0_8px_28px_rgba(14,165,233,0.08)] md:p-6"
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
                {header.title}
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">{header.subtitle}</p>
            </div>
          </div>
        </div>
        <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-sky-700 shadow-sm">
          Daily Mission Board · max 5
        </span>
      </div>

      {/* Focus Bar */}
      <div className="mt-4 rounded-2xl border border-sky-100 bg-white/90 px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Daily progress</p>
          <p className="text-sm font-extrabold tabular-nums text-slate-900">
            {bar.totalActions === 0
              ? "On pace"
              : `${bar.completedActions} / ${bar.totalActions} actions completed`}
          </p>
        </div>
        <div className="mt-2">
          <ProgressBarVisual pct={bar.progressPct} size="md" />
        </div>
        {(bar.chips.length > 0 || bar.employeeChips.length > 0) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {bar.chips.map((chip) => (
              <span
                key={chip.key}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-bold text-slate-700"
              >
                {chip.label}: {chip.completed}/{chip.total}
              </span>
            ))}
            {isAdminAllEmployees &&
              bar.employeeChips.slice(0, 6).map((e) => (
                <span
                  key={e.name}
                  className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700"
                >
                  {e.name}: {e.count}
                </span>
              ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="mt-4 space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[72px] rounded-2xl bg-sky-100/50" />
          ))}
        </div>
      ) : showSuccess && rows.length === 0 ? (
        <div className="mt-4">
          <SuccessState onSelectFocus={onSelectFocus} />
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {rows.map((row) => (
            <MissionRow key={`${row.priority}-${row.title}-${row.context?.network ?? ""}`} row={row} onSelect={onSelectFocus} />
          ))}
          {showSuccess && rows.length > 0 && (
            <p className="pt-1 text-center text-xs font-medium text-emerald-700">
              Nice work — daily missions looking healthy.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
