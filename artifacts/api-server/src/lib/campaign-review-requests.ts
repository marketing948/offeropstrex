import { and, desc, eq, inArray } from "drizzle-orm";
import { db, operationalEventsTable } from "@workspace/db";

export const CAMPAIGN_REVIEW_REQUESTED = "CAMPAIGN_REVIEW_REQUESTED";
export const CAMPAIGN_REVIEW_RESOLVED = "CAMPAIGN_REVIEW_RESOLVED";

export type OpenCampaignReviewRequest = {
  eventId: number;
  campaignId: number;
  campaignName: string;
  note: string;
  requestedByEmployeeId: number | null;
  createdAt: string;
};

function payloadNote(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const note = (payload as { note?: unknown }).note;
  return typeof note === "string" ? note : "";
}

function payloadCampaignName(payload: unknown, campaignId: number): string {
  if (!payload || typeof payload !== "object") return `Campaign #${campaignId}`;
  const name = (payload as { campaignName?: unknown }).campaignName;
  return typeof name === "string" && name.trim() ? name : `Campaign #${campaignId}`;
}

/** Latest open manual review requests per campaign (persisted in operational_events). */
export async function getOpenCampaignReviewRequests(
  workspaceId: number,
): Promise<OpenCampaignReviewRequest[]> {
  const rows = await db
    .select()
    .from(operationalEventsTable)
    .where(
      and(
        eq(operationalEventsTable.workspaceId, workspaceId),
        eq(operationalEventsTable.entityType, "campaign"),
        inArray(operationalEventsTable.eventType, [
          CAMPAIGN_REVIEW_REQUESTED,
          CAMPAIGN_REVIEW_RESOLVED,
        ]),
      ),
    )
    .orderBy(desc(operationalEventsTable.createdAt));

  const latestByCampaign = new Map<number, (typeof rows)[0]>();
  for (const row of rows) {
    const campaignId = Number(row.entityId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) continue;
    if (!latestByCampaign.has(campaignId)) latestByCampaign.set(campaignId, row);
  }

  const open: OpenCampaignReviewRequest[] = [];
  for (const [campaignId, row] of latestByCampaign) {
    if (row.eventType !== CAMPAIGN_REVIEW_REQUESTED) continue;
    open.push({
      eventId: row.id,
      campaignId,
      campaignName: payloadCampaignName(row.payloadJson, campaignId),
      note: payloadNote(row.payloadJson),
      requestedByEmployeeId: row.actorId ? Number(row.actorId) : null,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return open;
}

export async function hasOpenCampaignReviewRequest(
  workspaceId: number,
  campaignId: number,
): Promise<boolean> {
  const open = await getOpenCampaignReviewRequests(workspaceId);
  return open.some((r) => r.campaignId === campaignId);
}

export async function requestCampaignReview(params: {
  workspaceId: number;
  campaignId: number;
  campaignName: string;
  note: string;
  actorEmployeeId: number;
}): Promise<{ created: boolean; eventId: number }> {
  const existing = (await getOpenCampaignReviewRequests(params.workspaceId)).find(
    (r) => r.campaignId === params.campaignId,
  );
  if (existing) {
    return { created: false, eventId: existing.eventId };
  }

  const [event] = await db
    .insert(operationalEventsTable)
    .values({
      workspaceId: params.workspaceId,
      entityType: "campaign",
      entityId: String(params.campaignId),
      eventType: CAMPAIGN_REVIEW_REQUESTED,
      actorType: "employee",
      actorId: String(params.actorEmployeeId),
      source: "live_campaigns",
      payloadJson: {
        note: params.note,
        campaignName: params.campaignName,
        status: "requires_review",
      },
    })
    .returning();

  return { created: true, eventId: event!.id };
}

export async function resolveCampaignReview(params: {
  workspaceId: number;
  campaignId: number;
  actorEmployeeId: number;
  resolution?: string;
}): Promise<void> {
  const open = await hasOpenCampaignReviewRequest(params.workspaceId, params.campaignId);
  if (!open) return;

  await db.insert(operationalEventsTable).values({
    workspaceId: params.workspaceId,
    entityType: "campaign",
    entityId: String(params.campaignId),
    eventType: CAMPAIGN_REVIEW_RESOLVED,
    actorType: "employee",
    actorId: String(params.actorEmployeeId),
    source: "campaign_review",
    payloadJson: { resolution: params.resolution ?? "resolved" },
  });
}
