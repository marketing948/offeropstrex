import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalGeoKey,
  canonicalNetworkKey,
  countTestingCreatedToday,
  explainDailyMissionCampaignMatch,
} from "./daily-mission-board.ts";
import { selectRotatingGeosFromPlan } from "./daily-mission-completion.ts";
import type { TestingNetworkPlan } from "./monthly-goal-daily-plan.ts";

const NOW = new Date("2026-07-08T12:00:00Z");
const TODAY = "2026-07-08T10:00:00Z";
const YESTERDAY = "2026-07-06T10:00:00Z";

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    campaignPurpose: "testing",
    status: "live",
    createdAt: TODAY,
    liveStartedAt: TODAY,
    batchAffiliateNetwork: "BlueAffiliate",
    batchGeo: "US",
    employeeId: 7,
    ...overrides,
  };
}

describe("canonical keys", () => {
  test("GEO variants collapse to a single 2-letter code", () => {
    for (const v of ["US", "us", "US US", "🇺🇸 US", "  us  "]) {
      assert.equal(canonicalGeoKey(v), "US");
    }
  });
  test("network names normalize case + whitespace", () => {
    assert.equal(canonicalNetworkKey("Blue Affiliate"), "blue affiliate");
    assert.equal(canonicalNetworkKey("  Blue   Affiliate "), "blue affiliate");
  });
});

describe("countTestingCreatedToday — normalized matching (completion truth)", () => {
  test("real testing campaign created today matches employee + network + GEO", () => {
    const res = countTestingCreatedToday([campaign()], {
      now: NOW,
      network: "BlueAffiliate",
      geo: "US",
      employeeId: 7,
    });
    assert.equal(res.count, 1);
  });

  test("messy campaign GEO (US US / 🇺🇸 US / us) still matches plan GEO US", () => {
    for (const geo of ["US US", "🇺🇸 US", "us"]) {
      const res = countTestingCreatedToday([campaign({ batchGeo: geo })], {
        now: NOW,
        network: "BlueAffiliate",
        geo: "US",
        employeeId: 7,
      });
      assert.equal(res.count, 1, `expected match for GEO "${geo}"`);
    }
  });

  test("another employee's campaign does not count", () => {
    const res = countTestingCreatedToday([campaign({ employeeId: 99 })], {
      now: NOW,
      network: "BlueAffiliate",
      geo: "US",
      employeeId: 7,
    });
    assert.equal(res.count, 0);
  });

  test("wrong network does not count", () => {
    const res = countTestingCreatedToday(
      [campaign({ batchAffiliateNetwork: "Yieldkit" })],
      { now: NOW, network: "BlueAffiliate", geo: "US", employeeId: 7 },
    );
    assert.equal(res.count, 0);
  });

  test("wrong GEO does not count", () => {
    const res = countTestingCreatedToday([campaign({ batchGeo: "GB" })], {
      now: NOW,
      network: "BlueAffiliate",
      geo: "US",
      employeeId: 7,
    });
    assert.equal(res.count, 0);
  });

  test("working campaign does not count as testing", () => {
    const res = countTestingCreatedToday(
      [campaign({ campaignPurpose: "working" })],
      { now: NOW, network: "BlueAffiliate", geo: "US", employeeId: 7 },
    );
    assert.equal(res.count, 0);
  });

  test("yesterday's testing campaign does not count", () => {
    const res = countTestingCreatedToday(
      [campaign({ createdAt: YESTERDAY, liveStartedAt: YESTERDAY })],
      { now: NOW, network: "BlueAffiliate", geo: "US", employeeId: 7 },
    );
    assert.equal(res.count, 0);
  });
});

describe("explainDailyMissionCampaignMatch (diagnostic)", () => {
  test("explains a full match with normalized values", () => {
    const out = explainDailyMissionCampaignMatch(
      campaign({ batchGeo: "🇺🇸 US", batchAffiliateNetwork: "  blueaffiliate " }),
      { id: 7 },
      "BlueAffiliate",
      "US",
      NOW,
    );
    assert.equal(out.networkMatch, true);
    assert.equal(out.geoMatch, true);
    assert.equal(out.purposeMatch, true);
    assert.equal(out.dateMatch, true);
    assert.equal(out.finalMatch, true);
    assert.equal(out.normalized.campaignGeo, "US");
    assert.equal(out.normalized.planGeo, "US");
    assert.equal(out.normalized.campaignNetwork, "blueaffiliate");
    assert.equal(out.normalized.planNetwork, "blueaffiliate");
  });

  test("pinpoints the failing dimension (GEO mismatch)", () => {
    const out = explainDailyMissionCampaignMatch(
      campaign({ batchGeo: "GB" }),
      { id: 7 },
      "BlueAffiliate",
      "US",
      NOW,
    );
    assert.equal(out.geoMatch, false);
    assert.equal(out.finalMatch, false);
  });
});

