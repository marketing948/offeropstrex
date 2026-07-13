/**
 * AI Optimizer orchestrator — deterministic, stateless. Every call re-parses
 * the raw CSVs and recomputes matching, KPI, and CMP assignment, so the export
 * endpoints never trust client-supplied decisions.
 */

import { parseCampaignCsv, type CampaignParseResult } from "./campaign-parser.ts";
import { parseVoluumCsv } from "./voluum-parser.ts";
import { matchCampaignRowsToVoluumRows } from "./matcher.ts";
import { evaluateOfferRevenue, normalizeThreshold } from "./kpi.ts";
import {
  assignCmpToRetained,
  buildDistribution,
  validatePathCount,
  type PathBucket,
} from "./distribution.ts";
import { serializeCsv } from "./csv.ts";
import type { AnalysisSummary, DecisionRecord } from "./types.ts";

export type AnalyzeInput = {
  campaignCsv: string;
  voluumCsv: string;
  revenueThreshold?: number | string;
};

export type AnalyzeSuccess = {
  ok: true;
  threshold: number;
  campaignHeaders: string[];
  decisions: DecisionRecord[];
  summary: AnalysisSummary;
  warnings: string[];
  brandSource: "brand_name_column" | "ctrl_info";
};

export type AnalyzeResult = AnalyzeSuccess | { ok: false; error: string };

/** Build every per-Offer decision + summary from raw CSV text. */
export function analyzeOptimization(input: AnalyzeInput): AnalyzeResult {
  const threshold = normalizeThreshold(input.revenueThreshold);

  const campaign = parseCampaignCsv(input.campaignCsv);
  if (!campaign.ok) return { ok: false, error: campaign.error };

  const voluum = parseVoluumCsv(input.voluumCsv);
  if (!voluum.ok) return { ok: false, error: voluum.error };

  const { results, unmatchedVoluumRows } = matchCampaignRowsToVoluumRows(
    campaign.rows,
    voluum.rows,
  );

  let keep = 0;
  let remove = 0;
  let unmatched = 0;
  let matchedRows = 0;
  let invalidRevenueMatched = 0;

  const decisions: DecisionRecord[] = results.map((r) => {
    if (r.matchStatus === "UNMATCHED_CAMPAIGN_ROW") {
      unmatched++;
      return {
        originalPosition: r.originalPosition,
        brandName: r.campaignRow.brandNameRaw,
        normalizedBrandName: r.normalizedBrandName,
        offerId: r.campaignRow.offerId,
        revenue: null,
        decision: "UNMATCHED",
        reason: "No matching Voluum row found",
        matchStatus: r.matchStatus,
        oldCampaignIndex: r.campaignRow.oldCampaignIndex,
        newCampaignIndex: "",
      };
    }

    matchedRows++;
    const hasRevenue = r.revenue != null;
    const effectiveRevenue = hasRevenue ? (r.revenue as number) : 0;
    if (!hasRevenue) invalidRevenueMatched++;
    const kpi = evaluateOfferRevenue(effectiveRevenue, threshold);
    if (kpi.decision === "KEEP") keep++;
    else remove++;

    const reason = hasRevenue
      ? kpi.reason
      : `${kpi.reason} (Revenue was empty or invalid; treated as 0)`;

    return {
      originalPosition: r.originalPosition,
      brandName: r.campaignRow.brandNameRaw,
      normalizedBrandName: r.normalizedBrandName,
      offerId: r.campaignRow.offerId,
      revenue: r.revenue,
      decision: kpi.decision,
      reason,
      matchStatus: r.matchStatus,
      oldCampaignIndex: r.campaignRow.oldCampaignIndex,
      newCampaignIndex: "",
    };
  });

  const summary: AnalysisSummary = {
    campaignRows: campaign.rows.length,
    voluumRows: voluum.rows.length,
    matchedRows,
    unmatchedCampaignRows: unmatched,
    unmatchedVoluumRows: unmatchedVoluumRows.length,
    keep,
    remove,
    unmatched,
    retainedTotal: keep + unmatched,
    invalidRevenueRows: invalidRevenueMatched,
  };

  const warnings: string[] = [];
  if (summary.unmatched > 0) {
    warnings.push("Unmatched campaign rows will be preserved in the optimized file.");
  }
  if (summary.unmatchedVoluumRows > 0) {
    warnings.push(
      `${summary.unmatchedVoluumRows} Voluum row(s) had no matching Campaign row and were ignored.`,
    );
  }
  if (summary.invalidRevenueRows > 0) {
    warnings.push(
      `${summary.invalidRevenueRows} matched Voluum row(s) had empty or invalid Revenue and were treated as 0 (removed).`,
    );
  }
  if (summary.retainedTotal === 0) {
    warnings.push("All Offers were removed — there is nothing to export.");
  }

  return {
    ok: true,
    threshold,
    campaignHeaders: campaign.headers,
    decisions,
    summary,
    warnings,
    brandSource: voluum.brandSource,
  };
}

