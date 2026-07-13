/**
 * Integration fixture — proves the exact end-to-end workflow from the real
 * successful example, using sanitized synthetic data (no real links/IDs):
 *   - 346 Campaign rows and 346 Voluum rows,
 *   - duplicate Brand Names,
 *   - exactly 82 rows with Revenue > 0.1,
 *   - 10 PATHs → 9,9,8,8,8,8,8,8,8,8.
 *
 * Run: tsx --test src/lib/ai-optimizer/integration.test.ts
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseCsvTable } from "./csv.ts";
import {
  analyzeOptimization,
  buildDecisionReportCsv,
  buildOptimizedCampaignCsv,
} from "./optimizer.ts";
import { distributeOffers } from "./distribution.ts";

const TOTAL = 346;
const WINNERS = 82; // rows with Revenue > 0.1

const CAMPAIGN_HEADER =
  "Campaign index,Geo,AN Name,Brand Name,Link,Status,Offer Id,Service Id,Weight";

/**
 * Build matched Campaign+Voluum fixtures. The first WINNERS rows get revenue
 * 1.0 (> 0.1 → KEEP); the rest get revenue 0.05 (<= 0.1 → REMOVE). Brand names
 * intentionally repeat (Brand000..Brand049 cycling) to exercise duplicate,
 * occurrence-ordered matching while every Campaign row stays a separate Offer.
 */
function buildFixtures(): { campaignCsv: string; voluumCsv: string } {
  const campaignLines = [CAMPAIGN_HEADER];
  const voluumLines = ["Brand Name,Revenue"];
  for (let i = 0; i < TOTAL; i++) {
    const brand = `Brand${String(i % 50).padStart(3, "0")}_${i}`; // unique but structured
    const revenue = i < WINNERS ? "1.0" : "0.05";
    campaignLines.push(`old${i},GB,AN,${brand},http://x/${i},active,OF${i},svc,1`);
    voluumLines.push(`${brand},${revenue}`);
  }
  return { campaignCsv: campaignLines.join("\n"), voluumCsv: voluumLines.join("\n") };
}

describe("integration: 346 rows, 82 winners, 10 PATHs", () => {
  const { campaignCsv, voluumCsv } = buildFixtures();

  test("analysis counts match the real example", () => {
    const a = analyzeOptimization({ campaignCsv, voluumCsv, revenueThreshold: 0.1 });
    assert.equal(a.ok, true);
    if (!a.ok) return;
    assert.equal(a.summary.campaignRows, TOTAL);
    assert.equal(a.summary.voluumRows, TOTAL);
    assert.equal(a.summary.matchedRows, TOTAL);
    assert.equal(a.summary.keep, WINNERS);
    assert.equal(a.summary.remove, TOTAL - WINNERS);
    assert.equal(a.summary.unmatched, 0);
    assert.equal(a.summary.retainedTotal, WINNERS);
  });

  test("10 PATHs distribute 82 → 9,9,8×8", () => {
    assert.deepEqual(distributeOffers(WINNERS, 10), [9, 9, 8, 8, 8, 8, 8, 8, 8, 8]);
  });

  test("optimized Campaign has exactly 82 retained rows with correct CMP blocks", () => {
    const out = buildOptimizedCampaignCsv({
      campaignCsv,
      voluumCsv,
      revenueThreshold: 0.1,
      pathCount: 10,
      campaignFileName: "geo_gb.csv",
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.filename, "geo_gb_optimized_82_offers_10_paths.csv");
    const table = parseCsvTable(out.csv)!;
    assert.equal(table.rows.length, WINNERS);
    // Count rows per cmp label (col 0) → must equal the distribution.
    const counts = new Map<string, number>();
    for (const r of table.rows) counts.set(r[0]!, (counts.get(r[0]!) ?? 0) + 1);
    assert.equal(counts.get("cmp01"), 9);
    assert.equal(counts.get("cmp02"), 9);
    assert.equal(counts.get("cmp03"), 8);
    assert.equal(counts.get("cmp10"), 8);
    // Original headers preserved verbatim.
    assert.deepEqual(table.headers, CAMPAIGN_HEADER.split(","));
  });

  test("decision report contains every one of the 346 rows", () => {
    const rep = buildDecisionReportCsv({
      campaignCsv,
      voluumCsv,
      revenueThreshold: 0.1,
      pathCount: 10,
      campaignFileName: "geo_gb.csv",
    });
    assert.equal(rep.ok, true);
    if (!rep.ok) return;
    const table = parseCsvTable(rep.csv)!;
    assert.equal(table.rows.length, TOTAL);
    const kept = table.rows.filter((r) => r[4] === "KEEP");
    const removed = table.rows.filter((r) => r[4] === "REMOVE");
    assert.equal(kept.length, WINNERS);
    assert.equal(removed.length, TOTAL - WINNERS);
    // Kept rows carry a new index; removed rows are blank.
    assert.ok(kept.every((r) => r[8]!.startsWith("cmp")));
    assert.ok(removed.every((r) => r[8] === ""));
  });
});
