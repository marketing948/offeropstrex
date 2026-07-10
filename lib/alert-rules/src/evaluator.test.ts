import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ALERT_RULES } from "./index.js";
import {
  computePriorityScore,
  daysLive,
  evaluateCampaign,
  evaluatorBadges,
  normalizeRoiPercent,
} from "./evaluator.js";

const NOW = new Date("2026-07-08T12:00:00Z");

function live(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
}

describe("normalizeRoiPercent", () => {
  it("treats fractions as percent", () => {
    assert.equal(normalizeRoiPercent(0.2), 20);
    assert.equal(normalizeRoiPercent(20), 20);
    assert.equal(normalizeRoiPercent(0), 0);
    assert.equal(normalizeRoiPercent(null), 0);
  });
});

describe("daysLive", () => {
  it("floors whole days and clamps future to 0", () => {
    assert.equal(daysLive({ liveStartedAt: live(3) }, NOW), 3);
    assert.equal(daysLive({ liveStartedAt: live(-2) }, NOW), 0);
    assert.equal(daysLive({}, NOW), null);
  });
});

describe("evaluateCampaign — winner", () => {
  const winner = {
    campaign: { purpose: "working", status: "live", liveStartedAt: live(4) },
    metrics: { revenue: 500, cost: 100, roi: 60, conversions: 8, clicks: 100, offerCount: 2 },
  };

  it("flags a winner by the winning rule", () => {
    const out = evaluateCampaign(winner.campaign, winner.metrics, DEFAULT_ALERT_RULES, NOW);
    assert.equal(out.isWinner, true);
  });

  it("is settings-driven: strict winning rule removes the flag", () => {
    const strict = {
      ...DEFAULT_ALERT_RULES,
      winning: { minConversions: 50, minRevenue: 10_000, minROI: 500 },
    };
    const out = evaluateCampaign(winner.campaign, winner.metrics, strict, NOW);
    assert.equal(out.isWinner, false);
  });
});

describe("evaluateCampaign — scaling", () => {
  it("scales a matured profitable working campaign", () => {
    const out = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(4) },
      { revenue: 300, cost: 100, roi: 40, conversions: 3, clicks: 10, offerCount: 2 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(out.isScaling, true);
  });

  it("min-live-days threshold gates scaling", () => {
    const strict = {
      ...DEFAULT_ALERT_RULES,
      scaling: { ...DEFAULT_ALERT_RULES.scaling, minLiveDaysForScale: 30 },
    };
    const out = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(4) },
      { revenue: 300, cost: 100, roi: 40, conversions: 3, offerCount: 2 },
      strict,
      NOW,
    );
    assert.equal(out.isScaling, false);
  });

  it("non-working purpose never scales", () => {
    const out = evaluateCampaign(
      { purpose: "testing", status: "live", liveStartedAt: live(4) },
      { revenue: 300, cost: 100, roi: 40, offerCount: 2 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(out.isScaling, false);
  });
});

describe("evaluateCampaign — shutdown", () => {
  it("flags long-running low-performance non-winner", () => {
    const out = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(20) },
      { revenue: 0, cost: 80, roi: -100, conversions: 0, offerCount: 2, clicks: 500 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(out.isShutdown, true);
  });

  it("raising minDaysLive removes shutdown (settings-driven)", () => {
    const strict = {
      ...DEFAULT_ALERT_RULES,
      shutdown: { ...DEFAULT_ALERT_RULES.shutdown, minDaysLive: 60 },
    };
    const out = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(20) },
      { revenue: 0, cost: 80, roi: -100, conversions: 0, offerCount: 2 },
      strict,
      NOW,
    );
    assert.equal(out.isShutdown, false);
  });

  it("winners are never shutdown", () => {
    const out = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(20) },
      { revenue: 500, cost: 100, roi: 60, conversions: 8, offerCount: 2 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(out.isShutdown, false);
    assert.equal(out.isWinner, true);
  });
});

describe("evaluateCampaign — optimize", () => {
  it("missing offer count", () => {
    const out = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(5) },
      { revenue: 10, cost: 5, roi: 1, offerCount: null },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(out.optimizeReason, "missing_offer_count");
    assert.equal(out.isOptimize, true);
  });

  it("off target vs behind target respect settings ratios", () => {
    // VPO 10/2 = 5 vs target 15000 → ratio ~0 → off target
    const off = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(5) },
      { clicks: 10, offerCount: 2 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(off.optimizeReason, "off_target");
  });

  it("abnormal traffic when VPO exceeds max expected", () => {
    const rules = {
      ...DEFAULT_ALERT_RULES,
      traffic: { ...DEFAULT_ALERT_RULES.traffic, maxExpectedVisitsPerOffer: 1_000 },
    };
    const out = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(5) },
      { clicks: 20_000, offerCount: 1, revenue: 10, cost: 5, roi: 2 },
      rules,
      NOW,
    );
    assert.equal(out.optimizeReason, "abnormal_traffic");
    assert.equal(out.isTrafficIssue, true);
  });

  it("underperforming via ROI floor", () => {
    const out = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(7) },
      { clicks: 60_000, offerCount: 3, revenue: 100, cost: 120, roi: -16 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(out.optimizeReason, "underperforming");
  });

  it("underperforming via ROI drop threshold", () => {
    // Break-even (profit 0 → not scaling) with ROI above the floor (10 >= 5),
    // so only the ROI-drop rule can flag it.
    const out = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(7) },
      { clicks: 60_000, offerCount: 3, revenue: 100, cost: 100, roi: 10, roiPrevious: 40 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(out.facts.roiPercent >= DEFAULT_ALERT_RULES.optimization.roiMinThreshold, true);
    // 40 - 10 = 30 >= roiDropThreshold 20 → underperforming
    assert.equal(out.optimizeReason, "underperforming");
  });
});

