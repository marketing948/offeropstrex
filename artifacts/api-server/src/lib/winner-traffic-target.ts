import { and, eq, inArray, or } from "drizzle-orm";
import {
  batchTrafficSourceRunsTable,
  campaignsTable,
  testingBatchesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import type { Tx } from "../engine/types.ts";
import { applyAction } from "../engine/executor.ts";
import { formatReviewWinnersTitle } from "./campaign-display-name.ts";

/**
 * After `campaigns.clicks` is updated for a testing campaign, optionally
 * transition the batch × traffic-source run to `ready_for_winner_review`
 * and enqueue a single `review_winners_target` task (idempotent).
 */
export async function maybeMarkRunReadyForWinnerReview(
  tx: Tx,
  workspaceId: number,
  updatedCampaignId: number,
): Promise<void> {
  const [c] = await tx
    .select({
      id: campaignsTable.id,
      workspaceId: campaignsTable.workspaceId,
      batchId: campaignsTable.batchId,
      trafficSourceId: campaignsTable.trafficSourceId,
      campaignPurpose: campaignsTable.campaignPurpose,
      status: campaignsTable.status,
    })
    .from(campaignsTable)
    .where(
      and(eq(campaignsTable.id, updatedCampaignId), eq(campaignsTable.workspaceId, workspaceId)),
    )
    .limit(1);

  if (!c || c.campaignPurpose !== "testing" || c.batchId == null || c.trafficSourceId == null) {
    return;
  }
  if (c.status !== "live") return;

  const [run] = await tx
    .select({
      id: batchTrafficSourceRunsTable.id,
      targetAvgVisitsPerOffer: batchTrafficSourceRunsTable.targetAvgVisitsPerOffer,
      offerCount: batchTrafficSourceRunsTable.offerCount,
      status: batchTrafficSourceRunsTable.status,
      iosCampaignId: batchTrafficSourceRunsTable.iosCampaignId,
      androidCampaignId: batchTrafficSourceRunsTable.androidCampaignId,
    })
    .from(batchTrafficSourceRunsTable)
    .where(
      and(
        eq(batchTrafficSourceRunsTable.workspaceId, workspaceId),
        eq(batchTrafficSourceRunsTable.batchId, c.batchId),
        eq(batchTrafficSourceRunsTable.trafficSourceId, c.trafficSourceId),
        eq(batchTrafficSourceRunsTable.status, "active"),
        or(
          eq(batchTrafficSourceRunsTable.iosCampaignId, c.id),
          eq(batchTrafficSourceRunsTable.androidCampaignId, c.id),
        ),
      ),
    )
    .limit(1);

  if (
    !run
    || run.targetAvgVisitsPerOffer == null
    || run.targetAvgVisitsPerOffer <= 0
    || run.offerCount == null
    || run.offerCount <= 0
  ) {
    return;
  }

  const targetTotal = run.offerCount * run.targetAvgVisitsPerOffer;
  const campaignIds = [run.iosCampaignId, run.androidCampaignId].filter((id): id is number => id != null);
  if (campaignIds.length === 0) return;

  const rows = await tx
    .select({
      id: campaignsTable.id,
      clicks: campaignsTable.clicks,
      status: campaignsTable.status,
    })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.workspaceId, workspaceId), inArray(campaignsTable.id, campaignIds)));

  if (rows.length !== campaignIds.length) return;
  for (const r of rows) {
    if (r.status !== "live") return;
  }

  const sumClicks = rows.reduce((acc, r) => acc + Number(r.clicks ?? 0), 0);
  if (sumClicks < targetTotal) return;

  const [batch] = await tx
    .select({
      employeeId: testingBatchesTable.employeeId,
      batchName: testingBatchesTable.batchName,
    })
    .from(testingBatchesTable)
    .where(
      and(eq(testingBatchesTable.id, c.batchId), eq(testingBatchesTable.workspaceId, workspaceId)),
    )
    .limit(1);
  if (batch?.employeeId == null) return;

  const [ts] = await tx
    .select({ name: workspaceTrafficSourcesTable.name })
    .from(workspaceTrafficSourcesTable)
    .where(
      and(
        eq(workspaceTrafficSourcesTable.id, c.trafficSourceId),
        eq(workspaceTrafficSourcesTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  const batchLabel = batch.batchName?.trim() || `Batch #${c.batchId}`;
  const title = formatReviewWinnersTitle(batchLabel, ts?.name ?? "");

  for (const row of rows) {
    await applyAction(
      {
        type: "UpdateCampaignStatus",
        workspaceId,
        campaignId: row.id,
        from: "live",
        to: "ready_for_winner_review",
      },
      tx,
    );
  }

  await applyAction(
    {
      type: "CreateTask",
      workspaceId,
      data: {
        employeeId: batch.employeeId,
        relatedBatchId: c.batchId,
        relatedCampaignId: null,
        title,
        taskType: "review_winners_target",
        priority: "high",
        trafficSourceId: c.trafficSourceId,
      },
    },
    tx,
  );
}
