export const ALLOWED_AFFILIATE_INITIALS = [
  "SL", "LB", "LH", "RW", "BLU", "YK", "TA", "TT", "BR", "TD", "WG",
] as const;

export type AffiliateInitials = (typeof ALLOWED_AFFILIATE_INITIALS)[number];

// OfferOps automation is strictly tag-driven. Batch tags must already be
// lowercase in Voluum; mixed/upper-case tags are ignored rather than
// normalized so operators can fix the source data.
const AFFILIATE_PATTERN = ALLOWED_AFFILIATE_INITIALS.join("|").toLowerCase();
export const VOLUUM_TAG_REGEX = new RegExp(
  `^(${AFFILIATE_PATTERN})_([a-z]{2,3})_batch([0-9]+)$`,
);

const ANY_AFFILIATE_PREFIX_REGEX = /^([A-Za-z]+)_/;
const ALLOWED_AFFILIATE_SET = new Set<string>(
  ALLOWED_AFFILIATE_INITIALS.map(s => s.toUpperCase()),
);

export type ParsedVoluumTag = {
  tag: string;
  affiliateInitials: AffiliateInitials;
  geo: string;
  batchPrefix: string;
  batchNumber: number;
};

export type VoluumTagSkipReason =
  | "missing_tag"
  | "invalid_tag_format"
  | "unknown_affiliate_initials"
  | "invalid_geo"
  | "invalid_batch_number";

export type PickValidTagResult =
  | { valid: true; parsed: ParsedVoluumTag; allTags: string[] }
  | { valid: false; reason: VoluumTagSkipReason; allTags: string[]; offendingTag: string | null };

function parseSingleTag(raw: string):
  | { ok: true; parsed: ParsedVoluumTag }
  | { ok: false; reason: VoluumTagSkipReason } {
  const tag = raw.trim();
  if (!tag) return { ok: false, reason: "invalid_tag_format" };
  if (tag !== tag.toLowerCase()) return { ok: false, reason: "invalid_tag_format" };

  const m = VOLUUM_TAG_REGEX.exec(tag);
  if (m) {
    const [, affiliate, geo, batchNumberStr] = m;
    const batchNumber = Number(batchNumberStr);
    if (!Number.isFinite(batchNumber) || batchNumber <= 0) {
      return { ok: false, reason: "invalid_batch_number" };
    }
    return {
      ok: true,
      parsed: {
        tag,
        affiliateInitials: affiliate.toUpperCase() as AffiliateInitials,
        geo,
        batchPrefix: "batch",
        batchNumber,
      },
    };
  }

  // Tag did not match. Diagnose the most useful reason.
  const prefixRaw = ANY_AFFILIATE_PREFIX_REGEX.exec(tag)?.[1] ?? null;
  if (prefixRaw && !ALLOWED_AFFILIATE_SET.has(prefixRaw.toUpperCase())) {
    return { ok: false, reason: "unknown_affiliate_initials" };
  }

  // Try to surface a more specific reason for an otherwise broken tag.
  const looseParts = tag.split("_");
  if (looseParts.length === 3) {
    const [, geoPart, tail] = looseParts;
    if (!/^[a-z]{2,3}$/.test(geoPart)) {
      return { ok: false, reason: "invalid_geo" };
    }
    const tailMatch = /^(batch)([0-9]+)$/.exec(tail);
    if (tailMatch && Number(tailMatch[2]) <= 0) {
      return { ok: false, reason: "invalid_batch_number" };
    }
  }

  return { ok: false, reason: "invalid_tag_format" };
}

