import { and, desc, eq } from "drizzle-orm";
import type { Request } from "express";
import type { Tx } from "../engine/types.ts";
import {
  campaignsTable,
  db,
  testingBatchesTable,
  todoTasksTable,
} from "@workspace/db";
import { applyAction } from "../engine/executor.ts";
import { checkWorkspaceAccess } from "./workspace-access.ts";
import { recordOperationalEvent } from "./operational-events.ts";
import { appendOperationalActivity } from "./operational-activity-feed.ts";
import {
  campaignClosedTitle,
  winnersAddedTitle,
} from "./operational-activity-titles.ts";
import { resolveCampaignDisplayName } from "./campaign-display-name.ts";
import { parseVoluumOfferIdsFromStrings } from "@workspace/voluum-offer-ids";
import { insertCampaignWinnersTx } from "./campaign-winners.ts";
import {
  buildWinnerHandoffDescription,
  buildWinnerHandoffTitle,
  type WinnerHandoffContext,
} from "./winner-handoff.ts";

export const MANUAL_CLOSE_REASONS = [
  "opened_by_mistake",
  "no_traffic_dead_campaign",
  "technical_issue",
  "winners_found",
] as const;

export type ManualCloseReason = (typeof MANUAL_CLOSE_REASONS)[number];

export type ManualCloseInput = {
  reason: ManualCloseReason;
  note?: string | null;
  winnerOfferIds?: string[] | null;
};

export type ManualCloseResult = {
  campaign: typeof campaignsTable.$inferSelect;
  followUpTaskIds: number[];
  missingWorkingCampaign: boolean;
  targetWorkingCampaignId: number | null;
};

export async function assertCanManualCloseCampaign(
  req: Request,
  campaign: typeof campaignsTable.$inferSelect,
  batchEmployeeId: number | null,
): Promise<{ id: number; role: string }> {
  const access = await checkWorkspaceAccess(req, campaign.workspaceId);
  if (!access.allowed) {
    throw new ManualCloseError(access.reason, access.status);
  }
  if (access.employee.role === "admin") {
    return access.employee;
  }
  if (campaign.campaignPurpose === "working" || campaign.campaignPurpose === "scaling") {
    return access.employee;
  }
  if (batchEmployeeId != null && batchEmployeeId === access.employee.id) {
    return access.employee;
  }
  throw new ManualCloseError(
    "Only an admin or the batch assignee can close this testing campaign",
    403,
  );
}

export class ManualCloseError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "ManualCloseError";
  }
}

async function findLiveWorkingCampaign(
  client: Tx,
  params: {
    workspaceId: number;
    affiliateNetworkId: number;
    geoId: number;
    trafficSourceId: number;
    platform: "ios" | "android";
  },
): Promise<number | null> {
  const [row] = await client
    .select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(
      and(
        eq(campaignsTable.workspaceId, params.workspaceId),
        eq(campaignsTable.campaignPurpose, "working"),
        eq(campaignsTable.status, "live"),
        eq(campaignsTable.affiliateNetworkId, params.affiliateNetworkId),
        eq(campaignsTable.geoId, params.geoId),
        eq(campaignsTable.trafficSourceId, params.trafficSourceId),
        eq(campaignsTable.platform, params.platform),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function resolveWorkingCampaignTarget(
  client: Tx,
  campaign: typeof campaignsTable.$inferSelect,
): Promise<number | null> {
  if (campaign.campaignPurpose === "scaling" && campaign.parentCampaignId != null) {
    const [parent] = await client
      .select({ id: campaignsTable.id, campaignPurpose: campaignsTable.campaignPurpose })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.id, campaign.parentCampaignId),
          eq(campaignsTable.workspaceId, campaign.workspaceId),
        ),
      )
      .limit(1);
    if (parent?.campaignPurpose === "working") {
      return parent.id;
    }
  }

  if (campaign.batchId != null) {
    const [batch] = await client
      .select({
        affiliateNetworkId: testingBatchesTable.affiliateNetworkId,
        geoId: testingBatchesTable.geoId,
      })
      .from(testingBatchesTable)
      .where(
        and(
          eq(testingBatchesTable.id, campaign.batchId),
          eq(testingBatchesTable.workspaceId, campaign.workspaceId),
        ),
      )
      .limit(1);
    if (
      batch?.affiliateNetworkId != null &&
      batch.geoId != null &&
      campaign.trafficSourceId != null
    ) {
      return findLiveWorkingCampaign(client, {
        workspaceId: campaign.workspaceId,
        affiliateNetworkId: batch.affiliateNetworkId,
        geoId: batch.geoId,
        trafficSourceId: campaign.trafficSourceId,
        platform: campaign.platform,
      });
    }
    return null;
  }

  if (
    campaign.campaignPurpose === "working" &&
    campaign.affiliateNetworkId != null &&
    campaign.geoId != null &&
    campaign.trafficSourceId != null
  ) {
    return findLiveWorkingCampaign(client, {
      workspaceId: campaign.workspaceId,
      affiliateNetworkId: campaign.affiliateNetworkId,
      geoId: campaign.geoId,
      trafficSourceId: campaign.trafficSourceId,
      platform: campaign.platform,
    });
  }

  return null;
}

