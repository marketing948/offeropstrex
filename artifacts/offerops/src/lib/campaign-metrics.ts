/**
 * Canonical profit/ROI from cost + revenue — never trust imported ROI when raw values exist.
 */

export function profitFromCostRevenue(
  cost: number | string | null | undefined,
  revenue: number | string | null | undefined,
): number {
  const c = Number(cost ?? 0);
  const r = Number(revenue ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(r)) return 0;
  return r - c;
}

/** ROI as percentage: cost > 0 ? (profit / cost) * 100 : 0 */
export function roiPercentFromCostRevenue(
  cost: number | string | null | undefined,
  revenue: number | string | null | undefined,
): number {
  const c = Number(cost ?? 0);
  const profit = profitFromCostRevenue(cost, revenue);
  if (!Number.isFinite(c) || c <= 0) return 0;
  return (profit / c) * 100;
}

/**
 * Prefer calculated ROI from cost/revenue; fall back to stored ROI only when
 * cost/revenue are unavailable.
 */
export function resolveDisplayRoiPercent(
  cost: number | string | null | undefined,
  revenue: number | string | null | undefined,
  storedRoi?: number | string | null,
): number | null {
  const c = Number(cost ?? 0);
  const r = Number(revenue ?? 0);
  const hasFinancials =
    Number.isFinite(c) && Number.isFinite(r) && (c !== 0 || r !== 0);

  if (hasFinancials) {
    return roiPercentFromCostRevenue(cost, revenue);
  }

  if (storedRoi == null || storedRoi === "") return null;
  const n = typeof storedRoi === "number" ? storedRoi : Number(storedRoi);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 1 ? n * 100 : n;
}
