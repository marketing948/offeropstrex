import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ceilCount,
  ceilCurrency,
  evaluatePace,
  evaluateWorkingDayPace,
  formatOpsCount,
  formatOpsCurrency,
  formatOpsMetric,
  formatOpsPercent,
} from "./ops-v2-metrics.ts";

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

describe("ops number formatting", () => {
  test("ceils count metrics for Expected today display", () => {
    assert.equal(ceilCount(8.34726086956522), 9);
    assert.equal(ceilCount(2.43478260869523), 3);
    assert.equal(formatOpsCount(8.34726086956522), "9");
    assert.equal(formatOpsMetric(8.34726086956522, "count"), "9");
  });

  test("ceils currency then formats compact", () => {
    assert.equal(ceilCurrency(3099.1), 3100);
    assert.equal(formatOpsCurrency(3099.1), "$3.1K");
    assert.equal(formatOpsCurrency(72000.2), "$72K");
    assert.equal(formatOpsCurrency(850.1), "$851");
  });

  test("percent formatting never emits long floats", () => {
    assert.equal(formatOpsPercent(12.3456789), "12.3%");
    assert.equal(formatOpsPercent(12.3456789, 0), "12%");
  });
});

describe("evaluatePace exposed expectedByNow", () => {
  test("Expected today is dailyExpected and pace uses expectedByNow", () => {
    const now = new Date("2026-07-08T12:00:00Z");
    const pace = evaluatePace(30, 230, "2026-07", now);
    assert.equal(pace.dailyExpected, 10);
    assert.equal(pace.expectedByToday, 10);
    assert.equal(pace.expectedByNow, 60);
    assert.equal(pace.paceGap, 30 - 60);
    assert.equal(pace.paceStatus, "Behind Pace");
  });
});
