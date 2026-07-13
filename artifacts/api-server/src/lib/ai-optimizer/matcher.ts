/**
 * Deterministic Brand-Name matcher.
 *
 * Every Campaign row is a separate Offer. Brand Names are normalized only by
 * trim + internal-whitespace collapse + case-insensitivity (no fuzzy matching,
 * no punctuation stripping). Duplicate brands are matched by occurrence order:
 * the Nth Campaign row with a brand consumes the Nth unused Voluum row with the
 * same brand. Excess Campaign rows become UNMATCHED_CAMPAIGN_ROW; excess Voluum
 * rows are reported separately.
 */

import type { CampaignMatchResult, CampaignRow, VoluumRow } from "./types.ts";

/** trim → collapse internal whitespace → lowercase. Nothing else. */
export function normalizeBrandName(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export type MatchOutcome = {
  results: CampaignMatchResult[];
  unmatchedVoluumRows: VoluumRow[];
};

export function matchCampaignRowsToVoluumRows(
  campaignRows: CampaignRow[],
  voluumRows: VoluumRow[],
): MatchOutcome {
  // Per-brand FIFO queue of Voluum rows, preserving original order.
  const voluumByBrand = new Map<string, VoluumRow[]>();
  for (const v of voluumRows) {
    const key = normalizeBrandName(v.brandNameRaw);
    const list = voluumByBrand.get(key);
    if (list) list.push(v);
    else voluumByBrand.set(key, [v]);
  }

  const consumed = new Set<VoluumRow>();
  const results: CampaignMatchResult[] = campaignRows.map((campaignRow) => {
    const key = normalizeBrandName(campaignRow.brandNameRaw);
    const queue = voluumByBrand.get(key);
    const matched = queue && queue.length > 0 ? queue.shift()! : null;
    if (matched) consumed.add(matched);
    return {
      originalPosition: campaignRow.originalPosition,
      campaignRow,
      normalizedBrandName: key,
      matchedVoluumRow: matched,
      revenue: matched ? matched.revenue : null,
      matchStatus: matched ? "MATCHED" : "UNMATCHED_CAMPAIGN_ROW",
    };
  });

  const unmatchedVoluumRows = voluumRows.filter((v) => !consumed.has(v));
  return { results, unmatchedVoluumRows };
}
