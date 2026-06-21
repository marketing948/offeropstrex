import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { LucideIcon } from "lucide-react";

const THEMES = {
  green: {
    icon: "bg-emerald-500 text-white shadow-emerald-200/80",
    card: "border-slate-200/80 bg-white shadow-md shadow-slate-200/50",
  },
  amber: {
    icon: "bg-amber-400 text-white shadow-amber-200/80",
    card: "border-slate-200/80 bg-white shadow-md shadow-slate-200/50",
  },
  red: {
    icon: "bg-red-500 text-white shadow-red-200/80",
    card: "border-slate-200/80 bg-white shadow-md shadow-slate-200/50",
  },
  purple: {
    icon: "bg-violet-500 text-white shadow-violet-200/80",
    card: "border-slate-200/80 bg-white shadow-md shadow-slate-200/50",
  },
} as const;

export function OpsKpiStripCard({
  label,
  value,
  sub,
  icon: Icon,
  theme,
  loading,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub: string;
  icon: LucideIcon;
  theme: keyof typeof THEMES;
  loading?: boolean;
  onClick?: () => void;
}) {
  const t = THEMES[theme];
  const className = `flex min-h-[88px] items-center gap-4 rounded-2xl border px-4 py-4 text-left transition-all ${t.card} ${
    onClick ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-lg" : ""
  }`;

  const inner = (
    <>
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-lg ${t.icon}`}
      >
        <Icon className="h-5 w-5" strokeWidth={2.25} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-12" />
        ) : (
          <p className="mt-0.5 text-3xl font-black tabular-nums tracking-tight text-slate-900">
            {value}
          </p>
        )}
        {!loading && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}
