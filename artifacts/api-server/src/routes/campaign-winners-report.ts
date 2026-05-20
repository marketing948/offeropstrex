import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  campaignWinnersTable,
  campaignsTable,
  employeesTable,
  testingBatchesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { requireWorkspaceFromQuery, requireWorkspaceAccess } from "../lib/workspace-access.ts";

const router: IRouter = Router();

router.get("/reports/campaign-winners", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;
  if ((await requireWorkspaceAccess(req, res, workspaceId)) === null) return;

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
      workspaceTrafficSourcesTable,
      and(
        eq(campaignWinnersTable.trafficSourceId, workspaceTrafficSourcesTable.id),
        eq(workspaceTrafficSourcesTable.workspaceId, workspaceId),
      ),
    )
    .leftJoin(employeesTable, eq(campaignWinnersTable.detectedByEmployeeId, employeesTable.id))
    .where(
      and(
        eq(campaignWinnersTable.workspaceId, workspaceId),
        eq(campaignsTable.workspaceId, workspaceId),
      ),
    )
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
