import { z } from "zod";

/** Workspace-scoped alert / review thresholds — single source of truth. */
export const alertRulesSchema = z.object({
  testing: z.object({
    visitsPerOffer: z.number().int().positive(),
    trafficMilestonePercents: z.array(z.number().min(1).max(100)).min(1).max(5),
    zeroConversionAtMilestoneEnabled: z.boolean(),
    pacingRiskMinDaysLive: z.number().int().nonnegative(),
    pacingRiskMaxTrafficPercent: z.number().min(0).max(100),
    trafficSpikePercentIncrease: z.number().min(0).max(500),
    trafficDecreasePercentDecrease: z.number().min(0).max(100),
    minVisitsForZeroConvAlert: z.number().int().nonnegative(),
  }),
  winners: z.object({
    minConversionsForPotentialWinner: z.number().int().nonnegative(),
    minRoiPercentForLikelyWinner: z.number(),
    roiPositiveDaysBeforeScaleAlert: z.number().int().positive(),
    batchFinishedWinnersNoActionEnabled: z.boolean(),
    manualWinnerNoScaleEnabled: z.boolean(),
  }),
  scaling: z.object({
    noConversionsAfterHours: z.number().int().positive(),
    negativeRoiDays: z.number().int().positive(),
    minRevenueForStrongSignal: z.number().nonnegative(),
    minRoiPercentForPositiveSignal: z.number(),
    // Today Focus "Campaigns We Should Scale Today" suggestion thresholds.
    minLiveDaysForScale: z.number().int().nonnegative(),
    minProfitForScale: z.number().nonnegative(),
    minRoiPercentForScale: z.number().nonnegative(),
    minRevenueForScale: z.number().nonnegative(),
  }),
  optimization: z.object({
    // VPO ratio (visits-per-offer / target) below which a live campaign needs review.
    // Below offTargetRatio → "off target"; between it and 1.0 → "behind target".
    behindTargetRatio: z.number().min(0).max(1),
    offTargetRatio: z.number().min(0).max(1),
    // Proactive weak/underperforming working campaign review.
    minLiveDaysForReview: z.number().int().nonnegative(),
    weakRoiPercent: z.number(),
    // Optimize Today: min days live before an ROI-based review, ROI floor, and
    // ROI drop (percentage-point decline vs prior) that flags a campaign.
    minDaysLive: z.number().int().nonnegative(),
    roiMinThreshold: z.number(),
    roiDropThreshold: z.number().nonnegative(),
  }),
  // Traffic volume / anomaly thresholds. Single source for spike/decrease and
  // expected visits-per-offer bounds used by alerts + optimize suggestions.
  traffic: z.object({
    spikeIncreasePct: z.number().min(0).max(500),
    spikeDecreasePct: z.number().min(0).max(100),
    maxExpectedVisitsPerOffer: z.number().nonnegative(),
    minExpectedVisitsPerOffer: z.number().nonnegative(),
  }),
  // Winning campaign rule → flags a campaign as WINNER and surfaces it in Scale.
  winning: z.object({
    minConversions: z.number().int().nonnegative(),
    minRevenue: z.number().nonnegative(),
    minROI: z.number(),
  }),
  // Shutdown rule → long-running + low performance → suggest STOP.
  shutdown: z.object({
    minDaysLive: z.number().int().nonnegative(),
    maxConversions: z.number().int().nonnegative(),
    maxRevenue: z.number().nonnegative(),
  }),
  review: z.object({
    ignoredSignalEscalationHours: z.number().int().positive(),
    dismissalSnoozeHours: z.number().int().positive(),
    staleCampaignDays: z.number().int().positive(),
  }),
  operationalScoring: z.object({
    baseScore: z.number().int().min(0).max(100),
    positiveReviewPoints: z.number().int().nonnegative(),
    actionTakenPoints: z.number().int().nonnegative(),
    dismissPenalty: z.number().int().nonnegative(),
    ignoredSignalPenalty: z.number().int().nonnegative(),
    escalationPenalty: z.number().int().nonnegative(),
    overdueReviewPenalty: z.number().int().nonnegative(),
    delayedScalePenalty: z.number().int().nonnegative(),
  }),
});

export type AlertRulesConfig = z.infer<typeof alertRulesSchema>;

