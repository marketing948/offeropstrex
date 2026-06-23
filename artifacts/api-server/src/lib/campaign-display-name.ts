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

/** `{campaign} — {action}` title shown in Work Queue. */
export function formatWorkerTaskTitle(campaignLabel: string, action: string): string {
  const campaign = campaignLabel.trim();
  const act = action.trim();
  if (!campaign) return act;
  if (!act) return campaign;
  return `${campaign} — ${act}`;
}

export function formatTakeCampaignLiveTitle(
  displayName: string,
  trafficSourceName?: string | null,
): string {
  const source = trafficSourceName?.trim() || "Traffic Source";
  return formatWorkerTaskTitle(displayName, `Go live on ${source}`);
}

export function formatCreateVoluumTaskTitle(
  batchLabel: string,
  platform: "ios" | "android",
): string {
  const display = composeCampaignDisplayName(batchLabel, platform);
  const action =
    platform === "ios" ? "Open Voluum iOS Campaign" : "Open Voluum Android Campaign";
  return formatWorkerTaskTitle(display, action);
}

export function formatFindWinnersTitle(displayName: string): string {
  return formatWorkerTaskTitle(displayName, "Review campaign performance");
}

/** Title for post–traffic-target winner review (human enters offer IDs). */
export function formatReviewWinnersTitle(batchName: string, trafficSourceName: string): string {
  const b = batchName.trim() || "Batch";
  const t = trafficSourceName.trim() || "Traffic source";
  return formatWorkerTaskTitle(`${b} — ${t}`, "Review winners at traffic target");
}

export function formatOptimizationFollowupTitle(displayName: string): string {
  return formatWorkerTaskTitle(displayName, "Optimize traffic allocation");
}
