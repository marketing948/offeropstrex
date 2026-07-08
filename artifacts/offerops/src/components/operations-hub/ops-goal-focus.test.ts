import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateCatchUpAcrossSlices,
  buildAdminInterventionFocus,
  buildDailyFocusActions,
  buildRevenueRescueAction,
  computeGoalBasedFocus,
  priorityScore,
  suggestReportsAction,
  type GoalCardModel,
  type NetworkGeoSlice,
  REVENUE_BEHIND_THRESHOLD_PCT,
} from "./ops-goal-focus.ts";
import { evaluatePace } from "./ops-v2-metrics.ts";
import { isScalingOpportunity } from "./scaling-opportunity.ts";

const NOW = new Date("2026-07-08T12:00:00Z");
const MONTH = "2026-07";

function makeCard(
  kind: GoalCardModel["kind"],
  actual: number,
  target: number,
): GoalCardModel {
  return {
    kind,
    label: kind,
    icon: kind,
    actual,
    target,
    gap: Math.max(0, target - actual),
    pace: evaluatePace(actual, target, MONTH, NOW),
    format: kind === "revenue" ? "currency" : "count",
  };
}

describe("scaling opportunity", () => {
  test("requires profit >0, ROI >0, live >=2 days", () => {
    assert.equal(
      isScalingOpportunity({
        campaignPurpose: "working",
        status: "live",
        profit: 261,
        roi: 12.4,
        liveStartedAt: "2026-07-01T00:00:00Z",
        now: NOW,
      }),
      true,
    );
    assert.equal(
      isScalingOpportunity({
        campaignPurpose: "working",
        status: "live",
        profit: -10,
        roi: 12,
        liveStartedAt: "2026-07-01T00:00:00Z",
        now: NOW,
      }),
      false,
    );
    assert.equal(
      isScalingOpportunity({
        campaignPurpose: "working",
        status: "live",
        profit: 100,
        roi: -5,
        liveStartedAt: "2026-07-01T00:00:00Z",
        now: NOW,
      }),
      false,
    );
    assert.equal(
      isScalingOpportunity({
        campaignPurpose: "working",
        status: "live",
        profit: 100,
        roi: 10,
        liveStartedAt: "2026-07-07T00:00:00Z",
        now: NOW,
      }),
      false,
    );
  });
});

describe("priority / allocation", () => {
  test("performance boost prioritizes profitable network when gaps similar", () => {
    const cold: NetworkGeoSlice = {
      network: "ColdNet",
      geo: "US",
      current: 40,
      target: 230,
      revenue: 0,
      profit: 0,
      roi: 0,
    };
    const hot: NetworkGeoSlice = {
      network: "HotNet",
      geo: "GB",
      current: 40,
      target: 230,
      revenue: 5000,
      profit: 800,
      roi: 20,
    };
    assert.ok(priorityScore(hot, MONTH, NOW) > priorityScore(cold, MONTH, NOW));
  });

  test("testing catch-up allocates across network/GEO", () => {
    const slices: NetworkGeoSlice[] = [
      { network: "Yieldkit CBV", geo: "GB", current: 10, target: 100, profit: 100 },
      { network: "BlueAffiliate CBV", geo: "DE", current: 5, target: 80, profit: 50 },
      { network: "Shoplooks PAP", geo: "US", current: 8, target: 90, profit: 0 },
    ];
    const rows = allocateCatchUpAcrossSlices(slices, 9, MONTH, NOW);
    assert.ok(rows.length >= 1);
    assert.equal(rows.reduce((s, r) => s + r.count, 0), 9);
  });
});