export const DEFAULT_ALERT_RULES: AlertRulesConfig = {
  testing: {
    visitsPerOffer: 15_000,
    trafficMilestonePercents: [50, 75, 100],
    zeroConversionAtMilestoneEnabled: true,
    pacingRiskMinDaysLive: 3,
    pacingRiskMaxTrafficPercent: 25,
    trafficSpikePercentIncrease: 40,
    trafficDecreasePercentDecrease: 30,
    minVisitsForZeroConvAlert: 500,
  },
  winners: {
    minConversionsForPotentialWinner: 1,
    minRoiPercentForLikelyWinner: 10,
    roiPositiveDaysBeforeScaleAlert: 3,
    batchFinishedWinnersNoActionEnabled: true,
    manualWinnerNoScaleEnabled: true,
  },
  scaling: {
    noConversionsAfterHours: 48,
    negativeRoiDays: 7,
    minRevenueForStrongSignal: 200,
    minRoiPercentForPositiveSignal: 15,
    minLiveDaysForScale: 2,
    minProfitForScale: 0,
    minRoiPercentForScale: 0,
    minRevenueForScale: 0,
  },
  optimization: {
    // ratio < offTargetRatio → "off target"; offTargetRatio ≤ ratio < behindTargetRatio → "behind".
    offTargetRatio: 0.7,
    behindTargetRatio: 1,
    minLiveDaysForReview: 3,
    weakRoiPercent: 5,
    minDaysLive: 3,
    roiMinThreshold: 5,
    roiDropThreshold: 20,
  },
  traffic: {
    spikeIncreasePct: 40,
    spikeDecreasePct: 30,
    maxExpectedVisitsPerOffer: 25_000,
    minExpectedVisitsPerOffer: 3_000,
  },
  winning: {
    minConversions: 1,
    minRevenue: 200,
    minROI: 15,
  },
  shutdown: {
    minDaysLive: 7,
    maxConversions: 0,
    maxRevenue: 0,
  },
  review: {
    ignoredSignalEscalationHours: 4,
    dismissalSnoozeHours: 8,
    staleCampaignDays: 14,
  },
  operationalScoring: {
    baseScore: 50,
    positiveReviewPoints: 4,
    actionTakenPoints: 2,
    dismissPenalty: 1,
    ignoredSignalPenalty: 6,
    escalationPenalty: 6,
    overdueReviewPenalty: 6,
    delayedScalePenalty: 4,
  },
};

export const ALERT_RULES_SETTINGS_KEY = "alert_rules_config";

function mergeSection<T extends Record<string, unknown>>(
  defaults: T,
  patch: unknown,
): T {
  if (!patch || typeof patch !== "object") return defaults;
  return { ...defaults, ...(patch as Partial<T>) };
}

/** Deep-merge stored JSON with defaults; invalid shapes fall back safely. */
export function mergeAlertRules(raw: unknown): AlertRulesConfig {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const candidate = {
    testing: mergeSection(DEFAULT_ALERT_RULES.testing, input.testing),
    winners: mergeSection(DEFAULT_ALERT_RULES.winners, input.winners),
    scaling: mergeSection(DEFAULT_ALERT_RULES.scaling, input.scaling),
    optimization: mergeSection(DEFAULT_ALERT_RULES.optimization, input.optimization),
    traffic: mergeSection(DEFAULT_ALERT_RULES.traffic, input.traffic),
    winning: mergeSection(DEFAULT_ALERT_RULES.winning, input.winning),
    shutdown: mergeSection(DEFAULT_ALERT_RULES.shutdown, input.shutdown),
    review: mergeSection(DEFAULT_ALERT_RULES.review, input.review),
    operationalScoring: mergeSection(
      DEFAULT_ALERT_RULES.operationalScoring,
      input.operationalScoring,
    ),
  };
  const parsed = alertRulesSchema.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULT_ALERT_RULES;
}

/** Milestone percents as 0–1 fractions for heuristics. */
export function milestoneFractions(rules: AlertRulesConfig): number[] {
  return rules.testing.trafficMilestonePercents.map((p) => p / 100);
}

// Unified alert engine (single brain) + rollout flags.
export * from "./evaluator.ts";
export * from "./feature-flags.ts";
