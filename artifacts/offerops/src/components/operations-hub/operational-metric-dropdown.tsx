/**
 * Design V1 — reusable affiliate-network metric dropdown for operational goal cards.
 */

export type OperationalColorTheme = "revenue" | "testing" | "working";

export type OperationalMetricItem = {
  id: string;
  label: string;
  current: number;
  target: number | null;
  progress: number;
};

export type OperationalMetricDropdownProps = {
  title: string;
  colorTheme: OperationalColorTheme;
  items: OperationalMetricItem[];
  format: "currency" | "count";
  /** Suffix for count rows, e.g. "Offers" or "Campaigns". */
  unitLabel?: string;
  emptyMessage: string;
  open: boolean;
  onRowClick?: (item: OperationalMetricItem) => void;
};

const THEME = {
  revenue: {
    border: "border-emerald-200/80 dark:border-emerald-900/50",
    bg: "bg-gradient-to-b from-emerald-50/90 to-background dark:from-emerald-950/30",
    rowBg: "bg-emerald-50/60 dark:bg-emerald-950/20",
    rowHover: "hover:bg-emerald-100/80 dark:hover:bg-emerald-950/40",
    bar: "from-emerald-600 to-green-400",
    label: "text-emerald-950 dark:text-emerald-100",
    muted: "text-emerald-800/70 dark:text-emerald-300/80",
    pct: "text-emerald-700 dark:text-emerald-300",
  },
  testing: {
    border: "border-violet-200/80 dark:border-violet-900/50",
    bg: "bg-gradient-to-b from-violet-50/90 to-background dark:from-violet-950/30",
    rowBg: "bg-violet-50/60 dark:bg-violet-950/20",
    rowHover: "hover:bg-violet-100/80 dark:hover:bg-violet-950/40",
    bar: "from-violet-600 to-purple-400",
    label: "text-violet-950 dark:text-violet-100",
    muted: "text-violet-800/70 dark:text-violet-300/80",
    pct: "text-violet-700 dark:text-violet-300",
  },
  working: {
    border: "border-orange-200/80 dark:border-orange-900/50",
    bg: "bg-gradient-to-b from-orange-50/90 to-background dark:from-orange-950/30",
    rowBg: "bg-orange-50/60 dark:bg-orange-950/20",
    rowHover: "hover:bg-orange-100/80 dark:hover:bg-orange-950/40",
    bar: "from-orange-500 to-amber-400",
    label: "text-orange-950 dark:text-orange-100",
    muted: "text-orange-800/70 dark:text-orange-300/80",
    pct: "text-orange-700 dark:text-orange-300",
  },
} as const;

