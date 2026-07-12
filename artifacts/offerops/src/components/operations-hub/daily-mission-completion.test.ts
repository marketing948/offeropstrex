/**
 * "Done for today" worker convenience layer — focused tests (pure, no DOM).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  completeGeo,
  completeExtraGeo,
  computeEffectiveSummary,
  countCompletedGeosToday,
  countExtraCompletionsToday,
  createEmptyMissionState,
  emptyCompletion,
  geoUsageCount,
  geoUsageLastUsedAt,
  isDone,
  isOptimizationComplete,
  isScalingComplete,
  isTestingGeoComplete,
  isTestingNetworkComplete,
  isTestingNetworkDailyTargetMet,
  isTestingNetworkVisible,
  getRecentGeos,
  getSeenGeosToday,
  getUntouchedGeosToday,
  MAX_RECENT_GEOS,
  isAutoExtraModeActive,
  isExtraLimitReached,
  isNetworkFocusReuseMode,
  localDayKey,
  markGeosSeen,
  recordGeosShown,
  missionStartSentence,
  MAX_EXTRA_PER_NETWORK,
  normalizeForToday,
  optimizationKey,
  orderActiveFirst,
  orderTestingGeosByPriority,
  orderTestingNetworksByPriority,
  recordGeoUsage,
  scalingKey,
  selectExtraGeoForNetwork,
  selectNetworkFocusGeo,
  selectNextAction,
  selectTopGeosForNetwork,
  scoreGeoForMission,
  scoreNetworkForMission,
  deriveGeoPerformanceMetrics,
  selectTopGeosFromPlan,
  selectTopGeosAcrossPlan,
  selectFocusTestingNetworksFromPlan,
  selectNextActionFromPlan,
  effectiveSummaryFromPlan,
  isTestingGeoCompleteFromPlan,
  countCompletedGeosTodayFromPlan,
  isTestingNetworkDailyTargetMetFromPlan,
  testingGeoKey,
  testingNetworkKey,
  toggleDone,
} from "./daily-mission-completion.ts";
import type { DailyActionPlan } from "./monthly-goal-daily-plan.ts";

const NOW = new Date("2026-07-08T12:00:00");

function plan(): DailyActionPlan {
  return {
    testingNetworks: [
      {
        network: "BlueAffiliate CBV",
        todayRequired: 3,
        monthlyGoal: 48,
        geoCount: 3,
        doneToday: 0,
        paceStatus: "behind",
        geos: [
          {
            geo: "GB",
            monthlyTarget: 20,
            current: 0,
            expectedByNow: 5,
            dailyExpected: 1,
            gapToPace: 5,
            remaining: 20,
            todayRequired: 1,
            doneToday: 0,
          },
          {
            geo: "US",
            monthlyTarget: 20,
            current: 0,
            expectedByNow: 5,
            dailyExpected: 1,
            gapToPace: 5,
            remaining: 20,
            todayRequired: 1,
            doneToday: 0,
          },
          {
            geo: "DE",
            monthlyTarget: 8,
            current: 0,
            expectedByNow: 2,
            dailyExpected: 1,
            gapToPace: 2,
            remaining: 8,
            todayRequired: 1,
            doneToday: 0,
          },
        ],
      },
    ],
    optimizations: [
      {
        issueType: "missing_offer_count",
        label: "Add offer count to 2 campaigns",
        campaigns: [
          { id: 1, name: "A", network: "N", geo: "US" },
          { id: 2, name: "B", network: "N", geo: "DE" },
        ],
        required: 2,
        doneToday: 0,
        canTrackCompletion: true,
      },
    ],
    scalingCandidates: [
      { id: 10, name: "Scale me", network: "N", geo: "US", kind: "scaling", profit: 400, roi: 20, visitsPerOffer: null },
    ],
    moveToWorkingCandidates: [],
    summary: {
      testsRequired: 3,
      testsDone: 0,
      optimizationsRequired: 2,
      optimizationsDone: 0,
      scalingAdvisory: 1,
      completed: 0,
      total: 6,
      progressPct: 0,
    },
  };
}

describe("mission completion keys + state", () => {
  test("toggle adds then removes a key", () => {
    const key = testingNetworkKey("BlueAffiliate CBV");
    let state = emptyCompletion(NOW);
    state = toggleDone(state, key, NOW);
    assert.equal(isDone(state, key), true);
    state = toggleDone(state, key, NOW);
    assert.equal(isDone(state, key), false);
  });

  test("stale day is dropped on normalize (date-scoped)", () => {
    const yesterday = { day: "2026-07-07", done: [testingNetworkKey("X")] };
    const norm = normalizeForToday(yesterday, NOW);
    assert.equal(norm.day, localDayKey(NOW));
    assert.equal(norm.done.length, 0);
  });

  test("same-day state is preserved on normalize", () => {
    const today = { day: localDayKey(NOW), done: [optimizationKey("missing_offer_count")] };
    const norm = normalizeForToday(today, NOW);
    assert.equal(norm.done.length, 1);
  });
});

describe("computeEffectiveSummary folds manual done-for-today", () => {
  test("marking a testing network done counts its full todayRequired", () => {
    const p = plan();
    const state = toggleDone(emptyCompletion(NOW), testingNetworkKey("BlueAffiliate CBV"), NOW);
    const s = computeEffectiveSummary(p, state);
    assert.equal(s.testsDone, 3);
  });

  test("marking a single GEO done counts only that GEO", () => {
    const p = plan();
    const state = toggleDone(emptyCompletion(NOW), testingGeoKey("BlueAffiliate CBV", "GB"), NOW);
    const s = computeEffectiveSummary(p, state);
    assert.equal(s.testsDone, 1);
  });

  test("marking an optimization group done counts its required", () => {
    const p = plan();
    const state = toggleDone(emptyCompletion(NOW), optimizationKey("missing_offer_count"), NOW);
    const s = computeEffectiveSummary(p, state);
    assert.equal(s.optimizationsDone, 2);
  });

  test("marking a scale candidate done counts toward scalingDone + completed", () => {
    const p = plan();
    const state = toggleDone(emptyCompletion(NOW), scalingKey("scaling", 10), NOW);
    const s = computeEffectiveSummary(p, state);
    assert.equal(s.scalingDone, 1);
    assert.equal(s.completed, 1);
  });

  test("completing everything reaches 100% progress and is capped at total", () => {
    const p = plan();
    let state = emptyCompletion(NOW);
    state = toggleDone(state, testingNetworkKey("BlueAffiliate CBV"), NOW);
    state = toggleDone(state, optimizationKey("missing_offer_count"), NOW);
    state = toggleDone(state, scalingKey("scaling", 10), NOW);
    const s = computeEffectiveSummary(p, state);
    assert.equal(s.completed, s.total);
    assert.equal(s.progressPct, 100);
  });
});

describe("completion checks + active-first ordering (refresh/promote)", () => {
  test("isTestingNetworkComplete true only when today's requirement is met", () => {
    const p = plan();
    const net = p.testingNetworks[0]!;
    assert.equal(isTestingNetworkComplete(net, emptyCompletion(NOW)), false);
    const state = toggleDone(emptyCompletion(NOW), testingNetworkKey(net.network), NOW);
    assert.equal(isTestingNetworkComplete(net, state), true);
  });

  test("isOptimizationComplete / isScalingComplete reflect done marks", () => {
    const p = plan();
    const state = toggleDone(
      toggleDone(emptyCompletion(NOW), optimizationKey("missing_offer_count"), NOW),
      scalingKey("scaling", 10),
      NOW,
    );
    assert.equal(isOptimizationComplete(p.optimizations[0]!, state), true);
    assert.equal(isScalingComplete(p.scalingCandidates[0]!, state), true);
  });

  test("orderActiveFirst promotes incomplete items and sinks completed ones", () => {
    const items = [
      { id: "a", done: false },
      { id: "b", done: true },
      { id: "c", done: false },
    ];
    const ordered = orderActiveFirst(items, (x) => x.done);
    assert.deepEqual(
      ordered.map((x) => x.id),
      ["a", "c", "b"],
    );
  });

  test("completed testing network sinks below active ones (no top-slot blocking)", () => {
    const p = plan();
    const nets = [
      p.testingNetworks[0]!,
      { ...p.testingNetworks[0]!, network: "SecondNet" },
    ];
    // Mark the first network done → it must drop below SecondNet.
    const state = toggleDone(emptyCompletion(NOW), testingNetworkKey("BlueAffiliate CBV"), NOW);
    const ordered = orderActiveFirst(nets, (n) => isTestingNetworkComplete(n, state));
    assert.equal(ordered[0]!.network, "SecondNet");
    assert.equal(ordered[1]!.network, "BlueAffiliate CBV");
  });

  test("ordering is stable for items with equal completion", () => {
    const items = ["x", "y", "z"].map((id) => ({ id }));
    const ordered = orderActiveFirst(items, () => false);
    assert.deepEqual(
      ordered.map((x) => x.id),
      ["x", "y", "z"],
    );
  });
});

function twoNetworkPlan(): DailyActionPlan {
  const geo = (
    g: string,
    gap: number,
    remaining: number,
  ): DailyActionPlan["testingNetworks"][number]["geos"][number] => ({
    geo: g,
    monthlyTarget: remaining,
    current: 0,
    expectedByNow: gap,
    dailyExpected: 1,
    gapToPace: gap,
    remaining,
    todayRequired: 1,
    doneToday: 0,
  });
  return {
    testingNetworks: [
      {
        network: "AlphaNet",
        todayRequired: 1,
        monthlyGoal: 10,
        geoCount: 1,
        doneToday: 0,
        paceStatus: "behind",
        geos: [geo("US", 2, 10)],
      },
      {
        network: "BetaNet",
        todayRequired: 2,
        monthlyGoal: 30,
        geoCount: 2,
        doneToday: 0,
        paceStatus: "behind",
        geos: [geo("GB", 9, 25), geo("DE", 1, 5)],
      },
    ],
    optimizations: [
      {
        issueType: "missing_offer_count",
        label: "Add offer count to 1 campaign",
        campaigns: [{ id: 1, name: "A", network: "N", geo: "US" }],
        required: 1,
        doneToday: 0,
        canTrackCompletion: true,
      },
    ],
    scalingCandidates: [
      { id: 9, name: "ScaleCo", network: "N", geo: "US", kind: "scaling", profit: 100, roi: 10, visitsPerOffer: null },
    ],
    moveToWorkingCandidates: [],
    summary: {
      testsRequired: 3,
      testsDone: 0,
      optimizationsRequired: 1,
      optimizationsDone: 0,
      scalingAdvisory: 1,
      completed: 0,
      total: 5,
      progressPct: 0,
    },
  };
}

/** BetaNet with a higher daily target so reuse mode can activate after all GEOs are done once. */
function betaNetExtendedTarget(): DailyActionPlan["testingNetworks"][number] {
  return { ...twoNetworkPlan().testingNetworks[1]!, todayRequired: 5 };
}

