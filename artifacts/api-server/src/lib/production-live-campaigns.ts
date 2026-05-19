import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  affiliateNetworksTable,
  campaignsTable,
  db,
  workspaceTrafficSourcesTable,
} from "@workspace/db";

export const PRODUCTION_CAMPAIGN_PURPOSES = ["working", "scaling"] as const;
export type ProductionCampaignPurpose = (typeof PRODUCTION_CAMPAIGN_PURPOSES)[number];

export type CreateProductionLiveCampaignInput = {
  workspaceId: number;
  campaignName: string;
  campaignPurpose: ProductionCampaignPurpose;
  platform: "ios" | "android";
  trafficSourceId: number;
  voluumCampaignId: string;
  campaignUrl: string;
  affiliateNetworkId?: number | null;
  geo?: string | null;
  parentCampaignId?: number | null;
  notes?: string | null;
};

type Db = Pick<NodePgDatabase, "select" | "insert">;

export async function assertProductionLiveCampaignPrerequisites(
  input: CreateProductionLiveCampaignInput,
  client: Db = db,
): Promise<void> {
  const voluumCampaignId = input.voluumCampaignId.trim();
  if (!voluumCampaignId) {
    throw new Error("voluumCampaignId is required");
  }
  if (!input.campaignUrl.trim()) {
    throw new Error("campaignUrl is required");
  }

  if (input.campaignPurpose === "scaling" && input.parentCampaignId == null) {
    throw new Error("parentCampaignId is required for scaling campaigns");
  }

  const [trafficSource] = await client
    .select({ id: workspaceTrafficSourcesTable.id })
    .from(workspaceTrafficSourcesTable)
    .where(
      and(
        eq(workspaceTrafficSourcesTable.id, input.trafficSourceId),
        eq(workspaceTrafficSourcesTable.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!trafficSource) {
    throw new Error("trafficSourceId does not belong to this workspace");
  }

  if (input.affiliateNetworkId != null) {
    const [network] = await client
      .select({ id: affiliateNetworksTable.id })
      .from(affiliateNetworksTable)
      .where(
        and(
          eq(affiliateNetworksTable.id, input.affiliateNetworkId),
          eq(affiliateNetworksTable.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (!network) {
      throw new Error("affiliateNetworkId does not belong to this workspace");
    }
  }

  if (input.parentCampaignId != null) {
    const [parent] = await client
      .select({
        id: campaignsTable.id,
        campaignPurpose: campaignsTable.campaignPurpose,
      })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.id, input.parentCampaignId),
          eq(campaignsTable.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (!parent) {
      throw new Error("parentCampaignId not found in this workspace");
    }
    if (input.campaignPurpose === "scaling" && parent.campaignPurpose !== "working") {
      throw new Error("parentCampaignId must reference a working campaign");
    }
  }

  const [existingVoluum] = await client
    .select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(
      and(
        eq(campaignsTable.workspaceId, input.workspaceId),
        eq(campaignsTable.voluumCampaignId, voluumCampaignId),
      ),
    )
    .limit(1);
  if (existingVoluum) {
    throw new Error(
      `Voluum campaign ID "${voluumCampaignId}" is already linked to another campaign in this workspace`,
    );
  }
}

export async function insertProductionLiveCampaign(
  input: CreateProductionLiveCampaignInput,
  client: Db = db,
): Promise<typeof campaignsTable.$inferSelect> {
  const voluumCampaignId = input.voluumCampaignId.trim();
  const now = new Date();

  const [row] = await client
    .insert(campaignsTable)
    .values({
      workspaceId: input.workspaceId,
      batchId: null,
      platform: input.platform,
      campaignName: input.campaignName.trim(),
      trafficSourceId: input.trafficSourceId,
      campaignUrl: input.campaignUrl.trim(),
      voluumCampaignId,
      voluumCampaignName: input.campaignName.trim(),
      status: "live",
      campaignPurpose: input.campaignPurpose,
      parentCampaignId: input.parentCampaignId ?? null,
      affiliateNetworkId: input.affiliateNetworkId ?? null,
      geo: input.geo?.trim() || null,
      notes: input.notes?.trim() || null,
      liveStartedAt: now,
    })
    .returning();

  return row!;
}

export function isProductionCampaignPurpose(
  purpose: string,
): purpose is ProductionCampaignPurpose {
  return purpose === "working" || purpose === "scaling";
}
