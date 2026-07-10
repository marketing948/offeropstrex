import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ALERT_RULES, mergeAlertRules } from "./index.js";

describe("mergeAlertRules", () => {
  it("returns defaults for empty input", () => {
    assert.deepEqual(mergeAlertRules(null), DEFAULT_ALERT_RULES);
  });

  it("merges partial patches", () => {
    const merged = mergeAlertRules({ testing: { visitsPerOffer: 20_000 } });
    assert.equal(merged.testing.visitsPerOffer, 20_000);
    assert.equal(merged.review.ignoredSignalEscalationHours, 4);
  });

  it("falls back on invalid values", () => {
    const merged = mergeAlertRules({ testing: { visitsPerOffer: -1 } });
    assert.equal(merged.testing.visitsPerOffer, DEFAULT_ALERT_RULES.testing.visitsPerOffer);
  });

  it("exposes new traffic / winning / shutdown sections with defaults", () => {
    const merged = mergeAlertRules(null);
    assert.equal(merged.traffic.spikeIncreasePct, DEFAULT_ALERT_RULES.traffic.spikeIncreasePct);
    assert.equal(merged.winning.minROI, DEFAULT_ALERT_RULES.winning.minROI);
    assert.equal(merged.shutdown.minDaysLive, DEFAULT_ALERT_RULES.shutdown.minDaysLive);
    assert.equal(
      merged.optimization.roiDropThreshold,
      DEFAULT_ALERT_RULES.optimization.roiDropThreshold,
    );
  });

  it("merges partial patches for the new sections", () => {
    const merged = mergeAlertRules({
      winning: { minRevenue: 999 },
      shutdown: { minDaysLive: 21 },
      traffic: { spikeIncreasePct: 55 },
    });
    assert.equal(merged.winning.minRevenue, 999);
    assert.equal(merged.winning.minROI, DEFAULT_ALERT_RULES.winning.minROI);
    assert.equal(merged.shutdown.minDaysLive, 21);
    assert.equal(merged.traffic.spikeIncreasePct, 55);
  });
});
