import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { geoFlagEmoji, geoFlagLabel } from "./geo-flag.ts";

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
});
