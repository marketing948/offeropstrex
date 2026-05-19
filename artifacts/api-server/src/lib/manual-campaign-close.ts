import { and, eq } from "drizzle-orm";
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
  winnerOfferIds?: number[] | null;
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
      const winnerIds =
        input.winnerOfferIds?.filter((id) => Number.isInteger(id) && id > 0) ?? [];

      const taskPayload = {
        kind: "winners_found_manual_close",
        campaignId: row.id,
        batchId: row.batchId,
        platform: row.platform,
        trafficSourceId: row.trafficSourceId,
        targetWorkingCampaignId,
        missingWorkingCampaign,
        winnerOfferIds: winnerIds,
        manualCloseReason: input.reason,
      };

      const title = missingWorkingCampaign
        ? `Create working campaign for winners (${row.campaignName})`
        : `Move winners to working campaign (${row.campaignName})`;

      const descriptionLines = [
        missingWorkingCampaign
          ? "No live working campaign matches this slot. Create the working campaign, then complete winner transfer in Voluum manually."
          : `Target working campaign #${targetWorkingCampaignId}. Add winner offers in Voluum manually — no automatic transfer.`,
        winnerIds.length > 0
          ? `Winner offer IDs: ${winnerIds.join(", ")}`
          : "Record winner offer IDs when completing this task.",
        input.note?.trim() ? `Note: ${input.note.trim()}` : null,
      ].filter(Boolean);

      const [task] = await tx
        .insert(todoTasksTable)
        .values({
          workspaceId: row.workspaceId,
          employeeId: assigneeId,
          relatedBatchId: row.batchId,
          relatedCampaignId: row.id,
          trafficSourceId: row.trafficSourceId,
          title,
          description: `${descriptionLines.join("\n")}\n\n${JSON.stringify(taskPayload)}`,
          taskType: "MANUAL",
          priority: "high",
          status: "TODO",
        })
        .returning({ id: todoTasksTable.id });

      if (task) {
        followUpTaskIds.push(task.id);
      }
    }

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
