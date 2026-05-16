// Phase 2: legacy Voluum device labels.
//
// Voluum names campaigns with a 2-token device suffix
// (`Android Wifi`, `iOS 3G`, `Desktop`, ...). The Voluum side has not
// migrated to the OfferOps Phase-2 `tracker_campaign_device` enum
// (`ios` / `android`), so the parser still has to recognise the
// historical labels to extract the device dimension from a campaign
// name. We keep the list local to the parser instead of re-exporting
// it from `@workspace/db` — Phase 2 dropped the global `FIXED_DEVICES`
// constant on purpose so no other code can build new device-aware
// schema on top of the legacy 5-label model. Phase 5's Voluum sync
// will compress the parsed label down to `ios` / `android` before
// writing to `tracker_campaigns.device`.
const LEGACY_VOLUUM_DEVICE_LABELS = ["iOS 3G", "iOS Wifi", "Android 3G", "Android Wifi", "Desktop"] as const;
type LegacyVoluumDeviceLabel = (typeof LEGACY_VOLUUM_DEVICE_LABELS)[number];

// Map of common GEO labels Voluum uses (long form) to ISO-2 country codes.
// Matching is case-insensitive. The canonical OfferOps GEO is the ISO-2 code,
// matching what `pickValidVoluumTag` produces from a batch tag like
// `lb_de_batch1` (`DE`). Two- or three-letter codes already in canonical form
// are accepted as-is.
const GEO_LABEL_TO_CODE: Record<string, string> = {
  germany: "DE",
  "united states": "US",
  usa: "US",
  "united kingdom": "GB",
  uk: "GB",
  france: "FR",
  spain: "ES",
  italy: "IT",
  netherlands: "NL",
  brazil: "BR",
  mexico: "MX",
  canada: "CA",
  australia: "AU",
  japan: "JP",
  "south africa": "ZA",
  india: "IN",
  turkey: "TR",
  poland: "PL",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  switzerland: "CH",
  austria: "AT",
  belgium: "BE",
  ireland: "IE",
  portugal: "PT",
  greece: "GR",
  "czech republic": "CZ",
  czechia: "CZ",
  hungary: "HU",
  romania: "RO",
  bulgaria: "BG",
  argentina: "AR",
  chile: "CL",
  colombia: "CO",
  peru: "PE",
  russia: "RU",
  ukraine: "UA",
  "saudi arabia": "SA",
  "united arab emirates": "AE",
  uae: "AE",
  singapore: "SG",
  malaysia: "MY",
  indonesia: "ID",
  philippines: "PH",
  thailand: "TH",
  vietnam: "VN",
  "south korea": "KR",
  korea: "KR",
  "new zealand": "NZ",
  israel: "IL",
  egypt: "EG",
  morocco: "MA",
  nigeria: "NG",
  kenya: "KE",
};

// Build a case-insensitive lookup from the lower-cased label to the
// canonical legacy label so the parser can re-emit the exact device
// string the rest of the system uses for display + grouping.
const DEVICE_BY_LOWER: ReadonlyMap<string, LegacyVoluumDeviceLabel> = new Map(
  (LEGACY_VOLUUM_DEVICE_LABELS as readonly LegacyVoluumDeviceLabel[]).map((d) => [d.toLowerCase(), d]),
);

export type ParsedVoluumCampaignName = {
  /** Original first segment, trimmed. e.g. `MR.X V2 Magic [TRX]` */
  trafficSourceName: string;
  /** ISO-2 country code (UPPERCASE). e.g. `DE` */
  geo: string;
  /**
   * Affiliate initials token from the campaign name, normalized to UPPERCASE.
   * The parser accepts any 2- or 3-letter token in the affiliate position so
   * that newly-introduced affiliate codes flow through end-to-end without a
   * code change. Whether the token actually corresponds to a real affiliate
   * is decided downstream by the structured-match step against batches in
   * the workspace.
   */
  affiliateInitials: string;
  /** Exact legacy Voluum device label, or `null` if device cannot be determined.
   *  Phase 5 sync compresses this down to `ios` / `android` for `tracker_campaigns.device`. */
  device: LegacyVoluumDeviceLabel | null;
  /** Connection-type token if it was consumed as part of the device (`3G` / `Wifi`), else `null`. */
  connectionType: string | null;
  /** Original input string, trimmed. */
  raw: string;
};

