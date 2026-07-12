/**
 * "Done for today" worker convenience layer (pure, testable).
 *
 * This is NOT campaign truth. It only records that a worker chose to dismiss /
 * complete a Daily Mission row for the current day. State is worker-scoped and
 * date-scoped; the persistence adapter (localStorage) lives in
 * use-daily-mission-completion.ts. These pure helpers make the logic testable
 * without a DOM/localStorage.
 */

import type {
  DailyActionPlan,
  OptimizationGroup,
  ScalingCandidate,
  ShutdownCandidate,
  TestingNetworkPlan,
} from "./monthly-goal-daily-plan.ts";
import type { OpsCampaignRowLite } from "./ops-goal-focus.ts";
import {
  canonicalGeoKey,
  canonicalNetworkKey,
  isSameLocalDay,
  toMissionCampaignRow,
} from "./daily-mission-board.ts";
import { geoCodeText } from "../../lib/geo-flag.ts";

type TestingGeo = TestingNetworkPlan["geos"][number];

/** Stable, human-debuggable keys for each dismissible mission row. */
export function testingNetworkKey(network: string): string {
  return `t:net:${network.trim().toLowerCase()}`;
}

export function testingGeoKey(network: string, geo: string): string {
  return `t:geo:${network.trim().toLowerCase()}:${geo.trim().toLowerCase()}`;
}

export function optimizationKey(issueType: string): string {
  return `o:${issueType}`;
}

export function scalingKey(kind: string, id: number | string): string {
  return `s:${kind}:${id}`;
}

export function shutdownKey(id: number | string): string {
  return `x:${id}`;
}

/** Local calendar day key (YYYY-MM-DD) used to scope completion to "today". */
export function localDayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Per-network GEO rotation memory for reuse fallback (count + last used). */
export type GeoUsageEntry = {
  count: number;
  lastUsedAt: number;
};

export type GeoUsageToday = Record<string, Record<string, GeoUsageEntry>>;

function normalizeGeoUsage(raw: unknown): GeoUsageToday {
  if (!raw || typeof raw !== "object") return {};
  const out: GeoUsageToday = {};
  for (const [net, geos] of Object.entries(raw as Record<string, unknown>)) {
    if (!geos || typeof geos !== "object") continue;
    out[net] = {};
    for (const [geo, val] of Object.entries(geos as Record<string, unknown>)) {
      if (typeof val === "number") {
        // Legacy shape: plain count → migrate to entry (no last-used yet).
        out[net][geo] = { count: val, lastUsedAt: 0 };
      } else if (val && typeof val === "object") {
        const e = val as { count?: number; lastUsedAt?: number };
        out[net][geo] = {
          count: Number(e.count ?? 0),
          lastUsedAt: Number(e.lastUsedAt ?? 0),
        };
      }
    }
  }
  return out;
}

export type MissionCompletionState = {
  /** Local day these completions belong to. Stale days are discarded on load. */
  day: string;
  /** Row keys the worker marked done for today. */
  done: string[];
  /** How many times each GEO has been completed today (drives reuse fallback). */
  geoUsageToday: GeoUsageToday;
  /** Optional-opportunity completions per network (bonus only, not progress). */
  extraCompletionsToday?: Record<string, number>;
  /** GEO codes already surfaced in the UI today (rotation pool — not shuffle). */
  seenGeosToday?: Record<string, string[]>;
  /** Last few GEO codes shown per network (anti-repeat in reuse mode). */
  recentGeos?: Record<string, string[]>;
};

/** Sliding memory of recently shown GEOs per network (reuse anti-repeat). */
export const MAX_RECENT_GEOS = 3;

export function emptyCompletion(now = new Date()): MissionCompletionState {
  return {
    day: localDayKey(now),
    done: [],
    geoUsageToday: {},
    extraCompletionsToday: {},
    seenGeosToday: {},
    recentGeos: {},
  };
}

/** Admin / read-only views — never inherit worker local completion state. */
export function createEmptyMissionState(now = new Date()): MissionCompletionState {
  return emptyCompletion(now);
}

function coalesceState(
  state: MissionCompletionState | null | undefined,
  now = new Date(),
): MissionCompletionState {
  if (!state) return emptyCompletion(now);
  return state;
}

/** Drop completions from a previous day so "done for today" never leaks over. */
export function normalizeForToday(
  state: MissionCompletionState | null | undefined,
  now = new Date(),
): MissionCompletionState {
  const today = localDayKey(now);
  if (!state || state.day !== today || !Array.isArray(state.done)) {
    return {
      day: today,
      done: [],
      geoUsageToday: {},
      extraCompletionsToday: {},
      seenGeosToday: {},
      recentGeos: {},
    };
  }
  const usage = normalizeGeoUsage(state.geoUsageToday);
  const extra = state.extraCompletionsToday ?? {};
  const seen = state.seenGeosToday ?? {};
  const recent = state.recentGeos ?? {};
  return {
    day: today,
    done: [...new Set(state.done)],
    geoUsageToday: usage,
    extraCompletionsToday: { ...extra },
    seenGeosToday: Object.fromEntries(
      Object.entries(seen).map(([net, geos]) => [net, [...new Set(geos)]]),
    ),
    recentGeos: Object.fromEntries(
      Object.entries(recent).map(([net, geos]) => [
        net,
        geos.slice(-MAX_RECENT_GEOS),
      ]),
    ),
  };
}

export function isDone(state: MissionCompletionState, key: string): boolean {
  return state.done.includes(key);
}

export function toggleDone(
  state: MissionCompletionState,
  key: string,
  now = new Date(),
): MissionCompletionState {
  const base = normalizeForToday(state, now);
  const set = new Set(base.done);
  const wasDone = set.has(key);
  if (wasDone) set.delete(key);
  else set.add(key);
  const seen = { ...(base.seenGeosToday ?? {}) };
  const recent = { ...(base.recentGeos ?? {}) };
  if (!wasDone && key.startsWith("t:net:")) {
    const nk = key.slice("t:net:".length);
    delete seen[nk];
    delete recent[nk];
  }
  return {
    day: base.day,
    done: [...set],
    geoUsageToday: base.geoUsageToday,
    extraCompletionsToday: base.extraCompletionsToday,
    seenGeosToday: seen,
    recentGeos: recent,
  };
}

function usageNetKey(network: string): string {
  return network.trim().toLowerCase();
}

function usageGeoKey(geo: string): string {
  return geo.trim().toLowerCase();
}

/** How many times a GEO was completed / focused today (0 if never). */
export function geoUsageCount(
  state: MissionCompletionState,
  network: string,
  geo: string,
): number {
  return state.geoUsageToday?.[usageNetKey(network)]?.[usageGeoKey(geo)]?.count ?? 0;
}

