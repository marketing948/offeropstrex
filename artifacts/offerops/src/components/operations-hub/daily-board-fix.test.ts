/**
 * Focused tests for the Daily Board production fix:
 *   - canonical adapter `toDailyMissionCampaign` + `explainDailyMissionCampaignMatch`
 *   - full Monthly-Goal suggestion pool + per-network Refresh rotation / exhaustion
 *   - distinct-GEO completion from real campaigns
 *   - `invalidateDailyBoardData` cache wiring
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  toDailyMissionCampaign,
  explainDailyMissionCampaignMatch,
} from "./daily-mission-board.ts";
import {
  buildTestingNetworkPlans,
  type TestingNetworkPlan,
} from "./monthly-goal-daily-plan.ts";
import {
  selectRotatingGeosFromPlan,
  selectTopGeosFromPlan,
  countCompletedGeosTodayFromPlan,
  countIncompleteSuggestionGeosFromPlan,
  isTestingNetworkDailyTargetMetFromPlan,
} from "./daily-mission-completion.ts";
import type { NetworkGeoSlice } from "./ops-goal-focus.ts";

const NOW = new Date("2026-07-13T12:00:00"); // Monday mid-month, local time
const MONTH = "2026-07";

function testingCampaign(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "live",
    campaignPurpose: "testing",
    createdAt: "2026-07-13T09:00:00",
    liveStartedAt: "2026-07-13T09:30:00",
    affiliateNetworkName: "Yieldkit PAP",
    geo: "US",
    employeeId: 42,
    ...over,
  };
}

// ── PART 3: canonical adapter ────────────────────────────────────────────────
describe("toDailyMissionCampaign (canonical adapter)", () => {
  test("resolves purpose testing / not_testing / null", () => {
    assert.equal(toDailyMissionCampaign(testingCampaign())!.purpose, "testing");
    assert.equal(
      toDailyMissionCampaign(testingCampaign({ campaignPurpose: "working" }))!.purpose,
      "not_testing",
    );
    assert.equal(
      toDailyMissionCampaign(testingCampaign({ campaignPurpose: "scaling" }))!.purpose,
      "not_testing",
    );
    assert.equal(
      toDailyMissionCampaign(testingCampaign({ campaignPurpose: "" }))!.purpose,
      null,
    );
  });

  test("normalizes GEO variants to ISO-2 uppercase", () => {
    for (const g of ["us", "US", "US US", "🇺🇸 US", "  us "]) {
      assert.equal(toDailyMissionCampaign(testingCampaign({ geo: g }))!.geoCode, "US");
    }
  });

  test("employee owner: employeeId → createdByEmployeeId → batchEmployeeId", () => {
    assert.equal(
      toDailyMissionCampaign(testingCampaign({ employeeId: 7 }))!.employeeId,
      7,
    );
    assert.equal(
      toDailyMissionCampaign(
        testingCampaign({ employeeId: null, createdByEmployeeId: 8 }),
      )!.employeeId,
      8,
    );
    assert.equal(
      toDailyMissionCampaign(
        testingCampaign({ employeeId: null, createdByEmployeeId: null, batchEmployeeId: 9 }),
      )!.employeeId,
      9,
    );
    assert.equal(
      toDailyMissionCampaign(
        testingCampaign({ employeeId: null, createdByEmployeeId: null, batchEmployeeId: null }),
      )!.employeeId,
      null,
    );
  });

  test("prefers stable network id when present", () => {
    assert.equal(
      toDailyMissionCampaign(testingCampaign({ affiliateNetworkId: 55 }))!.networkId,
      55,
    );
    assert.equal(
      toDailyMissionCampaign(
        testingCampaign({ affiliateNetworkId: null, batchAffiliateNetworkId: 66 }),
      )!.networkId,
      66,
    );
  });
});

// ── PART 2/3: completion matrix via explain ──────────────────────────────────
describe("explainDailyMissionCampaignMatch (completion truth)", () => {
  test("1) qualifying testing campaign today → finalMatch true", () => {
    const ex = explainDailyMissionCampaignMatch(
      testingCampaign(),
      { id: 42 },
      "Yieldkit PAP",
      "US",
      NOW,
    );
    assert.equal(ex.finalMatch, true);
  });

  test("2) manual/task-drawer testing campaign (batch owner) counts", () => {
    const ex = explainDailyMissionCampaignMatch(
      testingCampaign({ employeeId: null, batchEmployeeId: 42 }),
      { id: 42 },
      "Yieldkit PAP",
      "US",
      NOW,
    );
    assert.equal(ex.employeeMatch, true);
    assert.equal(ex.finalMatch, true);
  });

  test("4) a different employee does not count", () => {
    const ex = explainDailyMissionCampaignMatch(
      testingCampaign({ employeeId: 99 }),
      { id: 42 },
      "Yieldkit PAP",
      "US",
      NOW,
    );
    assert.equal(ex.employeeMatch, false);
    assert.equal(ex.finalMatch, false);
  });

  test("5) working/scaling campaign does not count", () => {
    const ex = explainDailyMissionCampaignMatch(
      testingCampaign({ campaignPurpose: "working" }),
      { id: 42 },
      "Yieldkit PAP",
      "US",
      NOW,
    );
    assert.equal(ex.purposeMatch, false);
    assert.equal(ex.finalMatch, false);
  });

  test("6) unknown purpose does not count", () => {
    const ex = explainDailyMissionCampaignMatch(
      testingCampaign({ campaignPurpose: "" }),
      { id: 42 },
      "Yieldkit PAP",
      "US",
      NOW,
    );
    assert.equal(ex.purposeMatch, false);
  });

  test("7) date boundary: yesterday does not count, today does", () => {
    const yesterday = explainDailyMissionCampaignMatch(
      testingCampaign({ createdAt: "2026-07-12T09:00:00", liveStartedAt: null }),
      { id: 42 },
      "Yieldkit PAP",
      "US",
      NOW,
    );
    assert.equal(yesterday.dateMatch, false);
    const today = explainDailyMissionCampaignMatch(
      testingCampaign({ createdAt: "2026-07-13T00:05:00", liveStartedAt: null }),
      { id: 42 },
      "Yieldkit PAP",
      "US",
      NOW,
    );
    assert.equal(today.dateMatch, true);
  });

  test("9/10) normalized network + GEO fallbacks match", () => {
    const ex = explainDailyMissionCampaignMatch(
      testingCampaign({ affiliateNetworkName: "  yieldkit   pap ", geo: "🇺🇸 US" }),
      { id: 42 },
      "YIELDKIT PAP",
      "us",
      NOW,
    );
    assert.equal(ex.networkMatch, true);
    assert.equal(ex.geoMatch, true);
    assert.equal(ex.finalMatch, true);
  });

  test("wrong GEO → geoMatch false", () => {
    const ex = explainDailyMissionCampaignMatch(
      testingCampaign({ geo: "GB" }),
      { id: 42 },
      "Yieldkit PAP",
      "US",
      NOW,
    );
    assert.equal(ex.geoMatch, false);
    assert.equal(ex.finalMatch, false);
  });
});

// ── PART 4/5: full suggestion pool + rotation ────────────────────────────────
function sixGeoSlices(network = "BlueAffiliate CBV"): NetworkGeoSlice[] {
  return ["GB", "US", "DE", "FR", "IT", "NL"].map((geo) => ({
    network,
    geo,
    current: 0,
    target: 40,
  }));
}

describe("Monthly-Goal suggestion pool + Refresh rotation", () => {
  test("11) plan exposes the FULL 6-GEO pool for suggestions", () => {
    const plans = buildTestingNetworkPlans(sixGeoSlices(), [], MONTH, NOW);
    const net = plans[0]!;
    assert.equal(net.suggestionGeos.length, 6);
    assert.deepEqual(
      net.suggestionGeos.map((g) => g.geo).sort(),
      ["DE", "FR", "GB", "IT", "NL", "US"],
    );
    // Initial window is 3.
    assert.equal(selectRotatingGeosFromPlan(net, 3, 0).length, 3);
  });

  test("12) refresh returns the next unseen three from the 6-GEO pool", () => {
    const net = buildTestingNetworkPlans(sixGeoSlices(), [], MONTH, NOW)[0]!;
    const w0 = selectRotatingGeosFromPlan(net, 3, 0).map((g) => g.geo);
    const w1 = selectRotatingGeosFromPlan(net, 3, 1).map((g) => g.geo);
    assert.equal(w0.length, 3);
    assert.equal(w1.length, 3);
    assert.notDeepEqual(w0, w1);
    // Together they cover all 6 (a genuine next window, not a reorder).
    assert.deepEqual([...w0, ...w1].sort(), ["DE", "FR", "GB", "IT", "NL", "US"]);
  });

  test("13) refresh changes only the selected network", () => {
    const a = buildTestingNetworkPlans(sixGeoSlices("NetA"), [], MONTH, NOW)[0]!;
    const b = buildTestingNetworkPlans(sixGeoSlices("NetB"), [], MONTH, NOW)[0]!;
    const bBefore = selectRotatingGeosFromPlan(b, 3, 0).map((g) => g.geo);
    // Advancing A's counter must not touch B's selection (state is per-network).
    selectRotatingGeosFromPlan(a, 3, 5);
    const bAfter = selectRotatingGeosFromPlan(b, 3, 0).map((g) => g.geo);
    assert.deepEqual(bBefore, bAfter);
  });

  test("16/18) a completed GEO is removed from suggestions (never reused as work)", () => {
    const net = buildTestingNetworkPlans(
      sixGeoSlices(),
      [testingCampaign({ id: 1, affiliateNetworkName: "BlueAffiliate CBV", geo: "US" })],
      MONTH,
      NOW,
    )[0]!;
    const codes = selectTopGeosFromPlan(net, 6).map((g) => g.geo);
    assert.ok(!codes.includes("US"), "tested US must not be an active suggestion");
    assert.equal(codes.length, 5);
  });

  test("17) exactly three goal GEOs → exhausted (refresh cannot rotate)", () => {
    const three: NetworkGeoSlice[] = ["GB", "US", "FR"].map((geo) => ({
      network: "SmallNet",
      geo,
      current: 0,
      target: 40,
    }));
    const net = buildTestingNetworkPlans(three, [], MONTH, NOW)[0]!;
    const w0 = selectRotatingGeosFromPlan(net, 3, 0).map((g) => g.geo).sort();
    const w1 = selectRotatingGeosFromPlan(net, 3, 1).map((g) => g.geo).sort();
    assert.deepEqual(w0, w1); // no new GEOs to show
    assert.equal(countIncompleteSuggestionGeosFromPlan(net), 3);
  });
});

// ── PART 3 acceptance: distinct-GEO completion ───────────────────────────────
describe("distinct-GEO completion from real campaigns", () => {
  test("testing any goal GEO advances network progress + marks it done", () => {
    const plans = buildTestingNetworkPlans(
      sixGeoSlices(),
      [
        testingCampaign({ id: 1, affiliateNetworkName: "BlueAffiliate CBV", geo: "US" }),
        testingCampaign({ id: 2, affiliateNetworkName: "BlueAffiliate CBV", geo: "NL" }),
      ],
      MONTH,
      NOW,
    );
    const net = plans[0]!;
    // Two distinct goal GEOs tested today → progress ≥ 2.
    assert.ok(countCompletedGeosTodayFromPlan(net) >= 2);
    const done = net.suggestionGeos.filter((g) => (g.doneToday ?? 0) > 0).map((g) => g.geo).sort();
    assert.deepEqual(done, ["NL", "US"]);
  });

  test("empty campaigns → zero completion (0/N is honest, never fabricated)", () => {
    const net = buildTestingNetworkPlans(sixGeoSlices(), [], MONTH, NOW)[0]!;
    assert.equal(countCompletedGeosTodayFromPlan(net), 0);
    assert.equal(isTestingNetworkDailyTargetMetFromPlan(net), false);
  });
});