function normalizeGeoToken(token: string): string | null {
  const t = token.trim();
  if (!t) return null;
  // Already a 2/3-letter code
  if (/^[A-Za-z]{2,3}$/.test(t)) return t.toUpperCase();
  const looked = GEO_LABEL_TO_CODE[t.toLowerCase()];
  return looked ?? null;
}

function tryConsumeDevice(
  tokens: readonly string[],
  startIdx: number,
): { device: LegacyVoluumDeviceLabel; connectionType: string | null; consumed: number } | null {
  if (startIdx >= tokens.length) return null;
  // Try 2-token combo first (e.g. "Android 3G", "iOS Wifi")
  if (startIdx + 1 < tokens.length) {
    const combo = `${tokens[startIdx]} ${tokens[startIdx + 1]}`.toLowerCase();
    const matched = DEVICE_BY_LOWER.get(combo);
    if (matched) {
      return { device: matched, connectionType: tokens[startIdx + 1], consumed: 2 };
    }
  }
  // Single-token (Desktop)
  const single = DEVICE_BY_LOWER.get(tokens[startIdx].toLowerCase());
  if (single) return { device: single, connectionType: null, consumed: 1 };
  return null;
}

/**
 * Parse a Voluum campaign name in the canonical OfferOps shape:
 *
 *   `[traffic source] - [GEO] - [affiliate] [device] [connection] [date] [visits]`
 *
 * e.g. `MR.X V2 Magic [TRX] - Germany - LB Android 3G 21.4.26 [4K]`
 *
 * Returns `null` when the name does not match the canonical shape (fewer
 * than 3 ` - `-separated segments) or when the GEO token cannot be resolved
 * to an ISO-2 code. The affiliate position accepts any 2- or 3-letter token
 * (uppercased) — the structured-match step downstream is what decides
 * whether the token corresponds to a real batch. The device token is
 * best-effort and may come back as `null` while the rest of the parse still
 * succeeds — the caller decides whether to fall back to source-only matching.
 */
export function parseVoluumCampaignName(
  name: string | null | undefined,
): ParsedVoluumCampaignName | null {
  if (!name) return null;
  const raw = name.trim();
  if (!raw) return null;

  // Top-level segments: " - " is the canonical separator.
  const segments = raw.split(/\s+-\s+/);
  if (segments.length < 3) return null;
  const trafficSourceName = segments[0].trim();
  const geoRaw = segments[1].trim();
  // The "tail" may itself contain hyphens (rare — e.g. dates), so re-join the
  // remainder rather than assuming exactly 3 segments.
  const tail = segments.slice(2).join(" - ").trim();
  if (!trafficSourceName || !geoRaw || !tail) return null;

  const geo = normalizeGeoToken(geoRaw);
  if (!geo) return null;

  const tailTokens = tail.split(/\s+/).filter(Boolean);
  if (tailTokens.length < 2) return null;

  const affiliateRaw = tailTokens[0];
  // Accept any 2- or 3-letter token in the affiliate position. Downstream
  // structured-match decides whether this affiliate actually maps to a
  // batch in the workspace. Reject obvious non-affiliate tokens (numbers,
  // longer words like "Android") so we don't false-parse names where the
  // first tail token happens to be the device.
  if (!/^[A-Za-z]{2,3}$/.test(affiliateRaw)) return null;
  const affiliateInitials = affiliateRaw.toUpperCase();

  // Device is optional — if the token after the affiliate isn't a recognized
  // legacy label we still return the parsed envelope with `device: null`
  // so callers can fall back to source-only matching.
  const deviceMatch = tryConsumeDevice(tailTokens, 1);

  return {
    trafficSourceName,
    geo,
    affiliateInitials,
    device: deviceMatch?.device ?? null,
    connectionType: deviceMatch?.connectionType ?? null,
    raw,
  };
}
