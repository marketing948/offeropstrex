/**
 * KPI rule engine. Default rule: Revenue > threshold (strictly greater), with
 * threshold defaulting to 0.1. Equality is a REMOVE (0.1 is not > 0.1).
 */

export type KpiDecision = { decision: "KEEP" | "REMOVE"; reason: string };

export const DEFAULT_REVENUE_THRESHOLD = 0.1;

/** Format a number for human-readable reasons without trailing noise. */
export function formatRevenue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

/**
 * Evaluate a single Offer's revenue against the threshold. Operates on a real
 * number — callers coerce empty/invalid matched revenue to 0 (documented) and
 * annotate the reason. UNMATCHED rows are handled by the decision builder, not
 * here, so this only ever returns KEEP or REMOVE.
 */
export function evaluateOfferRevenue(revenue: number, threshold: number): KpiDecision {
  if (revenue > threshold) {
    return {
      decision: "KEEP",
      reason: `Revenue ${formatRevenue(revenue)} is greater than ${formatRevenue(threshold)}`,
    };
  }
  return {
    decision: "REMOVE",
    reason: `Revenue ${formatRevenue(revenue)} is not greater than ${formatRevenue(threshold)}`,
  };
}

/** Validate an admin-supplied revenue threshold. */
export function normalizeThreshold(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return n;
  }
  return DEFAULT_REVENUE_THRESHOLD;
}
