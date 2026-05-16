import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseVoluumCampaignName } from "./voluum-campaign-name.ts";

test("parses the canonical example name", () => {
  // Use an affiliate that's actually in ALLOWED_AFFILIATE_INITIALS (LB).
  const r = parseVoluumCampaignName("MR.X V2 Magic [TRX] - Germany - LB Android 3G 21.4.26 [4K]");
  assert.ok(r);
  assert.equal(r.trafficSourceName, "MR.X V2 Magic [TRX]");
  assert.equal(r.geo, "DE");
  assert.equal(r.affiliateInitials, "LB");
  assert.equal(r.device, "Android 3G");
  assert.equal(r.connectionType, "3G");
});

test("parses iOS Wifi", () => {
  const r = parseVoluumCampaignName("Source X - United States - TT iOS Wifi 10.5.26 [2K]");
  assert.ok(r);
  assert.equal(r.geo, "US");
  assert.equal(r.affiliateInitials, "TT");
  assert.equal(r.device, "iOS Wifi");
  assert.equal(r.connectionType, "Wifi");
});

test("parses Desktop without a connection type", () => {
  const r = parseVoluumCampaignName("MyTraffic [PPC] - United Kingdom - SL Desktop 01.01.26 [1K]");
  assert.ok(r);
  assert.equal(r.geo, "GB");
  assert.equal(r.affiliateInitials, "SL");
  assert.equal(r.device, "Desktop");
  assert.equal(r.connectionType, null);
});

test("accepts an already-canonical 2-letter GEO code", () => {
  const r = parseVoluumCampaignName("Push.house - DE - LH Android Wifi 21.4.26");
  assert.ok(r);
  assert.equal(r.geo, "DE");
  assert.equal(r.device, "Android Wifi");
});

test("returns parsed envelope with device=null when device token is unrecognized", () => {
  const r = parseVoluumCampaignName("Source X - Germany - LB Banana 21.4.26");
  assert.ok(r);
  assert.equal(r.affiliateInitials, "LB");
  assert.equal(r.geo, "DE");
  assert.equal(r.device, null);
  assert.equal(r.connectionType, null);
});

test("is case-insensitive on the GEO label", () => {
  const r = parseVoluumCampaignName("Source - GERMANY - WG Desktop 21.4.26");
  assert.ok(r);
  assert.equal(r.geo, "DE");
});

test("accepts any 2- or 3-letter token in the affiliate position (canonical task example)", () => {
  // The canonical task example uses "NT" — parser must accept it; the
  // structured-match step downstream is what decides whether NT maps to a
  // real batch in the workspace.
  const r = parseVoluumCampaignName("MR.X V2 Magic [TRX] - Germany - NT Android 3G 21.4.26 [4K]");
  assert.ok(r);
  assert.equal(r.affiliateInitials, "NT");
  assert.equal(r.geo, "DE");
  assert.equal(r.device, "Android 3G");
});

test("rejects affiliate token that is not 2-3 letters", () => {
  // Numeric token in the affiliate slot would mean the name isn't canonical.
  const r = parseVoluumCampaignName("Source X - Germany - 123 Android 3G 21.4.26");
  assert.equal(r, null);
});

test("returns null when GEO cannot be resolved", () => {
  const r = parseVoluumCampaignName("Source X - Wakanda - LB Android 3G 21.4.26");
  assert.equal(r, null);
});

test("returns null when the name has fewer than 3 segments", () => {
  assert.equal(parseVoluumCampaignName("Source X - Germany"), null);
  assert.equal(parseVoluumCampaignName("Random campaign name with no separators"), null);
});

test("returns null on empty / nullish input", () => {
  assert.equal(parseVoluumCampaignName(""), null);
  assert.equal(parseVoluumCampaignName(null), null);
  assert.equal(parseVoluumCampaignName(undefined), null);
  assert.equal(parseVoluumCampaignName("   "), null);
});

test("returns null when the tail has only the affiliate token", () => {
  // Need at least affiliate + something after it (the canonical shape has
  // affiliate + device + ... ). A single-token tail isn't canonical.
  const r = parseVoluumCampaignName("Source X - Germany - LB");
  assert.equal(r, null);
});

test("preserves traffic-source brackets and special characters", () => {
  const r = parseVoluumCampaignName("MR.X V2 Magic [TRX] - Germany - LB Android 3G 21.4.26 [4K]");
  assert.ok(r);
  assert.equal(r.trafficSourceName, "MR.X V2 Magic [TRX]");
});
