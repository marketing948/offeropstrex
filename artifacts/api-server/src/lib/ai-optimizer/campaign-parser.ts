/** Campaign CSV parser — preserves every original column and its order. */

import { normalizeHeaderKey, parseCsvTable, type CsvTable } from "./csv.ts";
import type { CampaignRow } from "./types.ts";

const REQUIRED_CAMPAIGN_HEADERS = ["campaign index", "brand name"] as const;

export type CampaignParseResult =
  | {
      ok: true;
      headers: string[];
      campaignIndexCol: number;
      brandNameCol: number;
      offerIdCol: number | null;
      rows: CampaignRow[];
      hadBom: boolean;
      eol: "\r\n" | "\n";
    }
  | { ok: false; error: string };

/** Map required headers → column indices; reject duplicates & missing columns. */
function resolveColumns(headers: string[]):
  | { ok: true; campaignIndexCol: number; brandNameCol: number; offerIdCol: number | null }
  | { ok: false; error: string } {
  const seen = new Map<string, number>();
  const duplicates = new Set<string>();
  for (const h of headers) {
    const key = normalizeHeaderKey(h);
    if (key === "") continue;
    if (seen.has(key)) duplicates.add(key);
    else seen.set(key, seen.size);
  }
  // Re-index by actual column position (seen size above is not positional).
  const indexByKey = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = normalizeHeaderKey(h);
    if (key !== "" && !indexByKey.has(key)) indexByKey.set(key, i);
  });

  const dupRequired = REQUIRED_CAMPAIGN_HEADERS.filter((r) => duplicates.has(r));
  if (dupRequired.length > 0) {
    return {
      ok: false,
      error: `Duplicate required Campaign column(s): ${dupRequired.join(", ")}`,
    };
  }

  const missing = REQUIRED_CAMPAIGN_HEADERS.filter((r) => !indexByKey.has(r));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Campaign file is missing required column(s): ${missing
        .map((m) => (m === "campaign index" ? "Campaign index" : "Brand Name"))
        .join(", ")}`,
    };
  }

  return {
    ok: true,
    campaignIndexCol: indexByKey.get("campaign index")!,
    brandNameCol: indexByKey.get("brand name")!,
    offerIdCol: indexByKey.get("offer id") ?? null,
  };
}

export function parseCampaignCsv(input: string): CampaignParseResult {
  let table: CsvTable | null;
  try {
    table = parseCsvTable(input);
  } catch {
    return { ok: false, error: "Campaign file could not be parsed as CSV." };
  }
  if (!table || table.headers.length === 0) {
    return { ok: false, error: "Campaign file is empty." };
  }

  const cols = resolveColumns(table.headers);
  if (!cols.ok) return cols;

  if (table.rows.length === 0) {
    return { ok: false, error: "Campaign file has a header but no data rows." };
  }

  const rows: CampaignRow[] = table.rows.map((cells, i) => {
    const cell = (idx: number) => (cells[idx] ?? "").toString();
    return {
      originalPosition: i + 1,
      cells,
      brandNameRaw: cell(cols.brandNameCol),
      oldCampaignIndex: cell(cols.campaignIndexCol),
      offerId:
        cols.offerIdCol != null && cell(cols.offerIdCol).trim() !== ""
          ? cell(cols.offerIdCol).trim()
          : null,
    };
  });

  return {
    ok: true,
    headers: table.headers,
    campaignIndexCol: cols.campaignIndexCol,
    brandNameCol: cols.brandNameCol,
    offerIdCol: cols.offerIdCol,
    rows,
    hadBom: table.hadBom,
    eol: table.eol,
  };
}
