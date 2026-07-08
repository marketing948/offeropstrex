/**
 * Operations Hub — Today's Focus (goal-based action cards).
 */

import { Skeleton } from "@/components/ui/skeleton";
import type { FocusItem, TodaysFocus } from "@/components/operations-hub/ops-hub-drilldown-data";
import { ProgressBarVisual } from "@/components/operations-hub/goal-progress-row";
import {
  Eye,
  Flame,
  FlaskConical,
  Radio,
  Sparkles,
  Target,
  DollarSign,
  Puzzle,
} from "lucide-react";

const TIER_CONFIG = {
  primary: {
    card: "border-red-400/50 bg-gradient-to-br from-red-950/50 to-purple-950/40 shadow-[0_0_24px_rgba(239,68,68,0.15)]",
    glow: "shadow-[inset_0_0_20px_rgba(239,68,68,0.12)]",
    accent: "text-red-300",
  },
  secondary: {
    card: "border-sky-400/50 bg-gradient-to-br from-sky-950/50 to-indigo-950/40 shadow-[0_0_24px_rgba(56,189,248,0.15)]",
    glow: "shadow-[inset_0_0_20px_rgba(56,189,248,0.12)]",
    accent: "text-sky-300",
  },
  tertiary: {
    card: "border-amber-400/45 bg-gradient-to-br from-amber-950/45 to-orange-950/35 shadow-[0_0_24px_rgba(251,191,36,0.12)]",
    glow: "shadow-[inset_0_0_20px_rgba(251,191,36,0.1)]",
    accent: "text-amber-300",
  },
} as const;

function kindIcon(kind: string | undefined) {
  if (kind === "revenue") return DollarSign;
  if (kind === "testing") return FlaskConical;
  if (kind === "working") return Radio;
  if (kind === "action") return Puzzle;
  return Target;
}

const FALLBACK_SLOTS: FocusItem[] = [
  {
    tier: "primary",
    emoji: "🔥",
    title: "Set goals",
    text: "Configure monthly revenue, testing, and working targets to unlock Focus Today.",
    reason: "Focus Today is driven by Goal Engine pacing.",
    context: {
      kind: "action",
      progressLabel: "No goal set",
      progressPct: 0,
      suggestedAction: "Open Monthly Goals and set targets for this month.",
      navigationPath: "/performance/monthly-goals",
    },
  },
];

function FocusCard({
  item,
  onSelect,
}: {
  item: FocusItem;
  onSelect: (item: FocusItem) => void;
}) {
  const cfg = TIER_CONFIG[item.tier];
  const LeftIcon = item.tier === "primary" ? Flame : item.tier === "secondary" ? Target : Eye;
  const KindIcon = kindIcon(item.context?.kind);
  const ctx = item.context;
  const hasMetrics = !!(ctx?.todayTarget || ctx?.currentValue || ctx?.expectedByNow);

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`flex min-h-[180px] w-full cursor-pointer flex-col rounded-2xl border-2 p-4 text-left backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 ${cfg.card} ${cfg.glow}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <LeftIcon className={`h-4 w-4 ${cfg.accent}`} strokeWidth={2.25} />
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-violet-100/90">
            {item.title}
          </p>
        </div>
        <KindIcon className={`h-4 w-4 opacity-60 ${cfg.accent}`} strokeWidth={2} />
      </div>
      <p className="mt-3 text-sm font-semibold leading-snug text-white">{item.text}</p>
      {item.reason && (
        <p className="mt-2 text-xs leading-relaxed text-violet-200/75">{item.reason}</p>
      )}

      {hasMetrics && (
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px]">
          {ctx?.todayTarget && (
            <>
              <span className="text-violet-200/70">Today target</span>
              <span className="text-right font-bold tabular-nums text-white">{ctx.todayTarget}</span>
            </>
          )}
          {ctx?.currentValue && (
            <>
              <span className="text-violet-200/70">Current</span>
              <span className="text-right font-bold tabular-nums text-white">{ctx.currentValue}</span>
            </>
          )}
          {ctx?.expectedByNow && (
            <>
              <span className="text-violet-200/70">Expected by now</span>
              <span className="text-right font-bold tabular-nums text-white">{ctx.expectedByNow}</span>
            </>
          )}
          {ctx?.paceGapLabel && (
            <>
              <span className="text-violet-200/70">Pace gap</span>
              <span className="text-right font-bold tabular-nums text-white">{ctx.paceGapLabel}</span>
            </>
          )}
        </div>
      )}

      {ctx?.progressPct != null && ctx.progressLabel !== "No goal set" && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-violet-200/80">
            <span>{ctx.progressLabel ?? "Month progress vs today’s expected pace"}</span>
            <span className="font-bold tabular-nums text-white">{ctx.progressPct}%</span>
          </div>
          <ProgressBarVisual pct={ctx.progressPct} size="sm" />
        </div>
      )}
      {ctx?.progressLabel === "No goal set" && (
        <p className="mt-3 text-[11px] font-semibold text-amber-200/90">No goal set</p>
      )}

      <p className="mt-auto pt-2 text-[10px] font-semibold uppercase tracking-wider text-violet-300/60">
        Tap for details
      </p>
    </button>
  );
}

function displayItems(focus: TodaysFocus): FocusItem[] {
  if (focus.empty || focus.items.length === 0) return FALLBACK_SLOTS;
  return focus.items.slice(0, 3);
}

export function TodaysFocusCard({
  focus,
  loading,
  onSelectFocus,
}: {
  focus: TodaysFocus;
  loading?: boolean;
  onSelectFocus: (item: FocusItem) => void;
}) {
  const items = displayItems(focus);

  return (
    <section
      className="relative overflow-hidden rounded-[20px] border-2 border-violet-500/50 bg-gradient-to-br from-[#0f0a1e] via-violet-950 to-[#0a0614] p-5 shadow-[0_8px_40px_rgba(139,92,246,0.25)] md:p-6"
      aria-labelledby="ops-todays-focus"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(167,139,250,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(139,92,246,0.1) 0%, transparent 40%)",
        }}
      />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-violet-300" strokeWidth={2.25} />
            <h2
              id="ops-todays-focus"
              className="text-base font-extrabold uppercase tracking-[0.14em] text-white"
            >
              Today&apos;s Focus
            </h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-violet-200/80">
            What to do today based on monthly goals, today&apos;s expected pace, and current progress.
          </p>
        </div>
        <span className="rounded-full border border-violet-400/50 bg-violet-500/20 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-violet-100 shadow-[0_0_12px_rgba(139,92,246,0.3)]">
          Goal-based
        </span>
      </div>

      {loading ? (
        <div className="relative mt-5 grid gap-3 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl bg-violet-900/40" />
          ))}
        </div>
      ) : (
        <div className="relative mt-5 grid gap-3 md:grid-cols-3">
          {items.map((item, i) => (
            <FocusCard key={`${item.tier}-${item.title}-${i}`} item={item} onSelect={onSelectFocus} />
          ))}
        </div>
      )}
    </section>
  );
}
