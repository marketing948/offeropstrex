import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  affiliateNetworksTable,
  campaignWinnersTable,
  campaignsTable,
  employeesTable,
  testingBatchesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { requireWorkspaceFromQuery } from "../lib/workspace-access.ts";
import {
  enforceEmployeeIdAccess,
  requireWorkspaceWithNetworkScope,
  workerCampaignNetworkSqlFilter,
  workerHasNoAssignedNetworks,
} from "../lib/worker-network-access.ts";

const router: IRouter = Router();

router.get("/reports/campaign-winners", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const scoped = await requireWorkspaceWithNetworkScope(req, res, workspaceId);
  if (scoped === null) return;

  if (workerHasNoAssignedNetworks(scoped.scope)) {
    res.json([]);
    return;
  }

  const conditions = [
    eq(campaignWinnersTable.workspaceId, workspaceId),
    eq(campaignsTable.workspaceId, workspaceId),
  ];

  if (!scoped.scope.isAdmin) {
    const netFilter = workerCampaignNetworkSqlFilter(
      scoped.scope,
      testingBatchesTable.affiliateNetwork,
      affiliateNetworksTable.name,
      campaignsTable.affiliateNetworkId,
    );
    if (netFilter) conditions.push(netFilter);
    conditions.push(eq(testingBatchesTable.employeeId, scoped.scope.employeeId));
  }

  const rows = await db
    .select({
      detectedAt: campaignWinnersTable.detectedAt,
      batchName: testingBatchesTable.batchName,
      trafficSourceName: workspaceTrafficSourcesTable.name,
      platform: campaignWinnersTable.platform,
      campaignName: campaignsTable.campaignName,
      offerId: campaignWinnersTable.offerId,
      source: campaignWinnersTable.source,
      enteredBy: employeesTable.name,
      notes: campaignWinnersTable.notes,
    })
    .from(campaignWinnersTable)
    .innerJoin(campaignsTable, eq(campaignWinnersTable.campaignId, campaignsTable.id))
    .leftJoin(testingBatchesTable, eq(campaignWinnersTable.batchId, testingBatchesTable.id))
    .leftJoin(
      affiliateNetworksTable,
      and(
        eq(campaignsTable.affiliateNetworkId, affiliateNetworksTable.id),
        eq(affiliateNetworksTable.workspaceId, workspaceId),
      ),
    )
    .leftJoin(
      workspaceTrafficSourcesTable,
      and(
        eq(campaignWinnersTable.trafficSourceId, workspaceTrafficSourcesTable.id),
        eq(workspaceTrafficSourcesTable.workspaceId, workspaceId),
      ),
    )
    .leftJoin(employeesTable, eq(campaignWinnersTable.detectedByEmployeeId, employeesTable.id))
    .where(and(...conditions))
    .orderBy(desc(campaignWinnersTable.detectedAt))
    .limit(500);

  res.json(
    rows.map((r) => ({
      detectedAt: r.detectedAt.toISOString(),
      batchName: r.batchName ?? null,
      trafficSourceName: r.trafficSourceName ?? null,
      platform: r.platform,
      campaignName: r.campaignName,
      offerId: r.offerId,
      source: r.source,
      sourceLabel: r.source === "manual_close" ? "Manual close" : "Target reached review",
      enteredBy: r.enteredBy ?? null,
      notes: r.notes ?? null,
    })),
  );
});

export default router;