function sixGeoNetwork(): DailyActionPlan["testingNetworks"][number] {
  const geo = (
    g: string,
    gap: number,
  ): DailyActionPlan["testingNetworks"][number]["geos"][number] => ({
    geo: g,
    monthlyTarget: 20,
    current: 0,
    expectedByNow: gap,
    dailyExpected: 1,
    gapToPace: gap,
    remaining: 20,
    todayRequired: 1,
    doneToday: 0,
  });
  return {
    network: "WideNet",
    todayRequired: 6,
    monthlyGoal: 120,
    geoCount: 6,
    doneToday: 0,
    paceStatus: "behind",
    geos: [geo("GB", 5), geo("US", 5), geo("DE", 2), geo("FR", 4), geo("IT", 3), geo("NL", 1)],
  };
}

describe("execution workflow: next action + priority queue", () => {
  test("next action is the highest-priority GEO (most behind pace)", () => {
    const p = twoNetworkPlan();
    const na = selectNextAction(p, emptyCompletion(NOW));
    // BetaNet/GB has gap 9 (most behind) → it wins over AlphaNet/US gap 2.
    assert.equal(na?.kind, "testing");
    assert.equal(na?.network, "BetaNet");
    assert.equal(na?.geo, "GB");
  });

  test("after completing the top GEO, the next GEO becomes first", () => {
    const p = twoNetworkPlan();
    const state = toggleDone(emptyCompletion(NOW), testingGeoKey("BetaNet", "GB"), NOW);
    const na = selectNextAction(p, state);
    // GB done → next priority is AlphaNet/US (gap 2) over BetaNet/DE (gap 1).
    assert.equal(na?.geo, "US");
    assert.equal(na?.network, "AlphaNet");
  });

  test("completed GEO is not shown on top (sinks in priority order)", () => {
    const p = twoNetworkPlan();
    const beta = p.testingNetworks[1]!;
    const state = toggleDone(emptyCompletion(NOW), testingGeoKey("BetaNet", "GB"), NOW);
    const ordered = orderTestingGeosByPriority(beta, state);
    assert.equal(ordered[ordered.length - 1]!.geo, "GB");
    assert.equal(ordered[0]!.geo, "DE");
  });

  test("network completion promotes the next network to the top", () => {
    const p = twoNetworkPlan();
    // Finish all of BetaNet (2 GEOs) → AlphaNet should rise to the top.
    let state = toggleDone(emptyCompletion(NOW), testingGeoKey("BetaNet", "GB"), NOW);
    state = toggleDone(state, testingGeoKey("BetaNet", "DE"), NOW);
    const ordered = orderTestingNetworksByPriority(p.testingNetworks, state);
    assert.equal(ordered[0]!.network, "AlphaNet");
    assert.equal(ordered[1]!.network, "BetaNet");
  });

  test("completed GEO is removed from the active queue (not just faded)", () => {
    const p = twoNetworkPlan();
    const beta = p.testingNetworks[1]!;
    const state = toggleDone(emptyCompletion(NOW), testingGeoKey("BetaNet", "GB"), NOW);
    // Mirrors the board filter: active = ordered geos minus completed.
    const active = orderTestingGeosByPriority(beta, state).filter(
      (g) => g.todayRequired > 0 && !isTestingGeoComplete(beta.network, g, state),
    );
    assert.ok(!active.some((g) => g.geo === "GB"));
    assert.ok(active.some((g) => g.geo === "DE"));
  });

  test("after ✔ the queue refills: a new task is always promoted while work remains", () => {
    const p = twoNetworkPlan();
    let state = emptyCompletion(NOW);
    const first = selectNextAction(p, state);
    assert.ok(first, "there should be a first task");
    // Completing the current head must surface a different next task, never empty.
    state = toggleDone(state, first!.key, NOW);
    const next = selectNextAction(p, state);
    assert.ok(next, "a next task must appear after completing one");
    assert.notEqual(next!.key, first!.key);
  });

  test("missionStartSentence reflects the real top network + GEOs", () => {
    const p = twoNetworkPlan();
    const sentence = missionStartSentence(p, emptyCompletion(NOW));
    assert.match(sentence, /^Start with BetaNet — open tests in GB, DE/);
  });

  test("falls back to optimize, then scale, when no testing remains", () => {
    const p = twoNetworkPlan();
    let state = emptyCompletion(NOW);
    // Complete both networks.
    state = toggleDone(state, testingNetworkKey("AlphaNet"), NOW);
    state = toggleDone(state, testingNetworkKey("BetaNet"), NOW);
    let na = selectNextAction(p, state);
    assert.equal(na?.kind, "optimize");
    // Complete optimize → scale becomes next.
    state = toggleDone(state, optimizationKey("missing_offer_count"), NOW);
    na = selectNextAction(p, state);
    assert.equal(na?.kind, "scale");
    // Complete scale → nothing left.
    state = toggleDone(state, scalingKey("scaling", 9), NOW);
    assert.equal(selectNextAction(p, state), null);
  });
});

