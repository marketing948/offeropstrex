import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeVoluumRowsByCampaignId,
  normalizeVoluumCsvHeader,
  parseCsvLine,
  parseVoluumMetricsCsv,
} from "./voluum-metrics-csv.ts";

describe("normalizeVoluumCsvHeader", () => {
  it("normalizes Campaign ID", () => {
    assert.equal(normalizeVoluumCsvHeader("Campaign ID"), "campaign_id");
  });
});

describe("parseCsvLine", () => {
  it("handles quoted commas", () => {
    assert.deepEqual(parseCsvLine('"a,b",c'), ["a,b", "c"]);
  });
});

describe("parseVoluumMetricsCsv", () => {
  const header =
    "Campaign,Campaign tags,Campaign ID,Created,Visits,Unique visits,Conversions,Cost,Revenue,ROI";

  it("parses valid rows and ignores extra columns", () => {
    const csv = [
      header,
      'Alpha,tag-a,vol-a,2024-01-01T10:00:00,1000,900,50,$100.50,$250.00,150%',
      'Beta,tag-b,vol-b,2024-01-02,500,400,10,25,75,200%',
    ].join("\n");

    const result = parseVoluumMetricsCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.dataRows.length, 2);
    assert.equal(result.dataRows[0]!.voluumCampaignId, "vol-a");
    assert.equal(result.dataRows[0]!.visits, 1000);
    assert.equal(result.dataRows[0]!.conversions, 50);
    assert.equal(result.dataRows[0]!.cost, "100.5");
    assert.equal(result.dataRows[0]!.revenue, "250");
  });

  it("fails when required headers are missing", () => {
    const result = parseVoluumMetricsCsv("Campaign,Visits\nx,1");
    assert.equal(result.ok, false);
  });

  it("skips row-level issues but keeps file parseable", () => {
    const csv = [
      header,
      "X,,,2024-01-01,10,9,1,5,10,0",
      "Y,,vol-y,2024-01-01,,9,1,5,10,0",
      "Z,,vol-z,2024-01-01,10,9,,5,10,0",
    ].join("\n");
    const result = parseVoluumMetricsCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const skipped = result.dataRows.filter((r) => r.rowSkipReason != null);
    assert.equal(skipped.length, 3);
    assert.equal(result.dataRows.length, 3);
  });

  it("last row wins for duplicate Campaign ID", () => {
    const csv = [
      header,
      "A,,dup-1,2024-01-01,100,90,5,10,20,0",
      "B,,dup-1,2024-01-02,200,180,6,11,21,0",
    ].join("\n");
    const result = parseVoluumMetricsCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const { rows, duplicateCampaignIdsInCsv } = dedupeVoluumRowsByCampaignId(result.dataRows);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.visits, 200);
    assert.equal(duplicateCampaignIdsInCsv, 1);
  });

  it("parses grouped integers", () => {
    const csv = [header, 'C,,vol-c,2024-01-01,"2,000",1000,3,1,2,0'].join("\n");
    const result = parseVoluumMetricsCsv(csv);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.dataRows[0]!.visits, 2000);
  });
});

describe("dedupeVoluumRowsByCampaignId", () => {
  it("counts duplicates among valid rows only", () => {
    const { duplicateCampaignIdsInCsv } = dedupeVoluumRowsByCampaignId([
      {
        lineNumber: 2,
        voluumCampaignId: "a",
        visits: 1,
        conversions: 0,
        cost: "0",
        revenue: "0",
      },
      {
        lineNumber: 3,
        voluumCampaignId: "a",
        visits: 2,
        conversions: 0,
        cost: "0",
        revenue: "0",
      },
    ]);
    assert.equal(duplicateCampaignIdsInCsv, 1);
  });
});
