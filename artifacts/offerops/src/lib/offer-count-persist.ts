/**
 * One-shot client persist when offerCount was resolved from batch fallback.
 * Prevents re-deriving on every render; server PATCH is best-effort.
 */
const persistedCampaignIds = new Set<number>();

export function persistOfferCountBackfill(
  campaignId: number,
  offerCount: number,
  patch: (campaignId: number, offerCount: number) => Promise<void>,
): void {
  if (persistedCampaignIds.has(campaignId)) return;
  persistedCampaignIds.add(campaignId);
  void patch(campaignId, offerCount).catch(() => {
    persistedCampaignIds.delete(campaignId);
  });
}

/** Test-only reset. */
export function resetOfferCountBackfillCache(): void {
  persistedCampaignIds.clear();
}
