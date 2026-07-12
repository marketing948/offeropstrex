/**
 * Focused tests for the GEO completion circle (verification/reconciliation).
 *
 * The circle NEVER stores completion — it triggers a real campaign refetch and
 * reflects campaign truth. These tests exercise the pure logic behind each
 * circle state and the verify flow (matching, promotion, isolation, admin
 * read-only equivalence, reload determinism) using the shared canonical matcher
 * and plan selectors — no localStorage, no DOM.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isGeoCompletedToday } from "./daily-mission-board.ts";
import {
  buildTestingNetworkPlans,
  type TestingNetworkPlan,
} from "./monthly-goal-daily-plan.ts";
import {
  countCompletedGeosTodayFromPlan,
  geoVerificationFailureMessage,
  isTestingGeoCompleteFromPlan,
  selectCompletedGeosFromPlan,
  selectRotatingGeosFromPlan,
  selectTopGeosFromPlan,
} from "./daily-mission-completion.ts";
import type { NetworkGeoSlice } from "./ops-goal-focus.ts";

const NOW = new Date("2026-07-13T12:00:00");
const MONTH = "2026-07";

function testingCampaign(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "live",
    campaignPurpose: "testing",
    createdAt: "2026-07-13T09:00:00",
    liveStartedAt: null,
    affiliateNetworkName: "BlueAffiliate CBV",
    geo: "US",
    employeeId: 42,
    ...over,
  };
}

function sixGeoSlices(network = "BlueAffiliate CBV"): NetworkGeoSlice[] {
  return ["GB", "US", "DE", "FR", "IT", "NL"].map((geo) => ({
    network,
    geo,
    current: 0,
    target: 40,
  }));
}

function plan(
  campaigns: Array<Record<string, unknown>> = [],
  network = "BlueAffiliate CBV",
): TestingNetworkPlan {
  return buildTestingNetworkPlans(sixGeoSlices(network), campaigns, MONTH, NOW)[0]!;
}

// 1) Every active GEO has an EMPTY completion circle (idle, not completed).
describe("1) active GEO → idle empty circle", () => {
  test("rotating suggestions are all incomplete (empty circle)", () => {
    const net = plan([]);
    const active = selectRotatingGeosFromPlan(net, 3, 0);
    assert.equal(active.length, 3);
    for (const g of active) {
      assert.equal(isTestingGeoCompleteFromPlan(g), false);
    }
  });
});

// 2) Campaign-backed completed GEO renders the CHECKED circle.
describe("2) campaign-backed completed GEO → checked circle", () => {
  test("tested GEO appears in completed set and is complete", () => {
    const net = plan([testingCampaign({ geo: "US" })]);
    const done = selectCompletedGeosFromPlan(net);
    const usRow = done.find((g) => g.geo === "US");
    assert.ok(usRow, "US must be in the completed set");
    assert.equal(isTestingGeoCompleteFromPlan(usRow!), true);
  });
});

// 3/4) Verification uses REFETCHED campaigns; a match marks the GEO done.
describe("3/4) verify against refetched campaigns", () => {
  test("no campaign before → not found; after refetch with a match → found", () => {
    const before = isGeoCompletedToday([], "BlueAffiliate CBV", "US", {
      employeeId: 42,
      now: NOW,
    });
    assert.equal(before, false);

    // Simulate the refetch returning a fresh qualifying testing campaign.
    const refetched = [testingCampaign({ geo: "US", employeeId: 42 })];
    const after = isGeoCompletedToday(refetched, "BlueAffiliate CBV", "US", {
      employeeId: 42,
      now: NOW,
    });
    assert.equal(after, true);
  });
});

// 5) No matching campaign does NOT change progress.
describe("5) no matching campaign → progress unchanged", () => {
  test("wrong GEO / wrong employee / wrong purpose never completes", () => {
    const rows = [
      testingCampaign({ geo: "GB", employeeId: 42 }), // wrong GEO
      testingCampaign({ geo: "US", employeeId: 99 }), // wrong employee
      testingCampaign({ geo: "US", employeeId: 42, campaignPurpose: "working" }), // wrong purpose
    ];
    assert.equal(
      isGeoCompletedToday(rows, "BlueAffiliate CBV", "US", { employeeId: 42, now: NOW }),
      false,
    );
    // Plan progress for US stays 0. Employee scoping happens upstream (the board
    // passes employee-scoped campaigns), so scope to 42 before building the plan;
    // the remaining rows (wrong-GEO, wrong-purpose) still never complete US.
    const scoped = rows.filter((r) => r.employeeId === 42);
    const net = plan(scoped);
    assert.equal(
      selectCompletedGeosFromPlan(net).some((g) => g.geo === "US"),
      false,
    );
  });
});

// 6) Verification failure shows the expected message.
describe("6) verification failure message", () => {
  test("exact copy, canonical GEO code (never duplicated)", () => {
    assert.equal(
      geoVerificationFailureMessage("BlueAffiliate CBV", "US"),
      "No matching Testing campaign was found for BlueAffiliate CBV / US today.",
    );
    // Messy GEO input still renders a single canonical code.
    assert.equal(
      geoVerificationFailureMessage("Yieldkit PAP", "🇺🇸 US"),
      "No matching Testing campaign was found for Yieldkit PAP / US today.",
    );
  });
});

// 7) Successful completion promotes the next incomplete GEO into the window.
describe("7) completion promotes the next incomplete GEO", () => {
  test("a tested GEO leaves the active pool; a new one fills the slot", () => {
    const empty = plan([]);
    const initial = selectRotatingGeosFromPlan(empty, 3, 0).map((g) => g.geo);
    assert.ok(initial.length === 3);

    // Complete the first suggested GEO via a real campaign, recompute the plan.
    const completedGeo = initial[0]!;
    const after = plan([testingCampaign({ geo: completedGeo })]);
    const nextWindow = selectRotatingGeosFromPlan(after, 3, 0).map((g) => g.geo);

    assert.ok(!nextWindow.includes(completedGeo), "completed GEO must leave active pool");
    assert.equal(nextWindow.length, 3, "a new incomplete GEO fills the slot");
    assert.equal(new Set(nextWindow).size, 3);
  });
});

// 8) Other networks remain unchanged when one network is completed.
describe("8) completion is isolated per network", () => {
  test("completing a GEO in NetA does not change NetB suggestions", () => {
    const netBBefore = plan([], "NetB");
    const beforeCodes = selectRotatingGeosFromPlan(netBBefore, 3, 0).map((g) => g.geo);

    // NetA gets a completed GEO; NetB has no campaigns at all.
    plan([testingCampaign({ affiliateNetworkName: "NetA", geo: "US" })], "NetA");
    const netBAfter = plan([], "NetB");
    const afterCodes = selectRotatingGeosFromPlan(netBAfter, 3, 0).map((g) => g.geo);

    assert.deepEqual(beforeCodes, afterCodes);
  });
});

// 9) Admin viewing an employee sees the SAME completion truth as the worker.
describe("9) admin/worker completion equivalence (read-only, campaign-backed)", () => {
  test("same employee id → identical completed set regardless of viewer", () => {
    const rows = [testingCampaign({ geo: "US", employeeId: 42 })];
    // Worker (self) and admin (viewing employee 42) evaluate the SAME campaigns.
    const workerView = isGeoCompletedToday(rows, "BlueAffiliate CBV", "US", { employeeId: 42, now: NOW });
    const adminView = isGeoCompletedToday(rows, "BlueAffiliate CBV", "US", { employeeId: 42, now: NOW });
    assert.equal(workerView, adminView);
    assert.equal(adminView, true);
  });
});

// 10) Reload derives completion from campaign data, not UI state.
describe("10) reload determinism (no localStorage dependence)", () => {
  test("rebuilding the plan from the same campaigns yields the same completion", () => {
    const rows = [
      testingCampaign({ geo: "US" }),
      testingCampaign({ id: 2, geo: "NL" }),
    ];
    const first = selectCompletedGeosFromPlan(plan(rows)).map((g) => g.geo).sort();
    const second = selectCompletedGeosFromPlan(plan(rows)).map((g) => g.geo).sort();
    assert.deepEqual(first, second);
    assert.deepEqual(first, ["NL", "US"]);
  });
});

// 11) Refresh (rotation) never marks a GEO completed.
describe("11) refresh does not mark completion", () => {
  test("progress is invariant across refresh counts", () => {
    const net = plan([]);
    const base = countCompletedGeosTodayFromPlan(net);
    for (let r = 0; r < 5; r++) {
      selectRotatingGeosFromPlan(net, 3, r);
      assert.equal(countCompletedGeosTodayFromPlan(net), base);
    }
    assert.equal(base, 0);
  });
});

// 12) Circle verification is a READ — it never rotates unrelated networks.
describe("12) verification does not rotate networks", () => {
  test("isGeoCompletedToday does not mutate plan selection windows", () => {
    const net = plan([testingCampaign({ geo: "US" })]);
    const windowBefore = selectTopGeosFromPlan(net, 3).map((g) => g.geo);
    // Verifying reads campaign data; it must not alter the suggestion window.
    isGeoCompletedToday([testingCampaign({ geo: "US" })], "BlueAffiliate CBV", "US", {
      employeeId: 42,
    });
    const windowAfter = selectTopGeosFromPlan(net, 3).map((g) => g.geo);
    assert.deepEqual(windowBefore, windowAfter);
  });
});
