/**
 * Balanced, contiguous PATH/CMP distribution.
 *
 * base = floor(remaining / pathCount); remainder = remaining % pathCount.
 * The first `remainder` PATHs receive base + 1 Offers; the rest receive base.
 * Assignment is contiguous over the retained sequence and preserves order.
 */

export type PathBucket = {
  /** cmp label, e.g. "cmp01". */
  campaignIndex: string;
  /** Offers in this PATH. */
  offerCount: number;
  /** 1-based inclusive start position within the retained sequence. */
  startPosition: number;
  /** 1-based inclusive end position within the retained sequence. */
  endPosition: number;
};

/** Zero-padded cmp label (min width 2 → cmp01..cmp99, cmp100, ...). */
export function cmpLabel(pathIndexZeroBased: number): string {
  const n = pathIndexZeroBased + 1;
  return `cmp${String(n).padStart(2, "0")}`;
}

/** Validate a PATH count against the retained Offer count. Returns error|null. */
export function validatePathCount(retainedCount: number, pathCount: number): string | null {
  if (!Number.isInteger(pathCount)) return "Number of PATHS must be a whole number.";
  if (pathCount < 1) return "Number of PATHS must be at least 1.";
  if (retainedCount < 1) return "There are no retained Offers to distribute.";
  if (pathCount > retainedCount) {
    return `Number of PATHS (${pathCount}) cannot exceed retained Offers (${retainedCount}).`;
  }
  return null;
}

/** Per-PATH Offer counts. Sum always equals `remaining`. */
export function distributeOffers(remaining: number, pathCount: number): number[] {
  const err = validatePathCount(remaining, pathCount);
  if (err) throw new Error(err);
  const base = Math.floor(remaining / pathCount);
  const remainder = remaining % pathCount;
  const counts: number[] = [];
  for (let i = 0; i < pathCount; i++) {
    counts.push(i < remainder ? base + 1 : base);
  }
  return counts;
}

/** Full bucket layout (labels + counts + retained-sequence position ranges). */
export function buildDistribution(remaining: number, pathCount: number): PathBucket[] {
  const counts = distributeOffers(remaining, pathCount);
  const buckets: PathBucket[] = [];
  let cursor = 1;
  counts.forEach((count, i) => {
    buckets.push({
      campaignIndex: cmpLabel(i),
      offerCount: count,
      startPosition: cursor,
      endPosition: cursor + count - 1,
    });
    cursor += count;
  });
  return buckets;
}

/**
 * cmp label per retained row, in retained order (length === retainedCount).
 * Row k (0-based) belongs to the bucket whose position range contains k+1.
 */
export function assignCmpToRetained(retainedCount: number, pathCount: number): string[] {
  const counts = distributeOffers(retainedCount, pathCount);
  const labels: string[] = [];
  counts.forEach((count, i) => {
    const label = cmpLabel(i);
    for (let j = 0; j < count; j++) labels.push(label);
  });
  return labels;
}
