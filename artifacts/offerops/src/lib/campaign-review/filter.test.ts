import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesReviewSearch } from "./filter.ts";
import type { ReviewQueueCampaign } from "./types.ts";

test("matchesReviewSearch finds campaign by id and comment", () => {
  const item: ReviewQueueCampaign = {
    campaignId: 42,
    campaignName: "UK Dating",
    batchId: 1,
    batchName: "Batch A",
    employeeId: 3,
    employeeName: "Alex",
    platform: "ios",
    purpose: "working",
    status: "live",
    health: "needs_review",
    healthLabel: "Needs review",
    signals: [],
    suggestedActions: [],
    visits: 100,
    conversions: 2,
    revenue: 50,
    cost: 40,
    roi: 25,
    profit: 10,
    firstSeenAt: null,
    escalated: false,
    voluumCampaignId: "vol-abc",
    reviewComment: "Check pacing",
    urgencyScore: 10,
  };
  assert.equal(matchesReviewSearch(item, "42"), true);
  assert.equal(matchesReviewSearch(item, "vol-abc"), true);
  assert.equal(matchesReviewSearch(item, "check pacing"), true);
  assert.equal(matchesReviewSearch(item, "alex"), true);
  assert.equal(matchesReviewSearch(item, "nomatch"), false);
});
