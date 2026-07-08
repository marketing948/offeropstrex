import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateWorkingDayPace } from "./ops-v2-metrics.ts";

describe("evaluateWorkingDayPace", () => {
  test("uses weekday-only pacing for July 2026", () => {
    const now = new Date("2026-07-08T12:00:00Z");
    const pace230 = evaluateWorkingDayPace("2026-07", 230, 0, now);
    const pace336 = evaluateWorkingDayPace("2026-07", 336, 0, now);
    const pace98 = evaluateWorkingDayPace("2026-07", 98, 0, now);

    assert.equal(pace230.totalWorkingDaysInMonth, 23);
    assert.equal(pace230.elapsedWorkingDaysInMonth, 6);
    assert.equal(pace230.dailyExpected, 10);
    assert.equal(pace230.expectedByNow, 60);

    assert.equal(pace336.totalWorkingDaysInMonth, 23);
    assert.equal(pace336.elapsedWorkingDaysInMonth, 6);
    assert.equal(Number(pace336.dailyExpected.toFixed(2)), 14.61);
    assert.equal(Number(pace336.expectedByNow.toFixed(2)), 87.65);

    assert.equal(pace98.totalWorkingDaysInMonth, 23);
    assert.equal(pace98.elapsedWorkingDaysInMonth, 6);
    assert.equal(Number(pace98.dailyExpected.toFixed(2)), 4.26);
    assert.equal(Number(pace98.expectedByNow.toFixed(2)), 25.57);
  });
});
