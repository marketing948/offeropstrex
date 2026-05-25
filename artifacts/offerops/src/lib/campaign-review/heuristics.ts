import { VISITS_PER_OFFER_TARGET } from "@/lib/executive-dashboard";
import type {
  CampaignHealthStatus,
  CampaignSignal,
  CampaignSignalKind,
  ReviewQueueCampaign,
  SuggestedReviewAction,
} from "@/lib/campaign-review/types";

export type ReviewCampaignInput = {
  id: number;
  campaignName: string;
  batchId: number | null;
  batchName: string | null;
  employeeId: number | null;
  employeeName: string | null;
  platform: string;
  campaignPurpose: string;
  status: string;
  liveStartedAt: string | null;
  clicks: number;
  conversions: number;
  revenue: number;
  cost: number;
  roi: number;
};

const HEALTH_LABELS: Record<CampaignHealthStatus, string> = {
  healthy: "Healthy",
  needs_review: "Needs review",
  winner_candidate: "Winner candidate",
  scaling_opportunity: "Scaling opportunity",
  traffic_risk: "Traffic risk",
  burning: "Burning",
  stale: "Stale",
  attention_required: "Attention required",
};

export function healthLabel(status: CampaignHealthStatus): string {
  return HEALTH_LABELS[status];
}

function signal(
  kind: CampaignSignalKind,
  label: string,
  detail: string,
  severity: CampaignSignal["severity"],
): CampaignSignal {
  return { id: `${kind}`, kind, label, detail, severity };
}

/** UI heuristics only — not server automation rules. */
export function deriveCampaignSignals(
  c: ReviewCampaignInput,
  offerCount: number,
  daysLive: number,
): CampaignSignal[] {
  const signals: CampaignSignal[] = [];
  const visits = c.clicks ?? 0;
  const conv = c.conversions ?? 0;
  const target = Math.max(offerCount, 1) * VISITS_PER_OFFER_TARGET;
  const pct = target > 0 ? visits / target : 0;
  const roi = c.roi ?? 0;
  const revenue = c.revenue ?? 0;
  const isTesting = c.campaignPurpose === "testing" && c.status === "live";
  const isScale = c.campaignPurpose !== "testing" && c.status === "live";

  if (isTesting) {
    if (conv === 0 && pct >= 0.5) {
      signals.push(
        signal(
          "traffic_50_no_conv",
          "50% of visit target — no conversions",
          `${Math.round(pct * 100)}% of expected traffic with zero conversions.`,
          pct >= 0.75 ? "high" : "medium",
        ),
      );
    }
    if (conv === 0 && pct >= 0.75) {
      signals.push(
        signal(
          "traffic_75_no_conv",
          "75% of visit target — no conversions",
          "Approaching full test spend without conversions.",
          "high",
        ),
      );
    }
    if (conv === 0 && pct >= 1) {
      signals.push(
        signal(
          "traffic_100_no_conv",
          "Visit target reached — no conversions",
          "Testing traffic exhausted with no conversions recorded.",
          "high",
        ),
      );
      signals.push(
        signal(
          "burning",
          "Burning testing campaign",
          "High traffic with no conversion outcome — consider stopping test.",
          "high",
        ),
      );
    }
    if (daysLive >= 3 && pct < 0.25 && conv === 0) {
      signals.push(
        signal(
          "traffic_unlikely_pace",
          "Unlikely to hit target on pace",
          "Low traffic velocity relative to days live.",
          "medium",
        ),
      );
    }
    if (conv === 0 && visits > 500) {
      signals.push(signal("zero_conversions", "Zero conversions", `${visits.toLocaleString()} visits recorded.`, "medium"));
    }
  }

  if (isScale) {
    if (conv === 0 && daysLive >= 2) {
      signals.push(
        signal(
          "zero_conversions",
          "No conversions since live",
          `Live ${daysLive} day(s) without conversions.`,
          daysLive >= 2 ? "high" : "medium",
        ),
      );
    }
    if (roi < 0 && daysLive >= 7) {
      signals.push(
        signal(
          "burning",
          "Sustained negative ROI",
          "Scale campaign negative ROI over extended live period.",
          "medium",
        ),
      );
    }
  }

  if (roi > 15 && revenue > 50) {
    signals.push(signal("positive_roi", "Positive ROI", `${roi.toFixed(1)}% ROI in recent metrics.`, "low"));
  }
  if (revenue > 200 && conv > 0) {
    signals.push(signal("strong_revenue", "Strong revenue", `${revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} revenue signal.`, "medium"));
  }
  if (conv > 0 && roi > 10 && isTesting) {
    signals.push(signal("likely_winner", "Likely winner detected", "Conversion performance suggests winner review.", "high"));
  }
  if (c.campaignPurpose === "working" && roi > 5 && conv > 0) {
    signals.push(signal("scaling_opportunity", "Scaling opportunity", "Working campaign performing — consider scale path.", "medium"));
  }

  if (daysLive > 14 && c.status === "live" && conv === 0) {
    signals.push(signal("stale", "Stale live campaign", "Extended live period without meaningful conversion signal.", "medium"));
  }

  if (visits > 0 && pct > 0.3) {
    const pace = visits / Math.max(daysLive, 1);
    if (pace > target * 0.15) {
      signals.push(signal("traffic_spike", "Traffic spike", "Visit velocity above typical pace.", "low"));
    }
  }

  return dedupeSignals(signals);
}

