/** Extract a 2-letter ISO code from messy GEO strings (e.g. "GB GB" → "GB"). */
export function normalizeGeoCode(geo: string): string {
  const trimmed = geo.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  const tokens = trimmed.match(/\b([A-Z]{2})\b/g);
  if (tokens?.length) return tokens[0]!;
  return "";
}

/** ISO 3166-1 alpha-2 → regional indicator flag emoji (e.g. GB → 🇬🇧). */
export function geoFlagEmoji(geo: string): string {
  const code = normalizeGeoCode(geo);
  if (code.length !== 2 || !/^[A-Z]{2}$/.test(code)) return "🌍";
  const base = 0x1f1e6 - 65;
  return String.fromCodePoint(base + code.charCodeAt(0), base + code.charCodeAt(1));
}

/** Flag + GEO code for mission board scan speed (single label, no duplication). */
export function geoFlagLabel(geo: string): string {
  const code = normalizeGeoCode(geo);
  return `${geoFlagEmoji(code)} ${code}`;
}

/**
 * Canonical GEO code for on-screen display — the code exactly ONCE, never an
 * emoji. Regional-indicator flag emoji can render as ASCII letters on
 * Windows/Linux, so emoji + code visibly duplicates ("US US"). This returns
 * only the normalized code (`us`, `US`, `US US`, `🇺🇸 US`, whitespace → `US`),
 * falling back to a trimmed single token for unrecognized input.
 */
export function geoCodeText(geo: string | null | undefined): string {
  const raw = (geo ?? "").trim();
  if (!raw) return "—";
  const code = normalizeGeoCode(raw);
  if (code) return code;
  // Unknown / non-ISO: show a single trimmed uppercase token, never duplicated.
  return raw.toUpperCase().split(/\s+/)[0] || "—";
}
