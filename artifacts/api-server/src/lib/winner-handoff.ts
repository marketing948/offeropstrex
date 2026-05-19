export const WINNER_HANDOFF_CONTEXT_MARKER = "---offerops-winner-handoff---";

export type WinnerHandoffContext = {
  kind: "winners_found_manual_close";
  testingCampaignId: number;
  batchId: number | null;
  platform: "ios" | "android";
  trafficSourceId: number | null;
  targetWorkingCampaignId: number | null;
  missingWorkingCampaign: boolean;
  winnerOfferIds: number[];
  manualCloseReason: "winners_found";
};

export function buildWinnerHandoffTitle(params: {
  campaignName: string;
  missingWorkingCampaign: boolean;
}): string {
  const name = params.campaignName.trim() || "campaign";
  if (params.missingWorkingCampaign) {
    return `Create/find working campaign and move winners from ${name}`;
  }
  return `Move winners from ${name} to working campaign`;
}

export function buildWinnerHandoffDescription(params: {
  context: WinnerHandoffContext;
  targetWorkingCampaignId: number | null;
  note?: string | null;
}): string {
  const { context, targetWorkingCampaignId, note } = params;
  const lines = [
    context.missingWorkingCampaign
      ? "No live working campaign matches this slot. Create or locate the working campaign, then move winner offers in Voluum manually."
      : `Target working campaign #${targetWorkingCampaignId}. Move winner offers in Voluum manually — no automatic transfer.`,
    context.winnerOfferIds.length > 0
      ? `Winner offer IDs: ${context.winnerOfferIds.join(", ")}`
      : "Winner offer IDs were not recorded at close — add them in Voluum before completing this task.",
    note?.trim() ? `Close note: ${note.trim()}` : null,
  ].filter(Boolean);

  return `${lines.join("\n")}\n\n${WINNER_HANDOFF_CONTEXT_MARKER}\n${JSON.stringify(context)}`;
}

export function parseWinnerHandoffContext(description: string | null | undefined): WinnerHandoffContext | null {
  if (!description?.trim()) return null;
  const markerIdx = description.indexOf(WINNER_HANDOFF_CONTEXT_MARKER);
  const jsonText =
    markerIdx >= 0
      ? description.slice(markerIdx + WINNER_HANDOFF_CONTEXT_MARKER.length).trim()
      : description.trim();
  try {
    const parsed = JSON.parse(jsonText) as WinnerHandoffContext;
    if (parsed?.kind !== "winners_found_manual_close") return null;
    if (!Number.isInteger(parsed.testingCampaignId)) return null;
    return {
      ...parsed,
      winnerOfferIds: Array.isArray(parsed.winnerOfferIds)
        ? parsed.winnerOfferIds.filter((id) => Number.isInteger(id) && id > 0)
        : [],
    };
  } catch {
    return null;
  }
}

export function winnerHandoffHumanDescription(description: string | null | undefined): string | null {
  if (!description?.trim()) return null;
  const markerIdx = description.indexOf(WINNER_HANDOFF_CONTEXT_MARKER);
  if (markerIdx < 0) return description.trim();
  const human = description.slice(0, markerIdx).trim();
  return human || null;
}