describe("testing refresh: next GEO within same network", () => {
  test("focus starts at the highest-priority active GEO", () => {
    const beta = twoNetworkPlan().testingNetworks[1]!;
    const focus = selectNetworkFocusGeo(beta, emptyCompletion(NOW), 0);
    assert.equal(focus?.geo, "GB"); // gap 9 wins
  });

  test("refresh (mark seen) rotates to the next unseen GEO", () => {
    const beta = twoNetworkPlan().testingNetworks[1]!;
    let state = emptyCompletion(NOW);
    const first = selectNetworkFocusGeo(beta, state, 0);
    state = markGeosSeen(state, beta.network, [first!.geo]);
    const second = selectNetworkFocusGeo(beta, state, 0);
    assert.notEqual(first?.geo, second?.geo);
    assert.equal(second?.geo, "DE");
  });

  test("returns reuse fallback after all active GEOs were seen", () => {
    const beta = twoNetworkPlan().testingNetworks[1]!;
    let state = emptyCompletion(NOW);
    const batch = selectTopGeosForNetwork(beta, state, 2).map((g) => g.geo);
    state = markGeosSeen(state, beta.network, batch);
    state = completeGeo(state, beta.network, "GB", NOW);
    state = completeGeo(state, beta.network, "DE", NOW);
    const reuse = selectNetworkFocusGeo(beta, state, 0);
    assert.ok(reuse);
    assert.ok(["GB", "DE"].includes(reuse!.geo));
  });

  test("completed GEO never reappears via refresh (no repeat same day)", () => {
    const beta = twoNetworkPlan().testingNetworks[1]!;
    const state = toggleDone(emptyCompletion(NOW), testingGeoKey("BetaNet", "GB"), NOW);
    for (let skip = 0; skip < 5; skip++) {
      assert.notEqual(selectNetworkFocusGeo(beta, state, skip)?.geo, "GB");
    }
    assert.equal(selectNetworkFocusGeo(beta, state, 0)?.geo, "DE");
  });

  test("reuse fallback: once all GEOs are done but target not met, refresh still returns a GEO", () => {
    const beta = twoNetworkPlan().testingNetworks[1]!;
    let state = toggleDone(emptyCompletion(NOW), testingGeoKey("BetaNet", "GB"), NOW);
    state = toggleDone(state, testingGeoKey("BetaNet", "DE"), NOW);
    assert.equal(isTestingNetworkDailyTargetMet(beta, state), true);
    assert.equal(selectTopGeosForNetwork(beta, state, 3, 0).length, 1);
  });

  test("returns null only when the network has zero eligible GEOs", () => {
    const empty: DailyActionPlan["testingNetworks"][number] = {
      ...twoNetworkPlan().testingNetworks[1]!,
      geos: [],
    };
    assert.equal(selectNetworkFocusGeo(empty, emptyCompletion(NOW), 0), null);
  });
});

