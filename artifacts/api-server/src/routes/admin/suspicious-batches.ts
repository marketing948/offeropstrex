// Phase 8d (Task #18) — admin-only suspicious-batch review queue.
//
// Returns testing batches that have at least one unresolved
// SUSPICIOUS_BATCH_UPDATE notification in the requested workspace.
// "Unresolved" is read off `notifications.read = false` — that's the
// only resolution state the table currently tracks, and matches the
// inbox semantics workers see (mark-as-read clears it). One row per
// batch, sorted newest-first by the most recent suspicious notification.

import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, notificationsTable, testingBatchesTable } from "@workspace/db";
import { requireAdmin, requireWorkspaceFromQuery } from "../../lib/workspace-access";

const router: IRouter = Router();

router.get("/admin/suspicious-batches", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const rows = await db
    .select({
      batchId: testingBatchesTable.id,
      batchName: testingBatchesTable.batchName,
      status: testingBatchesTable.status,
      affiliateNetwork: testingBatchesTable.affiliateNetwork,
      geo: testingBatchesTable.geo,
      employeeId: testingBatchesTable.employeeId,
      unresolvedCount: sql<number>`count(${notificationsTable.id})::int`,
      lastNotifiedAt: sql<Date>`max(${notificationsTable.createdAt})`,
    })
    .from(notificationsTable)
    .innerJoin(testingBatchesTable, eq(testingBatchesTable.id, notificationsTable.batchId))
    .where(and(
      eq(notificationsTable.workspaceId, workspaceId),
      // Defense-in-depth: also require the joined batch be in the same
      // workspace, so any historic cross-table drift can't surface
      // another workspace's batch metadata in this admin queue.
      eq(testingBatchesTable.workspaceId, workspaceId),
      eq(notificationsTable.type, "SUSPICIOUS_BATCH_UPDATE"),
      eq(notificationsTable.read, false),
    ))
    .groupBy(
      testingBatchesTable.id,
      testingBatchesTable.batchName,
      testingBatchesTable.status,
      testingBatchesTable.affiliateNetwork,
      testingBatchesTable.geo,
      testingBatchesTable.employeeId,
    )
    .orderBy(desc(sql`max(${notificationsTable.createdAt})`));

  res.json(rows.map((r) => ({
    ...r,
    lastNotifiedAt: r.lastNotifiedAt instanceof Date
      ? r.lastNotifiedAt.toISOString()
      : new Date(r.lastNotifiedAt).toISOString(),
  })));
});

export default router;
