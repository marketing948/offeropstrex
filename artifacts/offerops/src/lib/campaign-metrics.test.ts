import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  profitFromCostRevenue,
  resolveDisplayRoiPercent,
  roiPercentFromCostRevenue,
} from "./campaign-metrics.ts";

describe("campaign-metrics", () => {
  test("roiPercentFromCostRevenue calculates from cost and revenue", () => {
    assert.equal(roiPercentFromCostRevenue(100, 150), 50);
    assert.equal(roiPercentFromCostRevenue(200, 100), -50);
  });

  test("cost=0 returns 0 ROI without divide-by-zero", () => {
    assert.equal(roiPercentFromCostRevenue(0, 100), 0);
    assert.equal(roiPercentFromCostRevenue(0, 0), 0);
  });

  test("resolveDisplayRoiPercent ignores imported ROI when cost/revenue exist", () => {
    assert.equal(resolveDisplayRoiPercent(100, 150, 999), 50);
    assert.equal(resolveDisplayRoiPercent(100, 50, 200), -50);
  });

  test("resolveDisplayRoiPercent falls back to stored ROI without financials", () => {
    assert.equal(resolveDisplayRoiPercent(0, 0, 0.25), 25);
    assert.equal(resolveDisplayRoiPercent(null, null, 12), 12);
  });

  test("profitFromCostRevenue", () => {
    assert.equal(profitFromCostRevenue(40, 100), 60);
  });
});