function geo(code: string, todayRequired = 1, doneToday = 0) {
  return {
    geo: code,
    monthlyTarget: 20,
    current: 0,
    expectedByNow: 5,
    dailyExpected: 1,
    gapToPace: 5,
    todayRequired,
    doneToday,
    remaining: 20,
  };
}

function plan(geos: ReturnType<typeof geo>[]): TestingNetworkPlan {
  return {
    network: "BlueAffiliate",
    todayRequired: geos.reduce((s, g) => s + g.todayRequired, 0),
    monthlyGoal: 100,
    geoCount: geos.length,
    doneToday: 0,
    paceStatus: "behind",
    geos,
  };
}

describe("selectRotatingGeosFromPlan (suggestion rotation)", () => {
  const net = plan([geo("US"), geo("GB"), geo("DE"), geo("FR"), geo("CA"), geo("AU")]);

  test("initial view shows up to 3 incomplete GEOs", () => {
    const first = selectRotatingGeosFromPlan(net, 3, 0);
    assert.equal(first.length, 3);
  });

  test("refresh returns unseen incomplete GEOs, not a reorder of the same three", () => {
    const first = selectRotatingGeosFromPlan(net, 3, 0).map((g) => g.geo);
    const second = selectRotatingGeosFromPlan(net, 3, 1).map((g) => g.geo);
    assert.equal(second.length, 3);
    for (const code of second) {
      assert.ok(!first.includes(code), `${code} should not repeat immediately`);
    }
  });

  test("never returns completed GEOs (completion recomputed from plan)", () => {
    const withDone = plan([geo("US", 1, 1), geo("GB"), geo("DE")]);
    const out = selectRotatingGeosFromPlan(withDone, 3, 0).map((g) => g.geo);
    assert.ok(!out.includes("US"));
  });

  test("small pool wraps instead of fabricating extra GEOs", () => {
    const small = plan([geo("US"), geo("GB")]);
    assert.equal(selectRotatingGeosFromPlan(small, 3, 5).length, 2);
  });

  test("refresh independence: rotating one network never changes another", () => {
    // Two distinct networks. Rotation is a pure function of (plan, refreshCount),
    // so advancing BlueAffiliate's counter cannot affect Noctemque's window.
    const blue = plan([geo("US"), geo("GB"), geo("DE"), geo("FR"), geo("CA")]);
    const noct: TestingNetworkPlan = {
      ...plan([geo("IT"), geo("NL"), geo("ES"), geo("PL")]),
      network: "Noctemque",
    };
    const noctBefore = selectRotatingGeosFromPlan(noct, 3, 0).map((g) => g.geo);
    // BlueAffiliate refreshed several times; Noctemque counter untouched.
    selectRotatingGeosFromPlan(blue, 3, 3);
    const noctAfter = selectRotatingGeosFromPlan(noct, 3, 0).map((g) => g.geo);
    assert.deepEqual(noctAfter, noctBefore);
  });

  test("completing a suggested GEO removes it from candidates and never regresses", () => {
    const before = selectRotatingGeosFromPlan(
      plan([geo("US"), geo("GB"), geo("FR")]),
      3,
      0,
    ).map((g) => g.geo);
    assert.ok(before.includes("US"));
    // Same plan after a real testing campaign marks US done today.
    const after = selectRotatingGeosFromPlan(
      plan([geo("US", 1, 1), geo("GB"), geo("FR")]),
      3,
      0,
    ).map((g) => g.geo);
    assert.ok(!after.includes("US"), "completed US must drop out of suggestions");
  });

  test("wrap-around exposes every incomplete GEO and fabricates none", () => {
    const net5 = plan([geo("US"), geo("GB"), geo("DE"), geo("FR"), geo("CA")]);
    const seen = new Set<string>();
    for (let r = 0; r < 4; r++) {
      for (const g of selectRotatingGeosFromPlan(net5, 3, r)) seen.add(g.geo);
    }
    // Every real incomplete GEO surfaces across refreshes; nothing extra invented.
    assert.deepEqual([...seen].sort(), ["CA", "DE", "FR", "GB", "US"]);
  });
});
