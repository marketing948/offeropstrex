/**
 * Scaling Opportunity MVP helper (working campaigns only).
 */

export type ScalingOpportunityInput = {
  campaignPurpose?: string | null;
  status?: string | null;
  profit: number | null | undefined;
  roi: number | null | undefined;
  liveStartedAt?: string | null;
  createdAt?: string | null;
  now?: Date;
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
 * Working campaign is a Scaling Opportunity when:
 * - purpose = working (and preferably live)
 * - profit > 0
 * - ROI > 0
 * - live for at least 2 days
 */
export function isScalingOpportunity(input: ScalingOpportunityInput): boolean {
  if (input.campaignPurpose !== "working") return false;
  if (input.status != null && input.status !== "live") return false;
  const profit = Number(input.profit ?? 0);
  const roi = Number(input.roi ?? 0);
  if (!(profit > 0) || !(roi > 0)) return false;
  const days = daysLiveForCampaign(input.liveStartedAt, input.createdAt, input.now ?? new Date());
  if (days == null) return false;
  return days >= 2;
}