export function normalizeRawTags(rawTags: unknown): string[] {
  if (Array.isArray(rawTags)) {
    return rawTags.map(t => (t == null ? "" : String(t))).filter(t => t.length > 0);
  }
  if (typeof rawTags === "string" && rawTags.trim()) {
    // Voluum sometimes returns a comma- or whitespace-separated string.
    return rawTags.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Inspect every tag on an item and pick the first lowercase tag that matches
 * the canonical OfferOps batch tag pattern. If at least one valid tag is found, the
 * item is importable. If none match, return a structured skip reason that
 * favors the most informative diagnosis seen across all tags.
 */
export function pickValidVoluumTag(rawTags: unknown): PickValidTagResult {
  const allTags = normalizeRawTags(rawTags);
  if (allTags.length === 0) {
    return { valid: false, reason: "missing_tag", allTags, offendingTag: null };
  }

  // Reason priority — surface the closest-to-valid problem so users can fix it.
  const reasonPriority: Record<VoluumTagSkipReason, number> = {
    missing_tag: 0,
    invalid_tag_format: 1,
    unknown_affiliate_initials: 2,
    invalid_geo: 3,
    invalid_batch_number: 4,
  };

  let bestReason: VoluumTagSkipReason = "invalid_tag_format";
  let bestOffender: string = allTags[0];

  for (const tag of allTags) {
    const result = parseSingleTag(tag);
    if (result.ok) {
      return { valid: true, parsed: result.parsed, allTags };
    }
    if (reasonPriority[result.reason] > reasonPriority[bestReason]) {
      bestReason = result.reason;
      bestOffender = tag;
    }
  }

  return { valid: false, reason: bestReason, allTags, offendingTag: bestOffender };
}

// ─── Tracker Campaign Tag (Phase 6 / SPEC §4) ───────────────────────
//
// STRICTLY SEPARATE from the offer/campaign tag above. Tracker campaign
// tags identify a single tracker slot (one device for one batch) and
// follow this shape:
//
//   <initials>_<geo>_batch<n>_<platform>
//   e.g. sl_gb_batch1_ios, sl_gb_batch1_and
//
// SPEC §4: traffic source is NOT part of the tag. The traffic source
// for a tracker campaign is detected from Voluum's campaign-level
// trafficSourceName field, not parsed from the tag. This validator is
// used by the sync producer when emitting TrackerCampaignImported.

export type TrackerDevice = "ios" | "android";
export type TrackerPlatformSuffix = "ios" | "and";

const TRACKER_AFFILIATE_PATTERN = ALLOWED_AFFILIATE_INITIALS.join("|").toLowerCase();
export const TRACKER_CAMPAIGN_TAG_REGEX = new RegExp(
  `^(${TRACKER_AFFILIATE_PATTERN})_([a-z]{2,3})_batch([0-9]+)_(ios|and)$`,
);

export type ParsedTrackerCampaignTag = {
  // Canonical lower-case form for storage (matches Voluum's convention).
  tag: string;
  affiliateInitials: AffiliateInitials;
  geo: string;
  batchNumber: number;
  batchTag: string;
  platformSuffix: TrackerPlatformSuffix;
  device: TrackerDevice;
};

export type TrackerCampaignTagSkipReason =
  | "missing_tag"
  | "invalid_tag_format"
  | "unknown_affiliate_initials"
  | "invalid_geo"
  | "invalid_batch_number";

export type ParseTrackerCampaignTagResult =
  | { valid: true; parsed: ParsedTrackerCampaignTag }
  | { valid: false; reason: TrackerCampaignTagSkipReason; offendingTag: string | null };

/** Pure regex/structure parse of a tracker-campaign tag. Per SPEC §4
 *  the tag does NOT include the traffic source — the caller derives
 *  that from the Voluum campaign's own trafficSourceName field. */
export function parseTrackerCampaignTag(raw: unknown): ParseTrackerCampaignTagResult {
  if (raw == null) return { valid: false, reason: "missing_tag", offendingTag: null };
  const tag = String(raw).trim();
  if (!tag) return { valid: false, reason: "missing_tag", offendingTag: null };
  if (tag !== tag.toLowerCase()) {
    return { valid: false, reason: "invalid_tag_format", offendingTag: tag };
  }

  const m = TRACKER_CAMPAIGN_TAG_REGEX.exec(tag);
  if (m) {
    const [, affiliate, geo, batchNumberStr, platformSuffix] = m;
    const batchNumber = Number(batchNumberStr);
    if (!Number.isFinite(batchNumber) || batchNumber <= 0) {
      return { valid: false, reason: "invalid_batch_number", offendingTag: tag };
    }
    const batchTag = `${affiliate}_${geo}_batch${batchNumber}`;
    const suffix = platformSuffix as TrackerPlatformSuffix;
    return {
      valid: true,
      parsed: {
        tag,
        affiliateInitials: affiliate.toUpperCase() as AffiliateInitials,
        geo,
        batchNumber,
        batchTag,
        platformSuffix: suffix,
        device: suffix === "ios" ? "ios" : "android",
      },
    };
  }

  // Diagnose the most useful reason. Matches the diagnostic ladder used
  // by the offer-tag parser.
  const prefixRaw = ANY_AFFILIATE_PREFIX_REGEX.exec(tag)?.[1] ?? null;
  if (prefixRaw && !ALLOWED_AFFILIATE_SET.has(prefixRaw.toUpperCase())) {
    return { valid: false, reason: "unknown_affiliate_initials", offendingTag: tag };
  }

  // Tracker tags have exactly 4 underscore-separated parts:
  // <initials>_<geo>_batch<n>_<platform>
  const parts = tag.split("_");
  if (parts.length === 4) {
    const [, geoPart, batchPart, platformPart] = parts;
    if (!/^[a-z]{2,3}$/.test(geoPart)) {
      return { valid: false, reason: "invalid_geo", offendingTag: tag };
    }
    const batchMatch = /^batch([0-9]+)$/.exec(batchPart);
    if (batchMatch) {
      const n = Number(batchMatch[1]);
      if (!Number.isFinite(n) || n <= 0) {
        return { valid: false, reason: "invalid_batch_number", offendingTag: tag };
      }
    }
    if (platformPart && !/^(ios|and)$/.test(platformPart)) {
      return { valid: false, reason: "invalid_tag_format", offendingTag: tag };
    }
  }

  return { valid: false, reason: "invalid_tag_format", offendingTag: tag };
}

/** Back-compat wrapper. Per SPEC §4 traffic source is no longer part
 *  of the tracker tag, so this is now equivalent to
 *  parseTrackerCampaignTag and ignores any extra arguments. Retained
 *  as the named entry-point used by sync.ts and other callers. */
export function validateTrackerCampaignTag(
  raw: unknown,
): ParseTrackerCampaignTagResult {
  return parseTrackerCampaignTag(raw);
}
