import {
  REPORT_INSIGHT_LABELS,
  reportInsightBadgeClass,
  reportInsightShortLabel,
  type ReportInsight,
} from "@/components/reports/reports-analytics";
import { cn } from "@/lib/utils";

export function ReportsInsightPill({ insight }: { insight: ReportInsight }) {
  const fullLabel = REPORT_INSIGHT_LABELS[insight];
  const shortLabel = reportInsightShortLabel(insight);

  return (
    <span
      title={fullLabel}
      className={cn(
        "inline-flex max-w-full rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-tight whitespace-nowrap",
        reportInsightBadgeClass(insight),
      )}
    >
      {shortLabel}
    </span>
  );
}
