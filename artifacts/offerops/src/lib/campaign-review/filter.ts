import type { ReviewQueueCampaign } from "./types.ts";

export function matchesReviewSearch(
  item: ReviewQueueCampaign,
  query: string,
  extraNote = "",
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.campaignName,
    String(item.campaignId),
    item.voluumCampaignId ?? "",
    item.batchName ?? "",
    item.platform,
    item.purpose,
    item.employeeName ?? "",
    item.reviewComment ?? "",
    extraNote,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}
