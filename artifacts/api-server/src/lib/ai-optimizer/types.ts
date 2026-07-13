/** Shared types for the AI Optimizer deterministic CSV engine. */

export type OfferDecision = "KEEP" | "REMOVE" | "UNMATCHED";
export type MatchStatus = "MATCHED" | "UNMATCHED_CAMPAIGN_ROW";

/** One parsed Campaign row (every Campaign row is a separate Offer). */
export type CampaignRow = {
  /** 1-based position in the original Campaign file (data rows only). */
  originalPosition: number;
  /** Raw cells, aligned to the original header order. */
  cells: string[];
  /** Raw Brand Name value as it appeared in the Campaign file. */
  brandNameRaw: string;
  /** Raw Campaign index value as it appeared in the Campaign file. */
  oldCampaignIndex: string;
  /** Offer Id when the column exists (display/report only), else null. */
  offerId: string | null;
};

/** One parsed Voluum row, reduced to the fields the optimizer needs. */
export type VoluumRow = {
  /** 1-based position in the original Voluum file (data rows only). */
  originalPosition: number;
  brandNameRaw: string;
  /** Parsed revenue, or null when empty / non-numeric. */
  revenue: number | null;
  /** How Brand Name was resolved (audit only). */
  brandSource: "brand_name_column" | "ctrl_info";
};

/** Result of matching a single Campaign row against Voluum rows. */
export type CampaignMatchResult = {
  originalPosition: number;
  campaignRow: CampaignRow;
  normalizedBrandName: string;
  matchedVoluumRow: VoluumRow | null;
  revenue: number | null;
  matchStatus: MatchStatus;
};

/** Per-Offer decision surfaced to the admin and written to the report. */
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
  /** Assigned only for retained rows once a PATH count is chosen; else "". */
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
  /** UNMATCHED Campaign rows (always retained). */
  unmatched: number;
  /** keep + unmatched. */
  retainedTotal: number;
  /** Matched rows whose Voluum revenue was empty/invalid (treated as 0). */
  invalidRevenueRows: number;
};
