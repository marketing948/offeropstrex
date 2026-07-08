import type { KpiTarget } from "@/lib/goals-config";

export const OPS_V2_DEMO_FALLBACKS = {
  revenue: 50_000,
  workingCampaigns: 10,
  testingBatches: 8,
} as const;

export const ACTIVE_TESTING_STATUSES = [
  "NEW_BATCH",
  "WAITING_FOR_TRACKER_CAMPAIGNS",
  "OFFER_READY_FOR_LIVE_TESTING",
  "LIVE_TESTS",
] as const;

export type ActiveTestingStatus = (typeof ACTIVE_TESTING_STATUSES)[number];

export type PaceStatus = "On Track" | "Watch" | "Behind Pace" | "Completed";

export type GoalHealthTone = "green" | "yellow" | "red";

export function monthToDateRange(now = new Date()): { dateFrom: string; dateTo: string } {
  const dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const dateTo = now.toISOString().slice(0, 10);
  return { dateFrom, dateTo };
}

export function monthLabel(now = new Date()): string {
  return now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function monthProgressFraction(now = new Date()): number {
  const year = now.getFullYear();
  const month = now.getMonth();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const daysElapsed = now.getDate();
  return Math.min(1, Math.max(0, daysElapsed / totalDays));
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function parseMonthKey(monthKey: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 0),
  };
}

function countWeekdaysInclusive(start: Date, end: Date): number {
  if (end < start) return 0;
  let total = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    if (isWeekday(cursor)) total += 1;
  }
  return total;
}

export type WorkingDayPace = {
  totalWorkingDaysInMonth: number;
  elapsedWorkingDaysInMonth: number;
  dailyExpected: number;
  expectedByNow: number;
  paceDelta: number;
  pacePercent: number;
  remaining: number;
  progressPercent: number;
};

export function evaluateWorkingDayPace(
  monthKey: string,
  monthlyTarget: number,
  currentValue: number,
  now = new Date(),
): WorkingDayPace {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) {
    const fallbackDays = 20;
    const expectedByNow = monthlyTarget * monthProgressFraction(now);
    return {
      totalWorkingDaysInMonth: fallbackDays,
      elapsedWorkingDaysInMonth: Math.round(fallbackDays * monthProgressFraction(now)),
      dailyExpected: monthlyTarget > 0 ? monthlyTarget / fallbackDays : 0,
      expectedByNow,
      paceDelta: currentValue - expectedByNow,
      pacePercent: expectedByNow > 0 ? ((currentValue / expectedByNow) - 1) * 100 : 0,
      remaining: Math.max(monthlyTarget - currentValue, 0),
      progressPercent: monthlyTarget > 0 ? (currentValue / monthlyTarget) * 100 : 0,
    };
  }

  const totalWorkingDaysInMonth = Math.max(1, countWeekdaysInclusive(parsed.start, parsed.end));
  const elapsedEnd = now < parsed.start ? null : (now > parsed.end ? parsed.end : now);
  const elapsedWorkingDaysInMonth = elapsedEnd ? countWeekdaysInclusive(parsed.start, elapsedEnd) : 0;
  const dailyExpected = monthlyTarget > 0 ? monthlyTarget / totalWorkingDaysInMonth : 0;
  const expectedByNow = monthlyTarget > 0
    ? (monthlyTarget * elapsedWorkingDaysInMonth) / totalWorkingDaysInMonth
    : 0;
  return {
    totalWorkingDaysInMonth,
    elapsedWorkingDaysInMonth,
    dailyExpected,
    expectedByNow,
    paceDelta: currentValue - expectedByNow,
    pacePercent: expectedByNow > 0 ? ((currentValue / expectedByNow) - 1) * 100 : 0,
    remaining: Math.max(monthlyTarget - currentValue, 0),
    progressPercent: monthlyTarget > 0 ? (currentValue / monthlyTarget) * 100 : 0,
  };
}

export function daysRemainingInMonth(now = new Date()): number {
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(0, totalDays - now.getDate());
}

