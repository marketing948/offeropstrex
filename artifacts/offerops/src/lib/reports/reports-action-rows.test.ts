import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNetworkGeoActionRowsFromBreakdown,
  buildReportsActionRow,
} from "./reports-action-rows.ts";
import type { MetricBreakdownResult } from "../performance-engine/api.ts";

const MONTH = "2026-07";
const NOW = new Date("2026-07-08T12:00:00Z");

const sampleBreakdown: MetricBreakdownResult = {
  metric: "testing",
  scope: { workspaceId: 1, employeeId: 2, month: MONTH },
  summary: { current: 40, target: 230, percent: 17, xpAvailable: 0 },
  networks: [
    {
      key: "yk",
      label: "Yieldkit CBV",
      networkId: "1",
      current: 10,
      target: 80,
      percent: 12,
      geos: [
        {
          key: "gb",
          label: "GB",
          current: 4,
          target: 40,
          percent: 10,
          targetSource: "custom",
        },
      ],
    },
  ],
  geos: [],
  items: [],
};

describe("reports action rows", () => {
  test("network row includes target/current/expected/today/gap/progress/action", () => {
    const { networks } = buildNetworkGeoActionRowsFromBreakdown(
      sampleBreakdown,
      "testing",
      MONTH,
      { now: NOW },
    );
    assert.ok(networks.length >= 1);
    const row = networks[0]!;
    assert.equal(row.label, "Yieldkit CBV");
    assert.ok(row.monthlyTarget > 0);
    assert.ok(row.expectedByNow > 0);
    assert.ok(row.todayTarget > 0);
    assert.ok(row.gapToPace > 0);
    assert.ok(row.progressPct >= 0);
    assert.match(row.actionSuggestion, /Create \d+ testing/);
  });

  test("GEO row includes same pace + action fields", () => {
    const { geos } = buildNetworkGeoActionRowsFromBreakdown(
      sampleBreakdown,
      "testing",
      MONTH,
      { now: NOW },
    );
    assert.ok(geos.length >= 1);
    const row = geos[0]!;
    assert.equal(row.geo, "GB");
    assert.equal(row.network, "Yieldkit CBV");
    assert.ok(row.monthlyTarget > 0);
    assert.ok(row.expectedByNow > 0);
    assert.ok(row.todayTarget > 0);
    assert.match(row.actionSuggestion, /Create \d+ testing/);
  });

  test("on pace row", () => {
    const row = buildReportsActionRow({
      key: "n1",
      dimension: "network",
      label: "A",
      metric: "testing",
      current: 230,
      target: 230,
      monthKey: MONTH,
      now: NOW,
    });
    assert.equal(row.actionSuggestion, "On pace");
  });
});
