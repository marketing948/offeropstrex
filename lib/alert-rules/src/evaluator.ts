/**
 * Unified campaign alert evaluator — the SINGLE source of truth for campaign
 * alert decisions (scale / optimize / shutdown / winner / traffic).
 *
 * Every threshold comes from `AlertRulesConfig` (alert_rules_config). There are
 * NO hardcoded business thresholds in this file. It is pure and dependency-free
 * so it can be consumed by the Daily Mission Board, Live Campaign health, and
 * campaign health badges without duplicating logic.
 */

import { DEFAULT_ALERT_RULES, type AlertRulesConfig } from "./index.ts";

/** Campaign identity/lifecycle facts (not metrics). */
export type EvaluatorCampaign = {
  purpose?: string | null;
  status?: string | null;
  liveStartedAt?: string | null;
  createdAt?: string | null;
};

/** Range/lifetime metrics for a campaign. */
export type EvaluatorMetrics = {
  revenue?: number | null;
  cost?: number | null;
  /** Optional explicit profit; falls back to revenue - cost. */
  profit?: number | null;
  /** Raw ROI (fraction or percent); normalized internally to percent. */
  roi?: number | null;
  conversions?: number | null;
  /** Visits / clicks. */
  clicks?: number | null;
  offerCount?: number | null;
  /** Optional precomputed visits-per-offer; else clicks / offerCount. */
  visitsPerOffer?: number | null;
  /** Optional prior ROI (raw) for ROI-drop detection. */
  roiPrevious?: number | null;
};

export type OptimizeReason =
  | "missing_offer_count"
  | "off_target"
  | "behind_target"
  | "abnormal_traffic"
  | "underperforming"
  | null;

export type EvaluatorOutput = {
  isScaling: boolean;
  isOptimize: boolean;
  isShutdown: boolean;
  isWinner: boolean;
  isTrafficIssue: boolean;
  // Live-surface signals (previously scattered across heuristics / dashboard).
  isZeroConversion: boolean;
  isStuck: boolean;
  isMilestone50: boolean;
  isMilestone75: boolean;
  isStale: boolean;
  /** Which optimize condition fired (drives the board's grouping). */
  optimizeReason: OptimizeReason;
  /** Derived values (exposed for priority + display; not thresholds). */
  facts: {
    daysLive: number | null;
    profit: number;
    roiPercent: number;
    revenue: number;
    conversions: number;
    visits: number;
    visitsPerOffer: number | null;
    vpoRatio: number | null;
    /** visits / (max(offerCount,1) × target visits-per-offer). */
    trafficPct: number;
    /** Highest milestone fraction reached with zero conversions (or null). */
    milestoneReached: number | null;
  };
};

/** ROI normalization shared everywhere: fractions (|x|<=1) become percent. */
export function normalizeRoiPercent(raw: number | null | undefined): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) <= 1 && n !== 0 ? n * 100 : n;
}