/** When a GEO was last completed / focused (ms epoch, 0 if never). */
export function geoUsageLastUsedAt(
  state: MissionCompletionState,
  network: string,
  geo: string,
): number {
  return state.geoUsageToday?.[usageNetKey(network)]?.[usageGeoKey(geo)]?.lastUsedAt ?? 0;
}

/** Increment today's usage counter for a GEO (immutable). */
export function recordGeoUsage(
  state: MissionCompletionState,
  network: string,
  geo: string,
  now = new Date(),
): MissionCompletionState {
  const base = normalizeForToday(state, now);
  const nk = usageNetKey(network);
  const gk = usageGeoKey(geo);
  const usage: GeoUsageToday = { ...base.geoUsageToday };
  const net = { ...(usage[nk] ?? {}) };
  const prev = net[gk] ?? { count: 0, lastUsedAt: 0 };
  net[gk] = { count: prev.count + 1, lastUsedAt: now.getTime() };
  usage[nk] = net;
  return { ...base, geoUsageToday: usage, seenGeosToday: base.seenGeosToday ?? {}, recentGeos: base.recentGeos ?? {} };
}

/**
 * One-way GEO completion used by the focus card's ✔: marks the GEO done for
 * today (idempotent) AND increments its usage counter so the auto/refresh queue
 * advances and the reuse fallback prefers variety. Never removes work.
 */
export function completeGeo(
  state: MissionCompletionState,
  network: string,
  geo: string,
  now = new Date(),
): MissionCompletionState {
  const withUsage = recordGeoUsage(state, network, geo, now);
  const key = testingGeoKey(network, geo);
  if (withUsage.done.includes(key)) return withUsage;
  return {
    ...withUsage,
    done: [...withUsage.done, key],
    seenGeosToday: withUsage.seenGeosToday ?? {},
    recentGeos: withUsage.recentGeos ?? {},
  };
}

/**
 * Bonus GEO completion — records usage only, never marks done or affects
 * daily target progress (safe for optional opportunities after 3/3).
 */
export function completeExtraGeo(
  state: MissionCompletionState,
  network: string,
  geo: string,
  now = new Date(),
): MissionCompletionState {
  const withUsage = recordGeoUsage(state, network, geo, now);
  const base = normalizeForToday(withUsage, now);
  const nk = usageNetKey(network);
  const extra = { ...(base.extraCompletionsToday ?? {}) };
  extra[nk] = (extra[nk] ?? 0) + 1;
  return {
    ...base,
    extraCompletionsToday: extra,
    seenGeosToday: base.seenGeosToday ?? {},
    recentGeos: base.recentGeos ?? {},
  };
}

/** Soft cap on optional opportunities per network per day. */
export const MAX_EXTRA_PER_NETWORK = 3;

export function countExtraCompletionsToday(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
): number {
  return state.extraCompletionsToday?.[usageNetKey(net.network)] ?? 0;
}

export function isExtraLimitReached(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
): boolean {
  return countExtraCompletionsToday(net, state) >= MAX_EXTRA_PER_NETWORK;
}

/** Auto extra flow: target met and still room for optional opportunities. */
export function isAutoExtraModeActive(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
): boolean {
  return isTestingNetworkDailyTargetMet(net, state) && !isExtraLimitReached(net, state);
}

export type EffectiveSummary = {
  testsRequired: number;
  testsDone: number;
  optimizationsRequired: number;
  optimizationsDone: number;
  scalingAdvisory: number;
  scalingDone: number;
  shutdownAdvisory: number;
  shutdownDone: number;
  completed: number;
  total: number;
  progressPct: number;
};

function testingNetworkEffectiveDone(
  net: TestingNetworkPlan,
  done: Set<string>,
): number {
  if (done.has(testingNetworkKey(net.network))) return net.todayRequired;
  let sum = 0;
  for (const g of net.geos) {
    if (done.has(testingGeoKey(net.network, g.geo))) sum += g.todayRequired;
    else sum += g.doneToday;
  }
  return Math.min(net.todayRequired, sum);
}

/** How many of today's required tests are done for this network (manual + timestamp). */
export function countCompletedGeosToday(
  net: TestingNetworkPlan,
  state: MissionCompletionState | null | undefined,
): number {
  const s = coalesceState(state);
  return testingNetworkEffectiveDone(net, new Set(s.done));
}

/** Whether the worker hit today's test target for this network. */
export function isTestingNetworkDailyTargetMet(
  net: TestingNetworkPlan,
  state: MissionCompletionState | null | undefined,
): boolean {
  if (net.todayRequired <= 0) return true;
  return countCompletedGeosToday(net, state) >= net.todayRequired;
}

function optimizationEffectiveDone(g: OptimizationGroup, done: Set<string>): number {
  if (done.has(optimizationKey(g.issueType))) return g.required;
  return g.canTrackCompletion ? Math.min(g.required, g.doneToday) : 0;
}

function scalingEffectiveDone(
  candidates: ScalingCandidate[],
  done: Set<string>,
): number {
  let n = 0;
  for (const c of candidates) {
    if (done.has(scalingKey(c.kind, c.id))) n++;
  }
  return n;
}

/** Whether the worker explicitly dismissed the whole network for today. */
export function isTestingNetworkDismissed(
  network: string,
  state: MissionCompletionState,
): boolean {
  return state.done.includes(testingNetworkKey(network));
}

/**
 * Whether a testing network should stay visible in the Daily Mission queue.
 * Stays up until network-dismissed — including when today's target is met (locked
 * "Done for today" state until the worker dismisses the card).
 */
export function isTestingNetworkVisible(
  net: TestingNetworkPlan,
  state: MissionCompletionState | null | undefined,
): boolean {
  const s = coalesceState(state);
  if (isTestingNetworkDismissed(net.network, s)) return false;
  return net.geos.some((g) => g.todayRequired > 0);
}

/** A testing network is complete when its effective done meets today's requirement. */
export function isTestingNetworkComplete(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
): boolean {
  return isTestingNetworkDailyTargetMet(net, state);
}

/** A GEO row is complete when marked done (network or geo) or timestamp-done meets its quota. */
export function isTestingGeoComplete(
  network: string,
  geo: { geo: string; todayRequired: number; doneToday: number },
  state: MissionCompletionState,
): boolean {
  const done = new Set(state.done);
  if (done.has(testingNetworkKey(network))) return true;
  if (done.has(testingGeoKey(network, geo.geo))) return true;
  return geo.todayRequired > 0 && geo.doneToday >= geo.todayRequired;
}

