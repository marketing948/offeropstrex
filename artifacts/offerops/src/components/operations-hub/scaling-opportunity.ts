/**
 * Scaling Opportunity MVP helper (working campaigns only).
 */

export type ScalingOpportunityInput = {
  campaignPurpose?: string | null;
  status?: string | null;
  profit: number | null | undefined;
  roi: number | null | undefined;
  revenue?: number | null | undefined;
  liveStartedAt?: string | null;
  createdAt?: string | null;
  now?: Date;
  /** Settings-defined thresholds (Alert Rules → Scale Today). Defaults preserve the MVP rule. */
  thresholds?: {
    minLiveDays?: number;
    minProfit?: number;
    minRoiPercent?: number;
    minRevenue?: number;
  };
};

export function daysLiveForCampaign(
  liveStartedAt: string | null | undefined,
  createdAt: string | null | undefined = null,
  now = new Date(),
): number | null {
  const raw = liveStartedAt?.trim() || createdAt?.trim() || "";
  if (!raw) return null;
  const started = new Date(raw);
  if (Number.isNaN(started.getTime())) return null;
  const ms = now.getTime() - started.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Working campaign is a Scaling Opportunity when it clears the settings-defined
 * Scale Today thresholds (Alert Rules → scaling.*). Defaults preserve the MVP rule:
 * - purpose = working (and preferably live)
 * - profit > minProfit (default 0)
 * - ROI  > minRoiPercent (default 0)
 * - revenue >= minRevenue (default 0)
 * - live for at least minLiveDays (default 2)
 */
export function isScalingOpportunity(input: ScalingOpportunityInput): boolean {
  if (input.campaignPurpose !== "working") return false;
  if (input.status != null && input.status !== "live") return false;

  const minLiveDays = input.thresholds?.minLiveDays ?? 2;
  const minProfit = input.thresholds?.minProfit ?? 0;
  const minRoi = input.thresholds?.minRoiPercent ?? 0;
  const minRevenue = input.thresholds?.minRevenue ?? 0;

  const profit = Number(input.profit ?? 0);
  const roi = Number(input.roi ?? 0);
  const revenue = Number(input.revenue ?? 0);

  // Must be genuinely profitable, then clear any admin-configured minimums.
  if (!(profit > 0) || !(roi > 0)) return false;
  if (profit < minProfit) return false;
  if (roi < minRoi) return false;
  if (revenue < minRevenue) return false;

  const days = daysLiveForCampaign(input.liveStartedAt, input.createdAt, input.now ?? new Date());
  if (days == null) return false;
  return days >= minLiveDays;
}
