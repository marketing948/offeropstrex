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
});