export function isOptimizationComplete(
  group: OptimizationGroup,
  state: MissionCompletionState,
): boolean {
  if (state.done.includes(optimizationKey(group.issueType))) return true;
  return group.canTrackCompletion && group.required > 0 && group.doneToday >= group.required;
}

export function isScalingComplete(
  candidate: ScalingCandidate,
  state: MissionCompletionState,
): boolean {
  return state.done.includes(scalingKey(candidate.kind, candidate.id));
}

export function isShutdownComplete(
  candidate: ShutdownCandidate,
  state: MissionCompletionState,
): boolean {
  return state.done.includes(shutdownKey(candidate.id));
}

/** GEOs with work today that are NOT completed yet. */
export function getActiveGeos(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
): TestingGeo[] {
  return net.geos.filter(
    (g) => g.todayRequired > 0 && !isTestingGeoComplete(net.network, g, state),
  );
}

/** GEOs eligible for reuse once every active GEO is completed today. */
export function getReuseGeos(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
): TestingGeo[] {
  return net.geos.filter(
    (g) => g.todayRequired > 0 && isTestingGeoComplete(net.network, g, state),
  );
}

/** Whether focus selection is in reuse mode (active pool exhausted, target not yet met). */
export function isNetworkFocusReuseMode(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
): boolean {
  if (isTestingNetworkDailyTargetMet(net, state)) return false;
  const eligible = net.geos.filter((g) => g.todayRequired > 0);
  if (eligible.length === 0) return false;
  return getActiveGeos(net, state).length === 0;
}

/** Timestamps within this window are treated as "equal" → light variety shuffle. */
const REUSE_TIMESTAMP_CLOSE_MS = 60_000;

