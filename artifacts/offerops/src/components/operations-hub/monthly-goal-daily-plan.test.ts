/**
 * Monthly Goal → Daily Action Plan — focused tests.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateTodayRequiredAcrossGeos,
  buildDailyActionPlan,
  buildScalingCandidates,
  buildShutdownCandidates,
  buildOptimizationGroups,
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
import { DEFAULT_ALERT_RULES, evaluateCampaign } from "@workspace/alert-rules";

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

describe("settings-driven scale & optimize thresholds", () => {
  const scaleCampaign = {
    id: 20,
    status: "live",
    campaignPurpose: "working",
    offerCount: 2,
    revenue: 150,
    cost: 50,
    roi: 20,
    liveStartedAt: "2026-07-06T00:00:00", // 2 days live by Jul 8
    affiliateNetworkName: "N",
    geo: "US",
  };

  test("network plan exposes monthlyGoal for the simplified row", () => {
    const plans = buildTestingNetworkPlans(
      [
        { network: "BlueAffiliate CBV", geo: "GB", current: 0, target: 20 },
        { network: "BlueAffiliate CBV", geo: "US", current: 0, target: 28 },
      ],
      [],
      MONTH,
      NOW,
    );
    assert.equal(plans[0]!.monthlyGoal, 48);
  });

  test("scale group honors settings thresholds (min revenue gates it out)", () => {
    const strict = {
      ...DEFAULT_ALERT_RULES,
      scaling: { ...DEFAULT_ALERT_RULES.scaling, minRevenueForScale: 200 },
    };
    const included = buildDailyActionPlan({
      monthKey: MONTH,
      now: NOW,
      testingSlices: [],
      campaigns: [scaleCampaign],
    });
    assert.equal(included.scalingCandidates.length, 1);

    const excluded = buildDailyActionPlan({
      monthKey: MONTH,
      now: NOW,
      testingSlices: [],
      campaigns: [scaleCampaign],
      rules: strict, // revenue 150 < 200 → not a scale candidate
    });
    assert.equal(excluded.scalingCandidates.length, 0);
  });

  test("scale group honors settings min live days", () => {
    const strictDays = {
      ...DEFAULT_ALERT_RULES,
      scaling: { ...DEFAULT_ALERT_RULES.scaling, minLiveDaysForScale: 30 },
    };
    const plan = buildDailyActionPlan({
      monthKey: MONTH,
      now: NOW,
      testingSlices: [],
      campaigns: [scaleCampaign],
      rules: strictDays,
    });
    assert.equal(plan.scalingCandidates.length, 0);
  });

  test("optimize group proactively flags underperforming working campaigns", () => {
    const plan = buildDailyActionPlan({
      monthKey: MONTH,
      now: NOW,
      testingSlices: [],
      campaigns: [
        {
          id: 30,
          status: "live",
          campaignPurpose: "working",
          offerCount: 3,
          clicks: 60_000, // ratio ~1.3 (>= target) so not off/behind
          revenue: 100,
          cost: 120,
          roi: -16, // weak (< weakRoiPercent 5)
          liveStartedAt: "2026-07-01T00:00:00", // 7 days live (>= 3)
          affiliateNetworkName: "N",
          geo: "US",
        },
      ],
    });
    assert.ok(plan.optimizations.some((g) => g.issueType === "underperforming"));
  });

  test("a scale candidate is NOT also flagged as underperforming", () => {
    const plan = buildDailyActionPlan({
      monthKey: MONTH,
      now: NOW,
      testingSlices: [],
      campaigns: [scaleCampaign],
    });
    assert.ok(!plan.optimizations.some((g) => g.issueType === "underperforming"));
    assert.equal(plan.scalingCandidates.length, 1);
  });

  test("optimize behind/off bands respect settings ratios", () => {
    // clicks 10 / offerCount 2 = VPO 5; target 15000 → ratio ~0.0003 → off target
    const campaigns = [
      {
        id: 40,
        status: "live",
        campaignPurpose: "working",
        offerCount: 2,
        clicks: 10,
        affiliateNetworkName: "N",
        geo: "US",
      },
    ];
    const plan = buildDailyActionPlan({ monthKey: MONTH, now: NOW, testingSlices: [], campaigns });
    assert.ok(plan.optimizations.some((g) => g.issueType === "off_target"));
    assert.ok(!plan.optimizations.some((g) => g.issueType === "behind_target"));
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

  test("each worker summary exposes daily bar fields (Tests / Optimize / Scale)", () => {
    const team = buildTeamDailyPlans(
      [
        {
          employeeId: 1,
          employeeName: "Sara",
          testingSlices: [{ network: "SHOPLOOKS PAP", geo: "FR", current: 2, target: 40 }],
          campaigns: [],
        },
        {
          employeeId: 2,
          employeeName: "Kida",
          testingSlices: [],
          campaigns: [
            { id: 9, status: "live", campaignPurpose: "working", offerCount: null },
            { id: 10, status: "live", campaignPurpose: "working", offerCount: null },
          ],
        },
      ],
      MONTH,
      NOW,
    );
    for (const w of team) {
      const sm = w.plan.summary;
      // Bars render done/total for all three groups — required must be >= done >= 0.
      assert.ok(sm.testsRequired >= sm.testsDone && sm.testsDone >= 0);
      assert.ok(sm.optimizationsRequired >= sm.optimizationsDone && sm.optimizationsDone >= 0);
      assert.ok(sm.scalingAdvisory >= 0);
      // Only workers with real work today are surfaced to admins.
      assert.ok(sm.total > 0);
    }
  });
});

describe("alert-rules engine: winner / shutdown / traffic / priority", () => {
  const winnerCampaign = {
    id: 100,
    status: "live",
    campaignPurpose: "working",
    offerCount: 2,
    revenue: 500,
    cost: 100,
    roi: 60,
    conversions: 8,
    clicks: 100,
    liveStartedAt: "2026-07-04T00:00:00", // 4 days live
    affiliateNetworkName: "N",
    geo: "US",
  };

  test("winning rule flags a WINNER and surfaces it in Scale", () => {
    const { scaling } = buildScalingCandidates([winnerCampaign], { now: NOW });
    const winner = scaling.find((c) => c.id === 100);
    assert.ok(winner);
    assert.equal(winner!.isWinner, true);
  });

  test("winner shows in Scale even if it misses the scale bar", () => {
    // Raise scale bar so it would NOT qualify by scale rule, but winning still does.
    const rules = {
      ...DEFAULT_ALERT_RULES,
      scaling: { ...DEFAULT_ALERT_RULES.scaling, minRevenueForScale: 100_000 },
    };
    const { scaling } = buildScalingCandidates([winnerCampaign], { now: NOW, rules });
    assert.ok(scaling.some((c) => c.id === 100 && c.isWinner));
  });

  test("changing the winning rule updates who is a winner (no hardcoded threshold)", () => {
    const strict = {
      ...DEFAULT_ALERT_RULES,
      winning: { minConversions: 50, minRevenue: 1_000, minROI: 500 },
    };
    const { scaling } = buildScalingCandidates([winnerCampaign], { now: NOW, rules: strict });
    const c = scaling.find((x) => x.id === 100);
    // May still be a scale candidate, but must NOT be flagged winner under strict rule.
    assert.ok(!c || c.isWinner === false);
  });

  test("shutdown rule surfaces long-running low-performance campaigns", () => {
    const dead = {
      id: 101,
      status: "live",
      campaignPurpose: "working",
      offerCount: 2,
      revenue: 0,
      cost: 80,
      roi: -100,
      conversions: 0,
      clicks: 500,
      liveStartedAt: "2026-06-20T00:00:00", // long live
      affiliateNetworkName: "N",
      geo: "US",
    };
    const stops = buildShutdownCandidates([dead], { now: NOW });
    assert.equal(stops.length, 1);
    assert.equal(stops[0]!.id, 101);
  });

  test("shutdown is settings-driven: raising minDaysLive removes it", () => {
    const dead = {
      id: 102,
      status: "live",
      campaignPurpose: "working",
      offerCount: 2,
      revenue: 0,
      cost: 50,
      roi: -100,
      conversions: 0,
      liveStartedAt: "2026-07-01T00:00:00", // 7 days
      affiliateNetworkName: "N",
      geo: "US",
    };
    const base = buildShutdownCandidates([dead], { now: NOW });
    assert.equal(base.length, 1);
    const strict = {
      ...DEFAULT_ALERT_RULES,
      shutdown: { ...DEFAULT_ALERT_RULES.shutdown, minDaysLive: 60 },
    };
    assert.equal(buildShutdownCandidates([dead], { now: NOW, rules: strict }).length, 0);
  });

  test("winner is never a shutdown candidate", () => {
    const stops = buildShutdownCandidates([winnerCampaign], { now: NOW });
    assert.equal(stops.length, 0);
  });

  test("traffic rule surfaces abnormal (excess) visits-per-offer as optimize", () => {
    const rules = {
      ...DEFAULT_ALERT_RULES,
      traffic: { ...DEFAULT_ALERT_RULES.traffic, maxExpectedVisitsPerOffer: 1_000 },
    };
    const flooded = {
      id: 103,
      status: "live",
      campaignPurpose: "working",
      offerCount: 1,
      // VPO 20000: ratio (>= target 15000) clears off/behind bands, then exceeds
      // maxExpectedVisitsPerOffer 1000 → abnormal traffic.
      clicks: 20_000,
      revenue: 10,
      cost: 5,
      roi: 2,
      affiliateNetworkName: "N",
      geo: "US",
    };
    const groups = buildOptimizationGroups([flooded], { now: NOW, rules });
    assert.ok(groups.some((g) => g.issueType === "abnormal_traffic"));
  });

  test("scale priority: winners first, then highest profit", () => {
    const midProfit = {
      id: 201,
      status: "live",
      campaignPurpose: "working",
      offerCount: 2,
      revenue: 300,
      cost: 100,
      roi: 30,
      conversions: 0, // not a winner (0 conv)
      liveStartedAt: "2026-07-04T00:00:00",
      affiliateNetworkName: "N",
      geo: "US",
    };
    const bigProfit = {
      id: 202,
      status: "live",
      campaignPurpose: "working",
      offerCount: 2,
      revenue: 2_000,
      cost: 100,
      roi: 90,
      conversions: 0, // not a winner (0 conv)
      liveStartedAt: "2026-07-04T00:00:00",
      affiliateNetworkName: "N",
      geo: "US",
    };
    const { scaling } = buildScalingCandidates([midProfit, bigProfit, winnerCampaign], {
      now: NOW,
    });
    assert.equal(scaling[0]!.id, 100); // winner first
    // Among non-winners, bigger profit ranks above smaller.
    const nonWinners = scaling.filter((c) => !c.isWinner).map((c) => c.id);
    assert.deepEqual(nonWinners, [202, 201]);
  });

  test("STEP 9 validation: legacy board classification matches the evaluator for 60 campaigns", () => {
    // Deterministic synthetic matrix covering purpose/status/metrics/age.
    const purposes = ["working", "scaling", "testing"];
    const statuses = ["live", "paused"];
    const money = [
      { revenue: 0, cost: 80 },
      { revenue: 150, cost: 50 },
      { revenue: 2_000, cost: 100 },
    ];
    const rois = [-30, 0, 25];
    const offers = [null, 2];
    const ages = [1, 5, 20];

    const campaigns: any[] = [];
    let id = 1;
    for (const purpose of purposes)
      for (const status of statuses)
        for (const m of money)
          for (const roi of rois)
            for (const offerCount of offers)
              for (const age of ages) {
                campaigns.push({
                  id: id++,
                  status,
                  campaignPurpose: purpose,
                  offerCount,
                  revenue: m.revenue,
                  cost: m.cost,
                  roi,
                  conversions: m.revenue > 500 ? 5 : 0,
                  clicks: 30_000,
                  liveStartedAt: new Date(NOW.getTime() - age * 86_400_000).toISOString(),
                  affiliateNetworkName: "N",
                  geo: "US",
                });
              }
    assert.ok(campaigns.length >= 60);

    let compared = 0;
    let mismatches = 0;
    for (const c of campaigns) {
      // Legacy (flag off) board membership, per-campaign.
      const { scaling } = buildScalingCandidates([c], { now: NOW });
      const optGroups = buildOptimizationGroups([c], { now: NOW });
      const stops = buildShutdownCandidates([c], { now: NOW });
      const legacyScale = scaling.some((s) => s.id === c.id);
      const legacyWinner = scaling.some((s) => s.id === c.id && s.isWinner);
      const legacyOptimize = optGroups.some((g) => g.campaigns.some((x) => x.id === c.id));
      const legacyShutdown = stops.some((s) => s.id === c.id);

      // New engine decision.
      const out = evaluateCampaign(
        {
          purpose: c.campaignPurpose,
          status: c.status,
          liveStartedAt: c.liveStartedAt,
          createdAt: c.createdAt,
        },
        {
          revenue: c.revenue,
          cost: c.cost,
          roi: c.roi,
          conversions: c.conversions,
          clicks: c.clicks,
          offerCount: c.offerCount,
        },
        DEFAULT_ALERT_RULES,
        NOW,
      );

      compared++;
      if ((out.isScaling || out.isWinner) !== legacyScale) mismatches++;
      if (out.isWinner !== legacyWinner) mismatches++;
      if (out.isOptimize !== legacyOptimize) mismatches++;
      if (out.isShutdown !== legacyShutdown) mismatches++;
    }
    assert.ok(compared >= 60);
    assert.equal(mismatches, 0, `legacy vs evaluator diverged on ${mismatches} decisions`);
  });

  test("plan exposes shutdownCandidates and summary.shutdownAdvisory", () => {
    const dead = {
      id: 300,
      status: "live",
      campaignPurpose: "working",
      offerCount: 2,
      revenue: 0,
      cost: 30,
      conversions: 0,
      liveStartedAt: "2026-06-20T00:00:00",
      affiliateNetworkName: "N",
      geo: "US",
    };
    const plan = buildDailyActionPlan({
      monthKey: MONTH,
      now: NOW,
      testingSlices: [],
      campaigns: [dead],
    });
    assert.equal(plan.shutdownCandidates.length, 1);
    assert.equal(plan.summary.shutdownAdvisory, 1);
  });
});
