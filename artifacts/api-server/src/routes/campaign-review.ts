import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { campaignsTable, db, testingBatchesTable } from "@workspace/db";
import { checkWorkspaceAccess, requireWorkspaceFromQuery } from "../lib/workspace-access";
import {
  loadAssignedNetworksForEmployee,
  networkIdAllowed,
  networkNameAllowed,
} from "../lib/worker-network-access";
import {
  getOpenCampaignReviewRequests,
  getCampaignsReviewedToday,
  getReviewDismissals,
  dismissCampaignReview,
  requestCampaignReview,
  resolveCampaignReview,
  updateCampaignReviewNote,
  markCampaignReviewed,
} from "../lib/campaign-review-requests.ts";

const router: IRouter = Router();

const requestReviewBody = z.object({
  workspaceId: z.number().int().positive(),
  note: z.string().trim().min(1).max(4000),
});

const resolveReviewBody = z.object({
  workspaceId: z.number().int().positive(),
  resolution: z.string().trim().max(500).optional(),
});

const updateReviewNoteBody = z.object({
  workspaceId: z.number().int().positive(),
  // Empty string is allowed and clears the note (display shows "No comment yet").
  note: z.string().trim().max(4000),
});

const markReviewedBody = z.object({
  workspaceId: z.number().int().positive(),
});

const dismissBody = z.object({
  workspaceId: z.number().int().positive(),
  campaignIds: z.array(z.number().int().positive()).min(1).max(200),
  reason: z.string().trim().max(500).optional(),
});

type WorkspaceAccess = Awaited<ReturnType<typeof checkWorkspaceAccess>>;
type GrantedAccess = Extract<WorkspaceAccess, { allowed: true }>;

/**
 * Per-campaign access resolution that never writes to the response, so it can
 * be used to build per-campaign results in bulk operations. Assumes workspace
 * access has already been granted for `access`.
 */
async function resolveCampaignAccessWithinWorkspace(
  access: GrantedAccess,
  workspaceId: number,
  campaignId: number,
): Promise<
  | { ok: true; campaign: { id: number; campaignName: string } }
  | { ok: false; status: number; error: string }
> {
  const [campaign] = await db
    .select({
      id: campaignsTable.id,
      workspaceId: campaignsTable.workspaceId,
      campaignName: campaignsTable.campaignName,
      affiliateNetworkId: campaignsTable.affiliateNetworkId,
      batchId: campaignsTable.batchId,
    })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.workspaceId, workspaceId)))
    .limit(1);

  if (!campaign) {
    return { ok: false, status: 404, error: "Campaign not found" };
  }

  if (access.employee.role !== "admin") {
    const assigned = await loadAssignedNetworksForEmployee(workspaceId, access.employee.id);
    let networkName: string | null = null;
    if (campaign.batchId != null) {
      const [batch] = await db
        .select({ affiliateNetwork: testingBatchesTable.affiliateNetwork })
        .from(testingBatchesTable)
        .where(eq(testingBatchesTable.id, campaign.batchId))
        .limit(1);
      networkName = batch?.affiliateNetwork ?? null;
    }
    const scope = {
      isAdmin: false as const,
      employeeId: access.employee.id,
      role: access.employee.role,
      allowedNetworkIds: assigned.ids,
      allowedNetworkNames: assigned.names,
    };
    const allowedById =
      campaign.affiliateNetworkId != null &&
      networkIdAllowed(scope, campaign.affiliateNetworkId);
    const allowedByName = networkName != null && networkNameAllowed(scope, networkName);
    if (!allowedById && !allowedByName) {
      return { ok: false, status: 403, error: "Affiliate network not assigned to you" };
    }
  }

  return { ok: true, campaign: { id: campaign.id, campaignName: campaign.campaignName } };
}

async function assertCampaignReviewAccess(
  req: Request,
  res: Response,
  workspaceId: number,
  campaignId: number,
) {
  const access = await checkWorkspaceAccess(req, workspaceId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return null;
  }

  const resolved = await resolveCampaignAccessWithinWorkspace(access, workspaceId, campaignId);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return null;
  }

  return { access, campaign: resolved.campaign };
}

router.get("/campaign-review/open-requests", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const access = await checkWorkspaceAccess(req, workspaceId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return;
  }

  let items = await getOpenCampaignReviewRequests(workspaceId);

  if (access.employee.role !== "admin") {
    items = items.filter((item) => item.requestedByEmployeeId === access.employee.id);
  }

  res.json({ items });
});