/** Stable pseudo-random tiebreaker (testable, not Math.random). */
export function hashGeo(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

function uniqueGeosByCode(geos: TestingGeo[]): TestingGeo[] {
  const seen = new Set<string>();
  const out: TestingGeo[] = [];
  for (const g of geos) {
    const key = g.geo.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

/** Priority sort for a GEO list: behind pace first, seed shuffles ties. */
export function orderGeosByTestingPriority(
  geos: TestingGeo[],
  seed = 0,
): TestingGeo[] {
  return [...geos].sort((a, b) => {
    const base =
      b.gapToPace - a.gapToPace ||
      b.remaining - a.remaining;
    if (base !== 0) return base;
    return hashGeo(a.geo + seed) - hashGeo(b.geo + seed);
  });
}

/** Reuse pool: least-used first, then oldest lastUsedAt, then seed tiebreak. */
export function orderByLeastUsed(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
  geos: TestingGeo[],
  seed = 0,
): TestingGeo[] {
  const sorted = [...geos].sort((a, b) => {
    const ua = geoUsageCount(state, net.network, a.geo);
    const ub = geoUsageCount(state, net.network, b.geo);
    if (ua !== ub) return ua - ub;
    const ta = geoUsageLastUsedAt(state, net.network, a.geo);
    const tb = geoUsageLastUsedAt(state, net.network, b.geo);
    if (ta !== tb) return ta - tb;
    return hashGeo(a.geo + seed) - hashGeo(b.geo + seed);
  });
  if (reuseStatsTied(state, net.network, geos)) {
    return varietyShuffle(sorted, seed);
  }
  return sorted;
}

function rotateGeosBySeed(geos: TestingGeo[], seed: number): TestingGeo[] {
  if (geos.length <= 1 || seed === 0) return geos;
  const offset = seed % geos.length;
  return [...geos.slice(offset), ...geos.slice(0, offset)];
}

/** GEO codes already shown in the mission UI for this network today. */
export function getSeenGeosToday(
  state: MissionCompletionState,
  network: string,
): Set<string> {
  const list = state.seenGeosToday?.[usageNetKey(network)] ?? [];
  return new Set(list);
}

export function isGeoSeenToday(
  state: MissionCompletionState,
  network: string,
  geo: string,
): boolean {
  return getSeenGeosToday(state, network).has(usageGeoKey(geo));
}

/** Keep GEOs not yet surfaced today (real rotation pool). */
export function filterUnseenGeos(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
  geos: TestingGeo[],
): TestingGeo[] {
  const seen = getSeenGeosToday(state, net.network);
  return geos.filter((g) => !seen.has(usageGeoKey(g.geo)));
}

/** Last GEO codes shown for this network (newest last, max {@link MAX_RECENT_GEOS}). */
export function getRecentGeos(
  state: MissionCompletionState,
  network: string,
): string[] {
  return state.recentGeos?.[usageNetKey(network)] ?? [];
}

/** Append shown GEOs to the recent buffer (FIFO trim). */
export function appendRecentGeos(
  state: MissionCompletionState,
  network: string,
  geos: string[],
): MissionCompletionState {
  if (geos.length === 0) return state;
  const nk = usageNetKey(network);
  const recent = { ...(state.recentGeos ?? {}) };
  const queue = [...(recent[nk] ?? [])];
  for (const g of geos) queue.push(usageGeoKey(g));
  recent[nk] = queue.slice(-MAX_RECENT_GEOS);
  return { ...state, recentGeos: recent };
}

/**
 * Reuse pool minus recently shown GEOs. If that would empty the pool, fall back
 * to the full pool (network has too few GEOs to avoid repeats).
 */
export function filterNotRecentGeos(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
  geos: TestingGeo[],
): TestingGeo[] {
  const recent = new Set(getRecentGeos(state, net.network));
  if (recent.size === 0 || geos.length === 0) return geos;
  const filtered = geos.filter((g) => !recent.has(usageGeoKey(g.geo)));
  return filtered.length > 0 ? filtered : geos;
}

function selectFromReusePool(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
  pool: TestingGeo[],
  limit: number,
): TestingGeo[] {
  if (pool.length === 0) return [];
  const antiRepeat = filterNotRecentGeos(net, state, pool);
  return uniqueGeosByCode(orderByLeastUsed(net, state, antiRepeat, 0)).slice(
    0,
    limit,
  );
}

/** Record GEOs surfaced in the UI (anti-repeat memory only). */
export function recordGeosShown(
  state: MissionCompletionState,
  network: string,
  geos: string[],
  now = new Date(),
): MissionCompletionState {
  return appendRecentGeos(normalizeForToday(state, now), network, geos);
}

/** Record GEOs returned to the UI so refresh advances to the next unseen batch. */
export function markGeosSeen(
  state: MissionCompletionState,
  network: string,
  geos: string[],
  now = new Date(),
): MissionCompletionState {
  const base = normalizeForToday(state, now);
  if (geos.length === 0) return base;
  const nk = usageNetKey(network);
  const seen = { ...(base.seenGeosToday ?? {}) };
  const set = new Set(seen[nk] ?? []);
  for (const g of geos) set.add(usageGeoKey(g));
  seen[nk] = [...set];
  return { ...base, seenGeosToday: seen };
}

export function clearSeenGeosForNetwork(
  state: MissionCompletionState,
  network: string,
  now = new Date(),
): MissionCompletionState {
  const base = normalizeForToday(state, now);
  const nk = usageNetKey(network);
  const seen = { ...(base.seenGeosToday ?? {}) };
  const recent = { ...(base.recentGeos ?? {}) };
  delete seen[nk];
  delete recent[nk];
  return { ...base, seenGeosToday: seen, recentGeos: recent };
}

function pickUnseenThenFallback(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
  limit: number,
  primary: TestingGeo[],
  fallback: TestingGeo[],
): TestingGeo[] {
  const unseenPrimary = filterUnseenGeos(net, state, primary);
  if (unseenPrimary.length > 0) {
    return uniqueGeosByCode(orderGeosByTestingPriority(unseenPrimary, 0)).slice(0, limit);
  }
  const unseenFallback = filterUnseenGeos(net, state, fallback);
  const pool = unseenFallback.length > 0 ? unseenFallback : fallback;
  return selectFromReusePool(net, state, pool, limit);
}

/** GEOs with zero usage today — never opened in this session. */
export function getUntouchedGeosToday(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
): TestingGeo[] {
  return net.geos.filter(
    (g) =>
      g.todayRequired > 0 &&
      geoUsageCount(state, net.network, g.geo) === 0,
  );
}

/**
 * Future-ready proxy for historical winner signal (higher = stronger track record).
 * Uses progress vs expected pace until dedicated performance fields exist.
 */
export function geoHistoricalScore(geo: TestingGeo): number {
  return geo.current - geo.expectedByNow;
}

function orderGeosByHistoricalPerformance(geos: TestingGeo[]): TestingGeo[] {
  return [...geos].sort((a, b) => geoHistoricalScore(b) - geoHistoricalScore(a));
}

function pickExtraGeoPool(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
  eligible: TestingGeo[],
): TestingGeo[] {
  const performers = orderGeosByHistoricalPerformance(eligible).filter(
    (g) => geoHistoricalScore(g) > 0,
  );
  const base = performers.length > 0 ? performers : eligible;
  const untouched = base.filter(
    (g) => geoUsageCount(state, net.network, g.geo) === 0,
  );
  return untouched.length > 0 ? untouched : base;
}

/**
 * Optional opportunity after daily target: one unseen GEO at a time.
 * Priority: historical performance → untouched → least-used reuse fallback.
 */
export function selectExtraGeoForNetwork(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
  _seed = 0,
): TestingGeo[] {
  if (!isTestingNetworkDailyTargetMet(net, state)) return [];
  if (isExtraLimitReached(net, state)) return [];
  const eligible = net.geos.filter((g) => g.todayRequired > 0);
  if (eligible.length === 0) return [];

  const notCompleted = eligible.filter(
    (g) => !isTestingGeoComplete(net.network, g, state),
  );
  const unseenActive = filterUnseenGeos(net, state, notCompleted);
  if (unseenActive.length > 0) {
    const pool = pickExtraGeoPool(net, state, unseenActive);
    const ordered = orderGeosByHistoricalPerformance(pool);
    return ordered[0] ? [ordered[0]] : [];
  }

  const unseenEligible = filterUnseenGeos(net, state, eligible);
  const pool = unseenEligible.length > 0 ? unseenEligible : eligible;
  const pick = selectFromReusePool(net, state, pool, 1)[0];
  return pick ? [pick] : [];
}

/**
 * Pick up to `limit` GEO tasks for a network — unseen active pool first, reuse
 * fallback only after every unseen active GEO is exhausted. After daily target
 * is met, auto-surfaces one optional opportunity at a time (until soft limit).
 */
export function selectTopGeosForNetwork(
  net: TestingNetworkPlan,
  state: MissionCompletionState | null | undefined,
  limit = 3,
  _seed = 0,
): TestingGeo[] {
  const s = coalesceState(state);
  const eligible = net.geos.filter((g) => g.todayRequired > 0);
  if (eligible.length === 0) return [];
  if (isTestingNetworkDailyTargetMet(net, s)) {
    return selectExtraGeoForNetwork(net, s, 0);
  }

  const active = getActiveGeos(net, s);
  const reusePool = getReuseGeos(net, s);
  return pickUnseenThenFallback(net, s, limit, active, reusePool);
}

/**
 * Select GEOs and mark them seen in one step (call on refresh / after display commit).
 */
export function selectTopGeosForNetworkAndMarkSeen(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
  limit = 3,
): { geos: TestingGeo[]; state: MissionCompletionState } {
  const geos = selectTopGeosForNetwork(net, state, limit);
  const codes = geos.map((g) => g.geo);
  let next = markGeosSeen(state, net.network, codes);
  next = recordGeosShown(next, net.network, codes);
  return { geos, state: next };
}

/**
 * @deprecated Prefer selectTopGeosForNetwork — returns the top single GEO.
 * Returns null ONLY when the network has zero eligible GEOs (todayRequired > 0).
 */
export function selectNetworkFocusGeo(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
  skip = 0,
  previousGeo?: string | null,
): TestingGeo | null {
  const top = selectTopGeosForNetwork(net, state, 1, skip);
  if (top.length === 0) return null;
  let pick = top[0]!;
  const eligible = net.geos.filter((g) => g.todayRequired > 0);
  if (previousGeo && eligible.length > 1) {
    const prevKey = previousGeo.trim().toLowerCase();
    if (pick.geo.trim().toLowerCase() === prevKey) {
      const alt = selectTopGeosForNetwork(net, state, 2, skip);
      if (alt.length > 1 && alt[1]!.geo.trim().toLowerCase() !== prevKey) {
        pick = alt[1]!;
      }
    }
  }
  return pick;
}

/** @deprecated Use hashGeo — kept for internal variety shuffle. */
function geoTieBreaker(geo: string): number {
  return hashGeo(geo);
}

/** Light variety shuffle when reuse stats are tied (seeded by skip for stability). */
function varietyShuffle(geos: TestingGeo[], seed: number): TestingGeo[] {
  return [...geos].sort((a, b) => {
    const ra = (geoTieBreaker(a.geo) ^ (seed * 2_654_435_761)) >>> 0;
    const rb = (geoTieBreaker(b.geo) ^ (seed * 2_654_435_761)) >>> 0;
    return (ra % 997) - (rb % 997);
  });
}

function reuseStatsTied(
  state: MissionCompletionState,
  network: string,
  eligible: TestingGeo[],
): boolean {
  if (eligible.length <= 1) return false;
  const counts = eligible.map((g) => geoUsageCount(state, network, g.geo));
  if (!counts.every((c) => c === counts[0])) return false;
  const times = eligible.map((g) => geoUsageLastUsedAt(state, network, g.geo));
  return Math.max(...times) - Math.min(...times) < REUSE_TIMESTAMP_CLOSE_MS;
}

/**
 * Stable "active-first" ordering: incomplete items rise to the top so the worker
 * always sees the next best remaining task; completed items sink to the bottom.
 */
export function orderActiveFirst<T>(items: T[], isComplete: (item: T) => boolean): T[] {
  return items
    .map((item, index) => ({ item, index, complete: isComplete(item) }))
    .sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? 1 : -1;
      return a.index - b.index;
    })
    .map((x) => x.item);
}

/**
 * Priority order for GEO testing tasks: incomplete first, then GEO most behind
 * pace, then largest remaining monthly target; seed shuffles ties on refresh.
 */
export function orderTestingGeosByPriority(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
  seed = 0,
): TestingGeo[] {
  const active = getActiveGeos(net, state);
  const complete = net.geos.filter(
    (g) => g.todayRequired > 0 && isTestingGeoComplete(net.network, g, state),
  );
  return [
    ...orderGeosByTestingPriority(active, seed),
    ...orderGeosByTestingPriority(complete, seed),
  ];
}

/** Max gap-to-pace across GEOs that are NOT yet done (remaining work only). */
function networkActiveMaxGap(net: TestingNetworkPlan, state: MissionCompletionState): number {
  return net.geos.reduce(
    (m, g) =>
      isTestingGeoComplete(net.network, g, state) ? m : Math.max(m, g.gapToPace),
    0,
  );
}

/** Remaining monthly target across GEOs that are NOT yet done. */
function networkActiveRemaining(net: TestingNetworkPlan, state: MissionCompletionState): number {
  return net.geos.reduce(
    (s, g) => (isTestingGeoComplete(net.network, g, state) ? s : s + g.remaining),
    0,
  );
}

/**
 * Priority order for networks: incomplete first, then the network whose REMAINING
 * work is most behind pace, then largest remaining target, then network name.
 * Recalculated on every call so finishing tasks re-ranks the queue live.
 */
export function orderTestingNetworksByPriority(
  networks: TestingNetworkPlan[],
  state: MissionCompletionState,
): TestingNetworkPlan[] {
  return [...networks].sort((a, b) => {
    const ca = isTestingNetworkComplete(a, state);
    const cb = isTestingNetworkComplete(b, state);
    if (ca !== cb) return ca ? 1 : -1;
    const ga = networkActiveMaxGap(a, state);
    const gb = networkActiveMaxGap(b, state);
    if (gb !== ga) return gb - ga;
    const ra = networkActiveRemaining(a, state);
    const rb = networkActiveRemaining(b, state);
    if (rb !== ra) return rb - ra;
    return a.network.localeCompare(b.network);
  });
}

export type NextAction = {
  kind: "testing" | "optimize" | "scale";
  key: string;
  title: string;
  context: string;
  network?: string;
  geo?: string;
};

/**
 * The single highest-priority task the worker should do FIRST.
 * Testing → (fallback) optimize → (fallback) scale. Null when nothing remains.
 */
export function selectNextAction(
  plan: DailyActionPlan,
  state: MissionCompletionState | null | undefined,
): NextAction | null {
  const s = coalesceState(state);
  for (const net of orderTestingNetworksByPriority(plan.testingNetworks, s)) {
    if (isTestingNetworkDailyTargetMet(net, s)) continue;
    for (const g of orderTestingGeosByPriority(net, s)) {
      if (g.todayRequired <= 0) continue;
      if (isTestingGeoComplete(net.network, g, s)) continue;
      return {
        kind: "testing",
        key: testingGeoKey(net.network, g.geo),
        title: `${g.geo} — Open ${g.todayRequired} test${g.todayRequired === 1 ? "" : "s"}`,
        context: `${net.network} · ${g.doneToday}/${g.todayRequired} done`,
        network: net.network,
        geo: g.geo,
      };
    }
  }

  const opt = orderActiveFirst(plan.optimizations, (g) => isOptimizationComplete(g, s)).find(
    (g) => !isOptimizationComplete(g, s),
  );
  if (opt) {
    return {
      kind: "optimize",
      key: optimizationKey(opt.issueType),
      title: opt.label,
      context: "Optimize a live campaign",
    };
  }

  const scaleAll = [...plan.scalingCandidates, ...plan.moveToWorkingCandidates];
  const sc = orderActiveFirst(scaleAll, (c) => isScalingComplete(c, s)).find(
    (c) => !isScalingComplete(c, s),
  );
  if (sc) {
    return {
      kind: "scale",
      key: scalingKey(sc.kind, sc.id),
      title: sc.name,
      context: `${sc.network} / ${sc.geo} · review for scaling`,
    };
  }

  return null;
}

/** Human sentence describing where to start, reflecting real remaining tasks. */
export function missionStartSentence(
  plan: DailyActionPlan,
  state: MissionCompletionState,
): string {
  for (const net of orderTestingNetworksByPriority(plan.testingNetworks, state)) {
    if (isTestingNetworkDailyTargetMet(net, state)) continue;
    const geos = orderTestingGeosByPriority(net, state)
      .filter((g) => g.todayRequired > 0 && !isTestingGeoComplete(net.network, g, state))
      .slice(0, 3)
      .map((g) => g.geo);
    if (geos.length > 0) {
      return `Start with ${net.network} — open tests in ${geos.join(", ")}`;
    }
  }
  const opt = plan.optimizations.find((g) => !isOptimizationComplete(g, state));
  if (opt) return `Next: ${opt.label}`;
  const scaleAll = [...plan.scalingCandidates, ...plan.moveToWorkingCandidates];
  const sc = scaleAll.find((c) => !isScalingComplete(c, state));
  if (sc) return `Next: review ${sc.name} for scaling`;
  return "All done for today — great work!";
}

/**
 * Recompute the Focus Bar summary folding in manual "done for today" marks.
 * Manual completion is unioned with the honest timestamp-based `doneToday`.
 */
export function computeEffectiveSummary(
  plan: DailyActionPlan,
  state: MissionCompletionState | null | undefined,
): EffectiveSummary {
  const s = coalesceState(state);
  const done = new Set(s.done);

  const testsRequired = plan.testingNetworks.reduce((s, n) => s + n.todayRequired, 0);
  const testsDone = Math.min(
    testsRequired,
    plan.testingNetworks.reduce((s, n) => s + testingNetworkEffectiveDone(n, done), 0),
  );

  const optimizationsRequired = plan.optimizations.reduce((s, g) => s + g.required, 0);
  const optimizationsDone = Math.min(
    optimizationsRequired,
    plan.optimizations.reduce((s, g) => s + optimizationEffectiveDone(g, done), 0),
  );

  const scalingCandidates = [
    ...plan.scalingCandidates,
    ...plan.moveToWorkingCandidates,
  ];
  const scalingAdvisory = scalingCandidates.length;
  const scalingDone = Math.min(scalingAdvisory, scalingEffectiveDone(scalingCandidates, done));

  const shutdownCandidates = plan.shutdownCandidates ?? [];
  const shutdownAdvisory = shutdownCandidates.length;
  const shutdownDone = Math.min(
    shutdownAdvisory,
    shutdownCandidates.reduce((n, c) => (done.has(shutdownKey(c.id)) ? n + 1 : n), 0),
  );

  const total = testsRequired + optimizationsRequired + scalingAdvisory + shutdownAdvisory;
  const completed = Math.min(
    total,
    testsDone + optimizationsDone + scalingDone + shutdownDone,
  );
  const progressPct =
    total <= 0 ? 100 : Math.min(100, Math.round((completed / total) * 100));

  return {
    testsRequired,
    testsDone,
    optimizationsRequired,
    optimizationsDone,
    scalingAdvisory,
    scalingDone,
    shutdownAdvisory,
    shutdownDone,
    completed,
    total,
    progressPct,
  };
}

// ---------------------------------------------------------------------------
// Campaign-backed plan selectors (single source of truth — no localStorage)
// ---------------------------------------------------------------------------

/**
 * Full suggestion pool for a network: the complete Monthly-Goal GEO set when
 * available, else today's allocated GEOs (backward-compatible fallback so plan
 * fixtures without `suggestionGeos` keep working).
 */
export function suggestionPoolFromPlan(net: TestingNetworkPlan): TestingGeo[] {
  const pool = net.suggestionGeos;
  return pool && pool.length > 0 ? pool : net.geos;
}

/**
 * GEO done today: a real testing campaign exists (uncapped `doneToday > 0`) and,
 * for an allocated GEO, its daily quota is met. Suggestion-pool GEOs (allocation
 * of 0) count as done as soon as one testing campaign lands.
 */
export function isTestingGeoCompleteFromPlan(
  geo: { todayRequired: number; doneToday: number },
): boolean {
  const done = geo.doneToday ?? 0;
  if (done <= 0) return false;
  return geo.todayRequired <= 0 || done >= geo.todayRequired;
}

/**
 * Network progress = DISTINCT Monthly-Goal GEOs with a real testing campaign
 * today, capped at the network's daily requirement. Counting distinct GEOs (not
 * per-allocation) means testing any goal GEO — including one surfaced by Refresh
 * beyond the initial 3 — advances progress.
 */
export function countCompletedGeosTodayFromPlan(net: TestingNetworkPlan): number {
  const pool = suggestionPoolFromPlan(net);
  const distinctDone = new Set(
    pool.filter((g) => (g.doneToday ?? 0) > 0).map((g) => canonicalGeoKey(g.geo)),
  ).size;
  return Math.min(net.todayRequired, distinctDone);
}

export function isTestingNetworkDailyTargetMetFromPlan(
  net: TestingNetworkPlan,
): boolean {
  if (net.todayRequired <= 0) return true;
  return countCompletedGeosTodayFromPlan(net) >= net.todayRequired;
}

/** Incomplete GEOs still available to suggest (real doneToday 0, monthly open). */
export function countIncompleteSuggestionGeosFromPlan(
  net: TestingNetworkPlan,
): number {
  return suggestionPoolFromPlan(net).filter(
    (g) => (g.doneToday ?? 0) === 0 && g.remaining > 0,
  ).length;
}

export function isTestingNetworkVisibleFromPlan(net: TestingNetworkPlan): boolean {
  return net.geos.some((g) => g.todayRequired > 0);
}

/** Performance + activity signals for smart GEO ranking. */
export type GeoPerformanceMetrics = {
  roi: number;
  conversions: number;
  lastWorkedAtMs: number | null;
  hasActivityToday: boolean;
};

export type GeoSelectionContext = {
  campaigns?: OpsCampaignRowLite[];
  now?: Date;
  /** Stable tiebreaker seed (defaults to per-GEO hash). */
  seed?: number;
};

const RECENT_GEO_WORK_MS = 30 * 60 * 1000;

export function minutesSince(
  isoOrMs: string | number,
  now = new Date(),
): number {
  const t =
    typeof isoOrMs === "number" ? isoOrMs : new Date(isoOrMs).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - t) / 60_000;
}

