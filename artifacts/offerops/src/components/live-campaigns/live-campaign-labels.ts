import type { DateRangePreset } from "@/lib/date-filter-presets";
import { DATE_RANGE_PRESET_LABELS } from "@/lib/date-filter-presets";

export type CampaignPurposeValue = "testing" | "working" | "scaling" | string;

export const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  testing: "Test",
  working: "Working",
  scaling: "Scaling",
};

export function campaignTypeLabel(purpose: CampaignPurposeValue): string {
  return CAMPAIGN_TYPE_LABELS[purpose] ?? purpose;
}

export function campaignTypeBadgeClass(purpose: CampaignPurposeValue): string {
  if (purpose === "testing") return "border-violet-200 bg-violet-100 text-violet-800";
  if (purpose === "working") return "border-emerald-200 bg-emerald-100 text-emerald-800";
  if (purpose === "scaling") return "border-sky-200 bg-sky-100 text-sky-800";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

export function platformBadgeClass(platform: string): string {
  if (platform === "ios") return "border-slate-200 bg-slate-50 text-slate-700";
  if (platform === "android") return "border-green-200 bg-green-50 text-green-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function formatPerformanceRangeLabel(
  preset: DateRangePreset,
  dateFrom: string,
  dateTo: string,
): string {
  if (preset !== "custom") return DATE_RANGE_PRESET_LABELS[preset];
  if (dateFrom === dateTo) return dateFrom;
  return `${dateFrom} → ${dateTo}`;
}

/** Human-readable date span for the range picker trigger, e.g. Jun 15, 2026 → Jun 21, 2026 */
export function formatPerformanceRangeDates(dateFrom: string, dateTo: string): string {
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  if (dateFrom === dateTo) return fmt(dateFrom);
  return `${fmt(dateFrom)} → ${fmt(dateTo)}`;
}

export function performanceRangeTriggerLabel(
  preset: DateRangePreset,
  dateFrom: string,
  dateTo: string,
): string {
  const name = formatPerformanceRangeLabel(preset, dateFrom, dateTo);
  const dates = formatPerformanceRangeDates(dateFrom, dateTo);
  return `${name} · ${dates}`;
}
