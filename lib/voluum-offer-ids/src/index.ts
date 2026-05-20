/**
 * Voluum offer identifiers — canonical external IDs are hyphenated lowercase UUID strings.
 *
 * Validates format only (no HTTP / Voluum API lookup).
 */

/** Hyphenated UUID (Voluum-style). Lowercase hex only — normalize input before matching. */
export const VOLUUM_OFFER_ID_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const INVALID_VOLUUM_OFFER_ID_FORMAT_MESSAGE = "Invalid Voluum offer ID format";

export function normalizeVoluumOfferIdToken(token: string): string {
  return token.trim().toLowerCase();
}

/**
 * Split free-text paste: commas, whitespace, newlines → raw tokens before validation.
 */
export function tokenizeVoluumOfferIdInput(raw: string): string[] {
  return raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Validates every token — all-or-nothing. Returns lowercase canonical IDs, deduped in first-seen order.
 */
export function parseVoluumOfferIdsFromNormalizedTokens(tokens: readonly string[]): { ok: string[] } | { error: string } {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens) {
    const id = normalizeVoluumOfferIdToken(raw);
    if (!id) continue;
    if (!VOLUUM_OFFER_ID_UUID_REGEX.test(id)) {
      return { error: INVALID_VOLUUM_OFFER_ID_FORMAT_MESSAGE };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return { ok: out };
}

export function parseVoluumOfferIdsFromText(raw: string): { ok: string[] } | { error: string } {
  const tokens = tokenizeVoluumOfferIdInput(raw);
  return parseVoluumOfferIdsFromNormalizedTokens(tokens);
}

/**
 * For JSON payloads: accepts string[] — trims / lowercases each; rejects mixed valid+invalid wholly.
 */
export function parseVoluumOfferIdsFromStrings(ids: unknown): { ok: string[] } | { error: string } {
  if (ids === undefined || ids === null) {
    return { ok: [] };
  }
  if (!Array.isArray(ids)) {
    return { error: INVALID_VOLUUM_OFFER_ID_FORMAT_MESSAGE };
  }
  const tokens: string[] = [];
  for (const v of ids) {
    if (typeof v !== "string") return { error: INVALID_VOLUUM_OFFER_ID_FORMAT_MESSAGE };
    tokens.push(v);
  }
  const normalized = tokens.map((t) => normalizeVoluumOfferIdToken(t)).filter(Boolean);
  return parseVoluumOfferIdsFromNormalizedTokens(normalized);
}

/**
 * Lenient extraction for embedded JSON on MANUAL winner handoff tasks: legacy positive
 * integers from older clients plus canonical hyphenated lowercase Voluum IDs. Entries
 * that are neither legacy numeric IDs nor UUID-form strings are omitted.
 */
export function coerceWinnerHandoffOfferIdsFromJson(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item === "number" && Number.isInteger(item) && item > 0) {
      const s = String(item);
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
      continue;
    }
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const low = normalizeVoluumOfferIdToken(trimmed);
    if (VOLUUM_OFFER_ID_UUID_REGEX.test(low)) {
      if (!seen.has(low)) {
        seen.add(low);
        out.push(low);
      }
      continue;
    }
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isInteger(n) && n > 0 && !seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
      }
    }
  }
  return out;
}