function networkGeoMatches(
  net: TestingNetworkPlan,
  geoCode: string,
  row: { network: string | null; geo: string | null },
): boolean {
  if (!row.network || !row.geo) return false;
  return (
    canonicalNetworkKey(row.network) === canonicalNetworkKey(net.network) &&
    canonicalGeoKey(row.geo) === canonicalGeoKey(geoCode)
  );
}

function networkMatches(
  net: TestingNetworkPlan,
  row: { network: string | null },
): boolean {
  if (!row.network) return false;
  return canonicalNetworkKey(row.network) === canonicalNetworkKey(net.network);
}

/** Latest worker activity timestamp for a network (any GEO). */
export function deriveNetworkLastWorkedAtMs(
  net: TestingNetworkPlan,
  context: GeoSelectionContext = {},
): number | null {
  let lastWorkedAtMs: number | null = null;

  for (const raw of context.campaigns ?? []) {
    const row = toMissionCampaignRow(raw);
    if (!row || !networkMatches(net, row)) continue;

    for (const stamp of [row.createdAt, row.liveStartedAt, row.updatedAt]) {
      if (!stamp) continue;
      const ts = new Date(stamp).getTime();
      if (Number.isFinite(ts)) {
        lastWorkedAtMs =
          lastWorkedAtMs == null ? ts : Math.max(lastWorkedAtMs, ts);
      }
    }
  }

  return lastWorkedAtMs;
}