/** Retained decisions (KEEP + UNMATCHED) in original Campaign order. */
export function retainedDecisions(decisions: DecisionRecord[]): DecisionRecord[] {
  return decisions.filter((d) => d.decision === "KEEP" || d.decision === "UNMATCHED");
}

/** Attach New Campaign Index to a copy of the decisions for a chosen pathCount. */
export function applyDistribution(
  decisions: DecisionRecord[],
  pathCount: number,
): { decisions: DecisionRecord[]; buckets: PathBucket[] } {
  const retained = retainedDecisions(decisions);
  const labels = assignCmpToRetained(retained.length, pathCount);
  const labelByPosition = new Map<number, string>();
  retained.forEach((d, i) => labelByPosition.set(d.originalPosition, labels[i]!));
  const withIndex = decisions.map((d) => ({
    ...d,
    newCampaignIndex: labelByPosition.get(d.originalPosition) ?? "",
  }));
  return { decisions: withIndex, buckets: buildDistribution(retained.length, pathCount) };
}

function baseName(fileName: string | undefined | null): string {
  const name = (fileName ?? "").trim() || "campaign";
  return name.replace(/\.[^./\\]+$/, "");
}

export type ExportInput = AnalyzeInput & {
  pathCount: number;
  campaignFileName?: string;
};

export type ExportSuccess = { ok: true; filename: string; csv: string };
export type ExportResult = ExportSuccess | { ok: false; error: string };

/** Optimized Campaign CSV — retained rows only, CMP index rewritten. */
export function buildOptimizedCampaignCsv(input: ExportInput): ExportResult {
  const analysis = analyzeOptimization(input);
  if (!analysis.ok) return analysis;

  const retained = retainedDecisions(analysis.decisions);
  const pathErr = validatePathCount(retained.length, input.pathCount);
  if (pathErr) return { ok: false, error: pathErr };

  // Re-parse the campaign file for original cells (analysis kept only decisions).
  const campaign = parseCampaignCsv(input.campaignCsv) as Extract<
    CampaignParseResult,
    { ok: true }
  >;

  const labels = assignCmpToRetained(retained.length, input.pathCount);
  const newIndexByPosition = new Map<number, string>();
  retained.forEach((d, i) => newIndexByPosition.set(d.originalPosition, labels[i]!));

  const outRows: string[][] = [];
  for (const row of campaign.rows) {
    const newIndex = newIndexByPosition.get(row.originalPosition);
    if (newIndex == null) continue; // REMOVE rows are dropped.
    const cells = [...row.cells];
    // Pad short rows so the Campaign index cell always exists.
    while (cells.length <= campaign.campaignIndexCol) cells.push("");
    cells[campaign.campaignIndexCol] = newIndex;
    outRows.push(cells);
  }

  const csv = serializeCsv(campaign.headers, outRows, {
    bom: campaign.hadBom,
    eol: campaign.eol,
  });
  const filename = `${baseName(input.campaignFileName)}_optimized_${retained.length}_offers_${input.pathCount}_paths.csv`;
  return { ok: true, filename, csv };
}

const REPORT_HEADERS = [
  "Original Position",
  "Brand Name",
  "Offer Id",
  "Revenue",
  "Decision",
  "Reason",
  "Match Status",
  "Old Campaign Index",
  "New Campaign Index",
] as const;

/** Decision report CSV — every Campaign row, including REMOVE + UNMATCHED. */
export function buildDecisionReportCsv(input: ExportInput): ExportResult {
  const analysis = analyzeOptimization(input);
  if (!analysis.ok) return analysis;

  const retained = retainedDecisions(analysis.decisions);
  const pathErr = validatePathCount(retained.length, input.pathCount);
  if (pathErr) return { ok: false, error: pathErr };

  const { decisions } = applyDistribution(analysis.decisions, input.pathCount);
  const rows: string[][] = decisions.map((d) => [
    String(d.originalPosition),
    d.brandName,
    d.offerId ?? "",
    d.revenue == null ? "" : String(d.revenue),
    d.decision,
    d.reason,
    d.matchStatus,
    d.oldCampaignIndex,
    d.newCampaignIndex,
  ]);

  const campaign = parseCampaignCsv(input.campaignCsv);
  const bom = campaign.ok ? campaign.hadBom : false;
  const csv = serializeCsv([...REPORT_HEADERS], rows, { bom });
  const filename = `${baseName(input.campaignFileName)}_optimization_report.csv`;
  return { ok: true, filename, csv };
}