export function resolveKpiTarget(
  kpiTargets: KpiTarget[],
  key: string,
  fallback: number,
): { target: number; usingFallback: boolean } {
  const found = kpiTargets.find((k) => k.key === key);
  if (found != null && found.monthlyTarget > 0) {
    return { target: found.monthlyTarget, usingFallback: false };
  }
  return { target: fallback, usingFallback: true };
}

/** Per-GEO revenue targets: `revenue:network:{network}:{geo}` then fallback `revenue:{geo}`. */
export function resolveGeoRevenueTarget(
  kpiTargets: KpiTarget[],
  geo: string,
  network?: string,
): { target: number | null; configured: boolean } {
  const normalizedGeo = geo.trim().toUpperCase();

  if (network?.trim()) {
    const networkGeoPrefix = "revenue:network:";
    const suffix = `:${geo.trim()}`;
    const foundScoped = kpiTargets.find((k) => {
      const lower = k.key.toLowerCase();
      if (!lower.startsWith(networkGeoPrefix)) return false;
      if (!k.key.endsWith(suffix)) return false;
      const networkPart = k.key.slice(networkGeoPrefix.length, k.key.length - suffix.length);
      return networkPart.trim().toLowerCase() === network.trim().toLowerCase();
    });
    if (foundScoped != null && foundScoped.monthlyTarget > 0) {
      return { target: foundScoped.monthlyTarget, configured: true };
    }
  }

  const prefix = "revenue:";
  const found = kpiTargets.find((k) => {
    const lower = k.key.toLowerCase();
    if (lower.startsWith("revenue:network:")) return false;
    if (!lower.startsWith(prefix)) return false;
    const geoKey = k.key.slice(prefix.length).trim().toUpperCase();
    return geoKey === normalizedGeo;
  });
  if (found != null && found.monthlyTarget > 0) {
    return { target: found.monthlyTarget, configured: true };
  }
  return { target: null, configured: false };
}

/** Network-level targets: `revenue:network:Shoplooks FXH` (exact network segment, no GEO suffix). */
export function resolveNetworkTarget(
  kpiTargets: KpiTarget[],
  baseKey: string,
  network: string,
): { target: number | null; configured: boolean } {
  const key = `${baseKey}:network:${network}`;
  const found = kpiTargets.find(
    (k) =>
      k.key === key ||
      k.key.toLowerCase() === key.toLowerCase(),
  );
  if (found != null && found.monthlyTarget > 0) {
    return { target: found.monthlyTarget, configured: true };
  }
  return { target: null, configured: false };
}

/** Network names with a configured `{baseKey}:network:{name}` target (excludes revenue GEO keys). */
export function listConfiguredNetworkTargets(
  kpiTargets: KpiTarget[],
  baseKey: string,
): string[] {
  const prefix = `${baseKey}:network:`;
  const names: string[] = [];
  for (const k of kpiTargets) {
    if (k.monthlyTarget <= 0) continue;
    if (!k.key.startsWith(prefix)) continue;
    const rest = k.key.slice(prefix.length);
    if (baseKey === "revenue" && rest.includes(":")) continue;
    names.push(rest);
  }
  return names;
}

export function progressPct(actual: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((actual / target) * 100));
}

export function gapRemaining(actual: number, target: number): number {
  return Math.max(0, target - actual);
}

export function remainingPct(actual: number, target: number): number {
  if (target <= 0) return 100;
  const remaining = Math.max(0, target - actual);
  return Math.min(100, Math.round((remaining / target) * 100));
}

export function healthToneFromRemaining(remaining: number): GoalHealthTone {
  if (remaining <= 25) return "green";
  if (remaining <= 50) return "yellow";
  return "red";
}

export const HEALTH_BAR_CLASS: Record<GoalHealthTone, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-red-500",
};

export const HEALTH_TEXT_CLASS: Record<GoalHealthTone, string> = {
  green: "text-emerald-700 dark:text-emerald-300",
  yellow: "text-amber-800 dark:text-amber-200",
  red: "text-red-700 dark:text-red-300",
};