/** Derive scoring metrics from plan progress + today's campaigns. */
export function deriveGeoPerformanceMetrics(
  net: TestingNetworkPlan,
  geo: TestingGeo,
  context: GeoSelectionContext = {},
): GeoPerformanceMetrics {
  const now = context.now ?? new Date();
  let hasActivityToday = geo.doneToday > 0;
  let roi = 0;
  let conversions = 0;
  let lastWorkedAtMs: number | null = null;

  for (const raw of context.campaigns ?? []) {
    const row = toMissionCampaignRow(raw);
    if (!row || !networkGeoMatches(net, geo.geo, row)) continue;

    for (const stamp of [row.createdAt, row.liveStartedAt, row.updatedAt]) {
      if (!stamp || !isSameLocalDay(stamp, now)) continue;
      hasActivityToday = true;
      const ts = new Date(stamp).getTime();
      if (Number.isFinite(ts)) {
        lastWorkedAtMs =
          lastWorkedAtMs == null ? ts : Math.max(lastWorkedAtMs, ts);
      }
    }

    const r = Number(raw.roi ?? 0);
    if (Number.isFinite(r)) roi = Math.max(roi, r);
    const conv = Number(raw.conversions ?? 0);
    if (Number.isFinite(conv)) conversions += conv;
  }

  return { roi, conversions, lastWorkedAtMs, hasActivityToday };
}

