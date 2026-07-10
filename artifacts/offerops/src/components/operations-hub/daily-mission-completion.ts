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
};

export function emptyCompletion(now = new Date()): MissionCompletionState {
  return { day: localDayKey(now), done: [], geoUsageToday: {}, extraCompletionsToday: {} };
}

/** Drop completions from a previous day so "done for today" never leaks over. */
export function normalizeForToday(
  state: MissionCompletionState | null | undefined,
  now = new Date(),
): MissionCompletionState {
  const today = localDayKey(now);
  if (!state || state.day !== today || !Array.isArray(state.done)) {
    return { day: today, done: [], geoUsageToday: {}, extraCompletionsToday: {} };
  }
  const usage = normalizeGeoUsage(state.geoUsageToday);
  const extra = state.extraCompletionsToday ?? {};
  return {
    day: today,
    done: [...new Set(state.done)],
    geoUsageToday: usage,
    extraCompletionsToday: { ...extra },
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
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return { day: base.day, done: [...set], geoUsageToday: base.geoUsageToday, extraCompletionsToday: base.extraCompletionsToday };
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
  return { ...base, geoUsageToday: usage };
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
  return { ...withUsage, done: [...withUsage.done, key] };
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
  return { ...base, extraCompletionsToday: extra };
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
  state: MissionCompletionState,
): number {
  return testingNetworkEffectiveDone(net, new Set(state.done));
}

/** Whether the worker hit today's test target for this network. */
export function isTestingNetworkDailyTargetMet(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
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
  state: MissionCompletionState,
): boolean {
  if (isTestingNetworkDismissed(net.network, state)) return false;
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
 * Optional opportunity after daily target: one GEO at a time.
 * Priority: historical performance → untouched → least-used.
 */
export function selectExtraGeoForNetwork(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
  seed = 0,
): TestingGeo[] {
  if (!isTestingNetworkDailyTargetMet(net, state)) return [];
  if (isExtraLimitReached(net, state)) return [];
  const eligible = net.geos.filter((g) => g.todayRequired > 0);
  if (eligible.length === 0) return [];

  const pool = pickExtraGeoPool(net, state, eligible);
  const untouchedInPool = pool.filter(
    (g) => geoUsageCount(state, net.network, g.geo) === 0,
  );
  const ordered =
    untouchedInPool.length > 0
      ? orderGeosByTestingPriority(pool, seed)
      : orderByLeastUsed(net, state, pool, seed);
  const pick = rotateGeosBySeed(ordered, seed)[0];
  return pick ? [pick] : [];
}

/**
 * Pick up to `limit` GEO tasks for a network — active pool first, reuse only
 * after every active GEO is exhausted. After daily target is met, auto-surfaces
 * one optional opportunity at a time (until soft extra limit).
 */
export function selectTopGeosForNetwork(
  net: TestingNetworkPlan,
  state: MissionCompletionState,
  limit = 3,
  seed = 0,
): TestingGeo[] {
  const eligible = net.geos.filter((g) => g.todayRequired > 0);
  if (eligible.length === 0) return [];
  if (isTestingNetworkDailyTargetMet(net, state)) {
    return selectExtraGeoForNetwork(net, state, seed);
  }

  const active = getActiveGeos(net, state);

  if (active.length >= limit) {
    const ordered = orderGeosByTestingPriority(active, seed);
    return rotateGeosBySeed(ordered, seed).slice(0, limit);
  }

  if (active.length > 0) {
    return orderGeosByTestingPriority(active, seed).slice(0, limit);
  }

  const reusePool = getReuseGeos(net, state);
  const ordered = orderByLeastUsed(net, state, reusePool, seed);
  return uniqueGeosByCode(rotateGeosBySeed(ordered, seed)).slice(0, limit);
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
  state: MissionCompletionState,
): NextAction | null {
  for (const net of orderTestingNetworksByPriority(plan.testingNetworks, state)) {
    if (isTestingNetworkDailyTargetMet(net, state)) continue;
    for (const g of orderTestingGeosByPriority(net, state)) {
      if (g.todayRequired <= 0) continue;
      if (isTestingGeoComplete(net.network, g, state)) continue;
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

  const opt = orderActiveFirst(plan.optimizations, (g) => isOptimizationComplete(g, state)).find(
    (g) => !isOptimizationComplete(g, state),
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
  const sc = orderActiveFirst(scaleAll, (c) => isScalingComplete(c, state)).find(
    (c) => !isScalingComplete(c, state),
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
  state: MissionCompletionState,
): EffectiveSummary {
  const done = new Set(state.done);

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