function platformRunOutcome(reason: ManualCloseReason): "completed" | "failed" {
  return reason === "winners_found" ? "completed" : "failed";
}

export async function manualCloseCampaign(
  campaign: typeof campaignsTable.$inferSelect,
  actorId: number,
  input: ManualCloseInput,
): Promise<ManualCloseResult> {
  if (campaign.status === "closed") {
    throw new ManualCloseError("Campaign is already closed", 409);
  }

  let winnerVoluumIds: string[] = [];
  if (input.reason === "winners_found") {
    const idParse = parseVoluumOfferIdsFromStrings(input.winnerOfferIds ?? null);
    if ("error" in idParse) throw new ManualCloseError(idParse.error, 400);
    winnerVoluumIds = idParse.ok;
  }

  const now = new Date();
  const followUpTaskIds: number[] = [];
  let missingWorkingCampaign = false;
  let targetWorkingCampaignId: number | null = null;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(campaignsTable)
      .set({
        status: "closed",
        closeSource: "manual",
        manualCloseReason: input.reason,
        manualCloseNote: input.note?.trim() || null,
        manualClosedAt: now,
        manualClosedByEmployeeId: actorId,
        updatedAt: now,
      })
      .where(
        and(
          eq(campaignsTable.id, campaign.id),
          eq(campaignsTable.workspaceId, campaign.workspaceId),
        ),
      )
      .returning();

    if (!row) {
      throw new ManualCloseError("Campaign not found", 404);
    }

    if (
      row.campaignPurpose === "testing" &&
      row.batchId != null &&
      row.trafficSourceId != null
    ) {
      await applyAction(
        {
          type: "CompleteTrafficSourceRunPlatform",
          workspaceId: row.workspaceId,
          batchId: row.batchId,
          trafficSourceId: row.trafficSourceId,
          platform: row.platform,
          campaignId: row.id,
          outcome: platformRunOutcome(input.reason),
          failureReason:
            input.reason === "winners_found"
              ? null
              : `manual_close:${input.reason}`,
        },
        tx,
      );
    }

    if (input.reason === "winners_found") {
      const [batch] =
        row.batchId != null
          ? await tx
              .select({
                employeeId: testingBatchesTable.employeeId,
                batchName: testingBatchesTable.batchName,
              })
              .from(testingBatchesTable)
              .where(eq(testingBatchesTable.id, row.batchId))
              .limit(1)
          : [undefined];

      targetWorkingCampaignId = await resolveWorkingCampaignTarget(tx, row);
      missingWorkingCampaign = targetWorkingCampaignId == null;

      const assigneeId = batch?.employeeId ?? actorId;

      if (winnerVoluumIds.length > 0) {
        await insertCampaignWinnersTx(tx, {
          workspaceId: row.workspaceId,
          batchId: row.batchId,
          campaignId: row.id,
          trafficSourceId: row.trafficSourceId,
          platform: row.platform,
          offerIds: winnerVoluumIds,
          source: "manual_close",
          detectedByEmployeeId: actorId,
          notes: input.note?.trim() || null,
        });
        const winnerDisplayName = resolveCampaignDisplayName({
          campaignName: row.campaignName,
          batchName: batch?.batchName,
          platform: row.platform,
        });
        await appendOperationalActivity(tx, {
          workspaceId: row.workspaceId,
          eventType: "winner_added",
          entityType: "campaign",
          entityId: row.id,
          actorEmployeeId: actorId,
          title: winnersAddedTitle(winnerDisplayName, winnerVoluumIds.length),
          metadata: { offerIds: winnerVoluumIds, source: "manual_close" },
        });
      }

      const displayName = resolveCampaignDisplayName({
        campaignName: row.campaignName,
        batchName: batch?.batchName,
        platform: row.platform,
      });

      const handoffContext: WinnerHandoffContext = {
        kind: "winners_found_manual_close",
        testingCampaignId: row.id,
        batchId: row.batchId,
        platform: row.platform,
        trafficSourceId: row.trafficSourceId,
        targetWorkingCampaignId,
        missingWorkingCampaign,
        winnerOfferIds: winnerVoluumIds,
        manualCloseReason: input.reason,
      };

      const title = buildWinnerHandoffTitle({
        campaignName: displayName,
        missingWorkingCampaign,
      });

      const description = buildWinnerHandoffDescription({
        context: handoffContext,
        targetWorkingCampaignId,
        note: input.note,
      });

      await applyAction(
        {
          type: "CreateTask",
          workspaceId: row.workspaceId,
          data: {
            employeeId: assigneeId,
            relatedBatchId: row.batchId,
            relatedCampaignId: row.id,
            trafficSourceId: row.trafficSourceId,
            title,
            description,
            taskType: "MANUAL",
            priority: "high",
          },
        },
        tx,
      );

      const [createdFollowUp] = await tx
        .select({ id: todoTasksTable.id })
        .from(todoTasksTable)
        .where(
          and(
            eq(todoTasksTable.workspaceId, row.workspaceId),
            eq(todoTasksTable.relatedCampaignId, row.id),
            eq(todoTasksTable.taskType, "MANUAL"),
            eq(todoTasksTable.title, title),
          ),
        )
        .orderBy(desc(todoTasksTable.id))
        .limit(1);

      if (createdFollowUp) {
        followUpTaskIds.push(createdFollowUp.id);
      }
    }

    let closeBatchName: string | undefined;
    if (row.batchId != null) {
      const [closeBatch] = await tx
        .select({ batchName: testingBatchesTable.batchName })
        .from(testingBatchesTable)
        .where(eq(testingBatchesTable.id, row.batchId))
        .limit(1);
      closeBatchName = closeBatch?.batchName;
    }
    const closedDisplayName = resolveCampaignDisplayName({
      campaignName: row.campaignName,
      batchName: closeBatchName,
      platform: row.platform,
    });
    await appendOperationalActivity(tx, {
      workspaceId: row.workspaceId,
      eventType: "campaign_closed",
      entityType: "campaign",
      entityId: row.id,
      actorEmployeeId: actorId,
      title: campaignClosedTitle(closedDisplayName, input.reason),
      description: input.note?.trim() || null,
      metadata: { reason: input.reason },
    });

    return row;
  });

  await recordOperationalEvent({
    workspaceId: updated.workspaceId,
    entityType: "campaign",
    entityId: updated.id,
    eventType: "CAMPAIGN_MANUALLY_CLOSED",
    actorType: "employee",
    actorId,
    source: "routes.campaigns.manual-close",
    payloadJson: {
      campaignId: updated.id,
      workspaceId: updated.workspaceId,
      batchId: updated.batchId,
      campaignPurpose: updated.campaignPurpose,
      platform: updated.platform,
      trafficSourceId: updated.trafficSourceId,
      reason: input.reason,
      winnerOfferIds: input.reason === "winners_found" ? winnerVoluumIds : undefined,
      followUpTaskIds,
      missingWorkingCampaign,
      targetWorkingCampaignId,
    },
  });

  return {
    campaign: updated,
    followUpTaskIds,
    missingWorkingCampaign,
    targetWorkingCampaignId,
  };
}
