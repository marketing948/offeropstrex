import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCampaignDisplayName } from "./campaign-display-name.ts";

test("resolveCampaignDisplayName prefers voluum name over batch-composed default", () => {
  const name = resolveCampaignDisplayName({
    campaignName: "Summer Batch iOS",
    batchName: "Summer Batch",
    platform: "ios",
    voluumCampaignName: "UK Dating Offer iOS",
  });
  assert.equal(name, "UK Dating Offer iOS");
});

test("resolveCampaignDisplayName keeps explicit campaign name from file", () => {
  const name = resolveCampaignDisplayName({
    campaignName: "DE Finance Lead iOS",
    batchName: "Winter Batch",
    platform: "ios",
    voluumCampaignName: null,
  });
  assert.equal(name, "DE Finance Lead iOS");
});

test("resolveCampaignDisplayName falls back to batch name when name is create_voluum title", () => {
  const name = resolveCampaignDisplayName({
    campaignName: "Create Voluum campaign iOS",
    batchName: "Winter Batch",
    platform: "ios",
  });
  assert.equal(name, "Winter Batch iOS");
});