router.get("/campaign-review/reviewed-today", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const access = await checkWorkspaceAccess(req, workspaceId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return;
  }

  const items = await getCampaignsReviewedToday(workspaceId);
  res.json({ items });
});

router.get("/campaign-review/dismissed", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const access = await checkWorkspaceAccess(req, workspaceId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return;
  }

  const items = await getReviewDismissals(workspaceId);
  res.json({ items });
});

/**
 * Persist single or bulk dismissals server-side (authoritative across
 * browsers/employees). Does not delete or close campaigns. Returns per-campaign
 * success/failure so the client can keep failed items selected/visible.
 */
router.post("/campaign-review/dismiss", async (req, res): Promise<void> => {
  const parsed = dismissBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { workspaceId, reason } = parsed.data;
  const access = await checkWorkspaceAccess(req, workspaceId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return;
  }

  const uniqueIds = [...new Set(parsed.data.campaignIds)];
  const bulkId = `dismiss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const results: Array<{
    campaignId: number;
    ok: boolean;
    dismissedAt?: string;
    error?: string;
  }> = [];

  for (const campaignId of uniqueIds) {
    const resolved = await resolveCampaignAccessWithinWorkspace(access, workspaceId, campaignId);
    if (!resolved.ok) {
      results.push({ campaignId, ok: false, error: resolved.error });
      continue;
    }
    const { dismissedAt } = await dismissCampaignReview({
      workspaceId,
      campaignId,
      actorEmployeeId: access.employee.id,
      reason: reason ?? null,
      bulkId,
    });
    results.push({ campaignId, ok: true, dismissedAt });
  }

  const anyOk = results.some((r) => r.ok);
  res.status(anyOk ? 200 : 400).json({ ok: anyOk, results });
});

router.post("/campaigns/:id/request-review", async (req, res): Promise<void> => {
  const campaignId = Number(req.params["id"]);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    res.status(400).json({ error: "Invalid campaign id" });
    return;
  }

  const parsed = requestReviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const ctx = await assertCampaignReviewAccess(req, res, parsed.data.workspaceId, campaignId);
  if (!ctx) return;

  const result = await requestCampaignReview({
    workspaceId: parsed.data.workspaceId,
    campaignId,
    campaignName: ctx.campaign.campaignName,
    note: parsed.data.note,
    actorEmployeeId: ctx.access.employee.id,
  });

  res.status(result.created ? 201 : 200).json({
    ok: true,
    created: result.created,
    eventId: result.eventId,
    campaignId,
  });
});

router.post("/campaigns/:id/resolve-review", async (req, res): Promise<void> => {
  const campaignId = Number(req.params["id"]);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    res.status(400).json({ error: "Invalid campaign id" });
    return;
  }

  const parsed = resolveReviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const ctx = await assertCampaignReviewAccess(req, res, parsed.data.workspaceId, campaignId);
  if (!ctx) return;

  await resolveCampaignReview({
    workspaceId: parsed.data.workspaceId,
    campaignId,
    actorEmployeeId: ctx.access.employee.id,
    resolution: parsed.data.resolution,
  });

  res.json({ ok: true, campaignId });
});

router.patch("/campaigns/:id/review-note", async (req, res): Promise<void> => {
  const campaignId = Number(req.params["id"]);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    res.status(400).json({ error: "Invalid campaign id" });
    return;
  }

  const parsed = updateReviewNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const ctx = await assertCampaignReviewAccess(req, res, parsed.data.workspaceId, campaignId);
  if (!ctx) return;

  try {
    await updateCampaignReviewNote({
      workspaceId: parsed.data.workspaceId,
      campaignId,
      note: parsed.data.note,
      actorEmployeeId: ctx.access.employee.id,
    });
    res.json({ ok: true, campaignId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(409).json({ error: message });
  }
});

router.post("/campaigns/:id/mark-reviewed", async (req, res): Promise<void> => {
  const campaignId = Number(req.params["id"]);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    res.status(400).json({ error: "Invalid campaign id" });
    return;
  }

  const parsed = markReviewedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const ctx = await assertCampaignReviewAccess(req, res, parsed.data.workspaceId, campaignId);
  if (!ctx) return;

  const result = await markCampaignReviewed({
    workspaceId: parsed.data.workspaceId,
    campaignId,
    actorEmployeeId: ctx.access.employee.id,
  });

  res.json({ ok: true, campaignId, ...result });
});

export default router;
