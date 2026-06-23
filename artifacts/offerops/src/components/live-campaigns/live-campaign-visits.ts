/**
 * Live Campaigns — visits cell formatting (range vs lifetime pacing).
 */

import type { AlertRulesConfig } from "@workspace/alert-rules";
import type { RangeMetricSnapshot } from "@/components/live-campaigns/live-campaign-health";

export type VisitsDisplay = {
  primary: string;
  secondary: string;
  hasRangeData: boolean;
};

export function formatVisitsDisplay(
  range: RangeMetricSnapshot,
  lifetimeVisits: number,
  offerCount: number,
  targetPct: number,
  rules: AlertRulesConfig,
): VisitsDisplay {
  const hasRangeData =
    range != null && (range.cost > 0 || range.revenue > 0 || range.visits > 0);

  if (!hasRangeData || range == null) {
    return {
      primary: "—",
      secondary: "No data for range",
      hasRangeData: false,
    };
  }

  if (range.visits === 0) {
    const target = offerCount > 0 ? Math.max(offerCount, 1) * rules.testing.visitsPerOffer : null;
    return {
      primary: "0",
      secondary: target
        ? `Target ${target.toLocaleString()} · ${targetPct}% lifetime pace`
        : "No visits",
      hasRangeData: true,
    };
  }

  const target = offerCount > 0 ? Math.max(offerCount, 1) * rules.testing.visitsPerOffer : null;
  if (target != null) {
    return {
      primary: range.visits.toLocaleString(),
      secondary: `Target ${target.toLocaleString()} · ${targetPct}% lifetime pace`,
      hasRangeData: true,
    };
  }

  if (lifetimeVisits > 0 && lifetimeVisits !== range.visits) {
    return {
      primary: range.visits.toLocaleString(),
      secondary: `Lifetime: ${lifetimeVisits.toLocaleString()}`,
      hasRangeData: true,
    };
  }

  return {
    primary: range.visits.toLocaleString(),
    secondary: "No target",
    hasRangeData: true,
  };
}
