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
  requestCampaignReview,
  resolveCampaignReview,
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
    res.status(404).json({ error: "Campaign not found" });
    return null;
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
    const allowedById =
      campaign.affiliateNetworkId != null &&
      networkIdAllowed(
        {
          isAdmin: false,
          employeeId: access.employee.id,
          role: access.employee.role,
          allowedNetworkIds: assigned.ids,
          allowedNetworkNames: assigned.names,
        },
        campaign.affiliateNetworkId,
      );
    const allowedByName =
      networkName != null &&
      networkNameAllowed(
        {
          isAdmin: false,
          employeeId: access.employee.id,
          role: access.employee.role,
          allowedNetworkIds: assigned.ids,
          allowedNetworkNames: assigned.names,
        },
        networkName,
      );
    if (!allowedById && !allowedByName) {
      res.status(403).json({ error: "Affiliate network not assigned to you" });
      return null;
    }
  }

  return { access, campaign };
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

export default router;