function dedupeSignals(signals: CampaignSignal[]): CampaignSignal[] {
  const seen = new Set<string>();
  return signals.filter((s) => {
    if (seen.has(s.kind)) return false;
    seen.add(s.kind);
    return true;
  });
}

export function deriveHealthStatus(signals: CampaignSignal[]): CampaignHealthStatus {
  if (signals.some((s) => s.kind === "burning" || s.kind === "traffic_100_no_conv")) return "burning";
  if (signals.some((s) => s.kind === "likely_winner")) return "winner_candidate";
  if (signals.some((s) => s.kind === "scaling_opportunity")) return "scaling_opportunity";
  if (signals.some((s) => s.kind === "traffic_75_no_conv" || s.kind === "traffic_unlikely_pace")) return "traffic_risk";
  if (signals.some((s) => s.kind === "stale")) return "stale";
  if (signals.length > 0) return "needs_review";
  return "healthy";
}

export function buildSuggestedActions(
  c: ReviewCampaignInput,
  signals: CampaignSignal[],
): SuggestedReviewAction[] {
  const actions: SuggestedReviewAction[] = [
    {
      id: "continue",
      label: "Continue monitoring",
      description: "Acknowledge signals and keep watching this campaign.",
      memoryType: "reviewed",
    },
  ];

  if (signals.some((s) => s.kind === "likely_winner")) {
    actions.push({
      id: "mark_winners",
      label: "Mark winners",
      description: "Stop testing and classify winners on the linked batch.",
      memoryType: "winner_candidate",
      href: c.batchId != null ? `/testing-batches/${c.batchId}` : "/testing-batches",
    });
  }

  if (signals.some((s) => s.kind === "burning" || s.kind === "traffic_100_no_conv")) {
    actions.push({
      id: "stop_test",
      label: "Stop testing campaign",
      description: "Review live campaign controls and pause or close if appropriate.",
      memoryType: "action_taken",
      href: "/live-campaigns",
    });
  }

  if (signals.some((s) => s.kind === "scaling_opportunity" || s.kind === "positive_roi")) {
    actions.push({
      id: "scale",
      label: "Plan scaling follow-up",
      description: "Record intent to create scaling workflow — execute via batch tasks when ready.",
      memoryType: "scaling_task_suggested",
      href: c.batchId != null ? `/testing-batches/${c.batchId}` : undefined,
    });
  }

  if (signals.some((s) => s.kind === "traffic_spike" || s.kind === "traffic_decrease")) {
    actions.push({
      id: "investigate",
      label: "Investigate traffic",
      description: "Open live campaigns to compare traffic source behavior.",
      memoryType: "action_taken",
      href: "/live-campaigns",
    });
  }

  actions.push({
    id: "dismiss",
    label: "Dismiss for now",
    description: "Remove from active review queue until new signals appear.",
    memoryType: "dismissed_signal",
  });

  return actions;
}

export function computeUrgencyScore(
  signals: CampaignSignal[],
  escalated: boolean,
): number {
  let score = 0;
  for (const s of signals) {
    if (s.severity === "high") score += 3;
    else if (s.severity === "medium") score += 2;
    else score += 1;
  }
  if (escalated) score += 5;
  return score;
}

export function buildReviewQueueItem(
  c: ReviewCampaignInput,
  offerCount: number,
  firstSeenAt: string | null,
  escalated: boolean,
): ReviewQueueCampaign | null {
  const daysLive = c.liveStartedAt
    ? Math.floor((Date.now() - new Date(c.liveStartedAt).getTime()) / 86_400_000)
    : 0;
  const signals = deriveCampaignSignals(c, offerCount, daysLive);
  if (signals.length === 0 && c.status !== "live") return null;

  const health = signals.length === 0 ? "healthy" : deriveHealthStatus(signals);
  if (health === "healthy") return null;

  const profit = (c.revenue ?? 0) - (c.cost ?? 0);

  return {
    campaignId: c.id,
    campaignName: c.campaignName,
    batchId: c.batchId,
    batchName: c.batchName,
    employeeId: c.employeeId,
    employeeName: c.employeeName,
    platform: c.platform,
    purpose: c.campaignPurpose,
    status: c.status,
    health,
    healthLabel: healthLabel(health),
    signals,
    suggestedActions: buildSuggestedActions(c, signals),
    visits: c.clicks ?? 0,
    conversions: c.conversions ?? 0,
    revenue: c.revenue ?? 0,
    cost: c.cost ?? 0,
    roi: c.roi ?? 0,
    profit,
    firstSeenAt,
    escalated,
    urgencyScore: computeUrgencyScore(signals, escalated),
  };
}
