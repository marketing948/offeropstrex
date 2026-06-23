import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  goalMatchesNetworkPlanScope,
  removeNetworkGoalsFromTargets,
  type GoalPlanScopeRow,
} from "./goal-plan-scope.ts";

function goal(partial: Partial<GoalPlanScopeRow> & Pick<GoalPlanScopeRow, "id" | "employeeId" | "metricKey">): GoalPlanScopeRow {
  return {
    monthlyTarget: 10,
    isActive: true,
    monthKey: "2026-06",
    affiliateNetworkName: "Linkhaitao SLG",
    ...partial,
  };
}

describe("goalMatchesNetworkPlanScope", () => {
  it("matches network-level and GEO rows for same worker/month/network", () => {
    const net = goal({ id: "1", employeeId: 78, metricKey: "testingBatches" });
    const geo = goal({ id: "2", employeeId: 78, metricKey: "testingBatches", geoCode: "GB", monthlyTarget: 0 });
    assert.equal(goalMatchesNetworkPlanScope(net, 78, "2026-06", "Linkhaitao SLG"), true);
    assert.equal(goalMatchesNetworkPlanScope(geo, 78, "2026-06", "Linkhaitao SLG"), true);
  });

  it("does not match other workers, months, or networks", () => {
    const row = goal({ id: "1", employeeId: 78, metricKey: "testingBatches" });
    assert.equal(goalMatchesNetworkPlanScope(row, 43, "2026-06", "Linkhaitao SLG"), false);
    assert.equal(goalMatchesNetworkPlanScope(row, 78, "2026-07", "Linkhaitao SLG"), false);
    assert.equal(goalMatchesNetworkPlanScope(row, 78, "2026-06", "Tradetracker CBV"), false);
  });

  it("does not match worker-wide goals without network", () => {
    const row = goal({ id: "1", employeeId: 78, metricKey: "revenue", affiliateNetworkName: null });
    assert.equal(goalMatchesNetworkPlanScope(row, 78, "2026-06", "Linkhaitao SLG"), false);
  });
});

describe("removeNetworkGoalsFromTargets", () => {
  const goals: GoalPlanScopeRow[] = [
    goal({
      id: "net-testing",
      employeeId: 78,
      metricKey: "testingBatches",
      monthlyTarget: 14,
      selectedGeoCodes: ["CA", "DE", "FR", "GB"],
    }),
    goal({
      id: "geo-gb",
      employeeId: 78,
      metricKey: "testingBatches",
      geoCode: "GB",
      monthlyTarget: 0,
    }),
    goal({
      id: "other-net",
      employeeId: 78,
      metricKey: "testingBatches",
      affiliateNetworkName: "Tradetracker CBV",
      monthlyTarget: 10,
    }),
    goal({
      id: "other-worker",
      employeeId: 43,
      metricKey: "testingBatches",
      monthlyTarget: 5,
    }),
  ];

  it("removes only selected network rows for worker/month", () => {
    const { kept, removed } = removeNetworkGoalsFromTargets(goals, 78, "2026-06", "Linkhaitao SLG");
    assert.equal(removed.length, 2);
    assert.deepEqual(removed.map((g) => g.id).sort(), ["geo-gb", "net-testing"]);
    assert.equal(kept.length, 2);
    assert.ok(kept.some((g) => g.id === "other-net"));
    assert.ok(kept.some((g) => g.id === "other-worker"));
  });
});
