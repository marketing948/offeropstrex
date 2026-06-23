import { DollarSign, FlaskConical, Briefcase } from "lucide-react";
import type { MonthlyGoalsKpi } from "@/lib/performance-engine/api";

const THEMES = {
  revenue: {
    border: "border-green-200",
    bg: "bg-green-50/50",
    activeBorder: "border-green-400 ring-2 ring-green-200",
    icon: "text-green-600 bg-green-100",
    bar: "bg-green-500",
    xp: "text-green-700",
  },
  testing: {
    border: "border-purple-200",
    bg: "bg-purple-50/50",
    activeBorder: "border-purple-400 ring-2 ring-purple-200",
    icon: "text-purple-600 bg-purple-100",
    bar: "bg-purple-500",
    xp: "text-purple-700",
  },
  working: {
    border: "border-orange-200",
    bg: "bg-orange-50/50",
    activeBorder: "border-orange-400 ring-2 ring-orange-200",
    icon: "text-orange-600 bg-orange-100",
    bar: "bg-orange-500",
    xp: "text-orange-700",
  },
} as const;

function Icon({ theme }: { theme: MonthlyGoalsKpi["theme"] }) {
  const cls = `h-9 w-9 rounded-lg flex items-center justify-center ${THEMES[theme].icon}`;
  if (theme === "revenue") return <div className={cls}><DollarSign size={18} /></div>;
  if (theme === "testing") return <div className={cls}><FlaskConical size={18} /></div>;
  return <div className={cls}><Briefcase size={18} /></div>;
}

function formatValue(kpi: MonthlyGoalsKpi): string {
  if (kpi.theme === "revenue") {
    return `$${kpi.current.toLocaleString()} / $${kpi.target.toLocaleString()}`;
  }
  if (kpi.theme === "testing") {
    return `${kpi.current.toLocaleString()} / ${kpi.target.toLocaleString()} Tests`;
  }
  return `${kpi.current.toLocaleString()} / ${kpi.target.toLocaleString()} Campaigns`;
}

export function KpiCard({
  kpi,
  selected,
  onClick,
}: {
  kpi: MonthlyGoalsKpi;
  selected?: boolean;
  onClick?: () => void;
}) {
  const t = THEMES[kpi.theme];
  const pct = kpi.target > 0 ? Math.min(100, kpi.progressPct) : 0;
  const interactive = Boolean(onClick);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={`rounded-xl border p-4 shadow-sm text-left w-full transition-all ${
        interactive ? "cursor-pointer hover:shadow-md" : ""
      } ${selected ? t.activeBorder : t.border} ${t.bg}`}
    >
      <div className="flex items-start gap-3">
        <Icon theme={kpi.theme} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{kpi.label}</p>
          <p className="text-lg font-bold mt-0.5">{formatValue(kpi)}</p>
          <div className="mt-3 h-2 rounded-full bg-white/80 overflow-hidden">
            <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">{pct}% completed</p>
          {kpi.xpAvailable > 0 && (
            <p className={`text-xs font-medium mt-1 ${t.xp}`}>
              +{kpi.xpAvailable.toLocaleString()} XP available
            </p>
          )}
          {interactive && (
            <p className="text-[11px] text-muted-foreground mt-2">Click for breakdown</p>
          )}
        </div>
      </div>
    </button>
  );
}
