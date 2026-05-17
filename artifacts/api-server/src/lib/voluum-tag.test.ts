import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pickValidVoluumTag,
  parseTrackerCampaignTag,
  validateTrackerCampaignTag,
} from "./voluum-tag.ts";

describe("pickValidVoluumTag", () => {
  it("parses a strict lowercase batch tag", () => {
    const r = pickValidVoluumTag(["sl_de_batch1"]);
    assert.equal(r.valid, true);
    if (!r.valid) return;
    assert.deepEqual(r.parsed, {
      tag: "sl_de_batch1",
      affiliateInitials: "SL",
      geo: "de",
      batchPrefix: "batch",
      batchNumber: 1,
    });
  });

  it("rejects mixed or uppercase batch tags", () => {
    assert.equal(pickValidVoluumTag(["SL_DE_BATCH1"]).valid, false);
    assert.equal(pickValidVoluumTag(["sl_DE_batch1"]).valid, false);
  });

  it("rejects non-batch tag shapes", () => {
    const r = pickValidVoluumTag(["sl_de_round1"]);
    assert.equal(r.valid, false);
    if (r.valid) return;
    assert.equal(r.reason, "invalid_tag_format");
  });

  it("picks the first valid lowercase tag from duplicate/noisy tags", () => {
    const r = pickValidVoluumTag(["noise", "sl_de_batch1", "sl_de_batch1"]);
    assert.equal(r.valid, true);
    if (!r.valid) return;
    assert.equal(r.parsed.tag, "sl_de_batch1");
    assert.deepEqual(r.allTags, ["noise", "sl_de_batch1", "sl_de_batch1"]);
  });
});

describe("parseTrackerCampaignTag", () => {
  it("parses a canonical iOS tag", () => {
    const r = parseTrackerCampaignTag("sl_gb_batch1_ios");
    assert.equal(r.valid, true);
    if (!r.valid) return;
    assert.deepEqual(r.parsed, {
      tag: "sl_gb_batch1_ios",
      affiliateInitials: "SL",
      geo: "gb",
      batchNumber: 1,
      batchTag: "sl_gb_batch1",
      platformSuffix: "ios",
      device: "ios",
    });
  });

  it("parses a canonical Android tag", () => {
    const r = parseTrackerCampaignTag("yk_de_batch12_and");
    assert.equal(r.valid, true);
    if (!r.valid) return;
    assert.equal(r.parsed.device, "android");
    assert.equal(r.parsed.platformSuffix, "and");
    assert.equal(r.parsed.batchTag, "yk_de_batch12");
    assert.equal(r.parsed.batchNumber, 12);
  });

  it("rejects mixed or uppercase campaign tags", () => {
    const r = parseTrackerCampaignTag("SL_GB_BATCH3_IOS");
    assert.equal(r.valid, false);
    if (r.valid) return;
    assert.equal(r.reason, "invalid_tag_format");
  });

  it("accepts 3-letter GEO", () => {
    const r = parseTrackerCampaignTag("br_gbr_batch2_and");
    assert.equal(r.valid, true);
    if (!r.valid) return;
    assert.equal(r.parsed.geo, "gbr");
  });

  it("rejects empty / null / whitespace as missing_tag", () => {
    assert.equal(parseTrackerCampaignTag("").valid, false);
    assert.equal(
      (parseTrackerCampaignTag("") as { reason: string }).reason,
      "missing_tag",
    );
    assert.equal(
      (parseTrackerCampaignTag(null) as { reason: string }).reason,
      "missing_tag",
    );
    assert.equal(
      (parseTrackerCampaignTag("   ") as { reason: string }).reason,
      "missing_tag",
    );
  });

  it("rejects unknown affiliate initials", () => {
    const r = parseTrackerCampaignTag("xx_gb_batch1_ios");
    assert.equal(r.valid, false);
    if (r.valid) return;
    assert.equal(r.reason, "unknown_affiliate_initials");
    assert.equal(r.offendingTag, "xx_gb_batch1_ios");
  });

  it("rejects bad GEO (numeric / too long)", () => {
    const r = parseTrackerCampaignTag("sl_12_batch1_ios");
    assert.equal(r.valid, false);
    if (r.valid) return;
    assert.equal(r.reason, "invalid_geo");
  });

  it("rejects batch number 0 / negative", () => {
    const r = parseTrackerCampaignTag("sl_gb_batch0_ios");
    assert.equal(r.valid, false);
    if (r.valid) return;
    assert.equal(r.reason, "invalid_batch_number");
  });

  it("rejects bad device segment", () => {
    const r = parseTrackerCampaignTag("sl_gb_batch1_desktop");
    assert.equal(r.valid, false);
    if (r.valid) return;
    assert.equal(r.reason, "invalid_tag_format");
  });

  it("rejects the legacy android suffix in favor of and", () => {
    const r = parseTrackerCampaignTag("sl_gb_batch1_android");
    assert.equal(r.valid, false);
    if (r.valid) return;
    assert.equal(r.reason, "invalid_tag_format");
  });

  it("rejects shape mismatch (offer-tag shape, not tracker shape)", () => {
    const r = parseTrackerCampaignTag("sl_gb_batch1");
    assert.equal(r.valid, false);
    if (r.valid) return;
    assert.equal(r.reason, "invalid_tag_format");
  });

  it("rejects legacy 5-part tag (with traffic source) — no longer valid per SPEC §4", () => {
    const r = parseTrackerCampaignTag("sl_gb_batch1_ios_richads");
    assert.equal(r.valid, false);
    if (r.valid) return;
    // Legacy 5-part shape no longer matches; diagnoses as format issue.
    assert.equal(r.reason, "invalid_tag_format");
  });
});

describe("validateTrackerCampaignTag", () => {
  it("is now a back-compat alias for parseTrackerCampaignTag (TS comes from Voluum config, not the tag)", () => {
    const a = parseTrackerCampaignTag("sl_gb_batch1_ios");
    const b = validateTrackerCampaignTag("sl_gb_batch1_ios");
    assert.deepEqual(a, b);
  });

  it("rejects invalid tag regardless of arguments", () => {
    const r = validateTrackerCampaignTag("xx_gb_batch1_ios");
    assert.equal(r.valid, false);
    if (r.valid) return;
    assert.equal(r.reason, "unknown_affiliate_initials");
  });
});
