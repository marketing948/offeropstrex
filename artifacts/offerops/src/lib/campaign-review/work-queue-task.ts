import type { ReviewQueueCampaign } from "@/lib/campaign-review/types";

export function buildWorkQueueTaskDescription(review: ReviewQueueCampaign): string {
  return [
    "Source: campaign-review",
    `Campaign: ${review.campaignName} (#${review.campaignId})`,
    review.batchName && review.batchId != null
      ? `Batch: ${review.batchName} (#${review.batchId})`
      : null,
    `Campaign type: ${review.purpose}`,
    `Platform: ${review.platform}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function resolveWorkQueueAssigneeId(
  review: ReviewQueueCampaign,
  actorEmployeeId: number,
): number {
  return review.employeeId ?? actorEmployeeId;
}
