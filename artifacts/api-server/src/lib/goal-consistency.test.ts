import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ServerWorkerGoalTarget } from "./goals-config-server.ts";
import { overviewTargetMatchesNetworks } from "./goal-allocation-utils.ts";
import {
  resolveGeoTargetsForNetworkMetric,
  resolveNetworkTargetsForMetric,
  workerWideTarget,
} from "./goal-network-resolution.ts";

function goal(partial: Partial<ServerWorkerGoalTarget> & Pick<ServerWorkerGoalTarget, "metricKey" | "employeeId" | "monthlyTarget">): ServerWorkerGoalTarget {
  return {
    monthKey: "2026-06",
    xpReward: 0,
    affiliateNetworkName: null,
    geoCode: null,
    selectedGeoCodes: null,
    ...partial,
  };
}

describe("goal cross-surface network resolution", () => {
  it("Tester-style explicit network totals match overview", () => {
    const employeeId = 78;
    const goals: ServerWorkerGoalTarget[] = [
      goal({
        metricKey: "revenue",
        employeeId,
        affiliateNetworkName: "Tradetracker CBV",
        monthlyTarget: 4000,
        selectedGeoCodes: ["CA", "DE", "FR", "GB"],
      }),
      goal({
        metricKey: "testingBatches",
        employeeId,
        affiliateNetworkName: "Tradetracker CBV",
        monthlyTarget: 4,
        selectedGeoCodes: ["CA", "DE", "FR", "GB"],
      }),
      goal({
        metricKey: "workingCampaigns",
        employeeId,
        affiliateNetworkName: "Tradetracker CBV",
        monthlyTarget: 4,
        selectedGeoCodes: ["CA", "DE", "FR", "GB"],
      }),
    ];

    const assigned = ["Linkhaitao SLG", "Tradetracker CBV"];
    const revenue = resolveNetworkTargetsForMetric(goals, "revenue", employeeId, assigned, []);
    const testing = resolveNetworkTargetsForMetric(goals, "testingBatches", employeeId, assigned, []);
    const working = resolveNetworkTargetsForMetric(goals, "workingCampaigns", employeeId, assigned, []);

    assert.equal(revenue.get("Tradetracker CBV")?.target, 4000);
    assert.equal(testing.get("Tradetracker CBV")?.target, 4);
    assert.equal(working.get("Tradetracker CBV")?.target, 4);

    const geoSplit = resolveGeoTargetsForNetworkMetric({
      goals,
      metricKey: "revenue",
      employeeId,
      networkName: "Tradetracker CBV",
      networkResolution: revenue.get("Tradetracker CBV")!,
      activityGeos: [],
    });
    assert.equal(geoSplit.geos.length, 4);
    assert.equal(
      geoSplit.geos.reduce((sum, g) => sum + g.target, 0),
      4000,
    );
  });

  it("Sara-style multi-network sums match overview", () => {
    const employeeId = 42;
    const goals: ServerWorkerGoalTarget[] = [
      goal({ metricKey: "revenue", employeeId, affiliateNetworkName: "Yieldkit CBV", monthlyTarget: 5000 }),
      goal({ metricKey: "revenue", employeeId, affiliateNetworkName: "BlueAffiliate CBV", monthlyTarget: 3000 }),
      goal({ metricKey: "testingBatches", employeeId, affiliateNetworkName: "Yieldkit CBV", monthlyTarget: 18 }),
      goal({ metricKey: "testingBatches", employeeId, affiliateNetworkName: "BlueAffiliate CBV", monthlyTarget: 18 }),
      goal({ metricKey: "workingCampaigns", employeeId, affiliateNetworkName: "Yieldkit CBV", monthlyTarget: 6 }),
      goal({ metricKey: "workingCampaigns", employeeId, affiliateNetworkName: "BlueAffiliate CBV", monthlyTarget: 6 }),
    ];

    const assigned = ["Yieldkit CBV", "BlueAffiliate CBV"];
    const revenue = [...resolveNetworkTargetsForMetric(goals, "revenue", employeeId, assigned, []).values()];
    const testing = [...resolveNetworkTargetsForMetric(goals, "testingBatches", employeeId, assigned, []).values()];
    const working = [...resolveNetworkTargetsForMetric(goals, "workingCampaigns", employeeId, assigned, []).values()];

    assert.equal(revenue.reduce((s, r) => s + r.target, 0), 8000);
    assert.equal(testing.reduce((s, r) => s + r.target, 0), 36);
    assert.equal(working.reduce((s, r) => s + r.target, 0), 12);

    assert.equal(
      overviewTargetMatchesNetworks({
        overview: { revenue: { target: 8000 }, testing: { target: 36 }, working: { target: 12 } },
        workerWideUnallocated: null,
        networks: [
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
        ],
      }),
      true,
    );
  });

  it("worker-wide auto distribution sums to overview", () => {
    const employeeId = 99;
    const goals: ServerWorkerGoalTarget[] = [
      goal({ metricKey: "revenue", employeeId, monthlyTarget: 4000 }),
      goal({ metricKey: "testingBatches", employeeId, monthlyTarget: 4 }),
      goal({ metricKey: "workingCampaigns", employeeId, monthlyTarget: 4 }),
    ];
    const assigned = ["NetA", "NetB"];

    assert.equal(workerWideTarget(goals, "revenue", employeeId), 4000);
    const revenueShares = resolveNetworkTargetsForMetric(goals, "revenue", employeeId, assigned, []);
    assert.equal(revenueShares.get("NetA")?.target, 2000);
    assert.equal(revenueShares.get("NetB")?.target, 2000);
    assert.equal([...revenueShares.values()].reduce((s, r) => s + r.target, 0), 4000);
  });

  it("explicit GEO zero appears in inherited split", () => {
    const employeeId = 78;
    const goals: ServerWorkerGoalTarget[] = [
      goal({
        metricKey: "revenue",
        employeeId,
        affiliateNetworkName: "Tradetracker CBV",
        monthlyTarget: 4000,
        selectedGeoCodes: ["CA", "DE"],
      }),
      goal({
        metricKey: "revenue",
        employeeId,
        affiliateNetworkName: "Tradetracker CBV",
        geoCode: "DE",
        monthlyTarget: 0,
      }),
    ];
    const resolution = resolveNetworkTargetsForMetric(
      goals,
      "revenue",
      employeeId,
      ["Tradetracker CBV"],
      [],
    ).get("Tradetracker CBV")!;
    const { geos } = resolveGeoTargetsForNetworkMetric({
      goals,
      metricKey: "revenue",
      employeeId,
      networkName: "Tradetracker CBV",
      networkResolution: resolution,
      activityGeos: [],
    });
    const de = geos.find((g) => g.geoCode === "DE");
    assert.ok(de);
    assert.equal(de!.target, 0);
    assert.equal(de!.source, "custom-zero");
  });

  it("no goals yields empty network resolution", () => {
    const employeeId = 1;
    const goals: ServerWorkerGoalTarget[] = [];
    const revenue = resolveNetworkTargetsForMetric(goals, "revenue", employeeId, ["NetA"], []);
    assert.equal(revenue.size, 0);
  });
});
