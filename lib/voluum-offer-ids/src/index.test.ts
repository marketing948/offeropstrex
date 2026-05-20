import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  parseVoluumOfferIdsFromNormalizedTokens,
  parseVoluumOfferIdsFromStrings,
  parseVoluumOfferIdsFromText,
  INVALID_VOLUUM_OFFER_ID_FORMAT_MESSAGE,
  coerceWinnerHandoffOfferIdsFromJson,
} from "./index";

const VALID_A = "3d1ef3ff-01e2-4340-a029-ec28275f50b4";
const VALID_B = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";

describe("parseVoluumOfferIdsFromText", () => {
  test("valid UUID-style IDs pass", () => {
    const r = parseVoluumOfferIdsFromText(`${VALID_A}\n${VALID_B}`);
    assert.ok("ok" in r);
    assert.deepEqual([...r.ok], [VALID_A, VALID_B]);
  });

  test("uppercase normalizes to lowercase", () => {
    const r = parseVoluumOfferIdsFromText("3D1EF3FF-01E2-4340-A029-EC28275F50B4");
    assert.ok("ok" in r);
    assert.deepEqual(r.ok, [VALID_A]);
  });

  test("comma-separated + dedupe", () => {
    const r = parseVoluumOfferIdsFromText(` ${VALID_A}, ${VALID_A} , ${VALID_B} `);
    assert.ok("ok" in r);
    assert.deepEqual(r.ok, [VALID_A, VALID_B]);
  });

  test("invalid ID rejects entire submission", () => {
    const r = parseVoluumOfferIdsFromText(`${VALID_A}\nnot-a-uuid`);
    assert.ok("error" in r);
    assert.equal(r.error, INVALID_VOLUUM_OFFER_ID_FORMAT_MESSAGE);
  });

  test("mixed valid+invalid rejects", () => {
    const r = parseVoluumOfferIdsFromNormalizedTokens([VALID_A, "101"]);
    assert.ok("error" in r);
  });
});

describe("parseVoluumOfferIdsFromStrings", () => {
  test("array of canonical strings passes", () => {
    const r = parseVoluumOfferIdsFromStrings([VALID_A, VALID_B.toUpperCase()]);
    assert.ok("ok" in r);
    assert.deepEqual(r.ok, [VALID_A, VALID_B]);
  });

  test("reject non-array payload shape", () => {
    const r = parseVoluumOfferIdsFromStrings("x");
    assert.ok("error" in r);
  });
});

describe("coerceWinnerHandoffOfferIdsFromJson", () => {
  test("preserves legacy positive integers", () => {
    assert.deepEqual(coerceWinnerHandoffOfferIdsFromJson([101, 102]), ["101", "102"]);
  });

  test("canonicalizes UUID strings", () => {
    assert.deepEqual(
      coerceWinnerHandoffOfferIdsFromJson([" 3D1EF3FF-01E2-4340-A029-EC28275F50B4 ", "101"]),
      [VALID_A, "101"],
    );
  });

  test("drops unknown strings", () => {
    assert.deepEqual(coerceWinnerHandoffOfferIdsFromJson(["nope", 0, -1, null]), []);
  });
});
