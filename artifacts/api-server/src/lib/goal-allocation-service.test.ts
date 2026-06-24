import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  distributeTargetAcrossKeys,
  sortEligibleNetworks,
} from "./goal-effective-targets.ts";
import {
  overviewTargetMatchesNetworks,
  sumNetworkMetricTargets,
  type GoalAllocationNetworkRow,
  type GoalAllocationResult,
} from "./goal-allocation-utils.ts";

describe("sortEligibleNetworks", () => {
  it("sorts case-insensitively ascending", () => {
    assert.deepEqual(sortEligibleNetworks(["tradetracker", "Linkhaitao"]), [
      "Linkhaitao",
      "tradetracker",
    ]);
  });
});

describe("distributeTargetAcrossKeys", () => {
  it("splits revenue equally", () => {
    const shares = distributeTargetAcrossKeys("revenue", 4000, ["NetA", "NetB"]);
    assert.equal(shares.get("NetA"), 2000);
    assert.equal(shares.get("NetB"), 2000);
  });

  it("splits integer counts deterministically 4 over 3 networks", () => {
    const shares = distributeTargetAcrossKeys("count", 4, ["A", "B", "C"]);
    assert.deepEqual([...shares.values()].sort((a, b) => b - a), [2, 1, 1]);
    assert.equal([...shares.values()].reduce((s, v) => s + v, 0), 4);
  });
});

describe("overviewTargetMatchesNetworks", () => {
  it("matches Sara-style explicit network rows", () => {
    const networks: GoalAllocationNetworkRow[] = [
      {
        affiliateNetworkName: "Yieldkit CBV",
        revenueTarget: 5000,
        testingTarget: 18,
        workingTarget: 6,
        geoCount: 0,
        overrideCount: 0,
        geoSplitRows: [],
      },
      {
        affiliateNetworkName: "BlueAffiliate CBV",
        revenueTarget: 3000,
        testingTarget: 18,
        workingTarget: 6,
        geoCount: 0,
        overrideCount: 0,
        geoSplitRows: [],
      },
    ];
    const result: GoalAllocationResult = {
      overview: {
        revenue: { target: 8000 },
        testing: { target: 36 },
        working: { target: 12 },
      },
      workerWideUnallocated: null,
      networks,
    };
    assert.equal(sumNetworkMetricTargets(networks, "revenue"), 8000);
    assert.equal(sumNetworkMetricTargets(networks, "testing"), 36);
    assert.equal(sumNetworkMetricTargets(networks, "working"), 12);
    assert.equal(overviewTargetMatchesNetworks(result), true);
  });

  it("matches Tester-style single network totals", () => {
    const networks: GoalAllocationNetworkRow[] = [
      {
        affiliateNetworkName: "Tradetracker CBV",
        revenueTarget: 4000,
        testingTarget: 4,
        workingTarget: 4,
        geoCount: 4,
        overrideCount: 0,
        geoSplitRows: [],
      },
    ];
    const result: GoalAllocationResult = {
      overview: {
        revenue: { target: 4000 },
        testing: { target: 4 },
        working: { target: 4 },
      },
      workerWideUnallocated: null,
      networks,
    };
    assert.equal(overviewTargetMatchesNetworks(result), true);
  });
});