/** Whole calendar days a campaign has been live (liveStartedAt || createdAt). */
export function daysLive(
  campaign: EvaluatorCampaign,
  now: Date = new Date(),
): number | null {
  const raw = campaign.liveStartedAt?.trim() || campaign.createdAt?.trim() || "";
  if (!raw) return null;
  const started = new Date(raw);
  if (Number.isNaN(started.getTime())) return null;
  const ms = now.getTime() - started.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function num(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isManaged(purpose: string | null | undefined): boolean {
  const p = (purpose ?? "").toLowerCase();
  return p === "working" || p === "scaling";
}

function isLiveOrUnset(status: string | null | undefined): boolean {
  return status == null || status === "live";
}

/**
 * THE decision function. Given campaign facts + metrics + rules, returns the
 * unified alert flags. Identical inputs → identical decision everywhere.
 */
export function evaluateCampaign(
  campaign: EvaluatorCampaign,
  metrics: EvaluatorMetrics,
  rules: AlertRulesConfig = DEFAULT_ALERT_RULES,
  now: Date = new Date(),
): EvaluatorOutput {
  const revenue = num(metrics.revenue);
  const cost = num(metrics.cost);
  const profit = metrics.profit != null ? num(metrics.profit) : revenue - cost;
  const roiPercent = normalizeRoiPercent(metrics.roi);
  const conversions = num(metrics.conversions);
  const clicks = num(metrics.clicks);
  const offerCount = metrics.offerCount != null ? Number(metrics.offerCount) : null;
  const live = daysLive(campaign, now);
  const purpose = (campaign.purpose ?? "").toLowerCase();

  const visitsPerOffer =
    metrics.visitsPerOffer != null
      ? Number(metrics.visitsPerOffer)
      : offerCount != null && offerCount > 0
        ? clicks / offerCount
        : null;

  const vpoTarget = rules.testing.visitsPerOffer;
  const vpoRatio =
    visitsPerOffer != null && vpoTarget > 0 ? visitsPerOffer / vpoTarget : null;

  // ---- WINNER (rules.winning) ----
  const isWinner =
    conversions >= rules.winning.minConversions &&
    revenue >= rules.winning.minRevenue &&
    roiPercent >= rules.winning.minROI;

  // ---- SCALING (rules.scaling.*ForScale) — working, profitable, matured ----
  let isScaling = false;
  if (purpose === "working" && isLiveOrUnset(campaign.status)) {
    isScaling =
      profit > 0 &&
      roiPercent > 0 &&
      profit >= rules.scaling.minProfitForScale &&
      roiPercent >= rules.scaling.minRoiPercentForScale &&
      revenue >= rules.scaling.minRevenueForScale &&
      live != null &&
      live >= rules.scaling.minLiveDaysForScale;
  }

  // ---- SHUTDOWN (rules.shutdown) — long-running low-performance, not a winner ----
  let isShutdown = false;
  if (isManaged(purpose) && campaign.status === "live" && !isWinner) {
    isShutdown =
      live != null &&
      live >= rules.shutdown.minDaysLive &&
      conversions <= rules.shutdown.maxConversions &&
      revenue <= rules.shutdown.maxRevenue;
  }

  // ---- OPTIMIZE (rules.optimization + testing.visitsPerOffer + traffic.max) ----
  let optimizeReason: OptimizeReason = null;
  if (isManaged(purpose) && campaign.status === "live") {
    const { offTargetRatio, behindTargetRatio, minDaysLive, roiMinThreshold, roiDropThreshold } =
      rules.optimization;
    const maxExpectedVpo = rules.traffic.maxExpectedVisitsPerOffer;
    if (offerCount == null || offerCount <= 0) {
      optimizeReason = "missing_offer_count";
    } else if (vpoRatio != null && vpoRatio > 0 && vpoRatio < offTargetRatio) {
      optimizeReason = "off_target";
    } else if (vpoRatio != null && vpoRatio >= offTargetRatio && vpoRatio < behindTargetRatio) {
      optimizeReason = "behind_target";
    } else if (maxExpectedVpo > 0 && visitsPerOffer != null && visitsPerOffer > maxExpectedVpo) {
      optimizeReason = "abnormal_traffic";
    } else {
      const roiDropped =
        metrics.roiPrevious != null &&
        normalizeRoiPercent(metrics.roiPrevious) - roiPercent >= roiDropThreshold;
      const weakRoi = live != null && live >= minDaysLive && roiPercent < roiMinThreshold;
      if (!isScaling && (weakRoi || roiDropped)) {
        optimizeReason = "underperforming";
      }
    }
  }

  // ---- TRAFFIC ANOMALY (rules.traffic bounds) ----
  const { maxExpectedVisitsPerOffer, minExpectedVisitsPerOffer } = rules.traffic;
  const isTrafficIssue =
    visitsPerOffer != null &&
    offerCount != null &&
    offerCount > 0 &&
    ((maxExpectedVisitsPerOffer > 0 && visitsPerOffer > maxExpectedVisitsPerOffer) ||
      (minExpectedVisitsPerOffer > 0 && visitsPerOffer < minExpectedVisitsPerOffer));

  // ---- LIVE-SURFACE SIGNALS (milestones / zero-conv / stuck / stale) ----
  // Milestone pacing uses the review/dashboard denominator: visits vs
  // max(offerCount,1) × target visits-per-offer.
  const milestoneTarget = Math.max(offerCount ?? 0, 1) * vpoTarget;
  const trafficPct = milestoneTarget > 0 ? clicks / milestoneTarget : 0;
  const isTesting = purpose === "testing" && campaign.status === "live";
  const scaleLike = purpose !== "testing" && campaign.status === "live";

  const milestones = rules.testing.trafficMilestonePercents
    .map((p) => p / 100)
    .sort((a, b) => b - a);
  let milestoneReached: number | null = null;
  if (isTesting && rules.testing.zeroConversionAtMilestoneEnabled && conversions === 0) {
    for (const m of milestones) {
      if (trafficPct >= m) {
        milestoneReached = m;
        break;
      }
    }
  }
  const isMilestone50 =
    milestoneReached != null && milestoneReached >= 0.5 && milestoneReached < 0.75;
  const isMilestone75 =
    milestoneReached != null && milestoneReached >= 0.75 && milestoneReached < 1;

  let isZeroConversion = false;
  if (isTesting) {
    isZeroConversion = conversions === 0 && clicks > rules.testing.minVisitsForZeroConvAlert;
  } else if (scaleLike) {
    const noConvDays = rules.scaling.noConversionsAfterHours / 24;
    isZeroConversion = conversions === 0 && live != null && live >= noConvDays;
  }

  const isStale =
    campaign.status === "live" &&
    conversions === 0 &&
    live != null &&
    live > rules.review.staleCampaignDays;

  let isStuck = false;
  if (isTesting) {
    const paceMax = rules.testing.pacingRiskMaxTrafficPercent / 100;
    isStuck =
      conversions === 0 &&
      live != null &&
      live >= rules.testing.pacingRiskMinDaysLive &&
      trafficPct < paceMax;
  }

  return {
    isScaling,
    isOptimize: optimizeReason != null,
    isShutdown,
    isWinner,
    isTrafficIssue,
    isZeroConversion,
    isStuck,
    isMilestone50,
    isMilestone75,
    isStale,
    optimizeReason,
    facts: {
      daysLive: live,
      profit,
      roiPercent,
      revenue,
      conversions,
      visits: clicks,
      visitsPerOffer,
      vpoRatio,
      trafficPct,
      milestoneReached,
    },
  };
}

/**
 * Shared priority engine. Higher score = handle first.
 * Tiers (most → least urgent):
 *   Shutdown > Stuck/Stale > Optimize > Scaling > Winner > Traffic.
 * Within a tier:
 *  - shutdown / stuck / stale: longer live = more wasted → higher
 *  - optimize: lower ROI = more urgent → higher
 *  - scaling / winner: higher profit / revenue = more impact → higher
 */
export function computePriorityScore(out: EvaluatorOutput): number {
  const TIER = 1_000_000_000;
  const { profit, roiPercent, revenue, daysLive: live } = out.facts;
  if (out.isShutdown) return 6 * TIER + Math.max(0, live ?? 0);
  if (out.isStuck || out.isStale) return 5 * TIER + Math.max(0, live ?? 0);
  if (out.isOptimize) return 4 * TIER + Math.max(0, 100_000 - roiPercent);
  if (out.isScaling) return 3 * TIER + Math.max(0, profit);
  if (out.isWinner) return 2 * TIER + Math.max(0, revenue);
  if (out.isTrafficIssue) return 1 * TIER + Math.max(0, revenue);
  return 0;
}

/** STEP 5: evaluator → human badge label(s), most important first. */
export type CampaignBadge =
  | "Winner"
  | "Ready to scale"
  | "Should stop"
  | "Needs optimization"
  | "Traffic anomaly";

export function evaluatorBadges(out: EvaluatorOutput): CampaignBadge[] {
  const badges: CampaignBadge[] = [];
  if (out.isWinner) badges.push("Winner");
  if (out.isShutdown) badges.push("Should stop");
  if (out.isScaling) badges.push("Ready to scale");
  if (out.isOptimize) badges.push("Needs optimization");
  if (out.isTrafficIssue) badges.push("Traffic anomaly");
  return badges;
}
