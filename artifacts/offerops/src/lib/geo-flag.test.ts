import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { geoCodeText, geoFlagEmoji, geoFlagLabel } from "./geo-flag.ts";

/** Count non-overlapping occurrences of a code token in the rendered text. */
function countCode(text: string, code: string): number {
  return text.split(code).length - 1;
}

describe("geoFlagEmoji", () => {
  test("GB renders regional indicator pair", () => {
    assert.equal(geoFlagEmoji("GB"), "🇬🇧");
  });

  test("non-ISO codes fall back to globe", () => {
    assert.equal(geoFlagEmoji("GLOBAL"), "🌍");
  });
});

describe("geoFlagLabel", () => {
  test("GB renders flag prefix + code", () => {
    assert.equal(geoFlagLabel("GB"), "🇬🇧 GB");
  });

  test("deduplicates messy GEO strings", () => {
    assert.equal(geoFlagLabel("GB GB"), "🇬🇧 GB");
  });

  test("US variants all normalize to a single canonical label", () => {
    assert.equal(geoFlagLabel("US"), "🇺🇸 US");
    assert.equal(geoFlagLabel("us"), "🇺🇸 US");
    assert.equal(geoFlagLabel("US US"), "🇺🇸 US");
    assert.equal(geoFlagLabel("🇺🇸 US"), "🇺🇸 US");
    assert.equal(geoFlagLabel("  us  "), "🇺🇸 US");
  });

  test("mixed case gb GB normalizes once", () => {
    assert.equal(geoFlagLabel("gb GB"), "🇬🇧 GB");
  });

  test("unknown/invalid input is displayed safely once (globe, empty code)", () => {
    assert.equal(geoFlagLabel("GLOBAL"), "🌍 ");
    assert.equal(geoFlagLabel(""), "🌍 ");
  });
});

describe("geoCodeText (canonical code-only display — no emoji duplication)", () => {
  test("US variants all render the code exactly once", () => {
    for (const v of ["US", "us", "US US", "🇺🇸 US", "  us  "]) {
      const text = geoCodeText(v);
      assert.equal(text, "US", `"${v}" should render "US"`);
      assert.equal(countCode(text, "US"), 1, `"${v}" must contain US once`);
    }
  });

  test("GB renders the code exactly once", () => {
    const text = geoCodeText("gb GB");
    assert.equal(text, "GB");
    assert.equal(countCode(text, "GB"), 1);
  });

  test("output never contains a regional-indicator flag emoji", () => {
    for (const v of ["US", "GB", "🇺🇸 US"]) {
      assert.ok(!/[\u{1F1E6}-\u{1F1FF}]/u.test(geoCodeText(v)));
    }
  });

  test("invalid / empty GEO is displayed safely once", () => {
    assert.equal(geoCodeText("GLOBAL"), "GLOBAL");
    assert.equal(geoCodeText(""), "—");
    assert.equal(geoCodeText(null), "—");
    assert.equal(geoCodeText("   "), "—");
  });
});
