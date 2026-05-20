/** Derived fields — not persisted. */
export function deriveProfitAndRoi(cost: string | number, revenue: string | number): {
  profit: string;
  roi: string | null;
} {
  const c = Number(cost);
  const r = Number(revenue);
  const profit = r - c;
  const roi = c > 0 ? profit / c : null;
  return {
    profit: Number.isFinite(profit) ? String(profit) : "0",
    roi: roi != null && Number.isFinite(roi) ? String(roi) : null,
  };
}
