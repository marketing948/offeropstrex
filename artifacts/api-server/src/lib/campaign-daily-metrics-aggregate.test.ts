import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveMetricsDateRange,
  totalsFromSums,
} from "./campaign-daily-metrics-math.ts";

describe("resolveMetricsDateRange", () => {
  it("defaults to week start through today when omitted", () => {
    const r = resolveMetricsDateRange();
    assert.ok(!("error" in r));
    if ("error" in r) return;
    assert.match(r.dateFrom, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.dateTo, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.dateFrom <= r.dateTo);
  });

  it("rejects invalid dates", () => {
    const r = resolveMetricsDateRange("bad", "2026-05-01");
    assert.ok("error" in r);
  });

  it("rejects inverted range", () => {
    const r = resolveMetricsDateRange("2026-05-10", "2026-05-01");
    assert.ok("error" in r);
  });
});

describe("totalsFromSums", () => {
  it("computes profit, roi, and epc", () => {
    const t = totalsFromSums(1000, 50, 100, 250);
    assert.equal(t.profit, 150);
    assert.equal(t.roi, 1.5);
    assert.equal(t.epc, 0.25);
  });

  it("returns null roi and epc when denominators are zero", () => {
    const t = totalsFromSums(0, 10, 0, 100);
    assert.equal(t.roi, null);
    assert.equal(t.epc, null);
  });
});
