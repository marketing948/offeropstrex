/**
 * RFC-4180 CSV codec for the AI Optimizer.
 *
 * The existing Voluum metrics parser (`voluum-metrics-csv.ts`) splits on raw
 * newlines and therefore cannot handle a quoted field that contains a line
 * break. The optimizer must preserve every original Campaign cell byte-for-byte
 * on export, so it needs a record-aware tokenizer that:
 *   - strips a leading UTF-8 BOM,
 *   - honours quoted commas and quoted line breaks (\n and \r\n),
 *   - unescapes doubled quotes ("") inside quoted fields,
 *   - preserves the source EOL + BOM convention when re-serializing.
 *
 * Pure module — no I/O, no logging of row contents.
 */

export type CsvTable = {
  /** Raw header cells, in original order. */
  headers: string[];
  /** Data rows (each an array of raw cell strings), in original order. */
  rows: string[][];
  /** True when the source began with a UTF-8 BOM. */
  hadBom: boolean;
  /** EOL detected in the source ("\r\n" or "\n"). Defaults to "\n". */
  eol: "\r\n" | "\n";
};

export const BOM = "\uFEFF";

/** Detect (and report) a leading UTF-8 BOM without mutating the caller's copy. */
export function hasBom(text: string): boolean {
  return text.charCodeAt(0) === 0xfeff;
}

/** First EOL style used in the text. CRLF wins only if it appears. */
export function detectEol(text: string): "\r\n" | "\n" {
  const idx = text.indexOf("\n");
  if (idx > 0 && text[idx - 1] === "\r") return "\r\n";
  return "\n";
}

/**
 * Tokenize CSV text into records. Fully quote-aware (commas, CR, LF, and ""
 * escapes inside quotes). A trailing newline does not create a spurious empty
 * record. A completely empty file yields zero records.
 */
export function tokenizeCsv(input: string): string[][] {
  const text = hasBom(input) ? input.slice(1) : input;
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let sawAnyChar = false;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    sawAnyChar = true;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      pushField();
      continue;
    }
    if (ch === "\r") {
      // Swallow CR; the following LF (if any) finalizes the record.
      if (text[i + 1] === "\n") i++;
      pushRecord();
      continue;
    }
    if (ch === "\n") {
      pushRecord();
      continue;
    }
    field += ch;
  }

  // Flush the final record unless the file ended exactly on a record boundary
  // (i.e. the last char was a newline and there is no dangling field/record).
  if (field.length > 0 || record.length > 0) {
    pushRecord();
  } else if (!sawAnyChar) {
    // empty input → no records
  }

  return records;
}

/**
 * Parse CSV text into a header row + data rows. Returns null when there is no
 * header row at all (empty file). Blank trailing rows are dropped; a row that
 * is entirely empty (single empty cell) is treated as blank and skipped.
 */
export function parseCsvTable(input: string): CsvTable | null {
  const records = tokenizeCsv(input);
  if (records.length === 0) return null;
  const [headers, ...rest] = records;
  const rows = rest.filter((r) => !(r.length === 1 && r[0] === ""));
  return {
    headers: headers ?? [],
    rows,
    hadBom: hasBom(input),
    eol: detectEol(input),
  };
}

/** Escape a single cell per RFC-4180 (quote when it contains , " CR or LF). */
export function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialize a header + rows back to CSV text, preserving EOL/BOM convention. */
export function serializeCsv(
  headers: string[],
  rows: string[][],
  opts: { bom?: boolean; eol?: "\r\n" | "\n" } = {},
): string {
  const eol = opts.eol ?? "\n";
  const lines = [headers, ...rows].map((cells) =>
    cells.map(escapeCsvCell).join(","),
  );
  const body = lines.join(eol);
  return opts.bom ? BOM + body : body;
}

/** Normalize a header/brand token for case-insensitive column/brand matching. */
export function normalizeHeaderKey(header: string): string {
  return header
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
