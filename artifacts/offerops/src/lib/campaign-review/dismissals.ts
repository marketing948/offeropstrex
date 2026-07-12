/**
 * Server-authoritative dismissal logic for Campaign Review.
 *
 * Dismissals are persisted server-side (operational_events →
 * CAMPAIGN_REVIEW_DISMISSED). Whether a campaign is *currently* hidden is a
 * pure function of two timestamps:
 *   - the latest dismissal timestamp for that campaign
 *   - the latest relevant signal/request timestamp for that campaign
 *
 * Rule (per product spec):
 *   latest signal/request timestamp > latest dismissal timestamp  => show again
 *   otherwise                                                      => stay hidden
 *
 * This module is intentionally DB-free so it can be unit tested in isolation.
 */

export type DismissalRecord = {
  campaignId: number;
  dismissedAt: string;
};

/** Latest dismissal timestamp per campaign. */
export function buildDismissalMap(items: DismissalRecord[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const item of items ?? []) {
    if (item == null || !Number.isInteger(item.campaignId)) continue;
    const at = Date.parse(item.dismissedAt);
    if (Number.isNaN(at)) continue;
    const prev = map.get(item.campaignId);
    if (prev == null || at > Date.parse(prev)) {
      map.set(item.campaignId, item.dismissedAt);
    }
  }
  return map;
}

/**
 * True when the review item should remain hidden. It reappears only when a
 * newer qualifying signal/request occurs strictly after the dismissal.
 */
export function isReviewItemHidden(
  dismissedAt: string | null | undefined,
  latestSignalAt: string | null | undefined,
): boolean {
  if (!dismissedAt) return false;
  const d = Date.parse(dismissedAt);
  if (Number.isNaN(d)) return false;
  if (!latestSignalAt) return true;
  const s = Date.parse(latestSignalAt);
  if (Number.isNaN(s)) return true;
  return s <= d;
}

/**
 * Latest relevant signal/request timestamp for a campaign. Uses the most
 * recent of any provided candidate timestamps (manual review request time,
 * campaign data update time, etc.). Invalid/empty values are ignored.
 */
export function latestSignalTimestamp(
  ...candidates: Array<string | null | undefined>
): string | null {
  let bestMs = Number.NEGATIVE_INFINITY;
  let best: string | null = null;
  for (const c of candidates) {
    if (!c) continue;
    const ms = Date.parse(c);
    if (Number.isNaN(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = c;
    }
  }
  return best;
}