function fmtCurrency(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function formatValueLine(
  item: OperationalMetricItem,
  format: "currency" | "count",
  unitLabel?: string,
): string {
  const hasTarget = item.target != null && item.target > 0;
  if (format === "currency") {
    if (!hasTarget) return fmtCurrency(item.current);
    return `${fmtCurrency(item.current)} / ${fmtCurrency(item.target!)}`;
  }
  if (!hasTarget) {
    return `${item.current} active${unitLabel ? ` ${unitLabel}` : ""}`;
  }
  const unit = unitLabel ? ` ${unitLabel}` : "";
  return `${item.current} / ${item.target}${unit}`;
}

function MetricRow({
  item,
  theme,
  format,
  unitLabel,
  onRowClick,
}: {
  item: OperationalMetricItem;
  theme: (typeof THEME)[OperationalColorTheme];
  format: "currency" | "count";
  unitLabel?: string;
  onRowClick?: (item: OperationalMetricItem) => void;
}) {
  const pct = Math.min(100, Math.max(0, item.progress));
  const hasTarget = item.target != null && item.target > 0;

  return (
    <button
      type="button"
      onClick={() => onRowClick?.(item)}
      className={`w-full rounded-xl px-4 py-3.5 text-left transition-colors ${theme.rowBg} ${theme.rowHover} ${
        onRowClick ? "cursor-pointer" : "cursor-default"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={`text-base font-bold tracking-tight ${theme.label}`}>{item.label}</p>
        {hasTarget && (
          <span className={`shrink-0 text-sm font-bold tabular-nums ${theme.pct}`}>{pct}%</span>
        )}
      </div>
      <p className={`mt-1 text-sm font-medium tabular-nums ${theme.muted}`}>
        {formatValueLine(item, format, unitLabel)}
      </p>
      {hasTarget && (
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
          <div
            className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out ${theme.bar}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {!hasTarget && (
        <>
          <div
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted/70 dark:bg-white/5"
            aria-hidden
          />
          <p className="mt-2 text-xs text-muted-foreground">No network target configured</p>
        </>
      )}
    </button>
  );
}

export function OperationalMetricDropdown({
  title,
  colorTheme,
  items,
  format,
  unitLabel,
  emptyMessage,
  open,
  onRowClick,
}: OperationalMetricDropdownProps) {
  const theme = THEME[colorTheme];

  return (
    <div
      className="grid transition-[grid-template-rows] duration-300 ease-out"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={`mt-2 rounded-xl border shadow-sm ${theme.border} ${theme.bg} ${
            open ? "opacity-100" : "opacity-0"
          } transition-opacity duration-300`}
          role="region"
          aria-label={title}
        >
          <div className="border-b border-inherit px-4 py-2.5">
            <p className={`text-xs font-bold uppercase tracking-widest ${theme.muted}`}>{title}</p>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            <div className="max-h-[min(20rem,50vh)] space-y-2 overflow-y-auto p-3">
              {items.map((item) => (
                <MetricRow
                  key={item.id}
                  item={item}
                  theme={theme}
                  format={format}
                  unitLabel={unitLabel}
                  onRowClick={onRowClick}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Map goal card network rows → dropdown items. */
export function networkRowsToMetricItems(
  rows: {
    network: string;
    actual: number;
    target: number | null;
    progressPct: number | null;
  }[],
): OperationalMetricItem[] {
  return rows.map((row) => ({
    id: row.network,
    label: row.network,
    current: row.actual,
    target: row.target,
    progress: row.progressPct ?? 0,
  }));
}

export function goalKindToTheme(kind: "revenue" | "testing" | "working"): OperationalColorTheme {
  return kind;
}

export function goalKindToUnitLabel(kind: "revenue" | "testing" | "working"): string | undefined {
  if (kind === "testing") return "Campaigns";
  if (kind === "working") return "Campaigns";
  return undefined;
}

export function goalKindToDropdownTitle(kind: "revenue" | "testing" | "working"): string {
  if (kind === "revenue") return "Revenue by affiliate network";
  if (kind === "testing") return "Testing by affiliate network";
  return "Working campaigns by affiliate network";
}

export function goalKindToSectionTitle(kind: "revenue" | "testing" | "working"): string {
  if (kind === "revenue") return "Revenue By Network";
  if (kind === "testing") return "Testing Pipeline By Network";
  return "Working Campaigns By Network";
}

export function goalKindToViewButtonLabel(kind: "revenue" | "testing" | "working"): string {
  if (kind === "revenue") return "Revenue View";
  if (kind === "testing") return "Pipeline View";
  return "Campaigns View";
}

export function goalKindToEmptyMessage(kind: "revenue" | "testing" | "working"): string {
  if (kind === "revenue") return "No revenue activity yet";
  if (kind === "testing") return "No testing activity yet";
  return "No working campaigns yet";
}

export function buildOperationsMetricUrl(
  metric: "revenue" | "testing" | "working",
  network: string,
): string {
  const params = new URLSearchParams({
    metric,
    network,
  });
  return `/operations?${params.toString()}`;
}

export function parseOperationsMetricParam(
  search: string,
): "revenue" | "testing" | "working" | null {
  const metric = new URLSearchParams(search).get("metric");
  if (metric === "revenue" || metric === "testing" || metric === "working") return metric;
  return null;
}
