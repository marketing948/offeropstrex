import { and, eq } from "drizzle-orm";
import { campaignsTable, db, testingBatchesTable } from "@workspace/db";
import type { checkWorkspaceAccess } from "./workspace-access.ts";
import { testingBatchJoin } from "./live-campaign-scope.ts";

type AccessResult = Extract<Awaited<ReturnType<typeof checkWorkspaceAccess>>, { allowed: true }>;

export class CampaignDailyMetricsError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "CampaignDailyMetricsError";
  }
}

/** Returns campaign row when the actor may record metrics for it in this workspace. */
export async function assertCanUpsertCampaignDailyMetrics(
  access: AccessResult,
  workspaceId: number,
  campaignId: number,
): Promise<typeof campaignsTable.$inferSelect> {
  const [row] = await db
    .select({ campaign: campaignsTable })
    .from(campaignsTable)
    .leftJoin(testingBatchesTable, testingBatchJoin(workspaceId))
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.workspaceId, workspaceId)))
    .limit(1);

  if (!row?.campaign) {
    throw new CampaignDailyMetricsError("Campaign not found", 404);
  }

  const campaign = row.campaign;
  if (access.employee.role === "admin") {
    return campaign;
  }

  if (campaign.campaignPurpose === "working" || campaign.campaignPurpose === "scaling") {
    return campaign;
  }

  const [batch] =
    campaign.batchId != null
      ? await db
          .select({ employeeId: testingBatchesTable.employeeId })
          .from(testingBatchesTable)
          .where(
            and(
              eq(testingBatchesTable.id, campaign.batchId),
              eq(testingBatchesTable.workspaceId, workspaceId),
            ),
          )
          .limit(1)
      : [undefined];

  if (batch?.employeeId === access.employee.id) {
    return campaign;
  }

  throw new CampaignDailyMetricsError("Not allowed to record metrics for this campaign", 403);
}
