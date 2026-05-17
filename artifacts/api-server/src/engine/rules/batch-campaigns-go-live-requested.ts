import type { Action, EventInput, Tx } from "../types.ts";

type BatchCampaignsGoLiveRequestedEvent = Extract<
  EventInput,
  { type: "BatchCampaignsGoLiveRequested" }
>;

export function handleBatchCampaignsGoLiveRequested(
  event: BatchCampaignsGoLiveRequestedEvent,
  _tx: Tx,
): Action[] {
  return [
    {
      type: "GoLiveBatchCampaigns",
      workspaceId: event.workspaceId,
      batchId: event.payload.batchId,
    },
  ];
}
