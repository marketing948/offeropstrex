/**
 * Voluum CSV parser.
 *
 * Brand Name resolution priority (explicit, no silent guessing):
 *   1. An explicit "Brand Name" column, if present.
 *   2. The final ";"-delimited segment of "ctrl_info" (e.g.
 *      `GB;clickadu;yk;tlg;<id>;Soak & Sleep` → "Soak & Sleep").
 *   3. Otherwise → validation error asking for a Brand Name / ctrl_info column.
 *
 * Revenue: trimmed; an optional leading "$" and thousands "," separators are
 * removed; the result must match a signed decimal. Empty / non-numeric revenue
 * is reported as `revenue: null` (a documented, surfaced condition — never a
 * silent zero at parse time).
 */

import { normalizeHeaderKey, parseCsvTable, type CsvTable } from "./csv.ts";
import type { VoluumRow } from "./types.ts";

export type VoluumParseResult =
  | {
      ok: true;
      rows: VoluumRow[];
      brandSource: "brand_name_column" | "ctrl_info";
      /** Data rows whose revenue was empty/non-numeric. */
      invalidRevenueRows: number;
    }
  | { ok: false; error: string };

/** Parse a raw revenue cell to a finite number, or null when empty/invalid. */
export function parseRevenue(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (s === "") return null;
  // Strip a single leading currency symbol and thousands separators only.
  s = s.replace(/^\$/, "").replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Brand from the final ";" segment of a ctrl_info value (trimmed). */
export function brandFromCtrlInfo(ctrlInfo: string): string {
  const parts = ctrlInfo.split(";");
  return (parts[parts.length - 1] ?? "").trim();
}

function indexByKey(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = normalizeHeaderKey(h);
    if (key !== "" && !map.has(key)) map.set(key, i);
  });
  return map;
}

export function parseVoluumCsv(input: string): VoluumParseResult {
  let table: CsvTable | null;
  try {
    table = parseCsvTable(input);
  } catch {
    return { ok: false, error: "Voluum file could not be parsed as CSV." };
  }
  if (!table || table.headers.length === 0) {
    return { ok: false, error: "Voluum file is empty." };
  }

  const cols = indexByKey(table.headers);
  const revenueCol = cols.get("revenue");
  if (revenueCol == null) {
    return { ok: false, error: "Voluum file is missing the required Revenue column." };
  }

  const brandNameCol = cols.get("brand name");
  const ctrlInfoCol = cols.get("ctrl_info");
  const brandSource: "brand_name_column" | "ctrl_info" | null =
    brandNameCol != null ? "brand_name_column" : ctrlInfoCol != null ? "ctrl_info" : null;
  if (brandSource == null) {
    return {
      ok: false,
      error:
        "Voluum file has no Brand Name column and no ctrl_info column to resolve Brand Name from.",
    };
  }

  if (table.rows.length === 0) {
    return { ok: false, error: "Voluum file has a header but no data rows." };
  }

  let invalidRevenueRows = 0;
  const rows: VoluumRow[] = table.rows.map((cells, i) => {
    const cell = (idx: number) => (cells[idx] ?? "").toString();
    const brandNameRaw =
      brandSource === "brand_name_column"
        ? cell(brandNameCol!)
        : brandFromCtrlInfo(cell(ctrlInfoCol!));
    const revenue = parseRevenue(cell(revenueCol));
    if (revenue == null) invalidRevenueRows++;
    return { originalPosition: i + 1, brandNameRaw, revenue, brandSource };
  });

  return { ok: true, rows, brandSource, invalidRevenueRows };
}
