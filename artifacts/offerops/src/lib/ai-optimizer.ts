/**
 * AI Optimizer — frontend types + PATH/CMP distribution preview.
 *
 * The backend (`@workspace/api-server` src/lib/ai-optimizer) is the single
 * source of truth: it recomputes matching, KPI, and CMP assignment on every
 * export. This module mirrors ONLY the deterministic distribution math so the
 * wizard can render the "New Campaign Index" column and the distribution table
 * live (no round-trip per PATH change). Both implementations are covered by the
 * same numeric tests, so they cannot drift silently.
 */

export type OfferDecision = "KEEP" | "REMOVE" | "UNMATCHED";
export type MatchStatus = "MATCHED" | "UNMATCHED_CAMPAIGN_ROW";

export type DecisionRecord = {
  originalPosition: number;
  brandName: string;
  normalizedBrandName: string;
  offerId: string | null;
  revenue: number | null;
  decision: OfferDecision;
  reason: string;
  matchStatus: MatchStatus;
  oldCampaignIndex: string;
  newCampaignIndex: string;
};

export type AnalysisSummary = {
  campaignRows: number;
  voluumRows: number;
  matchedRows: number;
  unmatchedCampaignRows: number;
  unmatchedVoluumRows: number;
  keep: number;
  remove: number;
  unmatched: number;
  retainedTotal: number;
  invalidRevenueRows: number;
};

export type AnalyzeResponse = {
  threshold: number;
  campaignHeaders: string[];
  decisions: DecisionRecord[];
  summary: AnalysisSummary;
  warnings: string[];
  brandSource: "brand_name_column" | "ctrl_info";
};

export type PathBucket = {
  campaignIndex: string;
  offerCount: number;
  startPosition: number;
  endPosition: number;
};

export function cmpLabel(pathIndexZeroBased: number): string {
  const n = pathIndexZeroBased + 1;
  return `cmp${String(n).padStart(2, "0")}`;
}

export function validatePathCount(retainedCount: number, pathCount: number): string | null {
  if (!Number.isInteger(pathCount)) return "Number of PATHS must be a whole number.";
  if (pathCount < 1) return "Number of PATHS must be at least 1.";
  if (retainedCount < 1) return "There are no retained Offers to distribute.";
  if (pathCount > retainedCount) {
    return `Number of PATHS (${pathCount}) cannot exceed retained Offers (${retainedCount}).`;
  }
  return null;
}

export function distributeOffers(remaining: number, pathCount: number): number[] {
  const err = validatePathCount(remaining, pathCount);
  if (err) throw new Error(err);
  const base = Math.floor(remaining / pathCount);
  const remainder = remaining % pathCount;
  return Array.from({ length: pathCount }, (_, i) => (i < remainder ? base + 1 : base));
}

export function buildDistribution(remaining: number, pathCount: number): PathBucket[] {
  const counts = distributeOffers(remaining, pathCount);
  const buckets: PathBucket[] = [];
  let cursor = 1;
  counts.forEach((count, i) => {
    buckets.push({
      campaignIndex: cmpLabel(i),
      offerCount: count,
      startPosition: cursor,
      endPosition: cursor + count - 1,
    });
    cursor += count;
  });
  return buckets;
}

export function assignCmpToRetained(retainedCount: number, pathCount: number): string[] {
  const counts = distributeOffers(retainedCount, pathCount);
  const labels: string[] = [];
  counts.forEach((count, i) => {
    const label = cmpLabel(i);
    for (let j = 0; j < count; j++) labels.push(label);
  });
  return labels;
}

/** Retained decisions (KEEP + UNMATCHED) in original Campaign order. */
export function retainedDecisions(decisions: DecisionRecord[]): DecisionRecord[] {
  return decisions.filter((d) => d.decision === "KEEP" || d.decision === "UNMATCHED");
}

/** Return decisions with New Campaign Index filled in for a chosen pathCount. */
export function withNewCampaignIndex(
  decisions: DecisionRecord[],
  pathCount: number,
): DecisionRecord[] {
  const retained = retainedDecisions(decisions);
  const err = validatePathCount(retained.length, pathCount);
  if (err) return decisions.map((d) => ({ ...d, newCampaignIndex: "" }));
  const labels = assignCmpToRetained(retained.length, pathCount);
  const byPosition = new Map<number, string>();
  retained.forEach((d, i) => byPosition.set(d.originalPosition, labels[i]!));
  return decisions.map((d) => ({ ...d, newCampaignIndex: byPosition.get(d.originalPosition) ?? "" }));
}
