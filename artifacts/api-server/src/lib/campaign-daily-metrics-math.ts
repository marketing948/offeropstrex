/** Derived fields — not persisted. */
export function deriveProfitAndRoi(cost: string | number, revenue: string | number): {
  profit: string;
  roi: string | null;
  epc: string | null;
} {
  const c = Number(cost);
  const r = Number(revenue);
  const profit = r - c;
  const roi = c > 0 ? profit / c : null;
  return {
    profit: Number.isFinite(profit) ? String(profit) : "0",
    roi: roi != null && Number.isFinite(roi) ? String(roi) : null,
    epc: null,
  };
}

export function deriveCampaignMetricFields(
  cost: string | number,
  revenue: string | number,
  visits: number,
): {
  profit: string;
  roi: string | null;
  epc: string | null;
} {
  const base = deriveProfitAndRoi(cost, revenue);
  const v = Number(visits);
  const r = Number(revenue);
  const epc = v > 0 && Number.isFinite(r) ? String(r / v) : null;
  return { ...base, epc };
}
