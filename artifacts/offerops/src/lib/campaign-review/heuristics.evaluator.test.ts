import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ALERT_RULES, evaluateCampaign } from "@workspace/alert-rules";
import { deriveCampaignSignals, type ReviewCampaignInput } from "./heuristics.ts";

/**
 * STEP 6 validation — legacy heuristics (production path, flag OFF) vs the shared
 * evaluator's new live-surface signals, across 100 campaigns. The evaluator must
 * reproduce the legacy zero-conversion / milestone / stuck / stale decisions.
 */

const DAY = 86_400_000;

function liveAgo(days: number): string {
  // +1h so calendar-day flooring is stable at exactly `days`.
  return new Date(Date.now() - (days * DAY + 3_600_000)).toISOString();
}

function legacyBooleans(signals: ReturnType<typeof deriveCampaignSignals>) {
  const kinds = new Set(signals.map((s) => s.kind));
  return {
    milestone:
      kinds.has("traffic_50_no_conv") ||
      kinds.has("traffic_75_no_conv") ||
      kinds.has("traffic_100_no_conv"),
    zeroConv: kinds.has("zero_conversions"),
    stuck: kinds.has("traffic_unlikely_pace"),
    stale: kinds.has("stale"),
  };
}

describe("STEP 6: legacy heuristics vs evaluator — 100 campaigns", () => {
  test("mismatch rate on zero-conv / milestone / stuck / stale is 0%", () => {
    const purposes = ["testing", "working", "scaling"];
    const clicksSet = [0, 300, 600, 8_000, 12_000, 15_000, 30_000];
    const convSet = [0, 3];
    const offerSet = [1, 2];
    const ageSet = [1, 3, 8, 20];

    const campaigns: { c: ReviewCampaignInput; offerCount: number; daysLive: number }[] = [];
    let id = 1;
    for (const purpose of purposes)
      for (const clicks of clicksSet)
        for (const conversions of convSet)
          for (const offerCount of offerSet)
            for (const age of ageSet) {
              if (campaigns.length >= 100) break;
              campaigns.push({
                offerCount,
                daysLive: age,
                c: {
                  id: id++,
                  campaignName: `c${id}`,
                  batchId: null,
                  batchName: null,
                  employeeId: null,
                  employeeName: null,
                  platform: "ios",
                  campaignPurpose: purpose,
                  status: "live",
                  liveStartedAt: liveAgo(age),
                  clicks,
                  conversions,
                  revenue: conversions > 0 ? 300 : 0,
                  cost: 100,
                  roi: conversions > 0 ? 40 : -50,
                },
              });
            }
    assert.ok(campaigns.length >= 100, `only generated ${campaigns.length}`);

    const diffs: Record<string, number> = { milestone: 0, zeroConv: 0, stuck: 0, stale: 0 };
    for (const { c, offerCount, daysLive } of campaigns) {
      const legacy = legacyBooleans(deriveCampaignSignals(c, offerCount, daysLive, DEFAULT_ALERT_RULES));
      const out = evaluateCampaign(
        { purpose: c.campaignPurpose, status: c.status, liveStartedAt: c.liveStartedAt },
        { revenue: c.revenue, cost: c.cost, roi: c.roi, conversions: c.conversions, clicks: c.clicks, offerCount },
        DEFAULT_ALERT_RULES,
      );
      const next = {
        milestone: out.facts.milestoneReached != null,
        zeroConv:
          (c.campaignPurpose === "testing" || c.campaignPurpose !== "testing") && out.isZeroConversion,
        stuck: out.isStuck,
        stale: out.isStale,
      };
      if (legacy.milestone !== next.milestone) diffs.milestone++;
      if (legacy.zeroConv !== next.zeroConv) diffs.zeroConv++;
      if (legacy.stuck !== next.stuck) diffs.stuck++;
      if (legacy.stale !== next.stale) diffs.stale++;
    }

    const total = campaigns.length;
    const totalDiffs = diffs.milestone + diffs.zeroConv + diffs.stuck + diffs.stale;
    const rate = (totalDiffs / (total * 4)) * 100;
    // Surfaced for the run log.
    console.log(
      `[STEP6] heuristics parity over ${total} campaigns → diffs`,
      diffs,
      `rate=${rate.toFixed(2)}%`,
    );
    assert.ok(rate <= 5, `mismatch ${rate.toFixed(2)}% exceeds 5% budget`);
    assert.equal(totalDiffs, 0, `expected exact parity, got ${JSON.stringify(diffs)}`);
  });
});
