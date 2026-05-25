import { Skeleton } from "@/components/ui/skeleton";
import type { LucideIcon } from "lucide-react";

export function CompactKpi({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
  loading,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: LucideIcon;
  tone?: "neutral" | "positive" | "warning" | "critical";
  loading?: boolean;
  onClick?: () => void;
}) {
  const toneClass =
    tone === "critical"
      ? "border-red-200/80 bg-red-50/80 dark:bg-red-950/25"
      : tone === "warning"
        ? "border-amber-200/80 bg-amber-50/80 dark:bg-amber-950/25"
        : tone === "positive"
          ? "border-emerald-200/80 bg-emerald-50/80 dark:bg-emerald-950/25"
          : "border-border bg-card";

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-14" />
      ) : (
        <p className="mt-1.5 text-xl font-bold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
      )}
      {sub && !loading && (
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</p>
      )}
    </>
  );

  const className = `min-h-[4.5rem] rounded-lg border px-3 py-2.5 text-left transition-colors ${toneClass} ${
    onClick ? "cursor-pointer hover:border-primary/40 hover:shadow-sm" : ""
  }`;

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}