describe("GEO usage tracking + reuse ordering", () => {
  test("completeGeo marks the GEO done AND increments its usage counter", () => {
    let state = emptyCompletion(NOW);
    assert.equal(geoUsageCount(state, "BetaNet", "GB"), 0);
    state = completeGeo(state, "BetaNet", "GB", NOW);
    assert.equal(isDone(state, testingGeoKey("BetaNet", "GB")), true);
    assert.equal(geoUsageCount(state, "BetaNet", "GB"), 1);
  });

  test("completeGeo on an already-done GEO stays done and keeps counting usage (reuse)", () => {
    let state = completeGeo(emptyCompletion(NOW), "BetaNet", "GB", NOW);
    state = completeGeo(state, "BetaNet", "GB", NOW);
    assert.equal(isDone(state, testingGeoKey("BetaNet", "GB")), true);
    assert.equal(geoUsageCount(state, "BetaNet", "GB"), 2);
  });

  test("recordGeoUsage increments without marking done", () => {
    const state = recordGeoUsage(emptyCompletion(NOW), "BetaNet", "DE", NOW);
    assert.equal(isDone(state, testingGeoKey("BetaNet", "DE")), false);
    assert.equal(geoUsageCount(state, "BetaNet", "DE"), 1);
  });

  test("reuse fallback prefers the least-used GEO (variety before repeats)", () => {
    const beta = betaNetExtendedTarget();
    let state = completeGeo(emptyCompletion(NOW), "BetaNet", "GB", NOW);
    state = completeGeo(state, "BetaNet", "GB", NOW);
    state = completeGeo(state, "BetaNet", "DE", NOW);
    assert.equal(selectNetworkFocusGeo(beta, state, 0)?.geo, "DE");
  });

  test("reuse fallback rotates through all GEOs before repeating one", () => {
    const beta = betaNetExtendedTarget();
    let state = completeGeo(emptyCompletion(NOW), "BetaNet", "GB", NOW);
    state = completeGeo(state, "BetaNet", "DE", NOW);
    const first = selectTopGeosForNetwork(beta, state, 1)[0]?.geo;
    state = markGeosSeen(state, beta.network, [first!]);
    const second = selectTopGeosForNetwork(beta, state, 1)[0]?.geo;
    assert.notEqual(first, second);
  });

  test("normalizeFortoday drops stale usage but keeps same-day usage", () => {
    const stale = {
      day: "2026-07-07",
      done: [testingGeoKey("BetaNet", "GB")],
      geoUsageToday: { betanet: { gb: { count: 3, lastUsedAt: 1000 } } },
    };
    const dropped = normalizeForToday(stale, NOW);
    assert.equal(geoUsageCount(dropped, "BetaNet", "GB"), 0);

    const fresh = {
      day: localDayKey(NOW),
      done: [],
      geoUsageToday: { betanet: { gb: { count: 2, lastUsedAt: 5000 } } },
    };
    const kept = normalizeForToday(fresh, NOW);
    assert.equal(geoUsageCount(kept, "BetaNet", "GB"), 2);
    assert.equal(geoUsageLastUsedAt(kept, "BetaNet", "GB"), 5000);
  });

  test("legacy geoUsageToday number shape migrates on load", () => {
    const legacy = {
      day: localDayKey(NOW),
      done: [],
      geoUsageToday: { betanet: { gb: 3 } },
    };
    const migrated = normalizeForToday(legacy, NOW);
    assert.equal(geoUsageCount(migrated, "BetaNet", "GB"), 3);
    assert.equal(geoUsageLastUsedAt(migrated, "BetaNet", "GB"), 0);
  });
});

describe("network visibility + auto-advance (no dead states)", () => {
  test("single-GEO network stays visible after ✔ (locked done state)", () => {
    const singleGeo: DailyActionPlan["testingNetworks"][number] = {
      network: "YieldKit CBV",
      monthlyGoal: 10,
      geoCount: 1,
      doneToday: 0,
      todayRequired: 1,
      paceStatus: "behind",
      geos: [
        {
          geo: "GB",
          monthlyTarget: 10,
          current: 0,
          expectedByNow: 5,
          dailyExpected: 1,
          gapToPace: 5,
          remaining: 10,
          todayRequired: 1,
          doneToday: 0,
        },
      ],
    };
    const state = completeGeo(emptyCompletion(NOW), "YieldKit CBV", "GB", NOW);
    assert.equal(isTestingNetworkDailyTargetMet(singleGeo, state), true);
    assert.equal(isTestingNetworkVisible(singleGeo, state), true);
    assert.equal(isAutoExtraModeActive(singleGeo, state), true);
    assert.equal(selectTopGeosForNetwork(singleGeo, state, 1, 0).length, 1);
  });

  test("completing one GEO auto-advances focus to the next active GEO", () => {
    const beta = twoNetworkPlan().testingNetworks[1]!;
    const before = selectNetworkFocusGeo(beta, emptyCompletion(NOW), 0);
    assert.equal(before?.geo, "GB");
    const after = completeGeo(emptyCompletion(NOW), "BetaNet", "GB", NOW);
    const next = selectNetworkFocusGeo(beta, after, 0);
    assert.equal(next?.geo, "DE");
  });

  test("single-GEO network always returns that GEO regardless of skip", () => {
    const singleGeo: DailyActionPlan["testingNetworks"][number] = {
      network: "YieldKit CBV",
      monthlyTarget: 10,
      doneToday: 0,
      todayRequired: 1,
      paceStatus: "behind",
      geos: [
        {
          geo: "GB",
          monthlyTarget: 10,
          doneToday: 0,
          todayRequired: 1,
          remaining: 10,
          gapToPace: 5,
        },
      ],
    };
    const state = emptyCompletion(NOW);
    assert.equal(selectNetworkFocusGeo(singleGeo, state, 0)?.geo, "GB");
    assert.equal(selectNetworkFocusGeo(singleGeo, state, 99)?.geo, "GB");
    assert.equal(selectNetworkFocusGeo(singleGeo, state, 0, "GB")?.geo, "GB");
  });

  test("network hidden only when explicitly dismissed at network level", () => {
    const beta = twoNetworkPlan().testingNetworks[1]!;
    const dismissed = toggleDone(emptyCompletion(NOW), testingNetworkKey("BetaNet"), NOW);
    assert.equal(isTestingNetworkVisible(beta, dismissed), false);
  });

  test("never repeats the same GEO twice in a row when alternatives exist", () => {
    const beta = betaNetExtendedTarget();
    let state = completeGeo(emptyCompletion(NOW), "BetaNet", "GB", NOW);
    state = completeGeo(state, "BetaNet", "DE", NOW);
    const first = selectNetworkFocusGeo(beta, state, 0, "GB");
    assert.ok(first);
    assert.notEqual(first!.geo, "GB");
  });

  test("reuse prefers oldest lastUsedAt after equal counts", () => {
    const beta = betaNetExtendedTarget();
    const t0 = new Date("2026-07-08T10:00:00Z");
    let state = completeGeo(emptyCompletion(t0), "BetaNet", "GB", t0);
    const t1 = new Date("2026-07-08T11:00:00Z");
    state = completeGeo(state, "BetaNet", "DE", t1);
    state = completeGeo(state, "BetaNet", "GB", t1);
    assert.equal(selectTopGeosForNetwork(beta, state, 1, 0)[0]?.geo, "DE");
  });
});

