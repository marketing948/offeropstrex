/**
 * Monthly Goal → Daily Action Plan — focused tests.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateTodayRequiredAcrossGeos,
  buildDailyActionPlan,
  buildTeamDailyPlans,
  buildTestingNetworkPlans,
  computeNetworkTodayRequired,
  computeTodayRequired,
  planContainsRevenue,
  splitNetworkTodayAcrossSelectedGeos,
} from "./monthly-goal-daily-plan.ts";
import {
  evaluateWorkingDayPace,
  remainingWorkingDaysInMonth,
} from "./ops-v2-metrics.ts";

const NOW = new Date("2026-07-08T12:00:00");
const MONTH = "2026-07";
const REMAINING_DAYS = remainingWorkingDaysInMonth(MONTH, NOW);

describe("computeTodayRequired", () => {
  test("completed monthly target removes action", () => {
    const r = computeTodayRequired(20, 20, MONTH, NOW);
    assert.equal(r.todayRequired, 0);
    assert.equal(r.remaining, 0);
  });

  test("never exceeds remaining", () => {
    const r = computeTodayRequired(10, 9, MONTH, NOW);
    assert.ok(r.todayRequired <= 1);
  });

  test("behind pace uses max(daily, gap) capped by remaining", () => {
    // Mid-month July: roughly 6 elapsed weekdays by Jul 8
    const pace = evaluateWorkingDayPace(MONTH, 100, 10, NOW);
    const r = computeTodayRequired(100, 10, MONTH, NOW);
    const expected = Math.min(
      90,
      Math.max(Math.ceil(pace.dailyExpected), Math.ceil(Math.max(0, pace.expectedByNow - 10))),
    );
    assert.equal(r.todayRequired, expected);
    assert.ok(r.todayRequired > 0);
  });
});

describe("computeNetworkTodayRequired (network daily total)", () => {
  test("48 monthly target distributed over remaining working days → small daily", () => {
    // ceil(48 / remainingDays). With Jul 8 (18 days left) → ceil(48/18) = 3.
    const today = computeNetworkTodayRequired(48, 0, MONTH, NOW);
    assert.equal(today, Math.ceil(48 / REMAINING_DAYS));
    assert.equal(today, 3);
  });

  test("192 monthly target does NOT produce an inflated 72", () => {
    const today = computeNetworkTodayRequired(192, 0, MONTH, NOW);
    assert.equal(today, Math.ceil(192 / REMAINING_DAYS));
    assert.ok(today < 15);
    assert.notEqual(today, 72);
  });

  test("completed monthly goal returns 0 today", () => {
    assert.equal(computeNetworkTodayRequired(48, 48, MONTH, NOW), 0);
    assert.equal(computeNetworkTodayRequired(48, 60, MONTH, NOW), 0);
  });

  test("never exceeds remaining and never negative", () => {
    assert.equal(computeNetworkTodayRequired(3, 2, MONTH, NOW), 1);
    assert.ok(computeNetworkTodayRequired(48, 0, MONTH, NOW) >= 0);
  });
});

describe("buildTestingNetworkPlans", () => {
  test("network total is computed before GEO distribution (no ceil-per-GEO sum)", () => {
    // 6 GEOs each target 32 (=192 total), current 0.
    // WRONG (old): ceil-per-GEO summed would be huge (e.g. 6 * ceil(32/18) = 12+).
    // RIGHT: ceil(192 / remainingDays) then split across GEOs.
    const slices = ["GB", "US", "DE", "FR", "IT", "NL"].map((geo) => ({
      network: "SHOPLOOKS PAP",
      geo,
      current: 0,
      target: 32,
    }));
    const plans = buildTestingNetworkPlans(slices, [], MONTH, NOW);
    assert.equal(plans.length, 1);
    const net = plans[0]!;
    assert.equal(net.todayRequired, computeNetworkTodayRequired(192, 0, MONTH, NOW));
    assert.notEqual(net.todayRequired, 72);
    // GEO distribution sums EXACTLY to the network daily total.
    const sum = net.geos.reduce((s, g) => s + g.todayRequired, 0);
    assert.equal(sum, net.todayRequired);
  });

  test("48-target network with 3 GEOs shows 3 today split across GEOs", () => {
    const plans = buildTestingNetworkPlans(
      [
        { network: "BlueAffiliate CBV", geo: "GB", current: 0, target: 20 },
        { network: "BlueAffiliate CBV", geo: "US", current: 0, target: 20 },
        { network: "BlueAffiliate CBV", geo: "DE", current: 0, target: 8 },
      ],
      [],
      MONTH,
      NOW,
    );
    const net = plans[0]!;
    assert.equal(net.todayRequired, 3); // ceil(48/18)
    assert.equal(
      net.geos.reduce((s, g) => s + g.todayRequired, 0),
      3,
    );
  });


  test("network goal with GEO targets produces Network row with GEO actions", () => {
    const plans = buildTestingNetworkPlans(
      [
        { network: "SHOPLOOKS PAP", geo: "FR", current: 4, target: 20 },
        { network: "SHOPLOOKS PAP", geo: "DE", current: 3, target: 18 },
        { network: "SHOPLOOKS PAP", geo: "GB", current: 7, target: 22 },
      ],
      [],
      MONTH,
      NOW,
    );
    assert.equal(plans.length, 1);
    assert.equal(plans[0]!.network, "SHOPLOOKS PAP");
    assert.ok(plans[0]!.geoCount === 3);
    assert.ok(plans[0]!.todayRequired > 0);
    assert.equal(plans[0]!.geos.length, 3);
    for (const g of plans[0]!.geos) {
      assert.ok(g.todayRequired >= 0);
      assert.ok(g.monthlyTarget > 0);
      assert.ok(typeof g.expectedByNow === "number");
      assert.ok(typeof g.gapToPace === "number");
    }
    const sum = plans[0]!.geos.reduce((s, g) => s + g.todayRequired, 0);
    assert.equal(sum, plans[0]!.todayRequired);
  });

  test("selected GEOs without overrides: splitNetworkTodayAcrossSelectedGeos totals match", () => {
    const geos = [
      { network: "BRANDREWARDS FXH", geo: "US", current: 2, target: 10 },
      { network: "BRANDREWARDS FXH", geo: "NL", current: 8, target: 10 },
    ];
    const networkToday = 3;
    const split = splitNetworkTodayAcrossSelectedGeos(networkToday, geos, MONTH, NOW);
    assert.equal(split.reduce((s, g) => s + g.todayRequired, 0), 3);
  });

  test("behind-pace GEO receives more priority in allocateTodayRequiredAcrossGeos", () => {
    const alloc = allocateTodayRequiredAcrossGeos(5, [
      { geo: "US", gapToPace: 8, remaining: 10 },
      { geo: "NL", gapToPace: 1, remaining: 10 },
    ]);
    const us = alloc.find((a) => a.geo === "US")!;
    const nl = alloc.find((a) => a.geo === "NL")!;
    assert.ok(us.count > nl.count);
    assert.equal(us.count + nl.count, 5);
  });

  test("testing done today counts only matching Network/GEO testing campaigns", () => {
    const plans = buildTestingNetworkPlans(
      [
        { network: "SHOPLOOKS PAP", geo: "FR", current: 4, target: 40 },
        { network: "SHOPLOOKS PAP", geo: "DE", current: 4, target: 40 },
      ],
      [
        {
          id: 1,
          status: "live",
          campaignPurpose: "testing",
          createdAt: "2026-07-08T10:00:00",
          affiliateNetworkName: "SHOPLOOKS PAP",
          geo: "FR",
        },
        {
          id: 2,
          status: "live",
          campaignPurpose: "working",
          createdAt: "2026-07-08T10:00:00",
          affiliateNetworkName: "SHOPLOOKS PAP",
          geo: "FR",
        },
        {
          id: 3,
          status: "live",
          campaignPurpose: "testing",
          createdAt: "2026-07-08T10:00:00",
          affiliateNetworkName: "OTHER NET",
          geo: "FR",
        },
      ],
      MONTH,
      NOW,
    );
    const fr = plans[0]!.geos.find((g) => g.geo === "FR")!;
    assert.equal(fr.doneToday, 1);
  });
});

describe("buildDailyActionPlan", () => {
  test("revenue actions are never returned", () => {
    const plan = buildDailyActionPlan({
      monthKey: MONTH,
      now: NOW,
      testingSlices: [{ network: "A", geo: "US", current: 1, target: 40 }],
      campaigns: [
        { id: 1, status: "live", campaignPurpose: "working", offerCount: null, revenue: 0, cost: 0 },
      ],
    });
    assert.equal(planContainsRevenue(plan), false);
  });

  test("optimization rows only appear from real live campaign issues", () => {
    const plan = buildDailyActionPlan({
      monthKey: MONTH,
      now: NOW,
      testingSlices: [],
      campaigns: [
        {
          id: 1,
          status: "live",
          campaignPurpose: "working",
          offerCount: null,
          affiliateNetworkName: "N1",
          geo: "US",
        },
        {
          id: 2,
          status: "live",
          campaignPurpose: "working",
          offerCount: 2,
          clicks: 10,
          affiliateNetworkName: "N1",
          geo: "DE",
        }, // 5 VPO vs default 50 → off_target
        {
          id: 3,
          status: "paused",
          campaignPurpose: "working",
          offerCount: null,
        },
      ],
    });
    assert.ok(plan.optimizations.some((g) => g.issueType === "missing_offer_count"));
    assert.ok(plan.optimizations.some((g) => g.issueType === "off_target"));
    const missing = plan.optimizations.find((g) => g.issueType === "missing_offer_count")!;
    assert.equal(missing.campaigns.length, 1);
    assert.equal(missing.campaigns[0]!.id, 1);
  });

  test("scaling rows only appear from real candidates", () => {
    const plan = buildDailyActionPlan({
      monthKey: MONTH,
      now: NOW,
      testingSlices: [],
      campaigns: [
        {
          id: 10,
          status: "live",
          campaignPurpose: "working",
          offerCount: 2,
          revenue: 500,
          cost: 100,
          roi: 20,
          liveStartedAt: "2026-07-01T00:00:00",
          affiliateNetworkName: "N",
          geo: "US",
        },
        {
          id: 11,
          status: "live",
          campaignPurpose: "testing",
          offerCount: 2,
          clicks: 100,
          conversions: 3,
          revenue: 50,
          cost: 10,
          roi: 15,
          affiliateNetworkName: "N",
          geo: "DE",
        },
        {
          id: 12,
          status: "live",
          campaignPurpose: "working",
          offerCount: 2,
          revenue: 10,
          cost: 100,
          roi: -50,
          liveStartedAt: "2026-07-01T00:00:00",
        },
      ],
    });
    assert.equal(plan.scalingCandidates.length, 1);
    assert.equal(plan.scalingCandidates[0]!.id, 10);
    assert.ok(plan.moveToWorkingCandidates.some((c) => c.id === 11));
    assert.ok(!plan.scalingCandidates.some((c) => c.id === 12));
  });

  test("Focus Bar total = visible testing + optimization + scaling", () => {
    const plan = buildDailyActionPlan({
      monthKey: MONTH,
      now: NOW,
      testingSlices: [
        { network: "SHOPLOOKS PAP", geo: "FR", current: 4, target: 40 },
      ],
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
          liveStartedAt: "2026-07-01T00:00:00",
        },
      ],
    });
    const expected =
      plan.summary.testsRequired +
      plan.summary.optimizationsRequired +
      plan.summary.scalingAdvisory;
    assert.equal(plan.summary.total, expected);
    assert.ok(plan.summary.total > 0);
  });

  test("Focus Bar tests total = sum of network daily totals (not ceil-per-GEO)", () => {
    const plan = buildDailyActionPlan({
      monthKey: MONTH,
      now: NOW,
      testingSlices: [
        // Network A: 192 across 6 GEOs → ceil(192/days), NOT 6*ceil(32/days)
        ...["GB", "US", "DE", "FR", "IT", "NL"].map((geo) => ({
          network: "NET A",
          geo,
          current: 0,
          target: 32,
        })),
        // Network B: 48 across 3 GEOs → ceil(48/days)
        ...["GB", "US", "DE"].map((geo) => ({
          network: "NET B",
          geo,
          current: 0,
          target: 16,
        })),
      ],
    });
    const netA = computeNetworkTodayRequired(192, 0, MONTH, NOW);
    const netB = computeNetworkTodayRequired(48, 0, MONTH, NOW);
    assert.equal(plan.summary.testsRequired, netA + netB);
    // Each network row sums exactly to its network total.
    for (const n of plan.testingNetworks) {
      assert.equal(
        n.geos.reduce((s, g) => s + g.todayRequired, 0),
        n.todayRequired,
      );
    }
  });

  test("no fake completion without timestamps", () => {
    const plan = buildDailyActionPlan({
      monthKey: MONTH,
      now: NOW,
      testingSlices: [
        { network: "SHOPLOOKS PAP", geo: "FR", current: 4, target: 40 },
      ],
      campaigns: [
        {
          id: 1,
          status: "live",
          campaignPurpose: "testing",
          affiliateNetworkName: "SHOPLOOKS PAP",
          geo: "FR",
          // no createdAt — must not count
        },
        {
          id: 2,
          status: "live",
          campaignPurpose: "working",
          offerCount: 2,
          // no updatedAt — opt done stays 0 for behind/off; missing group absent
        },
      ],
    });
    const fr = plan.testingNetworks[0]?.geos.find((g) => g.geo === "FR");
    assert.equal(fr?.doneToday ?? 0, 0);
    assert.equal(plan.summary.testsDone, 0);
  });
});

describe("buildTeamDailyPlans", () => {
  test("admin all-employees returns worker-specific plans", () => {
    const team = buildTeamDailyPlans(
      [
        {
          employeeId: 1,
          employeeName: "Sara",
          testingSlices: [
            { network: "SHOPLOOKS PAP", geo: "FR", current: 2, target: 40 },
            { network: "BRANDREWARDS FXH", geo: "US", current: 1, target: 20 },
          ],
          campaigns: [],
        },
        {
          employeeId: 2,
          employeeName: "Kida",
          testingSlices: [],
          campaigns: [
            { id: 9, status: "live", campaignPurpose: "working", offerCount: null },
            { id: 10, status: "live", campaignPurpose: "working", offerCount: null },
            { id: 11, status: "live", campaignPurpose: "working", offerCount: null },
          ],
        },
      ],
      MONTH,
      NOW,
    );
    assert.ok(team.length >= 2);
    const sara = team.find((t) => t.employeeName === "Sara")!;
    const kida = team.find((t) => t.employeeName === "Kida")!;
    assert.match(sara.headline, /Sara/);
    assert.ok(sara.plan.testingNetworks.length >= 1);
    assert.match(kida.headline, /Kida/);
    assert.ok(kida.plan.optimizations.some((g) => g.issueType === "missing_offer_count"));
  });
});
