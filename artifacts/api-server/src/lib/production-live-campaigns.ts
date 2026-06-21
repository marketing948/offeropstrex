import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  affiliateNetworksTable,
  campaignsTable,
  db,
  geosTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";

export const PRODUCTION_CAMPAIGN_PURPOSES = ["testing", "working", "scaling"] as const;
export type ProductionCampaignPurpose = (typeof PRODUCTION_CAMPAIGN_PURPOSES)[number];

/**
 * Future winner-transfer matching (testing → working), derived without denormalizing
 * testing campaigns yet:
 * - affiliateNetworkId: testing_batches.affiliate_network_id (fallback: resolve name from batch.affiliate_network)
 * - geoId / geo: testing_batches.geo_id → geos.code, or normalized testing_batches.geo text
 * - trafficSourceId: campaigns.traffic_source_id on the testing campaign row
 * - platform: campaigns.platform on the testing campaign row
 * Working campaigns must use the same tuple on campaigns.affiliate_network_id, geo_id, traffic_source_id, platform.
 */
export type CreateProductionLiveCampaignInput = {
  workspaceId: number;
  campaignName: string;
  campaignPurpose: ProductionCampaignPurpose;
  platform?: "ios" | "android";
  trafficSourceId?: number;
  voluumCampaignId: string;
  campaignUrl: string;
  affiliateNetworkId?: number | null;
  geoId?: number | null;
  geo?: string | null;
  parentCampaignId?: number | null;
  notes?: string | null;
};

export type ResolvedProductionLiveCampaign = {
  workspaceId: number;
  campaignName: string;
  campaignPurpose: ProductionCampaignPurpose;
  platform: "ios" | "android";
  trafficSourceId: number;
  voluumCampaignId: string;
  campaignUrl: string;
  affiliateNetworkId: number;
  geoId: number;
  geo: string;
  parentCampaignId: number | null;
  notes: string | null;
};

type Db = Pick<NodePgDatabase, "select" | "insert">;

