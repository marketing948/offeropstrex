import {
  DEFAULT_ALERT_RULES,
  milestoneFractions,
  type AlertRulesConfig,
} from "@workspace/alert-rules";
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

/** UI heuristics only — thresholds from workspace alert rules. */
export function deriveCampaignSignals(
  c: ReviewCampaignInput,
  offerCount: number,
  daysLive: number,
  rules: AlertRulesConfig = DEFAULT_ALERT_RULES,
): CampaignSignal[] {
  const signals: CampaignSignal[] = [];
  const visits = c.clicks ?? 0;
  const conv = c.conversions ?? 0;
  const visitsPerOffer = rules.testing.visitsPerOffer;
  const target = Math.max(offerCount, 1) * visitsPerOffer;
  const pct = target > 0 ? visits / target : 0;
  const roi = c.roi ?? 0;
  const revenue = c.revenue ?? 0;
  const isTesting = c.campaignPurpose === "testing" && c.status === "live";
  const isScale = c.campaignPurpose !== "testing" && c.status === "live";
  const milestones = milestoneFractions(rules).sort((a, b) => b - a);
  const zeroAtMilestone = rules.testing.zeroConversionAtMilestoneEnabled;

  if (isTesting && zeroAtMilestone) {
    for (const m of milestones) {
      if (conv === 0 && pct >= m) {
        const pctLabel = Math.round(m * 100);
        if (m >= 1) {
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
        } else if (m >= 0.75) {
          signals.push(
            signal(
              "traffic_75_no_conv",
              `${pctLabel}% of visit target — no conversions`,
              "Approaching full test spend without conversions.",
              "high",
            ),
          );
        } else if (m >= 0.5) {
          signals.push(
            signal(
              "traffic_50_no_conv",
              `${pctLabel}% of visit target — no conversions`,
              `${Math.round(pct * 100)}% of expected traffic with zero conversions.`,
              pct >= 0.75 ? "high" : "medium",
            ),
          );
        }
        break;
      }
    }
  }

  if (isTesting) {
    const paceMax = rules.testing.pacingRiskMaxTrafficPercent / 100;
    if (
      daysLive >= rules.testing.pacingRiskMinDaysLive &&
      pct < paceMax &&
      conv === 0
    ) {
      signals.push(
        signal(
          "traffic_unlikely_pace",
          "Unlikely to hit target on pace",
          "Low traffic velocity relative to days live.",
          "medium",
        ),
      );
    }
    if (conv === 0 && visits > rules.testing.minVisitsForZeroConvAlert) {
      signals.push(
        signal(
          "zero_conversions",
          "Zero conversions",
          `${visits.toLocaleString()} visits recorded.`,
          "medium",
        ),
      );
    }
  }

  if (isScale) {
    const scaleNoConvDays = rules.scaling.noConversionsAfterHours / 24;
    if (conv === 0 && daysLive >= scaleNoConvDays) {
      signals.push(
        signal(
          "zero_conversions",
          "No conversions since live",
          `Live ${daysLive} day(s) without conversions.`,
          daysLive >= scaleNoConvDays ? "high" : "medium",
        ),
      );
    }
    if (roi < 0 && daysLive >= rules.scaling.negativeRoiDays) {
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

  if (roi > rules.scaling.minRoiPercentForPositiveSignal && revenue > 50) {
    signals.push(
      signal("positive_roi", "Positive ROI", `${roi.toFixed(1)}% ROI in recent metrics.`, "low"),
    );
  }
  if (revenue > rules.scaling.minRevenueForStrongSignal && conv > 0) {
    signals.push(
      signal(
        "strong_revenue",
        "Strong revenue",
        `${revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} revenue signal.`,
        "medium",
      ),
    );
  }
  if (
    conv >= rules.winners.minConversionsForPotentialWinner &&
    roi >= rules.winners.minRoiPercentForLikelyWinner &&
    isTesting
  ) {
    signals.push(
      signal("likely_winner", "Likely winner detected", "Conversion performance suggests winner review.", "high"),
    );
  }
  if (c.campaignPurpose === "working" && roi > 5 && conv > 0) {
    signals.push(
      signal("scaling_opportunity", "Scaling opportunity", "Working campaign performing — consider scale path.", "medium"),
    );
  }

  if (daysLive > rules.review.staleCampaignDays && c.status === "live" && conv === 0) {
    signals.push(
      signal("stale", "Stale live campaign", "Extended live period without meaningful conversion signal.", "medium"),
    );
  }

  if (visits > 0 && pct > 0.3) {
    const pace = visits / Math.max(daysLive, 1);
    const expectedDaily = target / Math.max(daysLive, 1);
    if (expectedDaily > 0) {
      const changePct = ((pace - expectedDaily) / expectedDaily) * 100;
      if (changePct >= rules.testing.trafficSpikePercentIncrease) {
        signals.push(signal("traffic_spike", "Traffic spike", "Visit velocity above typical pace.", "low"));
      } else if (changePct <= -rules.testing.trafficDecreasePercentDecrease) {
        signals.push(signal("traffic_decrease", "Traffic decrease", "Visit velocity below typical pace.", "low"));
      }
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
  rules: AlertRulesConfig = DEFAULT_ALERT_RULES,
): ReviewQueueCampaign | null {
  const daysLive = c.liveStartedAt
    ? Math.floor((Date.now() - new Date(c.liveStartedAt).getTime()) / 86_400_000)
    : 0;
  const signals = deriveCampaignSignals(c, offerCount, daysLive, rules);
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

/** Lightweight health for live campaign monitoring rows. */
export function evaluateCampaignMonitoringHealth(
  c: ReviewCampaignInput,
  offerCount: number,
  rules: AlertRulesConfig = DEFAULT_ALERT_RULES,
): { health: CampaignHealthStatus; healthLabel: string; targetPct: number } {
  const daysLive = c.liveStartedAt
    ? Math.floor((Date.now() - new Date(c.liveStartedAt).getTime()) / 86_400_000)
    : 0;
  const signals = deriveCampaignSignals(c, offerCount, daysLive, rules);
  const health = signals.length === 0 ? "healthy" : deriveHealthStatus(signals);
  const target = Math.max(offerCount, 1) * rules.testing.visitsPerOffer;
  const targetPct = target > 0 ? Math.min(100, Math.round(((c.clicks ?? 0) / target) * 100)) : 0;
  return { health, healthLabel: healthLabel(health), targetPct };
}
