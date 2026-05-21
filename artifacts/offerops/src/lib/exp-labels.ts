/** User-facing EXP terminology for worker goals/profile surfaces. */

export const EXP_POINTS_THIS_MONTH = "EXP Points this month";

export function expComboReward(points: number): string {
  return `+${points} EXP`;
}

export function expRankThreshold(minScore: number): string {
  return `${minScore.toLocaleString()}+ EXP`;
}

export function expLeaderboardTotal(total: number): string {
  return `${total.toLocaleString()} EXP`;
}
