// Slice 7B — read-only batch operational health for admins/operators.
//
// GET /admin/batches/:id/health — workspace-scoped summary of batch state,
// active traffic-source run, open tasks, recent operational events, and
// derived health flags. No mutations, no workflow emits.

import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import {
  batchTrafficSourceRunsTable,
  db,
  operationalEventsTable,
  testingBatchesTable,
  todoTasksTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { requireWorkspaceAccess } from "../../lib/workspace-access";
import {
  BATCH_HEALTH_EVENT_TYPES,
  deriveBatchHealthFlags,
  operationalEventReferencesBatch,
  type BatchHealthActiveRun,
  type BatchHealthOpenTask,
  type BatchHealthOperationalEvent,
} from "../../lib/batch-health.ts";

const router: IRouter = Router();

const RECENT_EVENTS_FETCH_LIMIT = 150;
const RECENT_EVENTS_RESPONSE_LIMIT = 50;

function parseBatchId(raw: string | undefined): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function serializeOperationalEvent(
  row: typeof operationalEventsTable.$inferSelect,
): BatchHealthOperationalEvent {
  return {
    id: row.id,
    eventType: row.eventType,
    entityType: row.entityType,
    entityId: row.entityId,
    actorType: row.actorType,
    actorId: row.actorId,
    source: row.source,
    payloadJson: (row.payloadJson ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadActiveTrafficSourceRun(
  workspaceId: number,
  batchId: number,
): Promise<BatchHealthActiveRun | null> {
  const [row] = await db
    .select({
      runId: batchTrafficSourceRunsTable.id,
      trafficSourceId: batchTrafficSourceRunsTable.trafficSourceId,
      trafficSourceName: workspaceTrafficSourcesTable.name,
      position: batchTrafficSourceRunsTable.position,
      status: batchTrafficSourceRunsTable.status,
      iosStatus: batchTrafficSourceRunsTable.iosStatus,
      androidStatus: batchTrafficSourceRunsTable.androidStatus,
      iosCampaignId: batchTrafficSourceRunsTable.iosCampaignId,
      androidCampaignId: batchTrafficSourceRunsTable.androidCampaignId,
      startedAt: batchTrafficSourceRunsTable.startedAt,
      completedAt: batchTrafficSourceRunsTable.completedAt,
    })
    .from(batchTrafficSourceRunsTable)
    .innerJoin(
      workspaceTrafficSourcesTable,
      and(
        eq(
          workspaceTrafficSourcesTable.id,
          batchTrafficSourceRunsTable.trafficSourceId,
        ),
        eq(workspaceTrafficSourcesTable.workspaceId, workspaceId),
      ),
    )
    .where(
      and(
        eq(batchTrafficSourceRunsTable.workspaceId, workspaceId),
        eq(batchTrafficSourceRunsTable.batchId, batchId),
        eq(batchTrafficSourceRunsTable.status, "active"),
      ),
    )
    .orderBy(desc(batchTrafficSourceRunsTable.position))
    .limit(1);

  if (!row) return null;

  return {
    runId: row.runId,
    trafficSourceId: row.trafficSourceId,
    trafficSourceName: row.trafficSourceName,
    position: row.position,
    status: row.status,
    iosStatus: row.iosStatus,
    androidStatus: row.androidStatus,
    iosCampaignId: row.iosCampaignId,
    androidCampaignId: row.androidCampaignId,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

async function loadOpenTasksForBatch(
  workspaceId: number,
  batchId: number,
): Promise<BatchHealthOpenTask[]> {
  const rows = await db
    .select({
      id: todoTasksTable.id,
      taskType: todoTasksTable.taskType,
      status: todoTasksTable.status,
      title: todoTasksTable.title,
      assignedEmployeeId: todoTasksTable.employeeId,
      relatedCampaignId: todoTasksTable.relatedCampaignId,
      trafficSourceId: todoTasksTable.trafficSourceId,
      dueDate: todoTasksTable.dueDate,
    })
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.workspaceId, workspaceId),
        eq(todoTasksTable.relatedBatchId, batchId),
        inArray(todoTasksTable.status, ["TODO", "IN_PROGRESS"]),
      ),
    )
    .orderBy(asc(todoTasksTable.id));

  return rows;
}

async function loadRecentBatchOperationalEvents(
  workspaceId: number,
  batchId: number,
): Promise<BatchHealthOperationalEvent[]> {
  const batchIdText = String(batchId);

  // Workspace-scoped prefilter; batch association is verified in application
  // code (especially RECONCILIATION_VIOLATION affectedBatchIds).
  const rows = await db
    .select()
    .from(operationalEventsTable)
    .where(
      and(
        eq(operationalEventsTable.workspaceId, workspaceId),
        inArray(operationalEventsTable.eventType, [...BATCH_HEALTH_EVENT_TYPES]),
        or(
          and(
            eq(operationalEventsTable.entityType, "batch"),
            eq(operationalEventsTable.entityId, batchIdText),
          ),
          eq(operationalEventsTable.eventType, "RECONCILIATION_VIOLATION"),
          eq(operationalEventsTable.eventType, "TRAFFIC_SOURCE_RUN_ACTIVATED"),
          eq(operationalEventsTable.eventType, "TRAFFIC_SOURCE_RUN_TERMINAL"),
          eq(operationalEventsTable.eventType, "TASK_CREATED"),
          eq(operationalEventsTable.eventType, "TASK_COMPLETED"),
          eq(operationalEventsTable.eventType, "CAMPAIGN_LINKED"),
        ),
      ),
    )
    .orderBy(
      desc(operationalEventsTable.createdAt),
      desc(operationalEventsTable.id),
    )
    .limit(RECENT_EVENTS_FETCH_LIMIT);

  const filtered: BatchHealthOperationalEvent[] = [];
  for (const row of rows) {
    if (!operationalEventReferencesBatch(row, batchId)) continue;
    filtered.push(serializeOperationalEvent(row));
    if (filtered.length >= RECENT_EVENTS_RESPONSE_LIMIT) break;
  }
  return filtered;
}

router.get("/admin/batches/:id/health", async (req, res): Promise<void> => {
  const batchId = parseBatchId(req.params.id);
  if (batchId === null) {
    res.status(400).json({ error: "Invalid batch id" });
    return;
  }

  const [batch] = await db
    .select({
      id: testingBatchesTable.id,
      workspaceId: testingBatchesTable.workspaceId,
      status: testingBatchesTable.status,
      batchName: testingBatchesTable.batchName,
      currentWorkspaceTrafficSourceId:
        testingBatchesTable.currentWorkspaceTrafficSourceId,
      trafficSourceStep: testingBatchesTable.trafficSourceStep,
    })
    .from(testingBatchesTable)
    .where(eq(testingBatchesTable.id, batchId));

  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }

  const workspaceId = await requireWorkspaceAccess(req, res, batch.workspaceId);
  if (workspaceId === null) return;

  const [activeRun, openTasks, recentEvents] = await Promise.all([
    loadActiveTrafficSourceRun(workspaceId, batchId),
    loadOpenTasksForBatch(workspaceId, batchId),
    loadRecentBatchOperationalEvents(workspaceId, batchId),
  ]);

  const flags = deriveBatchHealthFlags(activeRun, openTasks, recentEvents);

  res.json({
    batch: {
      id: batch.id,
      workspaceId: batch.workspaceId,
      status: batch.status,
      batchName: batch.batchName,
      currentWorkspaceTrafficSourceId: batch.currentWorkspaceTrafficSourceId,
      trafficSourceStep: batch.trafficSourceStep,
    },
    activeRun,
    openTasks,
    recentEvents,
    flags,
  });
});

export default router;
