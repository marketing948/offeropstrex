import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  computeGoalBasedFocus,
  type GoalCardModel,
} from "./ops-goal-focus.ts";
import { evaluatePace } from "./ops-v2-metrics.ts";

function makeCard(
  kind: GoalCardModel["kind"],
  actual: number,
  target: number,
  monthKey = "2026-07",
  now = new Date("2026-07-08T12:00:00Z"),
): GoalCardModel {
  return {
    kind,
    label: kind === "revenue" ? "Revenue" : kind === "testing" ? "Testing Pipeline" : "Working Campaigns",
    icon: kind,
    actual,
    target,
    gap: Math.max(0, target - actual),
    pace: evaluatePace(actual, target, monthKey, now),
    format: kind === "revenue" ? "currency" : "count",
    networkRows: [],
    supportsGeoDrilldown: kind === "revenue",
  };
}

describe("computeGoalBasedFocus", () => {
  test("behind testing produces actionable create-N message", () => {
    const items = computeGoalBasedFocus([
      makeCard("revenue", 50_000, 50_000),
      makeCard("testing", 40, 230),
      makeCard("working", 60, 60),
    ]);
    const testing = items.find((i) => i.title === "Testing focus");
    assert.ok(testing);
    assert.match(testing!.text, /Create \d+ testing campaign/);
    assert.match(testing!.reason ?? "", /behind pace/i);
    assert.equal(testing!.context?.progressLabel, "Month progress vs today’s expected pace");
    assert.ok((testing!.context?.progressPct ?? 0) < 100);
  });

  test("ahead working produces scaling suggestion", () => {
    const items = computeGoalBasedFocus([
      makeCard("revenue", 50_000, 50_000),
      makeCard("testing", 230, 230),
      makeCard("working", 90, 60),
    ]);
    const working = items.find((i) => i.title === "Working focus");
    assert.ok(working);
    assert.match(working!.text, /Review scaling opportunities/i);
  });

  test("no goal produces No goal set", () => {
    const items = computeGoalBasedFocus([
      makeCard("revenue", 0, 0),
      makeCard("testing", 0, 0),
      makeCard("working", 0, 0),
    ]);
    assert.ok(items.some((i) => i.text === "No goal set."));
  });

  test("missing offer count surfaces in focus", () => {
    const items = computeGoalBasedFocus(
      [
        makeCard("revenue", 50_000, 50_000),
        makeCard("testing", 230, 230),
        makeCard("working", 90, 60),
      ],
      [
        { status: "live", campaignPurpose: "working", offerCount: null },
        { status: "live", campaignPurpose: "working", offerCount: null },
      ],
    );
    const missing = items.find((i) => i.title === "Missing offer count");
    assert.ok(missing);
    assert.match(missing!.text, /Review 2 campaign/);
  });
});