export function normalizeGeoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export async function resolveProductionLiveCampaign(
  input: CreateProductionLiveCampaignInput,
  client: Db = db,
): Promise<ResolvedProductionLiveCampaign> {
  const voluumCampaignId = input.voluumCampaignId.trim();
  if (!voluumCampaignId) {
    throw new Error("voluumCampaignId is required");
  }
  const campaignUrl = input.campaignUrl.trim();
  if (!campaignUrl) {
    throw new Error("campaignUrl is required");
  }

  if (input.campaignPurpose === "scaling") {
    if (input.parentCampaignId == null) {
      throw new Error("parentCampaignId is required for scaling campaigns");
    }
    const [parent] = await client
      .select({
        id: campaignsTable.id,
        campaignPurpose: campaignsTable.campaignPurpose,
        platform: campaignsTable.platform,
        trafficSourceId: campaignsTable.trafficSourceId,
        affiliateNetworkId: campaignsTable.affiliateNetworkId,
        geoId: campaignsTable.geoId,
        geo: campaignsTable.geo,
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
    if (parent.campaignPurpose !== "working") {
      throw new Error("parentCampaignId must reference a working campaign");
    }
    if (
      parent.trafficSourceId == null ||
      parent.affiliateNetworkId == null ||
      parent.geoId == null
    ) {
      throw new Error("parent working campaign is missing slot metadata");
    }

    if (input.platform != null && input.platform !== parent.platform) {
      throw new Error("scaling campaign platform must match parent working campaign");
    }
    if (input.trafficSourceId != null && input.trafficSourceId !== parent.trafficSourceId) {
      throw new Error("scaling campaign trafficSourceId must match parent working campaign");
    }
    if (
      input.affiliateNetworkId != null &&
      input.affiliateNetworkId !== parent.affiliateNetworkId
    ) {
      throw new Error("scaling campaign affiliateNetworkId must match parent working campaign");
    }
    if (input.geoId != null && input.geoId !== parent.geoId) {
      throw new Error("scaling campaign geoId must match parent working campaign");
    }
    if (input.geo != null && parent.geo != null) {
      const normalized = normalizeGeoCode(input.geo);
      if (normalized !== parent.geo) {
        throw new Error("scaling campaign geo must match parent working campaign");
      }
    }

    return {
      workspaceId: input.workspaceId,
      campaignName: input.campaignName.trim(),
      campaignPurpose: "scaling",
      platform: parent.platform,
      trafficSourceId: parent.trafficSourceId,
      voluumCampaignId,
      campaignUrl,
      affiliateNetworkId: parent.affiliateNetworkId,
      geoId: parent.geoId,
      geo: parent.geo ?? "",
      parentCampaignId: parent.id,
      notes: input.notes?.trim() || null,
    };
  }

  if (input.affiliateNetworkId == null) {
    throw new Error("affiliateNetworkId is required for working and test campaigns");
  }
  if (input.trafficSourceId == null) {
    throw new Error("trafficSourceId is required for working and test campaigns");
  }
  if (input.platform == null) {
    throw new Error("platform is required for working and test campaigns");
  }
  if (input.campaignPurpose !== "working" && input.campaignPurpose !== "testing") {
    throw new Error("campaignPurpose must be working or testing for non-scaling campaigns");
  }

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

  let geoId = input.geoId ?? null;
  if (geoId == null && input.geo != null && input.geo.trim() !== "") {
    const code = normalizeGeoCode(input.geo);
    const [byCode] = await client
      .select({ id: geosTable.id, code: geosTable.code })
      .from(geosTable)
      .where(
        and(eq(geosTable.workspaceId, input.workspaceId), eq(geosTable.code, code)),
      )
      .limit(1);
    if (!byCode) {
      throw new Error("geo must match a workspace GEO code, or provide geoId");
    }
    geoId = byCode.id;
  }
  if (geoId == null) {
    throw new Error("geoId is required for working and test campaigns");
  }

  const [geoRow] = await client
    .select({ id: geosTable.id, code: geosTable.code })
    .from(geosTable)
    .where(
      and(eq(geosTable.id, geoId), eq(geosTable.workspaceId, input.workspaceId)),
    )
    .limit(1);
  if (!geoRow) {
    throw new Error("geoId does not belong to this workspace");
  }

  return {
    workspaceId: input.workspaceId,
    campaignName: input.campaignName.trim(),
    campaignPurpose: input.campaignPurpose,
    platform: input.platform,
    trafficSourceId: input.trafficSourceId,
    voluumCampaignId,
    campaignUrl,
    affiliateNetworkId: input.affiliateNetworkId,
    geoId: geoRow.id,
    geo: normalizeGeoCode(geoRow.code),
    parentCampaignId: null,
    notes: input.notes?.trim() || null,
  };
}

export async function assertProductionLiveCampaignPrerequisites(
  input: CreateProductionLiveCampaignInput,
  client: Db = db,
): Promise<ResolvedProductionLiveCampaign> {
  const resolved = await resolveProductionLiveCampaign(input, client);

  const [existingVoluum] = await client
    .select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(
      and(
        eq(campaignsTable.workspaceId, resolved.workspaceId),
        eq(campaignsTable.voluumCampaignId, resolved.voluumCampaignId),
      ),
    )
    .limit(1);
  if (existingVoluum) {
    throw new Error(
      `Voluum campaign ID "${resolved.voluumCampaignId}" is already linked to another campaign in this workspace`,
    );
  }

  if (resolved.campaignPurpose === "working") {
    const [existingSlot] = await client
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.workspaceId, resolved.workspaceId),
          eq(campaignsTable.campaignPurpose, "working"),
          eq(campaignsTable.status, "live"),
          eq(campaignsTable.affiliateNetworkId, resolved.affiliateNetworkId),
          eq(campaignsTable.geoId, resolved.geoId),
          eq(campaignsTable.trafficSourceId, resolved.trafficSourceId),
          eq(campaignsTable.platform, resolved.platform),
        ),
      )
      .limit(1);
    if (existingSlot) {
      throw new Error(
        "A live working campaign already exists for this affiliate network, GEO, traffic source, and platform",
      );
    }
  }

  return resolved;
}

export async function insertProductionLiveCampaign(
  resolved: ResolvedProductionLiveCampaign,
  client: Db = db,
): Promise<typeof campaignsTable.$inferSelect> {
  const now = new Date();

  const [row] = await client
    .insert(campaignsTable)
    .values({
      workspaceId: resolved.workspaceId,
      batchId: null,
      platform: resolved.platform,
      campaignName: resolved.campaignName,
      trafficSourceId: resolved.trafficSourceId,
      campaignUrl: resolved.campaignUrl,
      voluumCampaignId: resolved.voluumCampaignId,
      voluumCampaignName: resolved.campaignName,
      status: "live",
      campaignPurpose: resolved.campaignPurpose,
      parentCampaignId: resolved.parentCampaignId,
      affiliateNetworkId: resolved.affiliateNetworkId,
      geoId: resolved.geoId,
      geo: resolved.geo,
      notes: resolved.notes,
      liveStartedAt: now,
    })
    .returning();

  return row!;
}

export function isProductionCampaignPurpose(
  purpose: string,
): purpose is ProductionCampaignPurpose {
  return purpose === "testing" || purpose === "working" || purpose === "scaling";
}
