/**
 * AI Optimizer deterministic engine — pure-function tests (no DB, no I/O).
 * Covers parsing, Brand resolution, matching, KPI, distribution, and export.
 * Run: tsx --test src/lib/ai-optimizer/engine.test.ts
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { parseCsvTable, serializeCsv, tokenizeCsv } from "./csv.ts";
import { parseCampaignCsv } from "./campaign-parser.ts";
import { brandFromCtrlInfo, parseRevenue, parseVoluumCsv } from "./voluum-parser.ts";
import { matchCampaignRowsToVoluumRows, normalizeBrandName } from "./matcher.ts";
import { evaluateOfferRevenue } from "./kpi.ts";
import {
  assignCmpToRetained,
  buildDistribution,
  cmpLabel,
  distributeOffers,
  validatePathCount,
} from "./distribution.ts";
import {
  analyzeOptimization,
  buildDecisionReportCsv,
  buildOptimizedCampaignCsv,
} from "./optimizer.ts";

const CAMPAIGN_HEADER = "Campaign index,Geo,AN Name,Brand Name,Link,Status,Offer Id,Service Id,Weight";

function campaignRow(index: string, brand: string, offerId = "", geo = "GB"): string {
  return `${index},${geo},AN,${brand},http://x,active,${offerId},svc,1`;
}

// ---------------------------------------------------------------------------
// PARSING
// ---------------------------------------------------------------------------
describe("parsing", () => {
  test("1) UTF-8 BOM Campaign CSV parses & round-trips BOM on export", () => {
    const csv = "\uFEFF" + [CAMPAIGN_HEADER, campaignRow("old01", "Acme")].join("\n");
    const parsed = parseCampaignCsv(csv);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.hadBom, true);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0]!.brandNameRaw, "Acme");
  });

  test("2) quoted commas and quoted line breaks are preserved", () => {
    const csv = [
      CAMPAIGN_HEADER,
      `old01,GB,AN,"Brand, Inc.",http://x,active,,svc,1`,
      `old02,GB,AN,"Multi\nLine Brand",http://y,active,,svc,1`,
    ].join("\n");
    const table = parseCsvTable(csv);
    assert.ok(table);
    assert.equal(table!.rows.length, 2);
    assert.equal(table!.rows[0]![3], "Brand, Inc.");
    assert.equal(table!.rows[1]![3], "Multi\nLine Brand");
  });

  test("3) required Campaign headers are enforced", () => {
    const missing = parseCampaignCsv("Geo,AN Name\nGB,AN");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.match(missing.error, /Brand Name|Campaign index/);

    const dup = parseCampaignCsv("Campaign index,Brand Name,Brand Name\nc,b,b2");
    assert.equal(dup.ok, false);
    if (!dup.ok) assert.match(dup.error, /Duplicate/);
  });

  test("4) Voluum Brand from explicit Brand Name column", () => {
    const csv = "Brand Name,Revenue\nSoak & Sleep,5";
    const parsed = parseVoluumCsv(csv);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.brandSource, "brand_name_column");
    assert.equal(parsed.rows[0]!.brandNameRaw, "Soak & Sleep");
  });

  test("5) Voluum Brand from final ctrl_info segment", () => {
    assert.equal(
      brandFromCtrlInfo("GB;clickadu;yk;tlg;51b88f70e4b08db2e6704a45;Soak & Sleep"),
      "Soak & Sleep",
    );
    const csv = "ctrl_info,Revenue\nGB;clickadu;yk;tlg;id;Soak & Sleep,5";
    const parsed = parseVoluumCsv(csv);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.brandSource, "ctrl_info");
    assert.equal(parsed.rows[0]!.brandNameRaw, "Soak & Sleep");
  });

  test("Voluum with neither Brand Name nor ctrl_info is a validation error", () => {
    const parsed = parseVoluumCsv("Something,Revenue\nx,5");
    assert.equal(parsed.ok, false);
  });

  test("6) numeric Revenue parsing (int, decimal, $, thousands, negative)", () => {
    assert.equal(parseRevenue("5"), 5);
    assert.equal(parseRevenue("0.1000001"), 0.1000001);
    assert.equal(parseRevenue(" $1,234.56 "), 1234.56);
    assert.equal(parseRevenue("-3.5"), -3.5);
  });

  test("7) invalid Revenue → null", () => {
    assert.equal(parseRevenue(""), null);
    assert.equal(parseRevenue("abc"), null);
    assert.equal(parseRevenue("1.2.3"), null);
    assert.equal(parseRevenue(null), null);
  });

  test("empty file is rejected", () => {
    assert.equal(parseCampaignCsv("").ok, false);
    assert.equal(parseVoluumCsv("").ok, false);
    assert.equal(tokenizeCsv("").length, 0);
  });
});

// ---------------------------------------------------------------------------
// MATCHING
// ---------------------------------------------------------------------------
describe("matching", () => {
  function toCampaign(brands: string[]) {
    const csv = [CAMPAIGN_HEADER, ...brands.map((b, i) => campaignRow(`old${i}`, b))].join("\n");
    const p = parseCampaignCsv(csv);
    if (!p.ok) throw new Error(p.error);
    return p.rows;
  }
  function toVoluum(pairs: Array<[string, string]>) {
    const csv = ["Brand Name,Revenue", ...pairs.map(([b, r]) => `${b},${r}`)].join("\n");
    const p = parseVoluumCsv(csv);
    if (!p.ok) throw new Error(p.error);
    return p.rows;
  }

  test("8) exact normalized brand match", () => {
    const { results } = matchCampaignRowsToVoluumRows(toCampaign(["Acme"]), toVoluum([["Acme", "5"]]));
    assert.equal(results[0]!.matchStatus, "MATCHED");
    assert.equal(results[0]!.revenue, 5);
  });

  test("9) case-insensitive match", () => {
    const { results } = matchCampaignRowsToVoluumRows(toCampaign(["ACME"]), toVoluum([["acme", "5"]]));
    assert.equal(results[0]!.matchStatus, "MATCHED");
  });

  test("10) trim + collapse internal whitespace", () => {
    assert.equal(normalizeBrandName("  Big   Brand  "), "big brand");
    const { results } = matchCampaignRowsToVoluumRows(
      toCampaign(["  Big   Brand "]),
      toVoluum([["Big Brand", "5"]]),
    );
    assert.equal(results[0]!.matchStatus, "MATCHED");
  });

  test("11/12) duplicate brands matched by occurrence order; each row separate", () => {
    const { results } = matchCampaignRowsToVoluumRows(
      toCampaign(["Dup", "Dup", "Dup"]),
      toVoluum([["Dup", "1"], ["Dup", "2"]]),
    );
    assert.equal(results.length, 3);
    assert.equal(results[0]!.revenue, 1);
    assert.equal(results[1]!.revenue, 2);
    assert.equal(results[2]!.matchStatus, "UNMATCHED_CAMPAIGN_ROW"); // 13) excess campaign dup
  });

  test("14) excess Voluum duplicate reported separately", () => {
    const { unmatchedVoluumRows } = matchCampaignRowsToVoluumRows(
      toCampaign(["Dup"]),
      toVoluum([["Dup", "1"], ["Dup", "2"]]),
    );
    assert.equal(unmatchedVoluumRows.length, 1);
    assert.equal(unmatchedVoluumRows[0]!.revenue, 2);
  });

  test("15) no fuzzy matching (punctuation/substring differences do not match)", () => {
    const { results } = matchCampaignRowsToVoluumRows(
      toCampaign(["Acme Inc"]),
      toVoluum([["Acme Inc.", "5"], ["Acme", "5"]]),
    );
    assert.equal(results[0]!.matchStatus, "UNMATCHED_CAMPAIGN_ROW");
  });
});

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------
describe("kpi", () => {
  test("16) Revenue 0.1 → REMOVE (strictly greater)", () => {
    assert.equal(evaluateOfferRevenue(0.1, 0.1).decision, "REMOVE");
  });
  test("17) Revenue > 0.1 → KEEP", () => {
    assert.equal(evaluateOfferRevenue(0.1000001, 0.1).decision, "KEEP");
  });
  test("18) Revenue 0 → REMOVE", () => {
    assert.equal(evaluateOfferRevenue(0, 0.1).decision, "REMOVE");
  });
  test("19) negative Revenue → REMOVE", () => {
    assert.equal(evaluateOfferRevenue(-5, 0.1).decision, "REMOVE");
  });
  test("20) unmatched Campaign row → UNMATCHED and retained", () => {
    const campaignCsv = [CAMPAIGN_HEADER, campaignRow("old01", "Ghost")].join("\n");
    const voluumCsv = "Brand Name,Revenue\nOther,5";
    const a = analyzeOptimization({ campaignCsv, voluumCsv });
    assert.equal(a.ok, true);
    if (!a.ok) return;
    assert.equal(a.decisions[0]!.decision, "UNMATCHED");
    assert.equal(a.summary.retainedTotal, 1);
    assert.ok(a.warnings.some((w) => /preserved/.test(w)));
  });
});

// ---------------------------------------------------------------------------
// DISTRIBUTION
// ---------------------------------------------------------------------------
describe("distribution", () => {
  test("21) 82 / 10 → 9,9,8×8", () => {
    assert.deepEqual(distributeOffers(82, 10), [9, 9, 8, 8, 8, 8, 8, 8, 8, 8]);
  });
  test("22) 59 / 10 → nine 6s then 5", () => {
    assert.deepEqual(distributeOffers(59, 10), [6, 6, 6, 6, 6, 6, 6, 6, 6, 5]);
  });
  test("23) 31 / 10 → 4 then nine 3s (spec example 4,4,4,4,3×6 sums to 34; impossible for 31)", () => {
    // base=floor(31/10)=3, remainder=31%10=1 → first 1 PATH gets 4, rest get 3.
    // Sum invariant (===31) is authoritative over the spec's illustrative number.
    const counts = distributeOffers(31, 10);
    assert.deepEqual(counts, [4, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    assert.equal(counts.reduce((a, b) => a + b, 0), 31);
  });
  test("24) 3 / 3 → 1,1,1", () => {
    assert.deepEqual(distributeOffers(3, 3), [1, 1, 1]);
  });
  test("25) PATH count > Offers rejected", () => {
    assert.ok(validatePathCount(5, 6));
    assert.throws(() => distributeOffers(5, 6));
    assert.equal(validatePathCount(6, 5), null);
  });
  test("26/27) contiguous assignment preserves retained order", () => {
    const buckets = buildDistribution(82, 10);
    assert.equal(buckets[0]!.startPosition, 1);
    assert.equal(buckets[0]!.endPosition, 9);
    assert.equal(buckets[1]!.startPosition, 10);
    assert.equal(buckets[1]!.endPosition, 18);
    // total covered equals remaining, no gaps/overlaps
    assert.equal(buckets[buckets.length - 1]!.endPosition, 82);
    const labels = assignCmpToRetained(82, 10);
    assert.equal(labels.length, 82);
    assert.equal(labels[0], "cmp01");
    assert.equal(labels[8], "cmp01");
    assert.equal(labels[9], "cmp02");
  });
  test("28) cmp numbering zero-padded, supports cmp100", () => {
    assert.equal(cmpLabel(0), "cmp01");
    assert.equal(cmpLabel(8), "cmp09");
    assert.equal(cmpLabel(9), "cmp10");
    assert.equal(cmpLabel(99), "cmp100");
  });
});

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------
describe("export", () => {
  const campaignCsv = [
    CAMPAIGN_HEADER,
    campaignRow("orig01", "Keep1", "OF1"), // rev 5 → KEEP
    campaignRow("orig02", "Remove1", "OF2"), // rev 0 → REMOVE
    campaignRow("orig03", "Keep2", "OF3"), // rev 9 → KEEP
    campaignRow("orig04", "Ghost", "OF4"), // unmatched → retained
  ].join("\n");
  const voluumCsv = [
    "Brand Name,Revenue",
    "Keep1,5",
    "Remove1,0",
    "Keep2,9",
  ].join("\n");

  test("29/30) optimized headers/order preserved; only Campaign index changes", () => {
    const out = buildOptimizedCampaignCsv({ campaignCsv, voluumCsv, pathCount: 2 });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    const table = parseCsvTable(out.csv)!;
    assert.deepEqual(table.headers, CAMPAIGN_HEADER.split(","));
    // 3 retained rows (Keep1, Keep2, Ghost)
    assert.equal(table.rows.length, 3);
    // Brand column (index 3) untouched, order preserved
    assert.deepEqual(table.rows.map((r) => r[3]), ["Keep1", "Keep2", "Ghost"]);
    // Campaign index (col 0) rewritten to cmp labels
    assert.deepEqual(table.rows.map((r) => r[0]), ["cmp01", "cmp01", "cmp02"]);
    // Offer Id (col 6) untouched
    assert.deepEqual(table.rows.map((r) => r[6]), ["OF1", "OF3", "OF4"]);
  });

  test("31) removed rows absent from optimized Campaign", () => {
    const out = buildOptimizedCampaignCsv({ campaignCsv, voluumCsv, pathCount: 1 });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.ok(!out.csv.includes("Remove1"));
  });

  test("32) unmatched rows preserved in optimized Campaign", () => {
    const out = buildOptimizedCampaignCsv({ campaignCsv, voluumCsv, pathCount: 1 });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.ok(out.csv.includes("Ghost"));
  });

  test("33/34) decision report includes every Campaign row; duplicates stay separate", () => {
    const dupCampaign = [
      CAMPAIGN_HEADER,
      campaignRow("o1", "Dup", "A"),
      campaignRow("o2", "Dup", "B"),
    ].join("\n");
    const dupVoluum = ["Brand Name,Revenue", "Dup,5", "Dup,9"].join("\n");
    const report = buildDecisionReportCsv({
      campaignCsv: dupCampaign,
      voluumCsv: dupVoluum,
      pathCount: 1,
    });
    assert.equal(report.ok, true);
    if (!report.ok) return;
    const table = parseCsvTable(report.csv)!;
    assert.deepEqual(table.headers, [
      "Original Position",
      "Brand Name",
      "Offer Id",
      "Revenue",
      "Decision",
      "Reason",
      "Match Status",
      "Old Campaign Index",
      "New Campaign Index",
    ]);
    assert.equal(table.rows.length, 2); // both duplicate rows present
    assert.equal(table.rows[0]![3], "5");
    assert.equal(table.rows[1]![3], "9");

    // Full-file report retains every row including REMOVE (blank new index).
    const full = buildDecisionReportCsv({ campaignCsv, voluumCsv, pathCount: 2 });
    assert.equal(full.ok, true);
    if (!full.ok) return;
    const ft = parseCsvTable(full.csv)!;
    assert.equal(ft.rows.length, 4);
    const removeRow = ft.rows.find((r) => r[1] === "Remove1")!;
    assert.equal(removeRow[4], "REMOVE");
    assert.equal(removeRow[8], ""); // blank New Campaign Index for removed
  });

  test("all-offers-removed surfaces a blocking warning and blocks export", () => {
    const zeroCsv = [CAMPAIGN_HEADER, campaignRow("o1", "Z", "A")].join("\n");
    const zeroVoluum = ["Brand Name,Revenue", "Z,0"].join("\n");
    const a = analyzeOptimization({ campaignCsv: zeroCsv, voluumCsv: zeroVoluum });
    assert.equal(a.ok, true);
    if (!a.ok) return;
    assert.equal(a.summary.retainedTotal, 0);
    assert.ok(a.warnings.some((w) => /All Offers were removed/.test(w)));
    const out = buildOptimizedCampaignCsv({
      campaignCsv: zeroCsv,
      voluumCsv: zeroVoluum,
      pathCount: 1,
    });
    assert.equal(out.ok, false);
  });

  test("serializeCsv escapes commas/quotes/newlines", () => {
    const csv = serializeCsv(["a", "b"], [["x,y", 'he said "hi"'], ["li\nne", "z"]]);
    const table = parseCsvTable(csv)!;
    assert.equal(table.rows[0]![0], "x,y");
    assert.equal(table.rows[0]![1], 'he said "hi"');
    assert.equal(table.rows[1]![0], "li\nne");
  });
});
