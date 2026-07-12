import { and, desc, eq, inArray } from "drizzle-orm";
import { db, operationalEventsTable } from "@workspace/db";

export const CAMPAIGN_REVIEW_REQUESTED = "CAMPAIGN_REVIEW_REQUESTED";
export const CAMPAIGN_REVIEW_RESOLVED = "CAMPAIGN_REVIEW_RESOLVED";
export const CAMPAIGN_REVIEW_NOTE_UPDATED = "CAMPAIGN_REVIEW_NOTE_UPDATED";
export const CAMPAIGN_MARKED_REVIEWED = "CAMPAIGN_MARKED_REVIEWED";
export const CAMPAIGN_REVIEW_DISMISSED = "CAMPAIGN_REVIEW_DISMISSED";

export type OpenCampaignReviewRequest = {
  eventId: number;
  campaignId: number;
  campaignName: string;
  note: string;
  requestedByEmployeeId: number | null;
  createdAt: string;
};

export type CampaignReviewedMarker = {
  campaignId: number;
  reviewedAt: string;
  reviewedByEmployeeId: number | null;
};

export type ReviewDismissal = {
  campaignId: number;
  dismissedAt: string;
  dismissedByEmployeeId: number | null;
};

function payloadNote(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const note = (payload as { note?: unknown }).note;
  return typeof note === "string" ? note : "";
}

/**
 * Deterministically resolve the latest review note for a campaign.
 *
 * Considers both the original request note and any note updates, and always
 * returns the note from the most recent event (ties broken by higher event id
 * when present). Order of the input rows does not matter, so display order is
 * never ambiguous after refresh. An explicit empty string (cleared note) is a
 * valid, returned value.
 *
 * Exported for unit testing without a database.
 */
export function selectLatestReviewNote(
  rows: Array<{
    eventType: string;
    payloadJson: unknown;
    createdAt: Date;
    id?: number;
  }>,
): string {
  const noteRows = rows.filter(
    (r) =>
      r.eventType === CAMPAIGN_REVIEW_NOTE_UPDATED ||
      r.eventType === CAMPAIGN_REVIEW_REQUESTED,
  );
  if (noteRows.length === 0) return "";
  noteRows.sort((a, b) => {
    const t = b.createdAt.getTime() - a.createdAt.getTime();
    if (t !== 0) return t;
    return (b.id ?? 0) - (a.id ?? 0);
  });
  return payloadNote(noteRows[0]!.payloadJson);
}

