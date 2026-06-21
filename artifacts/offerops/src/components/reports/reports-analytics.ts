/**
 * Reports — insight derivation and metric presentation helpers.
 */

export type ReportInsight =
  | "winner_candidate"
  | "profitable"
  | "losing"
  | "no_data"
  | "needs_traffic"
  | "watch";

export const REPORT_INSIGHT_LABELS: Record<ReportInsight, string> = {
  winner_candidate: "Winner Candidate",
  profitable: "Profitable",
  losing: "Losing",
  no_data: "No Data",
  needs_traffic: "Needs Traffic",
  watch: "Watch",
};

export const REPORT_INSIGHT_SHORT_LABELS: Record<ReportInsight, string> = {
  winner_candidate: "Winner",
  profitable: "Profitable",
  losing: "Losing",
  no_data: "No Data",
  needs_traffic: "Needs Traffic",
  watch: "Watch",
};

export function reportInsightShortLabel(insight: ReportInsight): string {
  return REPORT_INSIGHT_SHORT_LABELS[insight] ?? REPORT_INSIGHT_LABELS[insight];
}

export function deriveReportInsight(row: {
  clicks: number;
  spend: number;
  revenue: number;
  profit: number;
  roi: number;
  conversions?: number;
  winners?: number;
}): ReportInsight {
  const hasMetrics = row.spend > 0 || row.revenue > 0 || row.clicks > 0;
  if (!hasMetrics) return "no_data";
  if (row.clicks === 0) return "needs_traffic";
  if (row.profit < 0 || row.roi < 0) return "losing";
  if (
    row.roi > 0 &&
    row.profit > 0 &&
    ((row.winners ?? 0) > 0 || (row.conversions ?? 0) > 0)
  ) {
    return "winner_candidate";
  }
  if (row.roi > 0 && row.profit > 0) return "profitable";
  return "watch";
}

export function reportInsightBadgeClass(insight: ReportInsight): string {
  switch (insight) {
    case "winner_candidate":
      return "border-violet-300 bg-violet-50 text-violet-800";
    case "profitable":
      return "border-emerald-300 bg-emerald-50 text-emerald-800";
    case "losing":
      return "border-red-300 bg-red-50 text-red-800";
    case "needs_traffic":
      return "border-orange-300 bg-orange-50 text-orange-800";
    case "watch":
      return "border-amber-300 bg-amber-50 text-amber-900";
    default:
      return "border-slate-300 bg-slate-100 text-slate-600";
  }
}

export function reportProfitColor(profit: number): string {
  if (profit > 0) return "text-emerald-600";
  if (profit < 0) return "text-red-500";
  return "text-slate-400";
}

export function reportRoiColor(roi: number): string {
  if (roi > 0) return "text-emerald-600";
  if (roi < 0) return "text-red-500";
  return "text-slate-400";
}

export function fmtReportMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function fmtReportPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

/** Compact ROI for tight table cells — avoids overflow on very large percentages. */
export function fmtReportPctCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10_000) return `${(n / 1000).toFixed(0)}k%`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k%`;
  if (abs >= 100) return `${n.toFixed(0)}%`;
  return `${n.toFixed(1)}%`;
}

export function fmtReportVisits(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
