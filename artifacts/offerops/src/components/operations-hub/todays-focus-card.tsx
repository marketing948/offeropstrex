/**
 * Operations Hub V3.1 — Today's Focus (deterministic recommendations).
 */

import { Skeleton } from "@/components/ui/skeleton";
import type { FocusItem, TodaysFocus } from "@/components/operations-hub/ops-hub-drilldown-data";
import {
  Eye,
  Flame,
  Rocket,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";

const TIER_CONFIG = {
  primary: {
    card: "border-red-400/50 bg-gradient-to-br from-red-950/50 to-purple-950/40 shadow-[0_0_24px_rgba(239,68,68,0.15)]",
    glow: "shadow-[inset_0_0_20px_rgba(239,68,68,0.12)]",
    icon: Flame,
    accent: "text-red-300",
    rightIcon: Target,
  },
  secondary: {
    card: "border-sky-400/50 bg-gradient-to-br from-sky-950/50 to-indigo-950/40 shadow-[0_0_24px_rgba(56,189,248,0.15)]",
    glow: "shadow-[inset_0_0_20px_rgba(56,189,248,0.12)]",
    icon: Zap,
    accent: "text-sky-300",
    rightIcon: Rocket,
  },
  tertiary: {
    card: "border-amber-400/45 bg-gradient-to-br from-amber-950/45 to-orange-950/35 shadow-[0_0_24px_rgba(251,191,36,0.12)]",
    glow: "shadow-[inset_0_0_20px_rgba(251,191,36,0.1)]",
    icon: Eye,
    accent: "text-amber-300",
    rightIcon: Eye,
  },
} as const;

const FALLBACK_SLOTS: FocusItem[] = [
  {
    tier: "primary",
    emoji: "🔥",
    title: "Highest Impact",
    text: "Review revenue pace and prioritize the largest network gap.",
    reason: "Based on current MTD pace vs monthly target.",
    context: {
      suggestedAction: "Select a hero goal card above to inspect network gaps.",
    },
  },
  {
    tier: "secondary",
    emoji: "⚡",
    title: "Quick Win",
    text: "Advance one testing batch or working campaign today.",
    reason: "Small operational moves compound toward monthly goals.",
    context: {
      suggestedAction: "Pick a network with low activity and start a test batch.",
      navigationPath: "/testing-batches",
    },
  },
  {
    tier: "tertiary",
    emoji: "👀",
    title: "Watch",
    text: "Monitor live campaign performance for early winner signals.",
    reason: "Stay ahead of pacing shifts before month-end.",
    context: {
      suggestedAction: "Check live campaigns for underperforming sources.",
      navigationPath: "/live-campaigns",
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
  const LeftIcon = cfg.icon;
  const RightIcon = cfg.rightIcon;

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`flex min-h-[140px] w-full cursor-pointer flex-col rounded-2xl border-2 p-4 text-left backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 ${cfg.card} ${cfg.glow}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <LeftIcon className={`h-4 w-4 ${cfg.accent}`} strokeWidth={2.25} />
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-violet-100/90">
            {item.title}
          </p>
        </div>
        <RightIcon className={`h-4 w-4 opacity-60 ${cfg.accent}`} strokeWidth={2} />
      </div>
      <p className="mt-3 flex-1 text-sm font-semibold leading-snug text-white">{item.text}</p>
      {item.reason && (
        <p className="mt-2 text-xs leading-relaxed text-violet-200/75">
          <span className="font-semibold text-violet-100/90">Reason: </span>
          {item.reason}
        </p>
      )}
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-violet-300/60">
        Tap for details
      </p>
    </button>
  );
}

function displayItems(focus: TodaysFocus): FocusItem[] {
  if (focus.empty || focus.items.length === 0) return FALLBACK_SLOTS;
  const items = [...focus.items];
  while (items.length < 3) {
    const missing = FALLBACK_SLOTS.find((f) => !items.some((i) => i.title === f.title));
    if (missing) items.push(missing);
    else break;
  }
  return items.slice(0, 3);
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
            "radial-gradient(circle at 20% 30%, rgba(167,139,250,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(139,92,246,0.1) 0%, transparent 40%), radial-gradient(1px 1px at 10% 20%, rgba(255,255,255,0.3) 0%, transparent 100%), radial-gradient(1px 1px at 60% 80%, rgba(255,255,255,0.2) 0%, transparent 100%)",
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
            Recommendations from your goals, pace, batches, and open tasks.
          </p>
        </div>
        <span className="rounded-full border border-violet-400/50 bg-violet-500/20 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-violet-100 shadow-[0_0_12px_rgba(139,92,246,0.3)]">
          Goal-based
        </span>
      </div>

      {loading ? (
        <div className="relative mt-5 grid gap-3 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl bg-violet-900/40" />
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
