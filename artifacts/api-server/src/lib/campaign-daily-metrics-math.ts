const METRIC_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type MetricsDateRange = {
  dateFrom: string;
  dateTo: string;
};

/** Monday-based week start (UTC calendar date). */
export function getWeekStartIso(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
  return weekStart.toISOString().slice(0, 10);
}

export function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function resolveMetricsDateRange(
  dateFromRaw?: string,
  dateToRaw?: string,
): MetricsDateRange | { error: string } {
  const dateFrom = dateFromRaw?.trim() || getWeekStartIso();
  const dateTo = dateToRaw?.trim() || getTodayIso();

  if (!METRIC_DATE_RE.test(dateFrom) || !METRIC_DATE_RE.test(dateTo)) {
    return { error: "date_from and date_to must be YYYY-MM-DD" };
  }
  if (dateFrom > dateTo) {
    return { error: "date_from must be on or before date_to" };
  }
  return { dateFrom, dateTo };
}

export type AggregatedMetricTotals = {
  visits: number;
  conversions: number;
  cost: number;
  revenue: number;
  profit: number;
  roi: number | null;
  epc: number | null;
};

export function totalsFromSums(
  visits: number,
  conversions: number,
  cost: number,
  revenue: number,
): AggregatedMetricTotals {
  const profit = revenue - cost;
  const roi = cost > 0 ? profit / cost : null;
  const epc = visits > 0 ? revenue / visits : null;
  return { visits, conversions, cost, revenue, profit, roi, epc };
}

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
