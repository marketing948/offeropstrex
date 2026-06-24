import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  goalMatchesNetworkPlanScope,
  goalMatchesWorkerMonthPlanScope,
  removeNetworkGoalsFromTargets,
  removeAllGoalsForWorkerMonth,
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

describe("goalMatchesWorkerMonthPlanScope", () => {
  it("matches all plan metrics for worker/month regardless of network", () => {
    const row = goal({ id: "1", employeeId: 78, metricKey: "revenue", affiliateNetworkName: null });
    assert.equal(goalMatchesWorkerMonthPlanScope(row, 78, "2026-06"), true);
    const netRow = goal({ id: "2", employeeId: 78, metricKey: "testingBatches" });
    assert.equal(goalMatchesWorkerMonthPlanScope(netRow, 78, "2026-06"), true);
  });

  it("does not match other workers or months", () => {
    const row = goal({ id: "1", employeeId: 78, metricKey: "testingBatches" });
    assert.equal(goalMatchesWorkerMonthPlanScope(row, 43, "2026-06"), false);
    assert.equal(goalMatchesWorkerMonthPlanScope(row, 78, "2026-07"), false);
  });
});

describe("removeAllGoalsForWorkerMonth", () => {
  const goals: GoalPlanScopeRow[] = [
    goal({ id: "a", employeeId: 78, metricKey: "revenue", affiliateNetworkName: null }),
    goal({ id: "b", employeeId: 78, metricKey: "testingBatches" }),
    goal({ id: "c", employeeId: 78, metricKey: "testingBatches", geoCode: "GB", monthlyTarget: 0 }),
    goal({ id: "d", employeeId: 78, metricKey: "testingBatches", affiliateNetworkName: "Tradetracker CBV" }),
    goal({ id: "e", employeeId: 43, metricKey: "testingBatches" }),
    goal({ id: "f", employeeId: 78, metricKey: "testingBatches", monthKey: "2026-07" }),
  ];

  it("removes only selected worker/month goals", () => {
    const { kept, removed } = removeAllGoalsForWorkerMonth(goals, 78, "2026-06");
    assert.equal(removed.length, 4);
    assert.deepEqual(removed.map((g) => g.id).sort(), ["a", "b", "c", "d"]);
    assert.equal(kept.length, 2);
    assert.ok(kept.some((g) => g.id === "e"));
    assert.ok(kept.some((g) => g.id === "f"));
  });
});