function latestNoteForCampaign(
  rows: Array<{
    eventType: string;
    payloadJson: unknown;
    createdAt: Date;
    id?: number;
  }>,
): string {
  return selectLatestReviewNote(rows);
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
          CAMPAIGN_REVIEW_NOTE_UPDATED,
        ]),
      ),
    )
    .orderBy(desc(operationalEventsTable.createdAt));

  // Openness is decided ONLY by the latest REQUESTED vs RESOLVED event. A
  // NOTE_UPDATED must never close (or re-open) a request — it only updates the
  // displayed note. (rows are ordered newest-first.)
  const latestStateByCampaign = new Map<number, (typeof rows)[0]>();
  const noteRowsByCampaign = new Map<number, typeof rows>();
  for (const row of rows) {
    const campaignId = Number(row.entityId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) continue;
    if (
      (row.eventType === CAMPAIGN_REVIEW_REQUESTED ||
        row.eventType === CAMPAIGN_REVIEW_RESOLVED) &&
      !latestStateByCampaign.has(campaignId)
    ) {
      latestStateByCampaign.set(campaignId, row);
    }
    if (
      row.eventType === CAMPAIGN_REVIEW_REQUESTED ||
      row.eventType === CAMPAIGN_REVIEW_NOTE_UPDATED
    ) {
      const list = noteRowsByCampaign.get(campaignId) ?? [];
      list.push(row);
      noteRowsByCampaign.set(campaignId, list);
    }
  }

  const open: OpenCampaignReviewRequest[] = [];
  for (const [campaignId, row] of latestStateByCampaign) {
    if (row.eventType !== CAMPAIGN_REVIEW_REQUESTED) continue;
    const noteHistory = noteRowsByCampaign.get(campaignId) ?? [row];
    open.push({
      eventId: row.id,
      campaignId,
      campaignName: payloadCampaignName(row.payloadJson, campaignId),
      note: latestNoteForCampaign(noteHistory),
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

export async function updateCampaignReviewNote(params: {
  workspaceId: number;
  campaignId: number;
  note: string;
  actorEmployeeId: number;
}): Promise<void> {
  const open = await hasOpenCampaignReviewRequest(params.workspaceId, params.campaignId);
  if (!open) {
    throw new Error("No open review request for this campaign");
  }

  await db.insert(operationalEventsTable).values({
    workspaceId: params.workspaceId,
    entityType: "campaign",
    entityId: String(params.campaignId),
    eventType: CAMPAIGN_REVIEW_NOTE_UPDATED,
    actorType: "employee",
    actorId: String(params.actorEmployeeId),
    source: "campaign_review",
    payloadJson: { note: params.note },
  });
}

/** Campaigns marked reviewed today (persisted in operational_events). */
export async function getCampaignsReviewedToday(
  workspaceId: number,
  dayStart = new Date(),
): Promise<CampaignReviewedMarker[]> {
  const start = new Date(dayStart);
  start.setHours(0, 0, 0, 0);

  const rows = await db
    .select()
    .from(operationalEventsTable)
    .where(
      and(
        eq(operationalEventsTable.workspaceId, workspaceId),
        eq(operationalEventsTable.entityType, "campaign"),
        eq(operationalEventsTable.eventType, CAMPAIGN_MARKED_REVIEWED),
      ),
    )
    .orderBy(desc(operationalEventsTable.createdAt));

  const latestByCampaign = new Map<number, CampaignReviewedMarker>();
  for (const row of rows) {
    if (row.createdAt < start) continue;
    const campaignId = Number(row.entityId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) continue;
    if (latestByCampaign.has(campaignId)) continue;
    latestByCampaign.set(campaignId, {
      campaignId,
      reviewedAt: row.createdAt.toISOString(),
      reviewedByEmployeeId: row.actorId ? Number(row.actorId) : null,
    });
  }
  return [...latestByCampaign.values()];
}

export async function markCampaignReviewed(params: {
  workspaceId: number;
  campaignId: number;
  actorEmployeeId: number;
}): Promise<{ reviewedAt: string }> {
  const reviewedAt = new Date();
  await db.insert(operationalEventsTable).values({
    workspaceId: params.workspaceId,
    entityType: "campaign",
    entityId: String(params.campaignId),
    eventType: CAMPAIGN_MARKED_REVIEWED,
    actorType: "employee",
    actorId: String(params.actorEmployeeId),
    source: "live_campaigns",
    payloadJson: { reviewedAt: reviewedAt.toISOString() },
  });
  return { reviewedAt: reviewedAt.toISOString() };
}

/**
 * Latest server-side dismissal per campaign (persisted in operational_events).
 * A dismissal is authoritative across browsers / employees. Whether a campaign
 * is *currently* hidden is decided by comparing this timestamp against the
 * latest relevant review/signal/request timestamp (see isReviewItemHidden).
 */
export async function getReviewDismissals(
  workspaceId: number,
): Promise<ReviewDismissal[]> {
  const rows = await db
    .select()
    .from(operationalEventsTable)
    .where(
      and(
        eq(operationalEventsTable.workspaceId, workspaceId),
        eq(operationalEventsTable.entityType, "campaign"),
        eq(operationalEventsTable.eventType, CAMPAIGN_REVIEW_DISMISSED),
      ),
    )
    .orderBy(desc(operationalEventsTable.createdAt));

  const latestByCampaign = new Map<number, ReviewDismissal>();
  for (const row of rows) {
    const campaignId = Number(row.entityId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) continue;
    if (latestByCampaign.has(campaignId)) continue;
    latestByCampaign.set(campaignId, {
      campaignId,
      dismissedAt: row.createdAt.toISOString(),
      dismissedByEmployeeId: row.actorId ? Number(row.actorId) : null,
    });
  }
  return [...latestByCampaign.values()];
}

export async function dismissCampaignReview(params: {
  workspaceId: number;
  campaignId: number;
  actorEmployeeId: number;
  reason?: string | null;
  bulkId?: string | null;
  reviewRequestId?: number | null;
}): Promise<{ dismissedAt: string }> {
  const dismissedAt = new Date();
  await db.insert(operationalEventsTable).values({
    workspaceId: params.workspaceId,
    entityType: "campaign",
    entityId: String(params.campaignId),
    eventType: CAMPAIGN_REVIEW_DISMISSED,
    actorType: "employee",
    actorId: String(params.actorEmployeeId),
    source: "campaign_review",
    payloadJson: {
      dismissedAt: dismissedAt.toISOString(),
      reason: params.reason ?? null,
      bulkId: params.bulkId ?? null,
      reviewRequestId: params.reviewRequestId ?? null,
    },
  });
  return { dismissedAt: dismissedAt.toISOString() };
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