describe("multi-GEO pool (V3): selectTopGeosForNetwork", () => {
  test("returns 3 geos when available", () => {
    const net = plan().testingNetworks[0]!;
    const geos = selectTopGeosForNetwork(net, emptyCompletion(NOW), 3, 0);
    assert.equal(geos.length, 3);
    assert.deepEqual(
      geos.map((g) => g.geo).sort(),
      ["DE", "GB", "US"],
    );
  });

  test("refresh returns a new unseen GEO batch (not reorder)", () => {
    const net = sixGeoNetwork();
    let state = emptyCompletion(NOW);
    const first = selectTopGeosForNetwork(net, state, 3).map((g) => g.geo);
    assert.equal(first.length, 3);
    state = markGeosSeen(state, net.network, first);
    const second = selectTopGeosForNetwork(net, state, 3).map((g) => g.geo);
    assert.equal(second.length, 3);
    for (const g of second) assert.ok(!first.includes(g), `${g} must not repeat before exhaustion`);
    assert.equal(second.length, 3);
  });

  test("no duplicate GEO in same render", () => {
    const net = plan().testingNetworks[0]!;
    const geos = selectTopGeosForNetwork(net, emptyCompletion(NOW), 3);
    assert.equal(new Set(geos.map((g) => g.geo.toLowerCase())).size, geos.length);
  });

  test("completed GEO never shown again same day (active pool only)", () => {
    const net = plan().testingNetworks[0]!;
    let state = completeGeo(emptyCompletion(NOW), net.network, "GB", NOW);
    const geos = selectTopGeosForNetwork(net, state, 3, 0);
    assert.ok(!geos.some((g) => g.geo === "GB"));
    assert.equal(geos.length, 2);
  });

  test("reuse only after active exhaustion when daily target not yet met", () => {
    const net: DailyActionPlan["testingNetworks"][number] = {
      ...plan().testingNetworks[0]!,
      todayRequired: 5,
    };
    let state = emptyCompletion(NOW);
    state = completeGeo(state, net.network, "GB", NOW);
    state = completeGeo(state, net.network, "US", NOW);
    state = completeGeo(state, net.network, "DE", NOW);
    assert.equal(countCompletedGeosToday(net, state), 3);
    assert.equal(isTestingNetworkDailyTargetMet(net, state), false);
    const geos = selectTopGeosForNetwork(net, state, 3, 0);
    assert.ok(geos.length > 0, "reuse fills slots until daily target is met");
  });

  test("completing one GEO back-fills from active pool", () => {
    const net = plan().testingNetworks[0]!;
    const before = selectTopGeosForNetwork(net, emptyCompletion(NOW), 3, 0);
    assert.equal(before.length, 3);
    const after = completeGeo(emptyCompletion(NOW), net.network, before[0]!.geo, NOW);
    const next = selectTopGeosForNetwork(net, after, 3, 0);
    assert.equal(next.length, 2);
    assert.ok(!next.some((g) => g.geo === before[0]!.geo));
  });

  test("never returns empty while target not met and work remains", () => {
    const beta = twoNetworkPlan().testingNetworks[1]!;
    let state = completeGeo(emptyCompletion(NOW), "BetaNet", "GB", NOW);
    assert.equal(isTestingNetworkDailyTargetMet(beta, state), false);
    const geos = selectTopGeosForNetwork(beta, state, 3, 0);
    assert.ok(geos.length > 0);
  });
});

describe("network progression (V4): daily target + lock", () => {
  test("done counter increments correctly per GEO completion", () => {
    const net = plan().testingNetworks[0]!;
    let state = emptyCompletion(NOW);
    assert.equal(countCompletedGeosToday(net, state), 0);
    state = completeGeo(state, net.network, "GB", NOW);
    assert.equal(countCompletedGeosToday(net, state), 1);
    state = completeGeo(state, net.network, "US", NOW);
    assert.equal(countCompletedGeosToday(net, state), 2);
    state = completeGeo(state, net.network, "DE", NOW);
    assert.equal(countCompletedGeosToday(net, state), 3);
  });

  test("locks required GEOs after daily target reached", () => {
    const net = plan().testingNetworks[0]!;
    let state = emptyCompletion(NOW);
    state = completeGeo(state, net.network, "GB", NOW);
    state = completeGeo(state, net.network, "US", NOW);
    state = completeGeo(state, net.network, "DE", NOW);
    assert.equal(isTestingNetworkDailyTargetMet(net, state), true);
    assert.equal(isNetworkFocusReuseMode(net, state), false);
    assert.equal(countCompletedGeosToday(net, state), 3);
  });

  test("no reuse after daily target completion", () => {
    const net = plan().testingNetworks[0]!;
    let state = emptyCompletion(NOW);
    state = completeGeo(state, net.network, "GB", NOW);
    state = completeGeo(state, net.network, "US", NOW);
    state = completeGeo(state, net.network, "DE", NOW);
    assert.equal(isNetworkFocusReuseMode(net, state), false);
  });

  test("auto extra still offers opportunities after target met", () => {
    const net = plan().testingNetworks[0]!;
    let state = emptyCompletion(NOW);
    state = completeGeo(state, net.network, "GB", NOW);
    state = completeGeo(state, net.network, "US", NOW);
    state = completeGeo(state, net.network, "DE", NOW);
    assert.equal(isAutoExtraModeActive(net, state), true);
    assert.equal(selectTopGeosForNetwork(net, state, 3, 0).length, 1);
  });

  test("next action skips networks that hit daily target", () => {
    const p = plan();
    let state = emptyCompletion(NOW);
    const net = p.testingNetworks[0]!;
    state = completeGeo(state, net.network, "GB", NOW);
    state = completeGeo(state, net.network, "US", NOW);
    state = completeGeo(state, net.network, "DE", NOW);
    const na = selectNextAction(p, state);
    assert.notEqual(na?.network, net.network);
  });
});