describe("buildDailyFocusActions", () => {
  test("behind testing produces testing action with network/GEO split", () => {
    const items = buildDailyFocusActions({
      monthKey: MONTH,
      now: NOW,
      goalCards: [
        makeCard("revenue", 50_000, 50_000),
        makeCard("testing", 40, 230),
        makeCard("working", 60, 60),
      ],
      slices: {
        testing: [
          { network: "Yieldkit CBV", geo: "GB", current: 10, target: 80, profit: 200 },
          { network: "BlueAffiliate CBV", geo: "DE", current: 5, target: 70, profit: 50 },
        ],
        working: [],
        revenue: [],
      },
    });
    const testing = items.find((i) => i.context?.actionType === "testing_action");
    assert.ok(testing);
    assert.match(testing!.text, /Create \d+ testing campaign/);
    assert.ok((testing!.context?.allocationLines?.length ?? 0) > 0);
  });

  test("working behind pace produces working action", () => {
    const items = buildDailyFocusActions({
      monthKey: MONTH,
      now: NOW,
      goalCards: [
        makeCard("revenue", 50_000, 50_000),
        makeCard("testing", 230, 230),
        makeCard("working", 20, 98),
      ],
      slices: {
        testing: [],
        working: [{ network: "NT FXH", geo: "NL", current: 5, target: 40, profit: 10 }],
        revenue: [],
      },
    });
    assert.ok(items.some((i) => i.context?.actionType === "working_action"));
  });

  test("revenue actions are never returned in Today Focus", () => {
    const mild = makeCard("revenue", 55, 60);
    const itemsMild = buildDailyFocusActions({
      monthKey: MONTH,
      now: NOW,
      goalCards: [mild, makeCard("testing", 230, 230), makeCard("working", 98, 98)],
      slices: { testing: [], working: [], revenue: [{ network: "A", current: 55, target: 60 }] },
    });
    assert.equal(itemsMild.some((i) => i.context?.actionType === "revenue_rescue"), false);

    const itemsSevere = buildDailyFocusActions({
      monthKey: MONTH,
      now: NOW,
      goalCards: [
        makeCard("revenue", 10_000, 100_000),
        makeCard("testing", 10, 230),
        makeCard("working", 98, 98),
      ],
      slices: {
        testing: [{ network: "Y", geo: "GB", current: 2, target: 80 }],
        working: [],
        revenue: [{ network: "Y", geo: "GB", current: 10_000, target: 100_000, profit: 1 }],
      },
    });
    assert.ok(itemsSevere[0]?.context?.actionType === "testing_action");
    assert.equal(itemsSevere.some((i) => i.context?.actionType === "revenue_rescue"), false);
    assert.equal(itemsSevere.some((i) => /revenue/i.test(i.title)), false);
  });

  test("missing offer count produces campaign health action", () => {
    const items = buildDailyFocusActions({
      monthKey: MONTH,
      now: NOW,
      goalCards: [
        makeCard("revenue", 50_000, 50_000),
        makeCard("testing", 230, 230),
        makeCard("working", 90, 60),
      ],
      slices: { testing: [], working: [], revenue: [] },
      campaigns: [
        { id: 1, status: "live", campaignPurpose: "working", offerCount: null },
        { id: 2, status: "live", campaignPurpose: "working", offerCount: null },
      ],
    });
    assert.ok(items.some((i) => i.context?.actionType === "campaign_health"));
  });

  test("admin view uses employee intervention wording", () => {
    const items = buildDailyFocusActions({
      monthKey: MONTH,
      now: NOW,
      isAdmin: true,
      employeeName: "Sara",
      goalCards: [
        makeCard("revenue", 50_000, 50_000),
        makeCard("testing", 40, 230),
        makeCard("working", 60, 60),
      ],
      slices: {
        testing: [{ network: "Yieldkit CBV", geo: "GB", current: 10, target: 80 }],
        working: [],
        revenue: [],
      },
    });
    const testing = items.find((i) => i.context?.actionType === "testing_action");
    assert.ok(testing);
    assert.match(testing!.text, /^Sara needs /);
    assert.equal(testing!.context?.employeeName, "Sara");
  });

  test("max 5 actions returned", () => {
    const items = buildDailyFocusActions({
      monthKey: MONTH,
      now: NOW,
      maxActions: 5,
      goalCards: [
        makeCard("revenue", 5_000, 100_000),
        makeCard("testing", 10, 230),
        makeCard("working", 5, 98),
      ],
      slices: {
        testing: [{ network: "A", current: 1, target: 80 }],
        working: [{ network: "B", current: 1, target: 40 }],
        revenue: [{ network: "A", current: 5_000, target: 100_000, profit: 1 }],
      },
      campaigns: [
        { id: 1, status: "live", campaignPurpose: "working", offerCount: null },
        {
          id: 2,
          status: "live",
          campaignPurpose: "working",
          offerCount: 2,
          revenue: 500,
          cost: 100,
          roi: 20,
          liveStartedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });
    assert.ok(items.length <= 5);
  });

  test("no goal produces No goals set", () => {
    const items = computeGoalBasedFocus(
      [makeCard("revenue", 0, 0), makeCard("testing", 0, 0), makeCard("working", 0, 0)],
      [],
      MONTH,
    );
    assert.ok(items.some((i) => /No goals set/i.test(i.text) || i.title === "No goals set"));
  });
});

describe("suggestReportsAction", () => {
  test("network row testing behind suggests create X", () => {
    const msg = suggestReportsAction({
      metric: "testing",
      current: 10,
      target: 230,
      monthKey: MONTH,
      now: NOW,
    });
    assert.match(msg, /Create \d+ testing/);
  });

  test("on pace shows On pace", () => {
    const msg = suggestReportsAction({
      metric: "testing",
      current: 230,
      target: 230,
      monthKey: MONTH,
      now: NOW,
    });
    assert.equal(msg, "On pace");
  });
});

describe("buildAdminInterventionFocus", () => {
  test("returns employee-specific intervention actions", () => {
    const items = buildAdminInterventionFocus({
      monthKey: MONTH,
      now: NOW,
      maxActions: 5,
      workers: [
        {
          employeeId: 1,
          employeeName: "Sara",
          goalCards: [
            makeCard("revenue", 50_000, 50_000),
            makeCard("testing", 10, 230),
            makeCard("working", 60, 60),
          ],
          slices: {
            testing: [{ network: "Yieldkit CBV", geo: "GB", current: 2, target: 80 }],
            working: [],
            revenue: [],
          },
        },
        {
          employeeId: 2,
          employeeName: "Kida",
          goalCards: [
            makeCard("revenue", 50_000, 50_000),
            makeCard("testing", 230, 230),
            makeCard("working", 90, 60),
          ],
          slices: { testing: [], working: [], revenue: [] },
          campaigns: [
            { id: 1, status: "live", campaignPurpose: "working", offerCount: null },
            { id: 2, status: "live", campaignPurpose: "working", offerCount: null },
            { id: 3, status: "live", campaignPurpose: "working", offerCount: null },
          ],
        },
      ],
    });
    assert.ok(items.length <= 5);
    assert.ok(items.every((i) => i.context?.employeeName));
    assert.ok(items.some((i) => /Sara/.test(i.text)));
    assert.ok(items.some((i) => /Kida/.test(i.text)));
  });

  test("employee filter path keeps worker-style cards with name", () => {
    const items = buildDailyFocusActions({
      monthKey: MONTH,
      now: NOW,
      isAdmin: true,
      employeeName: "Sara",
      goalCards: [
        makeCard("revenue", 50_000, 50_000),
        makeCard("testing", 40, 230),
        makeCard("working", 60, 60),
      ],
      slices: {
        testing: [{ network: "Yieldkit CBV", geo: "GB", current: 10, target: 80 }],
        working: [],
        revenue: [],
      },
    });
    assert.ok(items[0]?.context?.employeeName === "Sara");
    assert.match(items[0]!.text, /Sara/);
  });
});

describe("priorityScore profit/ROI boost", () => {
  test("positive profit+ROI ranks above revenue-only when gaps similar", () => {
    const cold: NetworkGeoSlice = {
      network: "Cold",
      geo: "US",
      current: 40,
      target: 230,
      revenue: 5000,
    };
    const hot: NetworkGeoSlice = {
      network: "Hot",
      geo: "GB",
      current: 40,
      target: 230,
      revenue: 1000,
      profit: 400,
      roi: 25,
    };
    assert.ok(priorityScore(hot, MONTH, NOW) > priorityScore(cold, MONTH, NOW));
  });
});

describe("buildRevenueRescueAction threshold", () => {
  test("exports threshold constant", () => {
    assert.equal(REVENUE_BEHIND_THRESHOLD_PCT, -20);
    const card = makeCard("revenue", 10_000, 100_000);
    const action = buildRevenueRescueAction(
      card,
      [{ network: "X", geo: "GB", current: 10_000, target: 100_000, profit: 50 }],
      MONTH,
      { now: NOW },
    );
    assert.ok(action);
  });
});