const EMPTY_FACTS = {
  daysLive: 1,
  profit: 1,
  roiPercent: 1,
  revenue: 1,
  conversions: 0,
  visits: 0,
  visitsPerOffer: null,
  vpoRatio: null,
  trafficPct: 0,
  milestoneReached: null,
};

function outputWith(flags: Partial<Record<string, boolean>>): Parameters<typeof computePriorityScore>[0] {
  return {
    isScaling: !!flags.isScaling,
    isOptimize: !!flags.isOptimize,
    isShutdown: !!flags.isShutdown,
    isWinner: !!flags.isWinner,
    isTrafficIssue: !!flags.isTrafficIssue,
    isZeroConversion: !!flags.isZeroConversion,
    isStuck: !!flags.isStuck,
    isMilestone50: !!flags.isMilestone50,
    isMilestone75: !!flags.isMilestone75,
    isStale: !!flags.isStale,
    optimizeReason: flags.isOptimize ? "underperforming" : null,
    facts: EMPTY_FACTS,
  };
}

describe("STEP 6 edge cases — weak / strong / dead", () => {
  it("weak campaign → optimize", () => {
    const weak = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(7) },
      { revenue: 100, cost: 120, roi: -16, conversions: 1, clicks: 60_000, offerCount: 3 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(weak.isOptimize, true);
    assert.equal(weak.isScaling, false);
    assert.equal(weak.isShutdown, false);
  });

  it("strong campaign → scale + winner", () => {
    const strong = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(5) },
      { revenue: 800, cost: 200, roi: 60, conversions: 12, clicks: 20, offerCount: 2 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(strong.isScaling, true);
    assert.equal(strong.isWinner, true);
    assert.equal(strong.isShutdown, false);
  });

  it("dead campaign → stop", () => {
    const dead = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(20) },
      { revenue: 0, cost: 90, roi: -100, conversions: 0, clicks: 400, offerCount: 2 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(dead.isShutdown, true);
    assert.equal(dead.isWinner, false);
    assert.equal(dead.isScaling, false);
  });
});

describe("computePriorityScore — shared order", () => {
  it("shutdown > stuck/stale > optimize > scaling > winner > traffic", () => {
    const stop = computePriorityScore(outputWith({ isShutdown: true }));
    const stuck = computePriorityScore(outputWith({ isStuck: true }));
    const stale = computePriorityScore(outputWith({ isStale: true }));
    const opt = computePriorityScore(outputWith({ isOptimize: true }));
    const scale = computePriorityScore(outputWith({ isScaling: true }));
    const win = computePriorityScore(outputWith({ isWinner: true }));
    const traffic = computePriorityScore(outputWith({ isTrafficIssue: true }));
    assert.ok(stop > stuck);
    assert.equal(stuck, stale);
    assert.ok(stuck > opt && opt > scale && scale > win && win > traffic);
  });
});

describe("evaluatorBadges", () => {
  it("maps flags to labels", () => {
    const badges = evaluatorBadges(outputWith({ isScaling: true, isWinner: true }));
    assert.deepEqual(badges, ["Winner", "Ready to scale"]);
  });
});

describe("evaluateCampaign — live-surface signals", () => {
  it("zero conversions (testing) driven by minVisitsForZeroConvAlert", () => {
    const out = evaluateCampaign(
      { purpose: "testing", status: "live", liveStartedAt: live(1) },
      { clicks: 600, conversions: 0, offerCount: 1 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(out.isZeroConversion, true);
    const below = evaluateCampaign(
      { purpose: "testing", status: "live", liveStartedAt: live(1) },
      { clicks: 100, conversions: 0, offerCount: 1 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(below.isZeroConversion, false);
  });

  it("zero conversions (scale) driven by noConversionsAfterHours", () => {
    const out = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(3) },
      { clicks: 100, conversions: 0, offerCount: 1 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(out.isZeroConversion, true); // 3d ≥ 48h/24 = 2d
  });

  it("milestone 50 / 75 from configured milestones", () => {
    const target = DEFAULT_ALERT_RULES.testing.visitsPerOffer; // offerCount 1
    const m50 = evaluateCampaign(
      { purpose: "testing", status: "live", liveStartedAt: live(1) },
      { clicks: Math.round(target * 0.6), conversions: 0, offerCount: 1 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(m50.isMilestone50, true);
    assert.equal(m50.isMilestone75, false);
    const m75 = evaluateCampaign(
      { purpose: "testing", status: "live", liveStartedAt: live(1) },
      { clicks: Math.round(target * 0.8), conversions: 0, offerCount: 1 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(m75.isMilestone75, true);
  });

  it("stale from review.staleCampaignDays", () => {
    const out = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(20) },
      { clicks: 10, conversions: 0, offerCount: 1 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    assert.equal(out.isStale, true);
  });

  it("stuck from pacing-risk settings", () => {
    const out = evaluateCampaign(
      { purpose: "testing", status: "live", liveStartedAt: live(5) },
      { clicks: 100, conversions: 0, offerCount: 1 },
      DEFAULT_ALERT_RULES,
      NOW,
    );
    // 5d ≥ 3d, trafficPct tiny < 25%, zero conv → stuck
    assert.equal(out.isStuck, true);
  });

  it("changing settings changes live-surface signals", () => {
    const strict = {
      ...DEFAULT_ALERT_RULES,
      review: { ...DEFAULT_ALERT_RULES.review, staleCampaignDays: 60 },
    };
    const out = evaluateCampaign(
      { purpose: "working", status: "live", liveStartedAt: live(20) },
      { clicks: 10, conversions: 0, offerCount: 1 },
      strict,
      NOW,
    );
    assert.equal(out.isStale, false);
  });
});