/**
 * Smart GEO priority score — behind pace first, larger GEOs within the network,
 * push untouched GEOs, boost proven performers, deprioritize very recent work.
 */
export function baseScoreGeoForMission(
  geo: TestingGeo,
  net: TestingNetworkPlan,
  metrics: GeoPerformanceMetrics,
  now = new Date(),
): number {
  let score = 0;

  const gap = Math.max(0, geo.monthlyTarget - geo.current);
  score += gap * 10;

  const networkTarget = net.monthlyGoal;
  if (networkTarget > 0 && geo.monthlyTarget > 0) {
    score += (geo.monthlyTarget / networkTarget) * 50;
  }

  if (!metrics.hasActivityToday) score += 50;

  if (metrics.roi > 0) score += 30;
  if (metrics.conversions > 0) score += 20;

  if (
    metrics.lastWorkedAtMs != null &&
    now.getTime() - metrics.lastWorkedAtMs < RECENT_GEO_WORK_MS
  ) {
    score -= 40;
  }

  return score;
}

export function scoreGeoForMission(
  geo: TestingGeo,
  net: TestingNetworkPlan,
  metrics: GeoPerformanceMetrics,
  seed = 0,
  now = new Date(),
): number {
  const tiebreaker = (hashGeo(`${net.network}:${geo.geo}:${seed}`) % 500) / 100;
  return baseScoreGeoForMission(geo, net, metrics, now) + tiebreaker;
}

function orderGeosBySmartScore(
  net: TestingNetworkPlan,
  geos: TestingGeo[],
  context: GeoSelectionContext = {},
): TestingGeo[] {
  const now = context.now ?? new Date();
  const seed = context.seed ?? 0;
  return [...geos].sort((a, b) => {
    const sa = baseScoreGeoForMission(
      a,
      net,
      deriveGeoPerformanceMetrics(net, a, context),
      now,
    );
    const sb = baseScoreGeoForMission(
      b,
      net,
      deriveGeoPerformanceMetrics(net, b, context),
      now,
    );
    if (sb !== sa) return sb - sa;
    if (b.gapToPace !== a.gapToPace) return b.gapToPace - a.gapToPace;
    if (b.remaining !== a.remaining) return b.remaining - a.remaining;
    const ta = hashGeo(`${net.network}:${a.geo}:${seed}`) % 500;
    const tb = hashGeo(`${net.network}:${b.geo}:${seed}`) % 500;
    return tb - ta || a.geo.localeCompare(b.geo);
  });
}

/**
 * Top incomplete GEOs by smart score (campaign-aware), drawn from the FULL
 * Monthly-Goal pool (not just today's 3 allocated) so Refresh can rotate through
 * every configured GEO. Incomplete = no real testing campaign today AND the
 * monthly target is still open.
 */
export function selectTopGeosFromPlan(
  net: TestingNetworkPlan,
  limit = 3,
  context: GeoSelectionContext = {},
): TestingGeo[] {
  const notCompleted = suggestionPoolFromPlan(net).filter(
    (g) => (g.doneToday ?? 0) === 0 && g.remaining > 0,
  );
  return orderGeosBySmartScore(net, notCompleted, context).slice(0, limit);
}

/**
 * Per-network suggestion rotation: a sliding window of up to `limit` INCOMPLETE
 * GEOs, advanced by `refreshCount`. Completion is always recomputed from the
 * plan (real campaigns) — rotation only controls which incomplete GEOs are shown.
 *
 * - refreshCount 0 → highest-priority incomplete GEOs.
 * - each refresh advances the window by `limit` (genuinely new GEOs, not a
 *   reorder of the same three) and wraps once the incomplete pool is exhausted.
 * - never returns completed GEOs, so finishing one never fabricates work.
 */
