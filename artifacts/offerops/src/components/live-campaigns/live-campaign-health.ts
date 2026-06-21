import type { AlertRulesConfig } from "@workspace/alert-rules";
import {
  evaluateCampaignMonitoringHealth,
  type ReviewCampaignInput,
} from "@/lib/campaign-review/heuristics";

export type RangeMetricSnapshot = {
  visits: number;
  conversions: number;
  cost: number;
  revenue: number;
  profit: number;
  roi: number | null;
} | null;

export type SummaryHealthStatus =
  | "healthy"
  | "needs_traffic"
  | "no_data"
  | "losing"
  | "winner_candidate"
  | "watch";

export type SummaryHealth = {
  status: SummaryHealthStatus;
  label: string;
  reason: string;
};

const HEALTH_LABELS: Record<SummaryHealthStatus, string> = {
  healthy: "Healthy",
  needs_traffic: "Needs Traffic",
  no_data: "No Data",
  losing: "Losing",
  winner_candidate: "Winner Candidate",
  watch: "Watch",
};

export function summaryHealthLabel(status: SummaryHealthStatus): string {
  return HEALTH_LABELS[status];
}

export function summaryHealthBadgeClass(status: SummaryHealthStatus): string {
  const base = "font-semibold ring-1 ring-inset";
  switch (status) {
    case "healthy":
      return `${base} border-emerald-300 bg-emerald-50 text-emerald-800 ring-emerald-200/80`;
    case "winner_candidate":
      return `${base} border-violet-300 bg-violet-50 text-violet-800 ring-violet-200/80`;
    case "losing":
      return `${base} border-red-300 bg-red-50 text-red-800 ring-red-200/80`;
    case "needs_traffic":
      return `${base} border-orange-300 bg-orange-50 text-orange-800 ring-orange-200/80`;
    case "watch":
      return `${base} border-amber-300 bg-amber-50 text-amber-900 ring-amber-200/80`;
    default:
      return `${base} border-slate-300 bg-slate-100 text-slate-700 ring-slate-200/80`;
  }
}

export function roiPercent(roi: number | null | string | undefined): number | null {
  if (roi == null || roi === "") return null;
  const n = typeof roi === "number" ? roi : Number(roi);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 1 ? n * 100 : n;
}

export function deriveSummaryHealth(
  range: RangeMetricSnapshot,
  campaign: ReviewCampaignInput,
  offerCount: number,
  rules: AlertRulesConfig,
): SummaryHealth {
  const monitoring = evaluateCampaignMonitoringHealth(campaign, offerCount, rules);
  const lifetimeVisits = campaign.clicks ?? 0;

  if (!range || (range.cost === 0 && range.revenue === 0 && range.visits === 0)) {
    return {
      status: "no_data",
      label: HEALTH_LABELS.no_data,
      reason: "No imported metrics for this range",
    };
  }

  if (lifetimeVisits === 0 && range.visits === 0) {
    return {
      status: "needs_traffic",
      label: HEALTH_LABELS.needs_traffic,
      reason: "No traffic recorded for this campaign",
    };
  }

  const roi = roiPercent(range.roi);
  if (range.profit < 0 || (roi != null && roi < 0)) {
    return {
      status: "losing",
      label: HEALTH_LABELS.losing,
      reason: "Negative profit in selected range",
    };
  }

  if (roi != null && roi > 0 && range.conversions > 0) {
    if (monitoring.health === "winner_candidate" || roi >= 15) {
      return {
        status: "winner_candidate",
        label: HEALTH_LABELS.winner_candidate,
        reason: "Positive ROI with conversions",
      };
    }
    return {
      status: "healthy",
      label: HEALTH_LABELS.healthy,
      reason: "Positive ROI with conversions",
    };
  }

  if (monitoring.targetPct < 50 && offerCount > 0) {
    return {
      status: "watch",
      label: HEALTH_LABELS.watch,
      reason: "Traffic is below target pace",
    };
  }

  return {
    status: "watch",
    label: HEALTH_LABELS.watch,
    reason: "Monitor performance in this range",
  };
}

export type TrafficPacing = "good" | "low" | "no_traffic" | "no_target";

export function deriveTrafficPacing(
  visits: number,
  targetPct: number,
  offerCount: number,
): { pacing: TrafficPacing; label: string } {
  if (offerCount <= 0) return { pacing: "no_target", label: "No Target" };
  if (visits === 0) return { pacing: "no_traffic", label: "No Traffic" };
  if (targetPct >= 75) return { pacing: "good", label: "Good" };
  return { pacing: "low", label: "Low" };
}

export function pacingBadgeClass(pacing: TrafficPacing): string {
  switch (pacing) {
    case "good":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "low":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "no_traffic":
      return "border-orange-200 bg-orange-50 text-orange-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-500";
  }
}

export function metricTone(
  value: number | null,
  kind: "money" | "roi" = "money",
): "positive" | "negative" | "neutral" {
  if (value == null || !Number.isFinite(value)) return "neutral";
  if (kind === "roi") {
    if (value > 0) return "positive";
    if (value < 0) return "negative";
    return "neutral";
  }
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

export function metricToneClass(tone: "positive" | "negative" | "neutral"): string {
  if (tone === "positive") return "text-emerald-700";
  if (tone === "negative") return "text-red-600";
  return "text-slate-400";
}
