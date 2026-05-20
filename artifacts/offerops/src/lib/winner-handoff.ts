import { coerceWinnerHandoffOfferIdsFromJson } from "@workspace/voluum-offer-ids";

export const WINNER_HANDOFF_CONTEXT_MARKER = "---offerops-winner-handoff---";

export type WinnerHandoffContext = {
  kind: "winners_found_manual_close";
  testingCampaignId: number;
  batchId: number | null;
  platform: "ios" | "android";
  trafficSourceId: number | null;
  targetWorkingCampaignId: number | null;
  missingWorkingCampaign: boolean;
  winnerOfferIds: string[];
  manualCloseReason: "winners_found";
};

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
      winnerOfferIds: coerceWinnerHandoffOfferIdsFromJson(parsed.winnerOfferIds),
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
