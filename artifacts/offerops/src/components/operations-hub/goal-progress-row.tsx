import {
  PACE_BADGE_CLASS,
  formatPaceVariance,
  progressBarGradient,
  type PaceEvaluation,
  type PaceStatus,
} from "@/components/operations-hub/ops-v2-metrics";

function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtVal(n: number, format: "currency" | "count") {
  return format === "currency" ? fmt$(n) : String(n);
}

export function ProgressBarVisual({
  pct,
  size = "md",
}: {
  pct: number;
  size?: "sm" | "md" | "lg";
}) {
  const h = size === "lg" ? "h-4" : size === "sm" ? "h-2" : "h-3";
  return (
    <div className={`${h} overflow-hidden rounded-full bg-muted/80`}>
      <div
        className={`${h} rounded-full bg-gradient-to-r transition-all duration-500 ${progressBarGradient(pct)}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export function PaceBadge({ status }: { status: PaceStatus }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider shadow-sm ${PACE_BADGE_CLASS[status]}`}
    >
      {status}
    </span>
  );
}

export function PaceDetailPanel({
  pace,
  actual,
  monthlyTarget,
  format,
}: {
  pace: PaceEvaluation;
  actual: number;
  monthlyTarget: number;
  format: "currency" | "count";
}) {
  const variance = formatPaceVariance(pace);
  return (
    <div className="mt-4 rounded-xl border border-slate-200/80 bg-white/90 px-4 py-3 text-xs shadow-inner">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <span className="font-medium text-slate-500">Goal</span>
        <span className="text-right text-sm font-bold tabular-nums text-slate-800">
          {fmtVal(monthlyTarget, format)}
        </span>
        <span className="font-medium text-slate-500">Expected today</span>
        <span className="text-right text-sm font-bold tabular-nums text-slate-800">
          {fmtVal(pace.expectedByToday, format)}
        </span>
        <span className="font-medium text-slate-500">Current</span>
        <span className="text-right text-sm font-bold tabular-nums text-slate-800">
          {fmtVal(actual, format)}
        </span>
      </div>
      <div className="mt-3 border-t border-slate-100 pt-2 text-center">
        <span
          className={`text-sm font-bold ${
            variance.tone === "negative" ? "text-red-600" : "text-emerald-600"
          }`}
        >
          {variance.emoji} {variance.label}
        </span>
      </div>
    </div>
  );
}

export function GoalProgressRow({
  label,
  actual,
  target,
  progressPct,
  format,
  indent = 0,
  expandable = false,
  expanded = false,
  onToggle,
  showFraction = true,
}: {
  label: string;
  actual: number;
  target: number | null;
  progressPct: number | null;
  format: "currency" | "count";
  indent?: number;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  showFraction?: boolean;
}) {
  const pct = progressPct ?? 0;
  const hasTarget = target != null && target > 0;

  const inner = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {expandable && (
          <span className="text-muted-foreground">{expanded ? "▼" : "▶"}</span>
        )}
        <span className="truncate font-medium">{label}</span>
      </div>
      {hasTarget && showFraction && (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {fmtVal(actual, format)} / {fmtVal(target, format)}
        </span>
      )}
      {!hasTarget && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {format === "currency"
            ? `${fmtVal(actual, format)} MTD · No target configured`
            : `${fmtVal(actual, format)} active · No target configured`}
        </span>
      )}
      {hasTarget && progressPct != null && (
        <span className="w-10 shrink-0 text-right text-xs font-bold tabular-nums">{pct}%</span>
      )}
    </>
  );

  return (
    <div style={{ paddingLeft: indent * 16 }} className="space-y-1.5">
      {expandable && onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/40"
        >
          {inner}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-2 py-1.5 text-sm">{inner}</div>
      )}
      {hasTarget && progressPct != null && <ProgressBarVisual pct={pct} size="sm" />}
    </div>
  );
}