describe("extra work mode (V5): controlled bonus after target", () => {
  function targetMetState(net: DailyActionPlan["testingNetworks"][number]) {
    let state = emptyCompletion(NOW);
    state = completeGeo(state, net.network, "GB", NOW);
    state = completeGeo(state, net.network, "US", NOW);
    state = completeGeo(state, net.network, "DE", NOW);
    return state;
  }

  test("auto extra returns exactly one GEO after target met", () => {
    const net = plan().testingNetworks[0]!;
    const state = targetMetState(net);
    const geos = selectTopGeosForNetwork(net, state, 3, 0);
    assert.equal(geos.length, 1);
  });

  test("extra mode prioritizes untouched GEOs", () => {
    const net: DailyActionPlan["testingNetworks"][number] = {
      ...plan().testingNetworks[0]!,
      todayRequired: 2,
      geos: [
        ...plan().testingNetworks[0]!.geos.slice(0, 2),
        {
          geo: "FR",
          monthlyTarget: 10,
          current: 0,
          expectedByNow: 3,
          dailyExpected: 1,
          gapToPace: 3,
          remaining: 10,
          todayRequired: 1,
          doneToday: 0,
        },
      ],
    };
    let state = emptyCompletion(NOW);
    state = completeGeo(state, net.network, "GB", NOW);
    state = completeGeo(state, net.network, "US", NOW);
    assert.equal(isTestingNetworkDailyTargetMet(net, state), true);
    assert.deepEqual(getUntouchedGeosToday(net, state).map((g) => g.geo), ["FR"]);
    assert.equal(selectExtraGeoForNetwork(net, state, 0)[0]?.geo, "FR");
  });

  test("extra completion does not increase daily progress", () => {
    const net = plan().testingNetworks[0]!;
    let state = targetMetState(net);
    assert.equal(countCompletedGeosToday(net, state), 3);
    state = completeExtraGeo(state, net.network, "GB", NOW);
    assert.equal(countCompletedGeosToday(net, state), 3);
    const summary = computeEffectiveSummary(plan(), state);
    assert.equal(summary.testsDone, 3);
    assert.equal(summary.testsRequired, 3);
  });

  test("extra mode uses lowest usage after all GEOs touched", () => {
    const net = plan().testingNetworks[0]!;
    let state = targetMetState(net);
    state = completeExtraGeo(state, net.network, "GB", NOW);
    state = completeExtraGeo(state, net.network, "GB", NOW);
    const pick = selectExtraGeoForNetwork(net, state, 0)[0]?.geo;
    assert.notEqual(pick, "GB");
    assert.ok(pick === "US" || pick === "DE");
  });

  test("refresh rotates extra GEO via unseen pool", () => {
    const net = plan().testingNetworks[0]!;
    let state = targetMetState(net);
    const first = selectExtraGeoForNetwork(net, state, 0)[0]?.geo;
    state = markGeosSeen(state, net.network, [first!]);
    const second = selectExtraGeoForNetwork(net, state, 0)[0]?.geo;
    assert.notEqual(first, second);
  });
});

describe("auto extra flow (V6): no manual entry + soft limit", () => {
  function targetMetState(net: DailyActionPlan["testingNetworks"][number]) {
    let state = emptyCompletion(NOW);
    state = completeGeo(state, net.network, "GB", NOW);
    state = completeGeo(state, net.network, "US", NOW);
    state = completeGeo(state, net.network, "DE", NOW);
    return state;
  }

  test("isAutoExtraModeActive when target met and under limit", () => {
    const net = plan().testingNetworks[0]!;
    const state = targetMetState(net);
    assert.equal(isAutoExtraModeActive(net, state), true);
    assert.equal(isExtraLimitReached(net, state), false);
  });

  test("completeExtraGeo increments extra counter only", () => {
    const net = plan().testingNetworks[0]!;
    let state = targetMetState(net);
    assert.equal(countExtraCompletionsToday(net, state), 0);
    state = completeExtraGeo(state, net.network, "GB", NOW);
    assert.equal(countExtraCompletionsToday(net, state), 1);
    assert.equal(countCompletedGeosToday(net, state), 3);
  });

  test("stops optional opportunities after maxExtraPerNetwork", () => {
    const net = plan().testingNetworks[0]!;
    let state = targetMetState(net);
    for (let i = 0; i < MAX_EXTRA_PER_NETWORK; i++) {
      state = completeExtraGeo(state, net.network, "GB", NOW);
    }
    assert.equal(countExtraCompletionsToday(net, state), MAX_EXTRA_PER_NETWORK);
    assert.equal(isExtraLimitReached(net, state), true);
    assert.equal(isAutoExtraModeActive(net, state), false);
    assert.equal(selectTopGeosForNetwork(net, state, 1, 0).length, 0);
  });

  test("progress unchanged after optional completions", () => {
    const net = plan().testingNetworks[0]!;
    let state = targetMetState(net);
    for (let i = 0; i < MAX_EXTRA_PER_NETWORK; i++) {
      state = completeExtraGeo(state, net.network, "US", NOW);
    }
    assert.equal(countCompletedGeosToday(net, state), 3);
    const summary = computeEffectiveSummary(plan(), state);
    assert.equal(summary.testsDone, 3);
  });
});

describe("GEO rotation pool (seenGeosToday)", () => {
  test("refresh returns unseen GEO", () => {
    const net = sixGeoNetwork();
    let state = emptyCompletion(NOW);
    const batch1 = selectTopGeosForNetwork(net, state, 3).map((g) => g.geo);
    state = markGeosSeen(state, net.network, batch1);
    const batch2 = selectTopGeosForNetwork(net, state, 3).map((g) => g.geo);
    assert.ok(batch2.every((g) => !batch1.includes(g)));
  });

  test("no repeat until all GEOs seen in active pool", () => {
    const net = sixGeoNetwork();
    let state = emptyCompletion(NOW);
    const seen: string[] = [];
    for (let i = 0; i < 2; i++) {
      const batch = selectTopGeosForNetwork(net, state, 3).map((g) => g.geo);
      for (const g of batch) assert.ok(!seen.includes(g));
      seen.push(...batch);
      state = markGeosSeen(state, net.network, batch);
    }
    assert.equal(new Set(seen).size, 6);
  });

  test("fallback only after unseen exhaustion", () => {
    const beta = betaNetExtendedTarget();
    let state = emptyCompletion(NOW);
    const all = selectTopGeosForNetwork(beta, state, 2).map((g) => g.geo);
    state = markGeosSeen(state, beta.network, all);
    state = completeGeo(state, beta.network, "GB", NOW);
    state = completeGeo(state, beta.network, "DE", NOW);
    const fallback = selectTopGeosForNetwork(beta, state, 1)[0]?.geo;
    assert.ok(fallback);
    assert.ok(["GB", "DE"].includes(fallback!));
  });

  test("seen resets on new day", () => {
    const net = sixGeoNetwork();
    let state = markGeosSeen(emptyCompletion(NOW), net.network, ["GB", "US"]);
    const stale = { ...state, day: "2026-07-07" };
    state = normalizeForToday(stale, NOW);
    assert.equal(getSeenGeosToday(state, net.network).size, 0);
  });

  test("seen clears when network dismissed", () => {
    const net = sixGeoNetwork();
    let state = recordGeosShown(emptyCompletion(NOW), net.network, ["GB"], NOW);
    state = toggleDone(state, testingNetworkKey(net.network), NOW);
    assert.equal(getSeenGeosToday(state, net.network).size, 0);
    assert.equal(getRecentGeos(state, net.network).length, 0);
  });
});

