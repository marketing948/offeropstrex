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
  TestingNetworkPlan,
} from "./monthly-goal-daily-plan.ts";

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

/** Local calendar day key (YYYY-MM-DD) used to scope completion to "today". */
export function localDayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type MissionCompletionState = {
  /** Local day these completions belong to. Stale days are discarded on load. */
  day: string;
  /** Row keys the worker marked done for today. */
  done: string[];
};

export function emptyCompletion(now = new Date()): MissionCompletionState {
  return { day: localDayKey(now), done: [] };
}

/** Drop completions from a previous day so "done for today" never leaks over. */
export function normalizeForToday(
  state: MissionCompletionState | null | undefined,
  now = new Date(),
): MissionCompletionState {
  const today = localDayKey(now);
  if (!state || state.day !== today || !Array.isArray(state.done)) {
    return { day: today, done: [] };
  }
  return { day: today, done: [...new Set(state.done)] };
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
  return { day: base.day, done: [...set] };
}

export type EffectiveSummary = {
  testsRequired: number;
  testsDone: number;
  optimizationsRequired: number;
  optimizationsDone: number;
  scalingAdvisory: number;
  scalingDone: number;
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

  const total = testsRequired + optimizationsRequired + scalingAdvisory;
  const completed = Math.min(total, testsDone + optimizationsDone + scalingDone);
  const progressPct =
    total <= 0 ? 100 : Math.min(100, Math.round((completed / total) * 100));

  return {
    testsRequired,
    testsDone,
    optimizationsRequired,
    optimizationsDone,
    scalingAdvisory,
    scalingDone,
    completed,
    total,
    progressPct,
  };
}
