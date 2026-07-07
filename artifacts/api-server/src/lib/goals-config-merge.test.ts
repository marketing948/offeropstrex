import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countWorkerGoalTargets,
  mergeLegacyGoalsSettingsPreservingWorkerTargets,
  safeParseGoalsConfig,
} from "./goals-config-merge.ts";

describe("mergeLegacyGoalsSettingsPreservingWorkerTargets", () => {
  const existingWorkerGoalTargets = [
    { id: "wg_1", employeeId: 42, metricKey: "revenue", monthlyTarget: 1000, isActive: true },
    { id: "wg_2", employeeId: 43, metricKey: "testingBatches", monthlyTarget: 6, isActive: true },
  ];

  it("preserves existing workerGoalTargets when incoming omits field", () => {
    const merged = mergeLegacyGoalsSettingsPreservingWorkerTargets(
      {
        workerGoalTargets: existingWorkerGoalTargets,
        kpiTargets: [],
      },
      {
        kpiTargets: [{ key: "revenue", monthlyTarget: 999 }],
      },
    );
    assert.equal(merged.workerGoalTargets.length, 2);
    assert.equal(merged.kpiTargets.length, 1);
  });

  it("ignores incoming empty workerGoalTargets", () => {
    const merged = mergeLegacyGoalsSettingsPreservingWorkerTargets(
      {
        workerGoalTargets: existingWorkerGoalTargets,
        kpiTargets: [],
      },
      {
        workerGoalTargets: [],
        kpiTargets: [{ key: "testingBatches", monthlyTarget: 8 }],
      },
    );
    assert.equal(merged.workerGoalTargets.length, 2);
    assert.equal(merged.kpiTargets.length, 1);
  });

  it("ignores incoming stale workerGoalTargets payload", () => {
    const merged = mergeLegacyGoalsSettingsPreservingWorkerTargets(
      {
        workerGoalTargets: existingWorkerGoalTargets,
        kpiTargets: [],
      },
      {
        workerGoalTargets: [{ id: "old", employeeId: 99, metricKey: "revenue", monthlyTarget: 1, isActive: true }],
      },
    );
    assert.deepEqual(merged.workerGoalTargets, existingWorkerGoalTargets);
  });
});

describe("goals-config merge helpers", () => {
  it("counts workerGoalTargets safely for audit", () => {
    assert.equal(countWorkerGoalTargets({ workerGoalTargets: [{ id: "a" }] as never[] }), 1);
    assert.equal(countWorkerGoalTargets({ workerGoalTargets: [] }), 0);
    assert.equal(countWorkerGoalTargets({}), 0);
    assert.equal(countWorkerGoalTargets(null), 0);
  });

  it("safeParseGoalsConfig rejects arrays and primitives", () => {
    assert.deepEqual(safeParseGoalsConfig("x"), {});
    assert.deepEqual(safeParseGoalsConfig([]), {});
    assert.deepEqual(safeParseGoalsConfig({ workerGoalTargets: [] }), { workerGoalTargets: [] });
  });
});
