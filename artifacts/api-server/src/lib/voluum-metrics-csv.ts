/** Voluum campaign report CSV — manual metrics import (no API). */

export const VOLUUM_METRICS_REQUIRED_HEADERS = [
  "campaign_id",
  "visits",
  "conversions",
  "cost",
  "revenue",
] as const;

export type VoluumMetricsSkipReason =
  | "missing_campaign_id"
  | "campaign_not_found"
  | "missing_metrics"
  | "invalid_number"
  | "not_allowed"
  | "duplicate_in_csv";

export type VoluumCsvParsedMetricRow = {
  lineNumber: number;
  voluumCampaignId: string | null;
  visits: number | null;
  conversions: number | null;
  cost: string | null;
  revenue: string | null;
  rowSkipReason?: "missing_campaign_id" | "missing_metrics" | "invalid_number";
};

export type VoluumCsvParseResult =
  | {
      ok: true;
      /** Every data row (including row-level parse skips). */
      dataRows: VoluumCsvParsedMetricRow[];
    }
  | { ok: false; error: string };

/** Normalize header cell for column mapping. */
export function normalizeVoluumCsvHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

const HEADER_ALIASES: Record<string, string> = {
  campaign_id: "campaign_id",
  campaignid: "campaign_id",
  visits: "visits",
  conversions: "conversions",
  cost: "cost",
  revenue: "revenue",
};

/** Parse one CSV line into fields (RFC4180-style quoted fields). */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

/** Split CSV text into non-empty trimmed lines. */
export function splitCsvLines(csvText: string): string[] {
  const normalized = csvText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
}

function mapHeaderIndices(headerCells: string[]): Map<string, number> | null {
  const indices = new Map<string, number>();
  for (let i = 0; i < headerCells.length; i++) {
    const key = HEADER_ALIASES[normalizeVoluumCsvHeader(headerCells[i] ?? "")];
    if (key && !indices.has(key)) {
      indices.set(key, i);
    }
  }
  for (const required of VOLUUM_METRICS_REQUIRED_HEADERS) {
    if (!indices.has(required)) {
      return null;
    }
  }
  return indices;
}

function stripMoneyAndGrouping(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(/^\$/, "").replace(/,/g, "").trim();
  return s;
}

function parseNonNegativeInteger(raw: string): number | null {
  const s = stripMoneyAndGrouping(raw);
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

function parseNonNegativeMoney(raw: string): string | null {
  const s = stripMoneyAndGrouping(raw);
  if (s === "") return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return String(n);
}

function getCell(cells: string[], index: number): string {
  return (cells[index] ?? "").trim();
}

function evaluateDataRow(
  cells: string[],
  indices: Map<string, number>,
  lineNumber: number,
): VoluumCsvParsedMetricRow {
  const voluumRaw = getCell(cells, indices.get("campaign_id")!);
  const voluumCampaignId = voluumRaw === "" ? null : voluumRaw;

  if (voluumCampaignId == null) {
    return {
      lineNumber,
      voluumCampaignId: null,
      visits: null,
      conversions: null,
      cost: null,
      revenue: null,
      rowSkipReason: "missing_campaign_id",
    };
  }

  const visitsRaw = getCell(cells, indices.get("visits")!);
  const conversionsRaw = getCell(cells, indices.get("conversions")!);
  const costRaw = getCell(cells, indices.get("cost")!);
  const revenueRaw = getCell(cells, indices.get("revenue")!);

  if (visitsRaw === "" || conversionsRaw === "" || costRaw === "" || revenueRaw === "") {
    return {
      lineNumber,
      voluumCampaignId,
      visits: null,
      conversions: null,
      cost: null,
      revenue: null,
      rowSkipReason: "missing_metrics",
    };
  }

  const visits = parseNonNegativeInteger(visitsRaw);
  const conversions = parseNonNegativeInteger(conversionsRaw);
  const cost = parseNonNegativeMoney(costRaw);
  const revenue = parseNonNegativeMoney(revenueRaw);

  if (visits == null || conversions == null || cost == null || revenue == null) {
    return {
      lineNumber,
      voluumCampaignId,
      visits: null,
      conversions: null,
      cost: null,
      revenue: null,
      rowSkipReason: "invalid_number",
    };
  }

  return {
    lineNumber,
    voluumCampaignId,
    visits,
    conversions,
    cost,
    revenue,
  };
}

type ValidMetricRow = VoluumCsvParsedMetricRow & {
  voluumCampaignId: string;
  visits: number;
  conversions: number;
  cost: string;
  revenue: string;
};

function isValidMetricRow(row: VoluumCsvParsedMetricRow): row is ValidMetricRow {
  return (
    row.voluumCampaignId != null &&
    row.visits != null &&
    row.conversions != null &&
    row.cost != null &&
    row.revenue != null &&
    row.rowSkipReason == null
  );
}

/** Last valid row per Campaign ID wins; earlier duplicates are dropped from output. */
export function dedupeVoluumRowsByCampaignId(rows: VoluumCsvParsedMetricRow[]): {
  rows: VoluumCsvParsedMetricRow[];
  duplicateCampaignIdsInCsv: number;
} {
  const order: string[] = [];
  const byId = new Map<string, ValidMetricRow>();
  let duplicateCampaignIdsInCsv = 0;

  for (const row of rows) {
    if (!isValidMetricRow(row)) continue;
    const id = row.voluumCampaignId.trim();
    if (byId.has(id)) {
      duplicateCampaignIdsInCsv++;
    } else {
      order.push(id);
    }
    byId.set(id, { ...row, voluumCampaignId: id });
  }

  const deduped: VoluumCsvParsedMetricRow[] = [];
  for (const id of order) {
    deduped.push(byId.get(id)!);
  }
  return { rows: deduped, duplicateCampaignIdsInCsv };
}

/**
 * Parse Voluum export CSV. Ignores Campaign, Created, ROI, events, etc.
 * Does not use Created as metrics date.
 */
export function parseVoluumMetricsCsv(csvText: string): VoluumCsvParseResult {
  if (!csvText || csvText.trim() === "") {
    return { ok: false, error: "CSV is empty" };
  }

  const lines = splitCsvLines(csvText);
  if (lines.length < 2) {
    return { ok: false, error: "CSV must include a header row and at least one data row" };
  }

  const headerCells = parseCsvLine(lines[0]!);
  const indices = mapHeaderIndices(headerCells);
  if (!indices) {
    return {
      ok: false,
      error: `Missing required columns. Need: Campaign ID, Visits, Conversions, Cost, Revenue`,
    };
  }

  const rawRows: VoluumCsvParsedMetricRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    rawRows.push(evaluateDataRow(cells, indices, i + 1));
  }

  return { ok: true, dataRows: rawRows };
}
