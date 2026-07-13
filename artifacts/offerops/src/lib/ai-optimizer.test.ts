/**
 * Frontend AI Optimizer distribution mirror — must match the backend engine.
 * Run: ../api-server/node_modules/.bin/tsx --test src/lib/ai-optimizer.test.ts
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  assignCmpToRetained,
  buildDistribution,
  cmpLabel,
  distributeOffers,
  validatePathCount,
  withNewCampaignIndex,
  type DecisionRecord,
} from "./ai-optimizer.ts";

describe("frontend distribution mirror", () => {
  test("82 / 10 → 9,9,8×8", () => {
    assert.deepEqual(distributeOffers(82, 10), [9, 9, 8, 8, 8, 8, 8, 8, 8, 8]);
  });
  test("59 / 10 → nine 6s then 5", () => {
    assert.deepEqual(distributeOffers(59, 10), [6, 6, 6, 6, 6, 6, 6, 6, 6, 5]);
  });
  test("3 / 3 → 1,1,1", () => {
    assert.deepEqual(distributeOffers(3, 3), [1, 1, 1]);
  });
  test("cmp labels zero-padded incl cmp100", () => {
    assert.equal(cmpLabel(0), "cmp01");
    assert.equal(cmpLabel(9), "cmp10");
    assert.equal(cmpLabel(99), "cmp100");
  });
  test("validatePathCount guards range", () => {
    assert.equal(validatePathCount(10, 3), null);
    assert.ok(validatePathCount(3, 4));
    assert.ok(validatePathCount(0, 1));
  });
  test("contiguous buckets cover the whole retained sequence", () => {
    const buckets = buildDistribution(82, 10);
    assert.equal(buckets[0]!.startPosition, 1);
    assert.equal(buckets[0]!.endPosition, 9);
    assert.equal(buckets.at(-1)!.endPosition, 82);
    assert.equal(assignCmpToRetained(82, 10).length, 82);
  });

  test("withNewCampaignIndex assigns cmp to retained rows, blanks REMOVE", () => {
    const decisions: DecisionRecord[] = [
      { originalPosition: 1, brandName: "K1", normalizedBrandName: "k1", offerId: null, revenue: 5, decision: "KEEP", reason: "", matchStatus: "MATCHED", oldCampaignIndex: "a", newCampaignIndex: "" },
      { originalPosition: 2, brandName: "R1", normalizedBrandName: "r1", offerId: null, revenue: 0, decision: "REMOVE", reason: "", matchStatus: "MATCHED", oldCampaignIndex: "b", newCampaignIndex: "" },
      { originalPosition: 3, brandName: "U1", normalizedBrandName: "u1", offerId: null, revenue: null, decision: "UNMATCHED", reason: "", matchStatus: "UNMATCHED_CAMPAIGN_ROW", oldCampaignIndex: "c", newCampaignIndex: "" },
    ];
    const out = withNewCampaignIndex(decisions, 2);
    assert.equal(out[0]!.newCampaignIndex, "cmp01");
    assert.equal(out[1]!.newCampaignIndex, ""); // REMOVE blank
    assert.equal(out[2]!.newCampaignIndex, "cmp02");
  });
});
