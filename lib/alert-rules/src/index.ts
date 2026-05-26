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
