import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isScalingOpportunity, daysLiveForCampaign } from "./scaling-opportunity.ts";

describe("daysLiveForCampaign", () => {
  test("computes whole days from liveStartedAt", () => {
    const days = daysLiveForCampaign(
      "2026-07-01T00:00:00Z",
      null,
      new Date("2026-07-08T12:00:00Z"),
    );
    assert.equal(days, 7);
  });

  test("falls back to createdAt", () => {
    const days = daysLiveForCampaign(
      null,
      "2026-07-05T00:00:00Z",
      new Date("2026-07-08T12:00:00Z"),
    );
    assert.equal(days, 3);
  });

  test("returns null when dates missing", () => {
    assert.equal(daysLiveForCampaign(null, null), null);
  });
});

describe("isScalingOpportunity", () => {
  test("MVP rules", () => {
    const now = new Date("2026-07-08T12:00:00Z");
    assert.equal(
      isScalingOpportunity({
        campaignPurpose: "testing",
        status: "live",
        profit: 100,
        roi: 10,
        liveStartedAt: "2026-07-01T00:00:00Z",
        now,
      }),
      false,
    );
  });

  test("missing date is not a scaling opportunity", () => {
    assert.equal(
      isScalingOpportunity({
        campaignPurpose: "working",
        status: "live",
        profit: 261,
        roi: 12.4,
        liveStartedAt: null,
        createdAt: null,
        now: new Date("2026-07-08T12:00:00Z"),
      }),
      false,
    );
  });

  test("createdAt fallback enables scaling when liveStartedAt missing", () => {
    assert.equal(
      isScalingOpportunity({
        campaignPurpose: "working",
        status: "live",
        profit: 261,
        roi: 12.4,
        liveStartedAt: null,
        createdAt: "2026-07-01T00:00:00Z",
        now: new Date("2026-07-08T12:00:00Z"),
      }),
      true,
    );
  });

  test("settings thresholds gate the suggestion", () => {
    const base = {
      campaignPurpose: "working" as const,
      status: "live",
      profit: 150,
      roi: 12,
      revenue: 150,
      liveStartedAt: "2026-07-06T00:00:00Z", // 2 days by Jul 8
      now: new Date("2026-07-08T12:00:00Z"),
    };
    // Default thresholds → qualifies
    assert.equal(isScalingOpportunity(base), true);
    // Min revenue too high → excluded
    assert.equal(
      isScalingOpportunity({ ...base, thresholds: { minRevenue: 200 } }),
      false,
    );
    // Min live days too high → excluded
    assert.equal(
      isScalingOpportunity({ ...base, thresholds: { minLiveDays: 30 } }),
      false,
    );
    // Min ROI too high → excluded
    assert.equal(
      isScalingOpportunity({ ...base, thresholds: { minRoiPercent: 25 } }),
      false,
    );
  });
});
