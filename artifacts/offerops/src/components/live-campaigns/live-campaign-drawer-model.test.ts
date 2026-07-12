import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { toLiveCampaignDrawerModel } from "./live-campaign-drawer-model.ts";

function fullCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    campaignName: "US iOS Test",
    campaignPurpose: "testing",
    platform: "ios",
    status: "live",
    batchId: 3,
    batchName: "Batch #3",
    batchGeo: "US US",
    batchAffiliateNetwork: "BlueAffiliate",
    trafficSourceName: "Zeropark",
    voluumCampaignId: "vol-123",
    liveStartedAt: "2026-07-08T10:00:00Z",
    winnersCount: 1,
    revenue: "200",
    cost: "100",
    clicks: 500,
    conversions: 10,
    roi: null,
    employeeName: "Dana",
    offerCount: 2,
    ...overrides,
  };
}

describe("toLiveCampaignDrawerModel", () => {
  test("maps a complete campaign with calculated ROI + canonical GEO", () => {
    const m = toLiveCampaignDrawerModel(fullCampaign(), { offerCount: 2 })!;
    assert.equal(m.id, 12);
    assert.equal(m.name, "US iOS Test");
    assert.equal(m.network, "BlueAffiliate");
    assert.equal(m.geoCode, "US");
    assert.equal(m.profit, 100);
    assert.equal(m.roiPercent, 100); // (200-100)/100 * 100
    assert.equal(m.offerCount, 2);
    assert.equal(m.statusLabel, "live");
  });

  test("null cost/revenue/roi render safely (no throw, null metrics)", () => {
    const m = toLiveCampaignDrawerModel(
      fullCampaign({ cost: null, revenue: null, roi: null }),
    )!;
    assert.equal(m.cost, null);
    assert.equal(m.revenue, null);
    assert.equal(m.profit, null);
    assert.equal(m.roiPercent, null);
  });

  test("uses calculated ROI over stored ROI when financials exist", () => {
    const m = toLiveCampaignDrawerModel(
      fullCampaign({ cost: "100", revenue: "300", roi: 5 }),
    )!;
    assert.equal(m.roiPercent, 200);
  });

  test("missing batch / owner / network / GEO collapse to null", () => {
    const m = toLiveCampaignDrawerModel(
      fullCampaign({
        batchId: null,
        batchName: null,
        employeeName: null,
        batchAffiliateNetwork: null,
        affiliateNetworkName: null,
        batchGeo: null,
        geo: null,
      }),
    )!;
    assert.equal(m.batchId, null);
    assert.equal(m.batchName, null);
    assert.equal(m.employeeName, null);
    assert.equal(m.network, null);
    assert.equal(m.geo, null);
    assert.equal(m.geoCode, null);
  });

  test("missing offerCount becomes null (not a crash)", () => {
    const m = toLiveCampaignDrawerModel(fullCampaign({ offerCount: null }), {})!;
    assert.equal(m.offerCount, null);
  });

  test("invalid / missing status still yields a safe label", () => {
    const m = toLiveCampaignDrawerModel(fullCampaign({ status: null }))!;
    assert.equal(m.status, "unknown");
    assert.equal(m.statusLabel, "unknown");
  });

  test("range metrics compute profit + ROI; absent range is null", () => {
    const withRange = toLiveCampaignDrawerModel(fullCampaign(), {
      rangeMetrics: {
        campaignId: 12,
        cost: "50",
        revenue: "150",
        conversions: 4,
        visits: 400,
        profit: "100",
        roi: null,
        epc: null,
      } as never,
    })!;
    assert.ok(withRange.range);
    assert.equal(withRange.range!.profit, 100);
    assert.equal(withRange.range!.roiPercent, 200);

    const noRange = toLiveCampaignDrawerModel(fullCampaign())!;
    assert.equal(noRange.range, null);
  });

  test("null / non-object input returns null (drawer renders nothing, no throw)", () => {
    assert.equal(toLiveCampaignDrawerModel(null), null);
    assert.equal(toLiveCampaignDrawerModel(undefined), null);
  });

  test("malformed row (unexpected shapes) does not throw", () => {
    assert.doesNotThrow(() =>
      toLiveCampaignDrawerModel({
        id: "not-a-number",
        cost: {},
        revenue: [],
        status: 5,
        batchGeo: 42,
      } as never),
    );
  });
});