export function selectRotatingGeosFromPlan(
  net: TestingNetworkPlan,
  limit = 3,
  refreshCount = 0,
  context: GeoSelectionContext = {},
): TestingGeo[] {
  const ordered = selectTopGeosFromPlan(net, Number.MAX_SAFE_INTEGER, context);
  if (ordered.length <= limit) return ordered;
  const rounds = Math.max(0, Math.floor(refreshCount));
  const start = (rounds * limit) % ordered.length;
  const out: TestingGeo[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ordered.length && out.length < limit; i++) {
    const g = ordered[(start + i) % ordered.length]!;
    const key = canonicalGeoKey(g.geo);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

/**
 * Campaign-backed COMPLETED goal GEOs for a network today — one row per distinct
 * GEO with a real testing campaign (uncapped `doneToday > 0`). Rendered with the
 * checked completion circle ("Done today"). Completion is campaign truth, so this
 * survives reload / logout / admin view without any localStorage.
 */
export function selectCompletedGeosFromPlan(net: TestingNetworkPlan): TestingGeo[] {
  const seen = new Set<string>();
  const out: TestingGeo[] = [];
  for (const g of suggestionPoolFromPlan(net)) {
    if ((g.doneToday ?? 0) <= 0) continue;
    const key = canonicalGeoKey(g.geo);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

/**
 * Canonical toast copy when circle verification finds no qualifying testing
 * campaign. GEO is rendered via the shared code formatter (never "US US").
 */
export function geoVerificationFailureMessage(
  network: string,
  geo: string,
): string {
  return `No matching Testing campaign was found for ${network} / ${geoCodeText(geo)} today.`;
}

export function orderTestingGeosByPlanPriority(
  net: TestingNetworkPlan,
  seed = 0,
  context: GeoSelectionContext = {},
): TestingGeo[] {
  const ctx = { ...context, seed };
  const active = net.geos.filter(
    (g) => g.todayRequired > 0 && g.doneToday < g.todayRequired,
  );
  const complete = net.geos.filter(
    (g) => g.todayRequired > 0 && g.doneToday >= g.todayRequired,
  );
  return [
    ...orderGeosBySmartScore(net, active, ctx),
    ...orderGeosBySmartScore(net, complete, ctx),
  ];
}

function networkActiveMaxGapFromPlan(net: TestingNetworkPlan): number {
  return net.geos.reduce(
    (m, g) =>
      isTestingGeoCompleteFromPlan(g) ? m : Math.max(m, g.gapToPace),
    0,
  );
}

/** Sum of GEO monthly progress for network-level scoring. */
export function networkCurrentFromPlan(net: TestingNetworkPlan): number {
  return net.geos.reduce((s, g) => s + Math.max(0, g.current), 0);
}

/**
 * Top-level network priority — behind pace, low progress boost,
 * deprioritize tiny networks, anti-starvation rotation.
 */
export function scoreNetworkForMission(
  net: TestingNetworkPlan,
  context: GeoSelectionContext = {},
): number {
  const now = context.now ?? new Date();
  const current = networkCurrentFromPlan(net);
  const remaining = Math.max(0, net.monthlyGoal - current);
  const progress = net.monthlyGoal > 0 ? current / net.monthlyGoal : 0;

  let score = 0;

  score += remaining * 5;
  score += (1 - progress) * 100;

  if (net.monthlyGoal < 10) {
    score -= 20;
  }

  const lastWorkedAtMs = deriveNetworkLastWorkedAtMs(net, context) ?? 0;

  let minutesIdle: number;
  if (lastWorkedAtMs === 0) {
    // Never touched — moderate tier only, not max starvation inflation.
    minutesIdle = 60;
  } else {
    minutesIdle = minutesSince(lastWorkedAtMs, now);
  }

  if (minutesIdle > 60) {
    score += 40;
  }
  if (minutesIdle > 120) {
    score += 80;
  }

  return score;
}

export function orderTestingNetworksByPlanPriority(
  networks: TestingNetworkPlan[],
  context: GeoSelectionContext = {},
): TestingNetworkPlan[] {
  return [...networks].sort((a, b) => {
    const ca = isTestingNetworkDailyTargetMetFromPlan(a);
    const cb = isTestingNetworkDailyTargetMetFromPlan(b);
    if (ca !== cb) return ca ? 1 : -1;

    const sa = scoreNetworkForMission(a, context);
    const sb = scoreNetworkForMission(b, context);
    if (sb !== sa) return sb - sa;

    const ga = networkActiveMaxGapFromPlan(a);
    const gb = networkActiveMaxGapFromPlan(b);
    if (gb !== ga) return gb - ga;

    return a.network.localeCompare(b.network);
  });
}

/** Focus the highest-priority networks before GEO selection (default: top 2). */
export const MISSION_FOCUS_NETWORK_COUNT = 2;

export function selectFocusTestingNetworksFromPlan(
  networks: TestingNetworkPlan[],
  limit = MISSION_FOCUS_NETWORK_COUNT,
  context: GeoSelectionContext = {},
): TestingNetworkPlan[] {
  const visible = networks.filter(isTestingNetworkVisibleFromPlan);
  const active = visible.filter((n) => !isTestingNetworkDailyTargetMetFromPlan(n));
  const doneToday = visible.filter((n) => isTestingNetworkDailyTargetMetFromPlan(n));

  const focused = orderTestingNetworksByPlanPriority(active, context).slice(0, limit);
  const rest = orderTestingNetworksByPlanPriority(active, context).slice(limit);
  return [
    ...focused,
    ...rest,
    ...orderTestingNetworksByPlanPriority(doneToday, context),
  ];
}

/** Top GEO picks across the highest-priority networks (network layer → GEO layer). */
export function selectTopGeosAcrossPlan(
  plan: DailyActionPlan,
  context: GeoSelectionContext = {},
  options: { networkLimit?: number; geoLimit?: number } = {},
): Array<{ network: string; geo: TestingGeo }> {
  const networkLimit = options.networkLimit ?? MISSION_FOCUS_NETWORK_COUNT;
  const geoLimit = options.geoLimit ?? 2;

  const nets = orderTestingNetworksByPlanPriority(plan.testingNetworks, context)
    .filter(
      (n) =>
        isTestingNetworkVisibleFromPlan(n) &&
        !isTestingNetworkDailyTargetMetFromPlan(n),
    )
    .slice(0, networkLimit);

  return nets.flatMap((net) =>
    selectTopGeosFromPlan(net, geoLimit, context).map((geo) => ({
      network: net.network,
      geo,
    })),
  );
}

export function selectNextActionFromPlan(
  plan: DailyActionPlan,
  context: GeoSelectionContext = {},
): NextAction | null {
  for (const net of orderTestingNetworksByPlanPriority(
    plan.testingNetworks,
    context,
  )) {
    if (isTestingNetworkDailyTargetMetFromPlan(net)) continue;
    for (const g of orderTestingGeosByPlanPriority(net, 0, context)) {
      if (g.todayRequired <= 0) continue;
      if (isTestingGeoCompleteFromPlan(g)) continue;
      return {
        kind: "testing",
        key: testingGeoKey(net.network, g.geo),
        title: `${g.geo} — Open ${g.todayRequired} test${g.todayRequired === 1 ? "" : "s"}`,
        context: `${net.network} · ${g.doneToday}/${g.todayRequired} done`,
        network: net.network,
        geo: g.geo,
      };
    }
  }

  const opt = plan.optimizations.find(
    (g) => !(g.canTrackCompletion && g.required > 0 && g.doneToday >= g.required),
  );
  if (opt) {
    return {
      kind: "optimize",
      key: optimizationKey(opt.issueType),
      title: opt.label,
      context: "Optimize a live campaign",
    };
  }

  const scaleAll = [...plan.scalingCandidates, ...plan.moveToWorkingCandidates];
  const sc = scaleAll[0];
  if (sc) {
    return {
      kind: "scale",
      key: scalingKey(sc.kind, sc.id),
      title: sc.name,
      context: `${sc.network} / ${sc.geo} · review for scaling`,
    };
  }

  return null;
}

/** Progress summary from plan build (campaign timestamps — same for worker and admin). */
export function effectiveSummaryFromPlan(plan: DailyActionPlan): EffectiveSummary {
  return {
    testsRequired: plan.summary.testsRequired,
    testsDone: plan.summary.testsDone,
    optimizationsRequired: plan.summary.optimizationsRequired,
    optimizationsDone: plan.summary.optimizationsDone,
    scalingAdvisory: plan.summary.scalingAdvisory,
    scalingDone: 0,
    shutdownAdvisory: plan.summary.shutdownAdvisory,
    shutdownDone: 0,
    completed: plan.summary.completed,
    total: plan.summary.total,
    progressPct: plan.summary.progressPct,
  };
}
