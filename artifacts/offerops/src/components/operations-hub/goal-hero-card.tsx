import type { GoalCardModel } from "@/components/operations-hub/ops-hub-drilldown-data";
import { PaceDetailPanel } from "@/components/operations-hub/goal-progress-row";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, FlaskConical, Radio } from "lucide-react";

const ICONS = {
  revenue: DollarSign,
  testing: FlaskConical,
  working: Radio,
};

const CARD_THEME = {
  revenue: {
    surface:
      "from-emerald-50 via-white to-emerald-50/30 border-emerald-300/70 shadow-emerald-100/60",
    iconBg: "bg-emerald-500 text-white shadow-lg shadow-emerald-200/70",
    iconLabel: "text-emerald-800/70",
    bar: "from-emerald-500 to-green-400",
    barTrack: "bg-emerald-100/80",
    ring: "ring-emerald-400/70",
  },
  testing: {
    surface:
      "from-violet-50 via-white to-violet-50/30 border-violet-300/70 shadow-violet-100/60",
    iconBg: "bg-violet-500 text-white shadow-lg shadow-violet-200/70",
    iconLabel: "text-violet-800/70",
    bar: "from-violet-500 to-purple-400",
    barTrack: "bg-violet-100/80",
    ring: "ring-violet-400/70",
  },
  working: {
    surface:
      "from-orange-50 via-white to-orange-50/30 border-orange-300/70 shadow-orange-100/60",
    iconBg: "bg-orange-500 text-white shadow-lg shadow-orange-200/70",
    iconLabel: "text-orange-800/70",
    bar: "from-orange-500 to-amber-400",
    barTrack: "bg-orange-100/80",
    ring: "ring-orange-400/70",
  },
} as const;

function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtActual(n: number, format: "currency" | "count") {
  return format === "currency" ? fmt$(n) : String(n);
}

function fmtGap(n: number, format: "currency" | "count") {
  if (format === "currency") return `${fmt$(n)} to go`;
  return `${n} to go`;
}

export function GoalHeroCard({
  card,
  selected,
  onSelect,
  loading,
}: {
  card: GoalCardModel;
  selected: boolean;
  onSelect: () => void;
  loading?: boolean;
}) {
  const Icon = ICONS[card.icon];
  const theme = CARD_THEME[card.icon];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-expanded={selected}
      className={`relative flex min-h-[310px] w-full cursor-pointer flex-col rounded-[18px] border-2 bg-gradient-to-br p-6 text-left shadow-lg transition-all duration-200 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f6f9] ${theme.surface} ${
        selected
          ? `ring-2 ${theme.ring} ring-offset-2 ring-offset-[#f4f6f9]`
          : "hover:-translate-y-0.5"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-full ${theme.iconBg}`}
        >
          <Icon className="h-5 w-5" strokeWidth={2.25} />
        </div>
        <span
          className={`text-xs font-extrabold uppercase tracking-[0.14em] ${theme.iconLabel}`}
        >
          {card.label}
        </span>
      </div>

      {loading ? (
        <Skeleton className="mt-6 h-12 w-36 rounded-lg" />
      ) : (
        <>
          <p className="mt-6 text-4xl font-black tabular-nums tracking-tight text-slate-900">
            {fmtActual(card.actual, card.format)}
          </p>
          <p className="mt-1 text-sm font-medium text-slate-500">
            of {fmtActual(card.target, card.format)} monthly target
          </p>
          <PaceDetailPanel pace={card.pace} actual={card.actual} format={card.format} />
          <div className="mt-auto space-y-2.5 pt-4">
            <div className={`h-3.5 overflow-hidden rounded-full ${theme.barTrack}`}>
              <div
                className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${theme.bar}`}
                style={{ width: `${Math.min(100, card.pace.progressPct)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-sm font-semibold">
              <span className="tabular-nums text-slate-800">{card.pace.progressPct}%</span>
              <span className="tabular-nums text-slate-500">
                {fmtGap(card.gap, card.format)}
              </span>
            </div>
          </div>
        </>
      )}
    </button>
  );
}
