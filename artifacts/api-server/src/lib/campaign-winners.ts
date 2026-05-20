import { and, eq, inArray } from "drizzle-orm";
import { campaignWinnersTable, testingBatchesTable } from "@workspace/db";
import { VOLUUM_OFFER_ID_UUID_REGEX } from "@workspace/voluum-offer-ids";
import type { Tx } from "../engine/types.ts";

export type CampaignWinnerSource = "manual_close" | "target_reached_review";

/** Idempotent inserts — duplicate (workspace, campaign, offer) rows are skipped. */
export async function insertCampaignWinnersTx(
  tx: Tx,
  params: {
    workspaceId: number;
    batchId: number | null;
    campaignId: number;
    trafficSourceId: number | null;
    platform: "ios" | "android";
    offerIds: string[];
    source: CampaignWinnerSource;
    detectedByEmployeeId: number;
    notes?: string | null;
  },
): Promise<void> {
  const uniq = [...new Set(params.offerIds)].filter(
    (id) => typeof id === "string" && id.length > 0 && VOLUUM_OFFER_ID_UUID_REGEX.test(id),
  );
  if (uniq.length === 0) return;

  const existing = await tx
    .select({ offerId: campaignWinnersTable.offerId })
    .from(campaignWinnersTable)
    .where(
      and(
        eq(campaignWinnersTable.workspaceId, params.workspaceId),
        eq(campaignWinnersTable.campaignId, params.campaignId),
        inArray(campaignWinnersTable.offerId, uniq),
      ),
    );
  const have = new Set(existing.map((r) => r.offerId));
  const toInsert = uniq.filter((id) => !have.has(id));
  if (toInsert.length === 0) return;

  await tx.insert(campaignWinnersTable).values(
    toInsert.map((offerId) => ({
      workspaceId: params.workspaceId,
      batchId: params.batchId,
      campaignId: params.campaignId,
      trafficSourceId: params.trafficSourceId,
      platform: params.platform,
      offerId,
      source: params.source,
      detectedByEmployeeId: params.detectedByEmployeeId,
      notes: params.notes ?? null,
    })),
  );
}

export async function loadBatchNameForCampaign(
  tx: Tx,
  batchId: number | null,
  workspaceId: number,
): Promise<string | null> {
  if (batchId == null) return null;
  const [b] = await tx
    .select({ batchName: testingBatchesTable.batchName })
    .from(testingBatchesTable)
    .where(and(eq(testingBatchesTable.id, batchId), eq(testingBatchesTable.workspaceId, workspaceId)))
    .limit(1);
  return b?.batchName ?? null;
}