describe("campaign-backed plan selectors", () => {
  test("selectTopGeosFromPlan returns top incomplete GEOs by smart score", () => {
    const net = sixGeoNetwork();
    const top = selectTopGeosFromPlan(net, 3);
    assert.equal(top.length, 3);
    assert.ok(top.every((g) => g.doneToday < g.todayRequired));
    assert.deepEqual(
      top.map((g) => g.geo).sort(),
      ["FR", "GB", "US"],
    );
  });

  test("scoreGeoForMission boosts GEOs with no activity today", () => {
    const net = sixGeoNetwork();
    const geo = net.geos.find((g) => g.geo === "NL")!;
    const quiet = deriveGeoPerformanceMetrics(net, geo, { campaigns: [] });
    const active = { ...quiet, hasActivityToday: true };
    const quietScore = scoreGeoForMission(geo, net, quiet, 0, NOW);
    const activeScore = scoreGeoForMission(geo, net, active, 0, NOW);
    assert.ok(quietScore > activeScore);
  });

  test("scoreGeoForMission penalizes GEO worked in last 30 minutes", () => {
    const net = sixGeoNetwork();
    const geo = net.geos[0]!;
    const base = deriveGeoPerformanceMetrics(net, geo, { campaigns: [], now: NOW });
    const recent = {
      ...base,
      hasActivityToday: true,
      lastWorkedAtMs: NOW.getTime() - 5 * 60_000,
    };
    assert.ok(
      scoreGeoForMission(geo, net, base, 0, NOW) >
        scoreGeoForMission(geo, net, recent, 0, NOW),
    );
  });

  test("scoreGeoForMission rewards positive ROI and conversions", () => {
    const net = sixGeoNetwork();
    const geo = net.geos.find((g) => g.geo === "DE")!;
    const plain = deriveGeoPerformanceMetrics(net, geo, { campaigns: [], now: NOW });
    const hot = { ...plain, roi: 12, conversions: 3 };
    assert.ok(
      scoreGeoForMission(geo, net, hot, 0, NOW) >
        scoreGeoForMission(geo, net, plain, 0, NOW),
    );
  });

  test("scoreGeoForMission boosts larger GEOs within the network", () => {
    const net = twoNetworkPlan().testingNetworks[1]!;
    const gb = net.geos.find((g) => g.geo === "GB")!;
    const de = net.geos.find((g) => g.geo === "DE")!;
    const metrics = deriveGeoPerformanceMetrics(net, gb, { campaigns: [], now: NOW });
    assert.ok(
      scoreGeoForMission(gb, net, metrics, 0, NOW) >
        scoreGeoForMission(de, net, metrics, 0, NOW),
    );
  });

  test("scoreNetworkForMission ranks larger behind-pace networks higher", () => {
    const p = twoNetworkPlan();
    const alpha = p.testingNetworks[0]!;
    const beta = p.testingNetworks[1]!;
    assert.ok(scoreNetworkForMission(beta) > scoreNetworkForMission(alpha));
  });

  test("scoreNetworkForMission penalizes tiny networks", () => {
    const tiny = {
      ...twoNetworkPlan().testingNetworks[0]!,
      monthlyGoal: 8,
    };
    const normal = {
      ...twoNetworkPlan().testingNetworks[0]!,
      monthlyGoal: 10,
    };
    assert.ok(scoreNetworkForMission(normal) > scoreNetworkForMission(tiny));
  });

  test("scoreNetworkForMission boosts idle networks (anti-starvation)", () => {
    const net = twoNetworkPlan().testingNetworks[0]!;
    const at61 = scoreNetworkForMission(net, {
      now: NOW,
      campaigns: [
        {
          status: "live",
          campaignPurpose: "testing",
          createdAt: new Date(NOW.getTime() - 61 * 60_000).toISOString(),
          affiliateNetworkName: net.network,
          geo: "US",
        },
      ],
    });
    const at30 = scoreNetworkForMission(net, {
      now: NOW,
      campaigns: [
        {
          status: "live",
          campaignPurpose: "testing",
          createdAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
          affiliateNetworkName: net.network,
          geo: "US",
        },
      ],
    });
    assert.ok(at61 > at30);
    assert.equal(at61 - at30, 40);
  });

  test("scoreNetworkForMission strongly boosts networks idle over 2 hours", () => {
    const net = twoNetworkPlan().testingNetworks[0]!;
    const at61 = scoreNetworkForMission(net, {
      now: NOW,
      campaigns: [
        {
          affiliateNetworkName: net.network,
          geo: "US",
          createdAt: new Date(NOW.getTime() - 61 * 60_000).toISOString(),
        },
      ],
    });
    const at121 = scoreNetworkForMission(net, {
      now: NOW,
      campaigns: [
        {
          affiliateNetworkName: net.network,
          geo: "US",
          createdAt: new Date(NOW.getTime() - 121 * 60_000).toISOString(),
        },
      ],
    });
    assert.ok(at121 > at61);
    assert.equal(at121 - at61, 80);
  });

  test("scoreNetworkForMission caps never-touched networks at moderate idle", () => {
    const net = twoNetworkPlan().testingNetworks[0]!;
    const neverTouched = scoreNetworkForMission(net, { now: NOW, campaigns: [] });
    const longIdle = scoreNetworkForMission(net, {
      now: NOW,
      campaigns: [
        {
          affiliateNetworkName: net.network,
          geo: "US",
          createdAt: new Date(NOW.getTime() - 121 * 60_000).toISOString(),
        },
      ],
    });
    assert.ok(longIdle > neverTouched);
    assert.equal(longIdle - neverTouched, 120);
  });

  test("selectFocusTestingNetworksFromPlan puts top mission-score networks first", () => {
    const p = twoNetworkPlan();
    const ordered = selectFocusTestingNetworksFromPlan(p.testingNetworks);
    assert.equal(ordered[0]?.network, "BetaNet");
  });

  test("selectTopGeosAcrossPlan returns GEOs from top focus networks", () => {
    const p = twoNetworkPlan();
    const picks = selectTopGeosAcrossPlan(p, {}, { networkLimit: 1, geoLimit: 1 });
    assert.equal(picks.length, 1);
    assert.equal(picks[0]?.network, "BetaNet");
    assert.equal(picks[0]?.geo.geo, "GB");
  });

  test("campaign context affects ranking via recent-work penalty", () => {
    const net = sixGeoNetwork();
    const campaigns = [
      {
        status: "live",
        campaignPurpose: "testing",
        createdAt: NOW.toISOString(),
        affiliateNetworkName: net.network,
        geo: "GB",
        roi: 5,
        conversions: 1,
      },
    ];
    const withCampaigns = selectTopGeosFromPlan(net, 3, {
      campaigns,
      now: NOW,
    });
    assert.ok(!withCampaigns.some((g) => g.geo === "GB"));
  });

  test("completed GEOs drop out after plan reflects campaigns", () => {
    const net = sixGeoNetwork();
    const withProgress = {
      ...net,
      geos: net.geos.map((g) =>
        g.geo === "GB" ? { ...g, doneToday: g.todayRequired } : g,
      ),
    };
    const top = selectTopGeosFromPlan(withProgress, 3);
    assert.ok(!top.some((g) => g.geo === "GB"));
  });

  test("target met from plan when enough GEOs have campaigns today", () => {
    const net = sixGeoNetwork();
    const met = {
      ...net,
      geos: net.geos.map((g) => ({ ...g, doneToday: g.todayRequired })),
    };
    assert.equal(isTestingNetworkDailyTargetMetFromPlan(met), true);
    assert.equal(selectTopGeosFromPlan(met, 3).length, 0);
  });

  test("effectiveSummaryFromPlan uses plan.summary", () => {
    const p = twoNetworkPlan();
    const s = effectiveSummaryFromPlan(p);
    assert.equal(s.testsRequired, p.summary.testsRequired);
    assert.equal(s.testsDone, p.summary.testsDone);
  });

  test("selectNextActionFromPlan picks highest-priority incomplete GEO", () => {
    const p = twoNetworkPlan();
    const na = selectNextActionFromPlan(p);
    assert.equal(na?.network, "BetaNet");
    assert.equal(na?.geo, "GB");
  });

  test("isTestingGeoCompleteFromPlan requires daily quota", () => {
    assert.equal(isTestingGeoCompleteFromPlan({ todayRequired: 2, doneToday: 1 }), false);
    assert.equal(isTestingGeoCompleteFromPlan({ todayRequired: 2, doneToday: 2 }), true);
  });

  test("countCompletedGeosTodayFromPlan sums geo doneToday capped", () => {
    const beta = twoNetworkPlan().testingNetworks[1]!;
    assert.equal(countCompletedGeosTodayFromPlan(beta), 0);
  });
});

