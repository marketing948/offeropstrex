/**
 * Daily Mission Board — progress/completion helpers for Today Focus (pure, testable).
 *
 * Does not fake completion. Testing and Working completions are counted separately
 * by campaign purpose. Missing purpose → do not count.
 */

import type {
  FocusActionType,
  FocusItem,
  MissionCategory,
  OpsCampaignRowLite,
  TodaysFocus,
} from "./ops-goal-focus.ts";

/** Narrow typed row for Mission Board completion math (Option B adapter). */
export type MissionCampaignRow = {
  id: number | null;
  campaignPurpose: "testing" | "working" | "scaling" | "unknown";
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  liveStartedAt: string | null;
  offerCount: number | null;
  network: string | null;
  geo: string | null;
  employeeId: number | null;
  employeeName: string | null;
};

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function asFiniteNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Safely extract Mission Board fields from API/campaign list rows.
 * Missing purpose → "unknown" (never counts toward Testing/Working completion).
 */
export function toMissionCampaignRow(raw: unknown): MissionCampaignRow | null {
  if (raw == null || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;

  const purposeRaw = asTrimmedString(c.campaignPurpose)?.toLowerCase() ?? "";
  let campaignPurpose: MissionCampaignRow["campaignPurpose"] = "unknown";
  if (purposeRaw === "testing" || purposeRaw === "test") campaignPurpose = "testing";
  else if (purposeRaw === "working") campaignPurpose = "working";
  else if (purposeRaw === "scaling") campaignPurpose = "scaling";

  const idNum = asFiniteNumber(c.id);
  const network =
    asTrimmedString(c.network) ??
    asTrimmedString(c.affiliateNetworkName) ??
    asTrimmedString(c.batchAffiliateNetwork) ??
    null;
  const geo =
    asTrimmedString(c.geo) ??
    asTrimmedString(c.batchGeo) ??
    null;
  const offerRaw = asFiniteNumber(c.offerCount);

  return {
    id: idNum != null && Number.isInteger(idNum) ? idNum : null,
    campaignPurpose,
    status: asTrimmedString(c.status)?.toLowerCase() ?? "",
    createdAt: asTrimmedString(c.createdAt),
    updatedAt: asTrimmedString(c.updatedAt),
    liveStartedAt: asTrimmedString(c.liveStartedAt),
    offerCount: offerRaw != null && offerRaw > 0 ? Math.round(offerRaw) : offerRaw === 0 ? 0 : null,
    network,
    geo,
    employeeId: (() => {
      const e = asFiniteNumber(c.employeeId);
      return e != null && Number.isInteger(e) ? e : null;
    })(),
    employeeName: asTrimmedString(c.employeeName),
  };
}

export function toMissionCampaignRows(
  rawList: unknown[] | OpsCampaignRowLite[] | null | undefined,
): MissionCampaignRow[] {
  if (!rawList?.length) return [];
  const out: MissionCampaignRow[] = [];
  for (const raw of rawList) {
    const row = toMissionCampaignRow(raw);
    if (row) out.push(row);
  }
  return out;
}

export type DailyMissionChip = {
  key: MissionCategory;
  label: string;
  completed: number;
  total: number;
};

export type DailyMissionBar = {
  completedActions: number;
  totalActions: number;
  progressPct: number;
  chips: DailyMissionChip[];
  employeeChips: { name: string; count: number }[];
  isSuccess: boolean;
};

export type DailyMissionRow = FocusItem & {
  priority: number;
  mission: {
    category: MissionCategory;
    categoryLabel: string;
    dailyTargetUnits: number;
    completedTodayUnits: number;
    canTrackCompletion: boolean;
    completionSource: "createdAt" | "updatedAt" | "none" | "advisory";
    completionLabel: string;
  };
};

export type CompletionCountResult = {
  count: number;
  source: "createdAt" | "updatedAt" | "none";
  scoped: "network_geo" | "worker" | "all";
};

export function isSameLocalDay(iso: string | null | undefined, now = new Date()): boolean {
  if (!iso?.trim()) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function parseTargetUnits(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(String(raw).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.round(n));
}

export function missionCategoryFor(actionType?: FocusActionType): MissionCategory {
  if (actionType === "testing_action") return "testing";
  if (actionType === "working_action") return "working";
  if (actionType === "scaling_opportunity") return "scaling";
  if (actionType === "campaign_health") return "fixes";
  if (actionType === "revenue_rescue") return "revenue";
  return "admin";
}

export function missionCategoryLabel(cat: MissionCategory): string {
  if (cat === "testing") return "Testing";
  if (cat === "working") return "Working";
  if (cat === "scaling") return "Scaling";
  if (cat === "fixes") return "Fixes";
  if (cat === "revenue") return "Revenue";
  return "Admin";
}

function networkMatches(a: string | null, b: string): boolean {
  if (!a) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function geoMatches(a: string | null, b?: string | null): boolean {
  if (!b?.trim()) return true;
  if (!a) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function matchesScope(
  c: MissionCampaignRow,
  opts: {
    network?: string;
    geo?: string | null;
    employeeId?: number | null;
    employeeName?: string | null;
  },
): boolean {
  if (opts.employeeId != null && c.employeeId != null && c.employeeId !== opts.employeeId) {
    return false;
  }
  if (
    opts.employeeName &&
    c.employeeName &&
    c.employeeName.trim().toLowerCase() !== opts.employeeName.trim().toLowerCase()
  ) {
    return false;
  }
  if (opts.network) {
    if (!networkMatches(c.network, opts.network)) return false;
    if (!geoMatches(c.geo, opts.geo)) return false;
  }
  return true;
}

function scopedLabel(opts: {
  network?: string;
  employeeId?: number | null;
  employeeName?: string | null;
}): CompletionCountResult["scoped"] {
  if (opts.network) return "network_geo";
  if (opts.employeeId != null || opts.employeeName) return "worker";
  return "all";
}

/**
 * Testing mission completion: only purpose === testing, created today.
 * Prefer createdAt; fall back to liveStartedAt only when createdAt is missing.
 * Unknown / working / scaling purpose → never counted.
 */
export function countTestingCreatedToday(
  campaigns: MissionCampaignRow[] | OpsCampaignRowLite[],
  opts: {
    now?: Date;
    network?: string;
    geo?: string | null;
    employeeId?: number | null;
    employeeName?: string | null;
  } = {},
): CompletionCountResult {
  const now = opts.now ?? new Date();
  const rows = toMissionCampaignRows(campaigns);
  let matched = 0;
  let usedReliableStamp = false;

  for (const c of rows) {
    if (c.campaignPurpose !== "testing") continue;
    if (!matchesScope(c, opts)) continue;

    const stamp = c.createdAt || c.liveStartedAt;
    if (!stamp || !isSameLocalDay(stamp, now)) continue;
    usedReliableStamp = true;
    matched++;
  }

  if (!usedReliableStamp && matched === 0) {
    return { count: 0, source: "none", scoped: scopedLabel(opts) };
  }

  return {
    count: matched,
    source: matched > 0 ? "createdAt" : "none",
    scoped: scopedLabel(opts),
  };
}

/** Testing campaigns created today for a worker (real completion source). */
export function getTestingCampaignsCreatedToday(
  campaigns: MissionCampaignRow[] | OpsCampaignRowLite[],
  opts: { employeeId?: number | null; now?: Date } = {},
): MissionCampaignRow[] {
  const now = opts.now ?? new Date();
  return toMissionCampaignRows(campaigns).filter((c) => {
    if (c.campaignPurpose !== "testing") return false;
    if (
      opts.employeeId != null &&
      c.employeeId != null &&
      c.employeeId !== opts.employeeId
    ) {
      return false;
    }
    const stamp = c.createdAt || c.liveStartedAt;
    return Boolean(stamp && isSameLocalDay(stamp, now));
  });
}

/** At least one testing campaign created today for this network + GEO. */
export function isGeoCompletedToday(
  campaigns: MissionCampaignRow[] | OpsCampaignRowLite[],
  network: string,
  geo: string,
  opts: { employeeId?: number | null; now?: Date } = {},
): boolean {
  return (
    countTestingCreatedToday(campaigns, { ...opts, network, geo }).count > 0
  );
}

/** Per-network count of GEOs with at least one testing campaign created today. */
export function countCompletedGeosTodayFromCampaigns(
  plan: { testingNetworks: { network: string; geos: { geo: string; todayRequired: number }[] }[] },
  campaigns: MissionCampaignRow[] | OpsCampaignRowLite[],
  opts: { employeeId?: number | null; now?: Date } = {},
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const net of plan.testingNetworks) {
    result[net.network] = net.geos.filter(
      (g) =>
        g.todayRequired > 0 &&
        isGeoCompletedToday(campaigns, net.network, g.geo, opts),
    ).length;
  }
  return result;
}

/**
 * Working mission completion: only purpose === working (or scaling live launches),
 * not testing. Prefer createdAt today; else liveStartedAt today; else updatedAt today
 * only when purpose is clearly working/scaling.
 * Unknown purpose → never counted.
 */
export function countWorkingCreatedToday(
  campaigns: MissionCampaignRow[] | OpsCampaignRowLite[],
  opts: {
    now?: Date;
    network?: string;
    geo?: string | null;
    employeeId?: number | null;
    employeeName?: string | null;
  } = {},
): CompletionCountResult {
  const now = opts.now ?? new Date();
  const rows = toMissionCampaignRows(campaigns);
  let matched = 0;
  let usedReliableStamp = false;

  for (const c of rows) {
    if (c.campaignPurpose !== "working" && c.campaignPurpose !== "scaling") continue;
    if (c.campaignPurpose === "testing") continue;
    if (!matchesScope(c, opts)) continue;

    const stamp = c.createdAt || c.liveStartedAt || null;
    if (stamp && isSameLocalDay(stamp, now)) {
      usedReliableStamp = true;
      matched++;
      continue;
    }
    // updatedAt alone is weaker — only accept when purpose is working/scaling and status live
    if (c.updatedAt && isSameLocalDay(c.updatedAt, now) && c.status === "live") {
      usedReliableStamp = true;
      matched++;
    }
  }

  if (!usedReliableStamp && matched === 0) {
    return { count: 0, source: "none", scoped: scopedLabel(opts) };
  }

  return {
    count: matched,
    source: matched > 0 ? "createdAt" : "none",
    scoped: scopedLabel(opts),
  };
}

/**
 * Missing offer count: working/scaling live with offerCount > 0 and updatedAt today.
 */
export function countOfferCountFixedToday(
  campaigns: MissionCampaignRow[] | OpsCampaignRowLite[],
  opts: {
    now?: Date;
    campaignIds?: number[];
    employeeId?: number | null;
    network?: string;
    geo?: string | null;
  } = {},
): { count: number; source: "updatedAt" | "none"; hasUpdatedAt: boolean } {
  const now = opts.now ?? new Date();
  const rows = toMissionCampaignRows(campaigns);
  const idSet = opts.campaignIds?.length ? new Set(opts.campaignIds) : null;
  let hasUpdatedAt = false;
  let matched = 0;

  for (const c of rows) {
    if (idSet && (c.id == null || !idSet.has(c.id))) continue;
    if (opts.employeeId != null && c.employeeId != null && c.employeeId !== opts.employeeId) {
      continue;
    }
    if (opts.network && !matchesScope(c, { network: opts.network, geo: opts.geo })) {
      continue;
    }
    if (!(c.campaignPurpose === "working" || c.campaignPurpose === "scaling")) continue;
    if (c.status !== "live") continue;
    if (c.updatedAt) hasUpdatedAt = true;
    if (!(c.offerCount != null && c.offerCount > 0)) continue;
    if (!isSameLocalDay(c.updatedAt, now)) continue;
    matched++;
  }

  return {
    count: matched,
    source: hasUpdatedAt ? "updatedAt" : "none",
    hasUpdatedAt,
  };
}

function resolveDailyTarget(item: FocusItem): number {
  const ctx = item.context;
  if (ctx?.dailyTargetUnits != null && ctx.dailyTargetUnits > 0) {
    return Math.round(ctx.dailyTargetUnits);
  }
  if (ctx?.actionType === "campaign_health") {
    const fromMetric = Number(ctx.metricValue ?? 0);
    if (fromMetric > 0) return Math.round(fromMetric);
    return Math.max(1, ctx.campaignIds?.length ?? 1);
  }
  if (ctx?.actionType === "scaling_opportunity") {
    const fromMetric = Number(ctx.metricValue ?? 0);
    if (fromMetric > 0) return Math.round(fromMetric);
    return Math.max(1, ctx.campaignIds?.length ?? 1);
  }
  if (ctx?.actionType === "revenue_rescue" || ctx?.actionType === "admin_intervention") {
    return 1;
  }
  if (ctx?.allocationLines?.length) {
    const sum = ctx.allocationLines.reduce((s, line) => {
      const m = line.match(/:\s*(\d+)\s*$/);
      return s + (m ? Number(m[1]) : 0);
    }, 0);
    if (sum > 0) return sum;
  }
  const fromToday = parseTargetUnits(ctx?.todayTarget);
  if (fromToday != null) return fromToday;
  return 1;
}

function enrichMissionRow(
  item: FocusItem,
  priority: number,
  campaigns: MissionCampaignRow[],
  opts: {
    now?: Date;
    employeeId?: number | null;
    isAdminAllEmployees?: boolean;
  },
): DailyMissionRow {
  const actionType = item.context?.actionType;
  const category = item.context?.missionCategory ?? missionCategoryFor(actionType);
  const dailyTargetUnits = resolveDailyTarget(item);
  let completedTodayUnits = 0;
  let canTrackCompletion = false;
  let completionSource: DailyMissionRow["mission"]["completionSource"] = "none";
  let completionLabel = "Still requires action";

  if (item.title === "On pace" || item.title === "Team on pace" || item.title === "No goals set") {
    return {
      ...item,
      priority,
      mission: {
        category,
        categoryLabel: missionCategoryLabel(category),
        dailyTargetUnits: 0,
        completedTodayUnits: 0,
        canTrackCompletion: true,
        completionSource: "advisory",
        completionLabel: "On pace",
      },
    };
  }

  const scopeOpts = {
    now: opts.now,
    network: item.context?.network,
    geo: item.context?.geo,
    employeeId: opts.employeeId,
    employeeName: opts.isAdminAllEmployees ? item.context?.employeeName : undefined,
  };

  if (actionType === "testing_action") {
    const created = countTestingCreatedToday(campaigns, scopeOpts);
    if (created.source === "createdAt") {
      canTrackCompletion = true;
      completionSource = "createdAt";
      completedTodayUnits = Math.min(dailyTargetUnits, created.count);
      completionLabel =
        created.scoped === "network_geo"
          ? `${completedTodayUnits} testing created today (Network/GEO)`
          : `${completedTodayUnits} testing created today`;
    } else {
      completionLabel = "Month progress vs today’s expected pace";
      completionSource = "none";
      canTrackCompletion = false;
    }
  } else if (actionType === "working_action") {
    const created = countWorkingCreatedToday(campaigns, scopeOpts);
    if (created.source === "createdAt") {
      canTrackCompletion = true;
      completionSource = "createdAt";
      completedTodayUnits = Math.min(dailyTargetUnits, created.count);
      completionLabel =
        created.scoped === "network_geo"
          ? `${completedTodayUnits} working launched today (Network/GEO)`
          : `${completedTodayUnits} working launched today`;
    } else {
      completionLabel = "Month progress vs today’s expected pace";
      completionSource = "none";
      canTrackCompletion = false;
    }
  } else if (actionType === "campaign_health") {
    const fixed = countOfferCountFixedToday(campaigns, {
      now: opts.now,
      campaignIds: item.context?.campaignIds,
      employeeId: opts.employeeId,
      network: item.context?.network,
      geo: item.context?.geo,
    });
    if (fixed.hasUpdatedAt) {
      canTrackCompletion = true;
      completionSource = "updatedAt";
      completedTodayUnits = Math.min(dailyTargetUnits, fixed.count);
      completionLabel =
        completedTodayUnits > 0
          ? `${completedTodayUnits} fixed today`
          : "Still requires action";
    } else {
      canTrackCompletion = false;
      completionSource = "none";
      completionLabel = "Still requires action";
    }
  } else if (actionType === "scaling_opportunity") {
    canTrackCompletion = false;
    completionSource = "advisory";
    completedTodayUnits = 0;
    completionLabel = "Review recommended";
  } else if (actionType === "revenue_rescue") {
    canTrackCompletion = false;
    completionSource = "advisory";
    completedTodayUnits = 0;
    completionLabel = "Advisory — check revenue drivers";
  } else {
    canTrackCompletion = false;
    completionSource = "advisory";
    completedTodayUnits = 0;
    completionLabel = item.context?.actionLabel ?? "Needs attention";
  }

  if (item.context?.completedTodayUnits != null && item.context.canTrackCompletion) {
    completedTodayUnits = Math.min(dailyTargetUnits, Math.max(0, item.context.completedTodayUnits));
    canTrackCompletion = true;
    completionSource = item.context.completionSource ?? completionSource;
    completionLabel = item.context.completionLabel ?? completionLabel;
  }

  return {
    ...item,
    priority,
    context: {
      ...item.context,
      dailyTargetUnits,
      completedTodayUnits,
      missionCategory: category,
      canTrackCompletion,
      completionSource,
      completionLabel,
    },
    mission: {
      category,
      categoryLabel: missionCategoryLabel(category),
      dailyTargetUnits,
      completedTodayUnits,
      canTrackCompletion,
      completionSource,
      completionLabel,
    },
  };
}

export function buildDailyMissionRows(
  focus: TodaysFocus,
  campaigns: OpsCampaignRowLite[] | MissionCampaignRow[] | unknown[] = [],
  opts: {
    now?: Date;
    employeeId?: number | null;
    isAdminAllEmployees?: boolean;
  } = {},
): DailyMissionRow[] {
  const normalized = toMissionCampaignRows(campaigns);
  const items = focus.empty ? [] : focus.items.slice(0, 5);
  return items
    .filter((i) => i.title !== "On pace" && i.title !== "Team on pace")
    .map((item, i) => enrichMissionRow(item, i + 1, normalized, opts));
}

export function computeDailyMissionBar(rows: DailyMissionRow[]): DailyMissionBar {
  let completedActions = 0;
  let totalActions = 0;
  const chipMap = new Map<MissionCategory, { completed: number; total: number }>();
  const empMap = new Map<string, number>();

  for (const row of rows) {
    const target = Math.max(0, row.mission.dailyTargetUnits);
    if (target <= 0) continue;
    const completed = row.mission.canTrackCompletion
      ? Math.min(target, Math.max(0, row.mission.completedTodayUnits))
      : 0;
    totalActions += target;
    completedActions += completed;

    const cat = row.mission.category;
    const cur = chipMap.get(cat) ?? { completed: 0, total: 0 };
    cur.total += target;
    cur.completed += completed;
    chipMap.set(cat, cur);

    const emp = row.context?.employeeName?.trim();
    if (emp) empMap.set(emp, (empMap.get(emp) ?? 0) + 1);
  }

  completedActions = Math.min(completedActions, totalActions);
  const progressPct =
    totalActions <= 0 ? 100 : Math.min(100, Math.round((completedActions / totalActions) * 100));

  const chipOrder: MissionCategory[] = ["testing", "working", "fixes", "scaling", "revenue", "admin"];
  const chips: DailyMissionChip[] = chipOrder
    .filter((k) => chipMap.has(k))
    .map((k) => {
      const v = chipMap.get(k)!;
      return {
        key: k,
        label: missionCategoryLabel(k),
        completed: Math.min(v.completed, v.total),
        total: v.total,
      };
    });

  const employeeChips = [...empMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    completedActions,
    totalActions,
    progressPct,
    chips,
    employeeChips,
    isSuccess: totalActions === 0 || completedActions >= totalActions,
  };
}

export type MissionBoardHeader = {
  title: string;
  subtitle: string;
};

export function buildMissionBoardHeader(opts: {
  isWorker: boolean;
  isAdminAllEmployees: boolean;
  employeeName?: string | null;
  bar: DailyMissionBar;
  visibleRows: number;
}): MissionBoardHeader {
  if (opts.isAdminAllEmployees) {
    return {
      title: "Team intervention focus",
      subtitle:
        opts.bar.totalActions > 0
          ? `${opts.visibleRows} priority action${opts.visibleRows === 1 ? "" : "s"} need attention today`
          : "No urgent interventions right now.",
    };
  }
  const name = opts.employeeName?.trim();
  if (name && !opts.isWorker) {
    return {
      title: `${name}’s daily missions`,
      subtitle: "Complete daily missions to stay on pace.",
    };
  }
  if (name) {
    const left = Math.max(0, opts.bar.totalActions - opts.bar.completedActions);
    return {
      title: "Today Focus",
      subtitle:
        left > 0
          ? `${name}, complete ${left} action${left === 1 ? "" : "s"} to stay on pace today`
          : `${name}, you’re on pace today.`,
    };
  }
  return {
    title: "Today Focus",
    subtitle: "Complete your daily missions to stay on pace.",
  };
}
