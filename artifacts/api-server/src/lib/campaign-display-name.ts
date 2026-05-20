/** Human label suffix for campaign platform (Voluum / operator UI). */
export function platformDisplaySuffix(platform: "ios" | "android"): string {
  return platform === "ios" ? "iOS" : "Android";
}

/** Canonical display name: `{batchName} iOS|Android`. */
export function composeCampaignDisplayName(
  batchName: string,
  platform: "ios" | "android",
): string {
  return `${batchName} ${platformDisplaySuffix(platform)}`;
}

/** True when `campaignName` was copied from a create_voluum task title. */
export function isCreateVoluumTaskTitle(name: string): boolean {
  return /^Create Voluum campaign/i.test(name.trim());
}

/**
 * Name shown in take-live titles and operator UI — never the raw create_voluum task title.
 */
export function resolveCampaignDisplayName(params: {
  campaignName: string;
  batchName?: string | null;
  platform: "ios" | "android";
}): string {
  const { campaignName, batchName, platform } = params;
  const trimmed = campaignName.trim();
  if (batchName?.trim()) {
    const fromBatch = composeCampaignDisplayName(batchName.trim(), platform);
    if (!trimmed || isCreateVoluumTaskTitle(trimmed)) {
      return fromBatch;
    }
  }
  if (trimmed) return trimmed;
  if (batchName?.trim()) {
    return composeCampaignDisplayName(batchName.trim(), platform);
  }
  return platformDisplaySuffix(platform);
}

export function formatTakeCampaignLiveTitle(displayName: string): string {
  return `Take "${displayName}" live`;
}

export function formatCreateVoluumTaskTitle(
  batchLabel: string,
  platform: "ios" | "android",
): string {
  return `Create Voluum campaign for ${batchLabel} ${platformDisplaySuffix(platform)}`;
}

export function formatFindWinnersTitle(displayName: string): string {
  return `Find winners for "${displayName}"`;
}

/** Title for post–traffic-target winner review (human enters offer IDs). */
export function formatReviewWinnersTitle(batchName: string, trafficSourceName: string): string {
  const b = batchName.trim() || "Batch";
  const t = trafficSourceName.trim() || "Traffic source";
  return `Review winners for "${b} — ${t}"`;
}