describe("legacy localStorage helpers (deprecated for UI)", () => {
  test("createEmptyMissionState matches emptyCompletion", () => {
    assert.deepEqual(createEmptyMissionState(NOW), emptyCompletion(NOW));
  });

  test("selectors tolerate null state", () => {
    const p = twoNetworkPlan();
    const beta = p.testingNetworks[1]!;
    assert.equal(countCompletedGeosToday(beta, null), beta.geos.reduce((s, g) => s + g.doneToday, 0));
    assert.ok(selectTopGeosForNetwork(beta, null, 1).length > 0);
    assert.ok(selectNextAction(p, null));
    assert.ok(computeEffectiveSummary(p, null).total > 0);
  });

  test("empty state ignores worker localStorage marks", () => {
    const beta = twoNetworkPlan().testingNetworks[1]!;
    let workerState = completeGeo(emptyCompletion(NOW), beta.network, "GB", NOW);
    workerState = completeGeo(workerState, beta.network, "DE", NOW);
    const adminState = createEmptyMissionState(NOW);
    assert.equal(countCompletedGeosToday(beta, workerState), 2);
    assert.equal(countCompletedGeosToday(beta, adminState), 0);
    assert.equal(isTestingNetworkDailyTargetMet(beta, workerState), true);
    assert.equal(isTestingNetworkDailyTargetMet(beta, adminState), false);
  });
});

describe("GEO anti-repeat memory (recentGeos)", () => {
  test("no immediate repeat in reuse mode", () => {
    const beta = betaNetExtendedTarget();
    let state = completeGeo(emptyCompletion(NOW), "BetaNet", "GB", NOW);
    state = completeGeo(state, "BetaNet", "DE", NOW);
    const first = selectTopGeosForNetwork(beta, state, 1)[0]!.geo;
    state = recordGeosShown(state, beta.network, [first], NOW);
    const second = selectTopGeosForNetwork(beta, state, 1)[0]!.geo;
    assert.notEqual(first, second);
  });

  test("no repeat within last MAX_RECENT_GEOS shown", () => {
    const net = sixGeoNetwork();
    let state = emptyCompletion(NOW);
    for (const geo of ["GB", "US", "DE", "FR", "IT", "NL"]) {
      state = completeGeo(state, net.network, geo, NOW);
    }
    state = recordGeosShown(state, net.network, ["GB", "US", "DE"], NOW);
    assert.deepEqual(getRecentGeos(state, net.network), ["gb", "us", "de"]);
    const pick = selectExtraGeoForNetwork(net, state, 0)[0]?.geo;
    assert.ok(pick);
    assert.ok(!["GB", "US", "DE"].includes(pick!));
  });

  test("recent buffer trims to MAX_RECENT_GEOS", () => {
    const net = sixGeoNetwork();
    let state = recordGeosShown(emptyCompletion(NOW), net.network, ["GB", "US"], NOW);
    state = recordGeosShown(state, net.network, ["DE", "FR"], NOW);
    assert.equal(getRecentGeos(state, net.network).length, MAX_RECENT_GEOS);
    assert.deepEqual(getRecentGeos(state, net.network), ["us", "de", "fr"]);
  });

  test("fallback when pool too small to avoid all recent GEOs", () => {
    const beta = betaNetExtendedTarget();
    let state = emptyCompletion(NOW);
    state = completeGeo(state, beta.network, "GB", NOW);
    state = completeGeo(state, beta.network, "DE", NOW);
    state = recordGeosShown(state, beta.network, ["GB", "DE"], NOW);
    const pick = selectTopGeosForNetwork(beta, state, 1)[0]?.geo;
    assert.ok(pick);
    assert.ok(["GB", "DE"].includes(pick!));
  });

  test("recent resets on new day", () => {
    const net = sixGeoNetwork();
    let state = recordGeosShown(emptyCompletion(NOW), net.network, ["GB"], NOW);
    const stale = { ...state, day: "2026-07-07" };
    state = normalizeForToday(stale, NOW);
    assert.equal(getRecentGeos(state, net.network).length, 0);
  });
});