export type PaceEvaluation = {
  progressPct: number;
  expectedByToday: number;
  expectedProgressPct: number;
  gap: number;
  paceStatus: PaceStatus;
  /** % ahead (+) or behind (−) vs linear month-to-date expectation. */
  paceVariancePct: number;
};

/** Compare actual progress vs linear month-to-date expectation. */
export function evaluatePace(
  actual: number,
  target: number,
  monthKey: string | null = null,
  now = new Date(),
): PaceEvaluation {
  const progressPctVal = progressPct(actual, target);
  const wd = monthKey ? evaluateWorkingDayPace(monthKey, target, actual, now) : null;
  const expectedByToday = wd ? wd.dailyExpected : (target * monthProgressFraction(now));
  const expectedByNow = wd ? wd.expectedByNow : (target * monthProgressFraction(now));
  const expectedProgressPct = target > 0 ? Math.round((expectedByNow / target) * 100) : 0;
  const gap = gapRemaining(actual, target);

  const paceVariancePct =
    expectedByNow > 0
      ? Math.round(((actual - expectedByNow) / expectedByNow) * 1000) / 10
      : actual > 0
        ? 100
        : 0;

  if (target > 0 && actual >= target) {
    return {
      progressPct: progressPctVal,
      expectedByToday,
      expectedProgressPct,
      gap: 0,
      paceStatus: "Completed",
      paceVariancePct: Math.max(0, paceVariancePct),
    };
  }

  let paceStatus: PaceStatus;
  if (actual >= expectedByNow) {
    paceStatus = "On Track";
  } else if (actual >= expectedByNow * 0.75) {
    paceStatus = "Watch";
  } else {
    paceStatus = "Behind Pace";
  }

  return {
    progressPct: progressPctVal,
    expectedByToday,
    expectedProgressPct,
    gap,
    paceStatus,
    paceVariancePct,
  };
}

export function formatPaceVariance(pace: PaceEvaluation): {
  emoji: string;
  label: string;
  tone: "positive" | "negative" | "neutral";
} {
  if (pace.paceStatus === "Completed") {
    return { emoji: "🟢", label: "Target completed", tone: "positive" };
  }
  const v = pace.paceVariancePct;
  if (v >= 0) {
    return {
      emoji: "🟢",
      label: `+${Math.abs(v).toFixed(1)}% ahead of pace`,
      tone: "positive",
    };
  }
  return {
    emoji: "🔴",
    label: `${v.toFixed(1)}% vs pace`,
    tone: "negative",
  };
}

export const PACE_BADGE_CLASS: Record<PaceStatus, string> = {
  "On Track":
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  Watch: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  "Behind Pace": "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
  Completed:
    "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
};

export function progressBarGradient(pct: number): string {
  if (pct >= 100) return "from-violet-500 to-fuchsia-500";
  if (pct >= 67) return "from-emerald-500 to-green-400";
  if (pct >= 34) return "from-amber-400 to-yellow-400";
  return "from-orange-500 to-red-500";
}

type CampaignLike = {
  affiliateNetworkName?: string | null;
  batchAffiliateNetwork?: string | null;
  geo?: string | null;
  batchGeo?: string | null;
  status: string;
  campaignPurpose?: string | null;
};

export function isWorkingLiveCampaign(c: CampaignLike): boolean {
  return c.campaignPurpose === "working" && c.status === "live";
}

/** @deprecated Use resolveAffiliateNetwork from ops-network-attribution */
export function campaignNetwork(c: CampaignLike): string {
  const fromCampaign = c.affiliateNetworkName?.trim();
  if (fromCampaign) return fromCampaign;
  return c.batchAffiliateNetwork?.trim() || "(unset)";
}

/** @deprecated Use resolveCampaignGeo from ops-network-attribution */
export function campaignGeo(c: CampaignLike): string {
  return (c.geo ?? c.batchGeo)?.trim() || "(unset)";
}
