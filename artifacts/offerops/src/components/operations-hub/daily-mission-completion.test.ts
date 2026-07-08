/**
 * "Done for today" worker convenience layer — focused tests (pure, no DOM).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEffectiveSummary,
  emptyCompletion,
  isDone,
  localDayKey,
  normalizeForToday,
  optimizationKey,
  scalingKey,
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
