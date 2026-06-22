// Phase 3: action executor. Every domain mutation produced by the
// engine flows through here. Routes / handlers must NOT call
// `db.update(testingBatchesTable)` etc. directly — the lint check at
// `scripts/src/check-no-direct-domain-mutations.ts` enforces this.

import {
  campaignsTable,
  batchTrafficSourceRunsTable,
  db,
  testingBatchesTable,
  todoTasksTable,
  notificationsTable,
  trackerCampaignsTable,
  voluumOffersTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { and, asc, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { emitWithinTx } from "./event-bus.ts";
import type { Action, BatchStatus, Tx } from "./types.ts";
import { assertNever } from "./types.ts";
import {
  isTerminalTrafficSourceRunStatus,
  recordTrafficSourceRunActivatedOperationalEvent,
  recordTrafficSourceRunTerminalOperationalEvent,
} from "../lib/campaignops-operational-events.ts";
import { recordOperationalEvent } from "../lib/operational-events.ts";
import { appendOperationalActivity } from "../lib/operational-activity-feed.ts";
import {
  campaignLinkedTitle,
  campaignLiveTitle,
  taskCompletedTitle,
  winnersAddedTitle,
} from "../lib/operational-activity-titles.ts";
import { resolveCampaignDisplayName } from "../lib/campaign-display-name.ts";
import { insertCampaignWinnersTx } from "../lib/campaign-winners.ts";
import { parseVoluumOfferIdsFromStrings } from "@workspace/voluum-offer-ids";

type CreateBatchAction = Extract<Action, { type: "CreateBatch" }>;
type PlatformRunStatus = "pending" | "active" | "completed" | "failed" | "skipped";
type TrafficSourceRunStatus = "pending" | "active" | "completed" | "failed" | "skipped";
type CreatedTaskAuditRow = Pick<
  typeof todoTasksTable.$inferSelect,
  "id" | "workspaceId" | "employeeId" | "relatedBatchId" | "relatedCampaignId" | "taskType" | "priority" | "trafficSourceId"
>;

const TERMINAL_PLATFORM_STATUSES = new Set<PlatformRunStatus>([
  "completed",
  "failed",
  "skipped",
]);

function deriveTrafficSourceRunStatus(
  iosStatus: PlatformRunStatus,
  androidStatus: PlatformRunStatus,
): TrafficSourceRunStatus {
  if (iosStatus === "pending" && androidStatus === "pending") return "pending";
  if (iosStatus === "skipped" && androidStatus === "skipped") return "skipped";

  const iosTerminal = TERMINAL_PLATFORM_STATUSES.has(iosStatus);
  const androidTerminal = TERMINAL_PLATFORM_STATUSES.has(androidStatus);
  if (iosTerminal && androidTerminal) {
    if (iosStatus === "completed" || androidStatus === "completed") return "completed";
    if (iosStatus === "failed" && androidStatus === "failed") return "failed";
    return "skipped";
  }

  return "active";
}

function shouldAdvanceTrafficSourceRun(
  iosStatus: PlatformRunStatus,
  androidStatus: PlatformRunStatus,
  runStatus: TrafficSourceRunStatus,
): boolean {
  const iosTerminal = TERMINAL_PLATFORM_STATUSES.has(iosStatus);
  const androidTerminal = TERMINAL_PLATFORM_STATUSES.has(androidStatus);
  if (!iosTerminal || !androidTerminal) return false;

  if (runStatus === "completed") return true;
  if (runStatus === "failed" && iosStatus === "failed" && androidStatus === "failed") {
    return true;
  }
  return false;
}

async function recordTaskCreatedOperationalEvent(tx: Tx, task: CreatedTaskAuditRow): Promise<void> {
  await recordOperationalEvent({
    workspaceId: task.workspaceId,
    entityType: "task",
    entityId: task.id,
    eventType: "TASK_CREATED",
    actorType: "system",
    source: "engine",
    payloadJson: {
      taskType: task.taskType,
      employeeId: task.employeeId,
      relatedBatchId: task.relatedBatchId,
      relatedCampaignId: task.relatedCampaignId,
      priority: task.priority,
      trafficSourceId: task.trafficSourceId,
    },
  }, tx);
}

async function recordTaskCreatedOperationalEvents(tx: Tx, tasks: CreatedTaskAuditRow[]): Promise<void> {
  for (const task of tasks) {
    await recordTaskCreatedOperationalEvent(tx, task);
  }
}

export async function activateNextTrafficSourceRun(
  tx: Tx,
  action: Extract<Action, { type: "CompleteTrafficSourceRunPlatform" }>,
  currentPosition: number,
): Promise<void> {
  const [batch] = await tx
    .select({
      employeeId: testingBatchesTable.employeeId,
      batchName: testingBatchesTable.batchName,
    })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.id, action.batchId),
        eq(testingBatchesTable.workspaceId, action.workspaceId),
      ),
    )
    .limit(1);
  if (!batch || batch.employeeId == null) return;

  const [nextRun] = await tx
    .select({
      id: batchTrafficSourceRunsTable.id,
      trafficSourceId: batchTrafficSourceRunsTable.trafficSourceId,
      position: batchTrafficSourceRunsTable.position,
      status: batchTrafficSourceRunsTable.status,
    })
    .from(batchTrafficSourceRunsTable)
    .where(
      and(
        eq(batchTrafficSourceRunsTable.workspaceId, action.workspaceId),
        eq(batchTrafficSourceRunsTable.batchId, action.batchId),
        gt(batchTrafficSourceRunsTable.position, currentPosition),
      ),
    )
    .orderBy(asc(batchTrafficSourceRunsTable.position))
    .limit(1);

  if (!nextRun) {
    const [existingAllDone] = await tx
      .select({ id: todoTasksTable.id })
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.workspaceId, action.workspaceId),
          eq(todoTasksTable.relatedBatchId, action.batchId),
          eq(todoTasksTable.taskType, "all_traffic_sources_tested"),
        ),
      )
      .limit(1);
    if (existingAllDone) return;

    const createdSummaryTasks = await tx
      .insert(todoTasksTable)
      .values({
        workspaceId: action.workspaceId,
        employeeId: batch.employeeId,
        relatedBatchId: action.batchId,
        title: `All traffic sources tested for ${batch.batchName ?? `Batch #${action.batchId}`}`,
        taskType: "all_traffic_sources_tested",
        priority: "low",
        status: "TODO",
      })
      .onConflictDoNothing()
      .returning({
        id: todoTasksTable.id,
        workspaceId: todoTasksTable.workspaceId,
        employeeId: todoTasksTable.employeeId,
        relatedBatchId: todoTasksTable.relatedBatchId,
        relatedCampaignId: todoTasksTable.relatedCampaignId,
        taskType: todoTasksTable.taskType,
        priority: todoTasksTable.priority,
        trafficSourceId: todoTasksTable.trafficSourceId,
      });
    await recordTaskCreatedOperationalEvents(tx, createdSummaryTasks);
    return;
  }

  // First activation only: pending → active seeds paired create_voluum_* tasks.
  // Replays with an already-active (or terminal) next run are no-ops.
  if (nextRun.status !== "pending") return;

  const now = new Date();
  await tx
    .update(batchTrafficSourceRunsTable)
    .set({
      status: "active",
      iosStatus: "active",
      androidStatus: "active",
      startedAt: now,
    })
    .where(eq(batchTrafficSourceRunsTable.id, nextRun.id));

  await recordTrafficSourceRunActivatedOperationalEvent(
    {
      workspaceId: action.workspaceId,
      batchId: action.batchId,
      runId: nextRun.id,
      trafficSourceId: nextRun.trafficSourceId,
      position: nextRun.position,
    },
    tx,
  );

  await tx
    .update(testingBatchesTable)
    .set({
      currentWorkspaceTrafficSourceId: nextRun.trafficSourceId,
      trafficSourceStep: sql`${testingBatchesTable.trafficSourceStep} + 1`,
    })
    .where(
      and(
        eq(testingBatchesTable.id, action.batchId),
        eq(testingBatchesTable.workspaceId, action.workspaceId),
      ),
    );

  const [source] = await tx
    .select({ name: workspaceTrafficSourcesTable.name })
    .from(workspaceTrafficSourcesTable)
    .where(
      and(
        eq(workspaceTrafficSourcesTable.id, nextRun.trafficSourceId),
        eq(workspaceTrafficSourcesTable.workspaceId, action.workspaceId),
      ),
    )
    .limit(1);
  const sourceName = source?.name ?? `traffic source #${nextRun.trafficSourceId}`;
  const batchName = batch.batchName ?? `Batch #${action.batchId}`;

  const createdCampaignTasks = await tx
    .insert(todoTasksTable)
    .values([
      {
        workspaceId: action.workspaceId,
        employeeId: batch.employeeId,
        relatedBatchId: action.batchId,
        title: `Create Voluum campaign (iOS) for ${batchName} on ${sourceName}`,
        taskType: "create_voluum_campaign_ios",
        priority: "high",
        status: "TODO",
        trafficSourceId: nextRun.trafficSourceId,
      },
      {
        workspaceId: action.workspaceId,
        employeeId: batch.employeeId,
        relatedBatchId: action.batchId,
        title: `Create Voluum campaign (Android) for ${batchName} on ${sourceName}`,
        taskType: "create_voluum_campaign_android",
        priority: "high",
        status: "TODO",
        trafficSourceId: nextRun.trafficSourceId,
      },
    ])
    .onConflictDoNothing()
    .returning({
      id: todoTasksTable.id,
      workspaceId: todoTasksTable.workspaceId,
      employeeId: todoTasksTable.employeeId,
      relatedBatchId: todoTasksTable.relatedBatchId,
      relatedCampaignId: todoTasksTable.relatedCampaignId,
      taskType: todoTasksTable.taskType,
      priority: todoTasksTable.priority,
      trafficSourceId: todoTasksTable.trafficSourceId,
    });
  await recordTaskCreatedOperationalEvents(tx, createdCampaignTasks);
}

const OPEN_TASK_STATUSES_FOR_RECOVERY = ["TODO", "IN_PROGRESS"] as const;

export type RecreateCreateTasksResult = {
  runId: number;
  trafficSourceId: number;
  createdTasks: Array<{ id: number; taskType: string }>;
  idempotent: boolean;
};

async function hasOpenCreateVoluumTask(
  tx: Tx,
  workspaceId: number,
  batchId: number,
  taskType: "create_voluum_campaign_ios" | "create_voluum_campaign_android",
): Promise<boolean> {
  const [row] = await tx
    .select({ id: todoTasksTable.id })
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.workspaceId, workspaceId),
        eq(todoTasksTable.relatedBatchId, batchId),
        eq(todoTasksTable.taskType, taskType),
        inArray(todoTasksTable.status, [...OPEN_TASK_STATUSES_FOR_RECOVERY]),
      ),
    )
    .limit(1);
  return row != null;
}

/**
 * Slice 8A — recreate missing create_voluum_campaign_* tasks for the active run only.
 * Does not advance progression or duplicate open tasks.
 */
export async function recreateMissingCreateVoluumCampaignTasks(
  workspaceId: number,
  batchId: number,
  tx: Tx,
): Promise<RecreateCreateTasksResult> {
  const [activeRun] = await tx
    .select({
      id: batchTrafficSourceRunsTable.id,
      trafficSourceId: batchTrafficSourceRunsTable.trafficSourceId,
      iosCampaignId: batchTrafficSourceRunsTable.iosCampaignId,
      androidCampaignId: batchTrafficSourceRunsTable.androidCampaignId,
    })
    .from(batchTrafficSourceRunsTable)
    .where(
      and(
        eq(batchTrafficSourceRunsTable.workspaceId, workspaceId),
        eq(batchTrafficSourceRunsTable.batchId, batchId),
        eq(batchTrafficSourceRunsTable.status, "active"),
      ),
    )
    .orderBy(desc(batchTrafficSourceRunsTable.position))
    .limit(1);

  if (!activeRun) {
    throw new Error("No active traffic source run for this batch");
  }

  const [batch] = await tx
    .select({
      employeeId: testingBatchesTable.employeeId,
      batchName: testingBatchesTable.batchName,
    })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.id, batchId),
        eq(testingBatchesTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!batch?.employeeId) {
    throw new Error("Batch has no assigned worker");
  }

  const [source] = await tx
    .select({ name: workspaceTrafficSourcesTable.name })
    .from(workspaceTrafficSourcesTable)
    .where(
      and(
        eq(workspaceTrafficSourcesTable.id, activeRun.trafficSourceId),
        eq(workspaceTrafficSourcesTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  const sourceName = source?.name ?? `traffic source #${activeRun.trafficSourceId}`;
  const batchName = batch.batchName ?? `Batch #${batchId}`;

  const beforeIds = new Set(
    (
      await tx
        .select({ id: todoTasksTable.id })
        .from(todoTasksTable)
        .where(
          and(
            eq(todoTasksTable.workspaceId, workspaceId),
            eq(todoTasksTable.relatedBatchId, batchId),
            inArray(todoTasksTable.taskType, [
              "create_voluum_campaign_ios",
              "create_voluum_campaign_android",
            ]),
            inArray(todoTasksTable.status, [...OPEN_TASK_STATUSES_FOR_RECOVERY]),
          ),
        )
    ).map((r) => r.id),
  );

  const toCreate: Array<Extract<Action, { type: "CreateTask" }>> = [];

  if (
    activeRun.iosCampaignId == null &&
    !(await hasOpenCreateVoluumTask(tx, workspaceId, batchId, "create_voluum_campaign_ios"))
  ) {
    toCreate.push({
      type: "CreateTask",
      workspaceId,
      data: {
        employeeId: batch.employeeId,
        relatedBatchId: batchId,
        title: `Create Voluum campaign (iOS) for ${batchName} on ${sourceName}`,
        taskType: "create_voluum_campaign_ios",
        priority: "high",
        trafficSourceId: activeRun.trafficSourceId,
      },
    });
  }

  if (
    activeRun.androidCampaignId == null &&
    !(await hasOpenCreateVoluumTask(tx, workspaceId, batchId, "create_voluum_campaign_android"))
  ) {
    toCreate.push({
      type: "CreateTask",
      workspaceId,
      data: {
        employeeId: batch.employeeId,
        relatedBatchId: batchId,
        title: `Create Voluum campaign (Android) for ${batchName} on ${sourceName}`,
        taskType: "create_voluum_campaign_android",
        priority: "high",
        trafficSourceId: activeRun.trafficSourceId,
      },
    });
  }

  if (toCreate.length === 0) {
    return {
      runId: activeRun.id,
      trafficSourceId: activeRun.trafficSourceId,
      createdTasks: [],
      idempotent: true,
    };
  }

  await applyActions(toCreate, tx);

  const afterRows = await tx
    .select({ id: todoTasksTable.id, taskType: todoTasksTable.taskType })
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.workspaceId, workspaceId),
        eq(todoTasksTable.relatedBatchId, batchId),
        inArray(todoTasksTable.taskType, [
          "create_voluum_campaign_ios",
          "create_voluum_campaign_android",
        ]),
        inArray(todoTasksTable.status, [...OPEN_TASK_STATUSES_FOR_RECOVERY]),
      ),
    );

  const createdTasks = afterRows
    .filter((row) => !beforeIds.has(row.id))
    .map((row) => ({ id: row.id, taskType: row.taskType }));

  return {
    runId: activeRun.id,
    trafficSourceId: activeRun.trafficSourceId,
    createdTasks,
    idempotent: createdTasks.length === 0,
  };
}

/**
 * Phase 5e: idempotent CreateBatch executor. Upserts on
 * `(workspaceId, batchTag)` so re-syncs of the same tag refresh
 * `numberOfOffers` / `lastSyncAt` instead of inserting a duplicate.
 * Returns `{id, isNew}` so producers (autoGroupOffersIntoBatches)
 * know whether to chain-emit `BatchCreated` for the cascade.
 */
export async function executeCreateBatch(
  action: CreateBatchAction,
  tx: Tx,
): Promise<{ id: number; isNew: boolean }> {
  // Workspace-isolation lint requires the `workspaceId:` literal to
  // appear inside the .values(...) call (not behind a variable
  // alias), so the AST scanner can prove every insert site is
  // workspace-scoped without needing to follow data flow. Inline the
  // values literal accordingly; conditional spreads carry the two
  // optional columns without forcing them to null/undefined when the
  // caller omits them.
  const builder = tx.insert(testingBatchesTable).values({
    workspaceId: action.workspaceId,
    employeeId: action.data.employeeId,
    batchName: action.data.batchName,
    affiliateNetwork: action.data.affiliateNetwork,
    geo: action.data.geo,
    trafficSource: action.data.trafficSource,
    batchTag: action.data.batchTag,
    affiliateNetworkId: action.data.affiliateNetworkId ?? null,
    ...(action.data.numberOfOffers !== undefined
      ? { numberOfOffers: action.data.numberOfOffers }
      : {}),
    ...(action.data.lastSyncAt !== undefined
      ? { lastSyncAt: action.data.lastSyncAt }
      : {}),
  });

  // ON CONFLICT update payload mirrors the same two optional fields
  // when present. Kept as a typed Partial so Drizzle's column-name
  // inference still applies.
  const conflictSet: Partial<typeof testingBatchesTable.$inferInsert> = {};
  if (action.data.numberOfOffers !== undefined) {
    conflictSet.numberOfOffers = action.data.numberOfOffers;
  }
  if (action.data.lastSyncAt !== undefined) {
    conflictSet.lastSyncAt = action.data.lastSyncAt;
  }

  // Deterministic insert-vs-update detection via Postgres `xmax`:
  // a row freshly inserted by THIS statement has xmax = 0; an
  // ON CONFLICT DO UPDATE branch produces a non-zero xmax (the
  // conflicting row was locked for update). This is robust against
  // clock skew, slow tx commits, and connection pool delays — it
  // cannot misclassify the way a `createdAt` time-window heuristic
  // could. See PostgreSQL docs §73.5 (System Columns).
  const returningCols = {
    id: testingBatchesTable.id,
    inserted: sql<boolean>`(xmax = 0)`,
  } as const;

  const upserted =
    Object.keys(conflictSet).length > 0
      ? await builder
          .onConflictDoUpdate({
            target: [
              testingBatchesTable.workspaceId,
              testingBatchesTable.batchTag,
            ],
            set: conflictSet,
          })
          .returning(returningCols)
      : await builder.returning(returningCols);

  const row = upserted[0];
  return { id: row.id, isNew: row.inserted === true };
}

/**
 * Apply a single action inside the supplied transaction. Caller is
 * responsible for transaction boundaries — the bus always wraps in one.
 */
export async function applyAction(action: Action, tx: Tx): Promise<void> {
  switch (action.type) {
    case "CreateBatch": {
      // Status defaults to "NEW_BATCH" via the column default.
      await executeCreateBatch(action, tx);
      return;
    }

    case "CreateTask": {
      const createdTasks = await tx
        .insert(todoTasksTable)
        .values({
          workspaceId: action.workspaceId,
          employeeId: action.data.employeeId,
          relatedBatchId: action.data.relatedBatchId,
          title: action.data.title,
          description: action.data.description ?? null,
          taskType: action.data.taskType,
          priority: action.data.priority ?? "medium",
          status: "TODO",
          trackerCampaignDevice: action.data.trackerCampaignDevice ?? null,
          trafficSourceId: action.data.trafficSourceId ?? null,
          relatedCampaignId: action.data.relatedCampaignId ?? null,
          flashing: action.data.flashing ?? false,
          dueDate: action.data.dueDate ?? null,
        })
        // Pivot Phase 4 (Task #27): the partial unique index
        // `todo_tasks_open_batch_auto_unique` (and the existing
        // tracker-task index) make concurrent rule firings safe —
        // the second insert silently no-ops instead of crashing the
        // engine tx.
        .onConflictDoNothing()
        .returning({
          id: todoTasksTable.id,
          workspaceId: todoTasksTable.workspaceId,
          employeeId: todoTasksTable.employeeId,
          relatedBatchId: todoTasksTable.relatedBatchId,
          relatedCampaignId: todoTasksTable.relatedCampaignId,
          taskType: todoTasksTable.taskType,
          priority: todoTasksTable.priority,
          trafficSourceId: todoTasksTable.trafficSourceId,
        });
      await recordTaskCreatedOperationalEvents(tx, createdTasks);
      return;
    }

    case "GoLiveBatchCampaigns": {
      const batchCampaigns = await tx
        .select({
          id: campaignsTable.id,
          status: campaignsTable.status,
          platform: campaignsTable.platform,
        })
        .from(campaignsTable)
        .where(
          and(
            eq(campaignsTable.workspaceId, action.workspaceId),
            eq(campaignsTable.batchId, action.batchId),
          ),
        );

      if (batchCampaigns.length === 0) {
        throw new Error("Batch has no campaigns yet");
      }
      const blocking = batchCampaigns.filter(
        (campaign) => campaign.status !== "ready" && campaign.status !== "live",
      );
      if (blocking.length > 0) {
        throw new Error("All batch campaigns must be ready before going live");
      }

      await tx
        .update(testingBatchesTable)
        .set({ liveAt: sql`coalesce(${testingBatchesTable.liveAt}, now())` })
        .where(
          and(
            eq(testingBatchesTable.id, action.batchId),
            eq(testingBatchesTable.workspaceId, action.workspaceId),
          ),
        );

      for (const campaign of batchCampaigns) {
        if (campaign.status !== "ready") continue;
        const [updated] = await tx
          .update(campaignsTable)
          .set({ status: "live", updatedAt: new Date() })
          .where(
            and(
              eq(campaignsTable.id, campaign.id),
              eq(campaignsTable.workspaceId, action.workspaceId),
              eq(campaignsTable.status, "ready"),
            ),
          )
          .returning({
            id: campaignsTable.id,
            batchId: campaignsTable.batchId,
            platform: campaignsTable.platform,
          });
        if (!updated || updated.batchId == null) continue;
        await emitWithinTx(tx, {
          type: "CampaignStatusChanged",
          workspaceId: action.workspaceId,
          payload: {
            campaignId: updated.id,
            batchId: updated.batchId,
            platform: updated.platform,
            from: "ready",
            to: "live",
          },
          dedupeKey: `phase5_go_live:${updated.id}`,
        });
      }
      return;
    }

    case "CompleteTask": {
      await tx
        .update(todoTasksTable)
        .set({ status: "DONE" })
        .where(eq(todoTasksTable.id, action.taskId));
      return;
    }

    case "CompleteTaskFromRequest": {
      const [task] = await tx
        .select()
        .from(todoTasksTable)
        .where(
          and(
            eq(todoTasksTable.id, action.taskId),
            eq(todoTasksTable.workspaceId, action.workspaceId),
          ),
        )
        .limit(1);
      if (!task || task.status === "DONE") return;

      let resolvedCampaignId = task.relatedCampaignId ?? null;
      let completionPayload: Record<string, unknown> = {};
      let takeCampaignLive:
        | {
            campaignId: number;
            trafficSourceCampaignId: string;
          }
        | null = null;
      let linkedCampaign:
        | {
            campaignId: number;
            batchId: number;
            platform: "ios" | "android";
            trafficSourceId: number;
          }
        | null = null;

      switch (action.completion.kind) {
        case "manual":
          completionPayload = {};
          break;

        case "generic":
          completionPayload = action.completion.completionPayload ?? {};
          break;

        case "create_voluum_campaign": {
          if (task.relatedBatchId == null) {
            throw new Error("Task is missing relatedBatchId");
          }
          const voluumCampaignId = action.completion.voluumCampaignId.trim();
          if (!voluumCampaignId) {
            throw new Error("voluumCampaignId is required");
          }
          const [existingVoluumLink] = await tx
            .select({ id: campaignsTable.id })
            .from(campaignsTable)
            .where(
              and(
                eq(campaignsTable.workspaceId, action.workspaceId),
                eq(campaignsTable.voluumCampaignId, voluumCampaignId),
              ),
            )
            .limit(1);
          if (existingVoluumLink) {
            throw new Error(
              `Voluum campaign ID "${voluumCampaignId}" is already linked to another campaign in this workspace`,
            );
          }
          const [tsRow] = await tx
            .select({ id: workspaceTrafficSourcesTable.id })
            .from(workspaceTrafficSourcesTable)
            .where(
              and(
                eq(workspaceTrafficSourcesTable.id, action.completion.trafficSourceId),
                eq(workspaceTrafficSourcesTable.workspaceId, action.workspaceId),
              ),
            )
            .limit(1);
          if (!tsRow) {
            throw new Error("trafficSourceId does not belong to this workspace");
          }

          const [campaign] = await tx
            .insert(campaignsTable)
            .values({
              workspaceId: action.workspaceId,
              batchId: task.relatedBatchId,
              platform: action.completion.platform,
              campaignName: action.completion.campaignName,
              trafficSourceId: action.completion.trafficSourceId,
              campaignUrl: action.completion.campaignUrl ?? null,
              voluumCampaignId,
              voluumCampaignName: action.completion.voluumCampaignName,
              status: "voluum_created",
            })
            .returning({ id: campaignsTable.id });
          resolvedCampaignId = campaign.id;
          linkedCampaign = {
            campaignId: campaign.id,
            batchId: task.relatedBatchId,
            platform: action.completion.platform,
            trafficSourceId: action.completion.trafficSourceId,
          };

          await tx
            .update(batchTrafficSourceRunsTable)
            .set(
              action.completion.platform === "ios"
                ? { iosCampaignId: campaign.id }
                : { androidCampaignId: campaign.id },
            )
            .where(
              and(
                eq(batchTrafficSourceRunsTable.workspaceId, action.workspaceId),
                eq(batchTrafficSourceRunsTable.batchId, task.relatedBatchId),
                eq(batchTrafficSourceRunsTable.trafficSourceId, action.completion.trafficSourceId),
                eq(batchTrafficSourceRunsTable.status, "active"),
              ),
            );

          completionPayload = {
            trafficSourceId: action.completion.trafficSourceId,
            voluumCampaignId,
            voluumCampaignName: action.completion.voluumCampaignName,
            campaignName: action.completion.campaignName,
            campaignUrl: action.completion.campaignUrl ?? null,
          };
          break;
        }

        case "take_campaign_live": {
          if (task.relatedCampaignId == null) {
            throw new Error("Task missing relatedCampaignId");
          }
          resolvedCampaignId = task.relatedCampaignId;
          takeCampaignLive = {
            campaignId: task.relatedCampaignId,
            trafficSourceCampaignId: action.completion.trafficSourceCampaignId,
          };
          completionPayload = {
            trafficSourceCampaignId: action.completion.trafficSourceCampaignId,
          };
          break;
        }

        case "find_winners": {
          if (task.relatedCampaignId == null) {
            throw new Error("Task missing relatedCampaignId");
          }
          if (action.completion.outcome === "failed") {
            const [updatedCampaign] = await tx
              .update(campaignsTable)
              .set({
                status: "closed",
                notes: action.completion.notes ?? action.completion.failureReason,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(campaignsTable.id, task.relatedCampaignId),
                  eq(campaignsTable.workspaceId, action.workspaceId),
                ),
              )
              .returning({ id: campaignsTable.id });
            if (!updatedCampaign) {
              throw new Error("Campaign not found");
            }
            resolvedCampaignId = task.relatedCampaignId;
            completionPayload = {
              outcome: "failed",
              failureReason: action.completion.failureReason,
              notes: action.completion.notes ?? null,
            };
            break;
          }

          const roi =
            action.completion.cost > 0
              ? (action.completion.revenue - action.completion.cost) / action.completion.cost
              : null;
          const [updatedCampaign] = await tx
            .update(campaignsTable)
            .set({
              status: "tested",
              winnersCount: action.completion.winnersCount,
              revenue: String(action.completion.revenue),
              cost: String(action.completion.cost),
              clicks: action.completion.clicks ?? null,
              conversions: action.completion.conversions ?? null,
              roi: roi != null ? String(roi) : null,
              notes: action.completion.notes ?? null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(campaignsTable.id, task.relatedCampaignId),
                eq(campaignsTable.workspaceId, action.workspaceId),
              ),
            )
            .returning({ id: campaignsTable.id });
          if (!updatedCampaign) {
            throw new Error("Campaign not found");
          }
          resolvedCampaignId = task.relatedCampaignId;
          completionPayload = {
            ...(action.completion.outcome === "success" ? { outcome: "success" } : {}),
            winnersCount: action.completion.winnersCount,
            revenue: action.completion.revenue,
            cost: action.completion.cost,
            clicks: action.completion.clicks ?? null,
            conversions: action.completion.conversions ?? null,
            notes: action.completion.notes ?? null,
          };
          break;
        }

        case "review_winners_target": {
          if (task.taskType !== "review_winners_target") {
            throw new Error("Task type mismatch for review_winners_target completion");
          }
          if (task.relatedBatchId == null || task.trafficSourceId == null) {
            throw new Error("review_winners_target task missing batch or traffic source link");
          }

          const out = action.completion.outcome;
          let ids: string[] = [];
          if (out === "winners") {
            const parsedIds = parseVoluumOfferIdsFromStrings(action.completion.winnerOfferIds ?? []);
            if ("error" in parsedIds) throw new Error(parsedIds.error);
            ids = parsedIds.ok;
            if (ids.length === 0) {
              throw new Error("winnerOfferIds required when outcome is winners");
            }
          }

          const [run] = await tx
            .select({
              iosCampaignId: batchTrafficSourceRunsTable.iosCampaignId,
              androidCampaignId: batchTrafficSourceRunsTable.androidCampaignId,
            })
            .from(batchTrafficSourceRunsTable)
            .where(
              and(
                eq(batchTrafficSourceRunsTable.workspaceId, action.workspaceId),
                eq(batchTrafficSourceRunsTable.batchId, task.relatedBatchId),
                eq(batchTrafficSourceRunsTable.trafficSourceId, task.trafficSourceId),
              ),
            )
            .limit(1);
          if (!run) {
            throw new Error("Traffic source run not found for winner review task");
          }

          const note = action.completion.notes?.trim() || null;
          const campaignIds = [run.iosCampaignId, run.androidCampaignId].filter(
            (cid): cid is number => cid != null,
          );

          for (const campaignId of campaignIds) {
            const [camp] = await tx
              .select({
                platform: campaignsTable.platform,
                status: campaignsTable.status,
              })
              .from(campaignsTable)
              .where(
                and(
                  eq(campaignsTable.id, campaignId),
                  eq(campaignsTable.workspaceId, action.workspaceId),
                ),
              )
              .limit(1);
            if (!camp) {
              throw new Error("Campaign not found");
            }
            if (out === "winners" && ids.length > 0) {
              await insertCampaignWinnersTx(tx, {
                workspaceId: action.workspaceId,
                batchId: task.relatedBatchId,
                campaignId,
                trafficSourceId: task.trafficSourceId,
                platform: camp.platform,
                offerIds: ids,
                source: "target_reached_review",
                detectedByEmployeeId: action.completedByEmployeeId,
                notes: note,
              });
              const [campRow] = await tx
                .select({
                  campaignName: campaignsTable.campaignName,
                  batchId: campaignsTable.batchId,
                })
                .from(campaignsTable)
                .where(
                  and(
                    eq(campaignsTable.id, campaignId),
                    eq(campaignsTable.workspaceId, action.workspaceId),
                  ),
                )
                .limit(1);
              const [batchRow] =
                campRow?.batchId != null
                  ? await tx
                      .select({ batchName: testingBatchesTable.batchName })
                      .from(testingBatchesTable)
                      .where(eq(testingBatchesTable.id, campRow.batchId))
                      .limit(1)
                  : [undefined];
              const displayName = resolveCampaignDisplayName({
                campaignName: campRow?.campaignName,
                batchName: batchRow?.batchName,
                platform: camp.platform,
              });
              await appendOperationalActivity(tx, {
                workspaceId: action.workspaceId,
                eventType: "winner_added",
                entityType: "campaign",
                entityId: campaignId,
                actorEmployeeId: action.completedByEmployeeId,
                title: winnersAddedTitle(displayName, ids.length),
                metadata: { offerIds: ids, source: "target_reached_review" },
              });
            }
            if (camp.status === "ready_for_winner_review") {
              await tx
                .update(campaignsTable)
                .set({
                  status: "tested",
                  notes: note,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(campaignsTable.id, campaignId),
                    eq(campaignsTable.workspaceId, action.workspaceId),
                    eq(campaignsTable.status, "ready_for_winner_review"),
                  ),
                );
            }
          }

          resolvedCampaignId = campaignIds[0] ?? resolvedCampaignId;
          completionPayload = {
            outcome: out,
            winnerOfferIds: out === "winners" ? ids : [],
            notes: note,
          };
          break;
        }

        case "all_traffic_sources_tested":
          completionPayload = {};
          break;

        default:
          assertNever(action.completion);
      }

      const [updated] = await tx
        .update(todoTasksTable)
        .set({
          status: "DONE",
          relatedCampaignId: resolvedCampaignId,
          completedAt: new Date(),
          completedByEmployeeId: action.completedByEmployeeId,
          completionPayload,
        })
        .where(
          and(
            eq(todoTasksTable.id, action.taskId),
            eq(todoTasksTable.workspaceId, action.workspaceId),
            ne(todoTasksTable.status, "DONE"),
          ),
        )
        .returning();
      if (!updated) return;

      if (takeCampaignLive !== null) {
        const [updatedCampaign] = await tx
          .update(campaignsTable)
          .set({
            status: "live",
            liveStartedAt: sql`coalesce(${campaignsTable.liveStartedAt}, now())`,
            trafficSourceCampaignId: takeCampaignLive.trafficSourceCampaignId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(campaignsTable.id, takeCampaignLive.campaignId),
              eq(campaignsTable.workspaceId, action.workspaceId),
            ),
          )
          .returning({ id: campaignsTable.id });
        if (!updatedCampaign) {
          throw new Error("Campaign not found");
        }
      }

      if (action.completion.kind !== "manual") {
        await emitWithinTx(tx, {
          type: "TaskCompleted",
          workspaceId: action.workspaceId,
          payload: {
            taskId: updated.id,
            taskType: updated.taskType,
            relatedBatchId: updated.relatedBatchId,
            relatedCampaignId: resolvedCampaignId,
          },
          dedupeKey: `task_completed:${updated.id}`,
        });

        if (linkedCampaign !== null) {
          await recordOperationalEvent({
            workspaceId: action.workspaceId,
            entityType: "campaign",
            entityId: linkedCampaign.campaignId,
            eventType: "CAMPAIGN_LINKED",
            actorType: "employee",
            actorId: action.completedByEmployeeId,
            source: "engine",
            payloadJson: {
              taskId: updated.id,
              taskType: updated.taskType,
              batchId: linkedCampaign.batchId,
              platform: linkedCampaign.platform,
              trafficSourceId: linkedCampaign.trafficSourceId,
            },
          }, tx);
        }

        await recordOperationalEvent({
          workspaceId: action.workspaceId,
          entityType: "task",
          entityId: updated.id,
          eventType: "TASK_COMPLETED",
          actorType: "employee",
          actorId: action.completedByEmployeeId,
          source: "engine",
          payloadJson: {
            taskType: updated.taskType,
            relatedBatchId: updated.relatedBatchId,
            relatedCampaignId: resolvedCampaignId,
            completionKind: action.completion.kind,
          },
        }, tx);

        await appendOperationalActivity(tx, {
          workspaceId: action.workspaceId,
          eventType: "task_completed",
          entityType: "task",
          entityId: updated.id,
          actorEmployeeId: action.completedByEmployeeId,
          title: taskCompletedTitle(updated.title),
          metadata: {
            taskType: updated.taskType,
            completionKind: action.completion.kind,
          },
        });

        const { awardTaskCompletionXp } = await import("../routes/performance-engine.ts");
        await awardTaskCompletionXp(
          action.workspaceId,
          action.completedByEmployeeId,
          updated.taskType,
          updated.id,
          tx,
        );

        if (linkedCampaign !== null) {
          let campaignName = "Campaign";
          if (action.completion.kind === "create_voluum_campaign") {
            campaignName = action.completion.campaignName;
          }
          const [batchRow] = await tx
            .select({ batchName: testingBatchesTable.batchName })
            .from(testingBatchesTable)
            .where(eq(testingBatchesTable.id, linkedCampaign.batchId))
            .limit(1);
          await appendOperationalActivity(tx, {
            workspaceId: action.workspaceId,
            eventType: "campaign_linked",
            entityType: "campaign",
            entityId: linkedCampaign.campaignId,
            actorEmployeeId: action.completedByEmployeeId,
            title: campaignLinkedTitle({
              campaignName,
              platform: linkedCampaign.platform,
              batchName: batchRow?.batchName,
            }),
            metadata: {
              batchId: linkedCampaign.batchId,
              trafficSourceId: linkedCampaign.trafficSourceId,
              taskId: updated.id,
            },
          });
        }

        if (takeCampaignLive !== null) {
          const [liveCamp] = await tx
            .select({
              campaignName: campaignsTable.campaignName,
              batchId: campaignsTable.batchId,
              platform: campaignsTable.platform,
            })
            .from(campaignsTable)
            .where(
              and(
                eq(campaignsTable.id, takeCampaignLive.campaignId),
                eq(campaignsTable.workspaceId, action.workspaceId),
              ),
            )
            .limit(1);
          const [batchRow] =
            liveCamp?.batchId != null
              ? await tx
                  .select({ batchName: testingBatchesTable.batchName })
                  .from(testingBatchesTable)
                  .where(eq(testingBatchesTable.id, liveCamp.batchId))
                  .limit(1)
              : [undefined];
          const displayName = resolveCampaignDisplayName({
            campaignName: liveCamp?.campaignName,
            batchName: batchRow?.batchName,
            platform: liveCamp?.platform ?? "ios",
          });
          await appendOperationalActivity(tx, {
            workspaceId: action.workspaceId,
            eventType: "campaign_live",
            entityType: "campaign",
            entityId: takeCampaignLive.campaignId,
            actorEmployeeId: action.completedByEmployeeId,
            title: campaignLiveTitle(displayName),
            metadata: { taskId: updated.id },
          });
        }
      }
      return;
    }

    case "CompleteTrafficSourceRunPlatform": {
      const [run] = await tx
        .select({
          id: batchTrafficSourceRunsTable.id,
          position: batchTrafficSourceRunsTable.position,
          status: batchTrafficSourceRunsTable.status,
          iosStatus: batchTrafficSourceRunsTable.iosStatus,
          androidStatus: batchTrafficSourceRunsTable.androidStatus,
        })
        .from(batchTrafficSourceRunsTable)
        .where(
          and(
            eq(batchTrafficSourceRunsTable.workspaceId, action.workspaceId),
            eq(batchTrafficSourceRunsTable.batchId, action.batchId),
            eq(batchTrafficSourceRunsTable.trafficSourceId, action.trafficSourceId),
          ),
        )
        .limit(1);
      if (!run) return;

      const currentPlatformStatus =
        action.platform === "ios" ? run.iosStatus : run.androidStatus;
      if (TERMINAL_PLATFORM_STATUSES.has(currentPlatformStatus)) return;

      const nextIosStatus =
        action.platform === "ios" ? action.outcome : run.iosStatus;
      const nextAndroidStatus =
        action.platform === "android" ? action.outcome : run.androidStatus;
      const nextRunStatus = deriveTrafficSourceRunStatus(
        nextIosStatus,
        nextAndroidStatus,
      );
      const now = new Date();

      await tx
        .update(batchTrafficSourceRunsTable)
        .set({
          status: nextRunStatus,
          ...(nextRunStatus === "completed" || nextRunStatus === "failed" || nextRunStatus === "skipped"
            ? { completedAt: now }
            : {}),
          ...(action.platform === "ios"
            ? {
                iosStatus: action.outcome,
                iosCampaignId: action.campaignId,
                iosCompletedAt: now,
                iosFailureReason:
                  action.outcome === "failed" ? action.failureReason ?? null : null,
              }
            : {
                androidStatus: action.outcome,
                androidCampaignId: action.campaignId,
                androidCompletedAt: now,
                androidFailureReason:
                  action.outcome === "failed" ? action.failureReason ?? null : null,
              }),
        })
        .where(eq(batchTrafficSourceRunsTable.id, run.id));

      if (isTerminalTrafficSourceRunStatus(nextRunStatus)) {
        await recordTrafficSourceRunTerminalOperationalEvent(
          {
            workspaceId: action.workspaceId,
            batchId: action.batchId,
            runId: run.id,
            trafficSourceId: action.trafficSourceId,
            status: nextRunStatus,
            iosStatus: nextIosStatus,
            androidStatus: nextAndroidStatus,
          },
          tx,
        );
      }

      if (shouldAdvanceTrafficSourceRun(nextIosStatus, nextAndroidStatus, nextRunStatus)) {
        await activateNextTrafficSourceRun(tx, action, run.position);
      }
      return;
    }

    case "UpdateCampaignStatus": {
      // Pivot Phase 4 (Task #27): mutate the campaign and chain-emit
      // `CampaignStatusChanged` so the campaign-status-changed rule
      // schedules GO_LIVE / OPTIMIZATION_FOLLOWUP downstream. The
      // .where() asserts the `from` state so a concurrent update
      // can't double-fire the cascade — the second UPDATE matches 0
      // rows and the chain-emit is suppressed.
      const updated = await tx
        .update(campaignsTable)
        .set({ status: action.to, updatedAt: new Date() })
        .where(
          and(
            eq(campaignsTable.id, action.campaignId),
            eq(campaignsTable.workspaceId, action.workspaceId),
            eq(campaignsTable.status, action.from),
          ),
        )
        .returning({
          id: campaignsTable.id,
          batchId: campaignsTable.batchId,
          platform: campaignsTable.platform,
        });
      if (updated.length === 0) return;
      const row = updated[0]!;
      if (row.batchId == null) return;
      // Chain-emit inside the parent tx so the downstream rule sees
      // the just-updated campaign row (committed only when the parent
      // tx commits).
      await emitWithinTx(tx, {
        type: "CampaignStatusChanged",
        workspaceId: action.workspaceId,
        payload: {
          campaignId: row.id,
          batchId: row.batchId,
          platform: row.platform,
          from: action.from,
          to: action.to,
        },
        dedupeKey: `campaign_status:${row.id}:${action.to}`,
      });
      return;
    }

    case "ChangeBatchStatus": {
      await tx
        .update(testingBatchesTable)
        .set({
          status: action.status,
          ...(action.liveAt !== undefined ? { liveAt: action.liveAt } : {}),
        })
        .where(
          and(
            eq(testingBatchesTable.id, action.batchId),
            eq(testingBatchesTable.workspaceId, action.workspaceId),
          ),
        );
      return;
    }

    case "CreateNotification": {
      await tx
        .insert(notificationsTable)
        .values({
          workspaceId: action.workspaceId,
          employeeId: action.data.employeeId,
          batchId: action.data.batchId ?? null,
          type: action.data.type,
          severity: action.data.severity ?? "info",
          message: action.data.message,
        });
      return;
    }

    case "RecordTrackerCampaign": {
      // Phase 5 sync emits TrackerCampaignImported when a Voluum
      // campaign with a known tag appears. The handler that observes
      // it returns this action to persist the row. Uniqueness is
      // enforced by the composite (batch_id, traffic_source_id, device)
      // unique index AND the (workspace_id, voluum_campaign_id)
      // unique index on tracker_campaigns. Phase 5c: the action is
      // idempotent — if either unique constraint already holds we
      // simply skip the insert. The bus's dedupeKey already prevents
      // most repeats; this is belt-and-braces for races + manual
      // re-emits.
      await tx
        .insert(trackerCampaignsTable)
        .values({
          workspaceId: action.workspaceId,
          batchId: action.data.batchId,
          trafficSourceId: action.data.trafficSourceId,
          device: action.data.device,
          voluumCampaignId: action.data.voluumCampaignId,
          tag: action.data.tag,
        })
        .onConflictDoNothing();
      return;
    }

    case "MarkTaskOverdue": {
      // Phase 7: engine-owned escalation. Sets the UI flashing flag and
      // records when the SLA was crossed. The cron emits TaskOverdue at
      // most once per task (deduped on `task_overdue:<id>`), so this
      // update happens exactly once over the task's lifetime — no need
      // for an idempotency guard here.
      await tx
        .update(todoTasksTable)
        .set({ flashing: true, escalatedAt: sql`now()` })
        .where(eq(todoTasksTable.id, action.taskId));
      return;
    }

    case "SetBatchTrafficSourceSnapshot": {
      // Spec-correction (post Phase 10): pin the workspace traffic-
      // source rotation order onto the batch row at creation time.
      // Stored as JSONB (orderedSources). currentTrafficSourceId is
      // set in the same statement so the two never diverge.
      await tx
        .update(testingBatchesTable)
        .set({
          trafficSourceOrderSnapshot: action.snapshot as unknown as object,
          currentTrafficSourceId: action.currentTrafficSourceId,
        })
        .where(eq(testingBatchesTable.id, action.batchId));
      return;
    }

    case "RecomputeBatchOfferCount": {
      // Spec-correction (post Phase 10): keep numberOfOffers consistent
      // after per-offer attachment in the OfferImported handler. Uses
      // a correlated subquery so the count is computed inside the
      // engine's tx (no read-then-write race against concurrent emits).
      await tx
        .update(testingBatchesTable)
        .set({
          numberOfOffers: sql<number>`(
            select count(*)::int from ${voluumOffersTable}
            where ${voluumOffersTable.workspaceId} = ${action.workspaceId}
              and ${voluumOffersTable.batchId} = ${action.batchId}
              and ${voluumOffersTable.isActive} = true
          )`,
        })
        .where(
          and(
            eq(testingBatchesTable.id, action.batchId),
            eq(testingBatchesTable.workspaceId, action.workspaceId),
          ),
        );
      return;
    }

    case "CreateCampaignTaskPair": {
      // Pivot Phase 4 (Task #27): seed the iOS + Android manual
      // campaign-creation tasks for a freshly-created batch. Two
      // inserts inside the same engine tx — if either fails the
      // BatchCreated emit rolls back and neither row persists.
      // Idempotency is owned by the BatchCreated event dedupe key
      // (`batch_created:<id>`); a re-emit short-circuits in event-bus
      // before this action is ever produced.
      const batchName = action.data.batchName;
      const createdIosTasks = await tx
        .insert(todoTasksTable)
        .values({
          workspaceId: action.workspaceId,
          employeeId: action.data.employeeId,
          relatedBatchId: action.data.batchId,
          title: `Create iOS campaign for ${batchName}`,
          taskType: "CREATE_IOS_CAMPAIGN",
          priority: "medium",
          status: "TODO",
        })
        .onConflictDoNothing()
        .returning({
          id: todoTasksTable.id,
          workspaceId: todoTasksTable.workspaceId,
          employeeId: todoTasksTable.employeeId,
          relatedBatchId: todoTasksTable.relatedBatchId,
          relatedCampaignId: todoTasksTable.relatedCampaignId,
          taskType: todoTasksTable.taskType,
          priority: todoTasksTable.priority,
          trafficSourceId: todoTasksTable.trafficSourceId,
        });
      await recordTaskCreatedOperationalEvents(tx, createdIosTasks);
      const createdAndroidTasks = await tx
        .insert(todoTasksTable)
        .values({
          workspaceId: action.workspaceId,
          employeeId: action.data.employeeId,
          relatedBatchId: action.data.batchId,
          title: `Create Android campaign for ${batchName}`,
          taskType: "CREATE_ANDROID_CAMPAIGN",
          priority: "medium",
          status: "TODO",
        })
        .onConflictDoNothing()
        .returning({
          id: todoTasksTable.id,
          workspaceId: todoTasksTable.workspaceId,
          employeeId: todoTasksTable.employeeId,
          relatedBatchId: todoTasksTable.relatedBatchId,
          relatedCampaignId: todoTasksTable.relatedCampaignId,
          taskType: todoTasksTable.taskType,
          priority: todoTasksTable.priority,
          trafficSourceId: todoTasksTable.trafficSourceId,
        });
      await recordTaskCreatedOperationalEvents(tx, createdAndroidTasks);
      return;
    }

    case "AdvanceTrafficSource": {
      // Move the batch's pointer to the next traffic source in its
      // snapshot order. The actual creation of follow-on tasks for the
      // new source is the rule's responsibility — it returns separate
      // CreateTask actions alongside this one.
      await tx
        .update(testingBatchesTable)
        .set({
          currentTrafficSourceId: action.nextTrafficSourceId,
          trafficSourceStep: sql`${testingBatchesTable.trafficSourceStep} + 1`,
        })
        .where(
          and(
            eq(testingBatchesTable.id, action.batchId),
            eq(testingBatchesTable.workspaceId, action.workspaceId),
          ),
        );
      return;
    }

    default:
      return assertNever(action);
  }
}

/** Apply a list of actions sequentially in the given transaction. */
export async function applyActions(actions: readonly Action[], tx: Tx): Promise<void> {
  for (const action of actions) {
    await applyAction(action, tx);
  }
}

// ── Route-callable executor helpers ───────────────────────────────────
//
// Phase 11 (post-spec): the testing-batches PATCH/DELETE/go-live
// routes used to mutate `testing_batches` directly behind a
// PHASE5_LEGACY_EXEMPTIONS allowlist. The exemption is gone; the
// routes now call these helpers, which are the single chokepoint for
// batch-row mutation just like `applyAction`. All of them are
// workspace-scoped so a stale id from a different workspace cannot
// silently mutate the wrong row.

export async function executeUpdateBatchFields(
  workspaceId: number,
  batchId: number,
  fields: Partial<typeof testingBatchesTable.$inferInsert>,
): Promise<typeof testingBatchesTable.$inferSelect | null> {
  if (Object.keys(fields).length === 0) {
    const [row] = await db
      .select()
      .from(testingBatchesTable)
      .where(
        and(
          eq(testingBatchesTable.id, batchId),
          eq(testingBatchesTable.workspaceId, workspaceId),
        ),
      );
    return row ?? null;
  }
  const [row] = await db
    .update(testingBatchesTable)
    .set(fields)
    .where(
      and(
        eq(testingBatchesTable.id, batchId),
        eq(testingBatchesTable.workspaceId, workspaceId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function executeDeleteBatch(
  workspaceId: number,
  batchId: number,
): Promise<typeof testingBatchesTable.$inferSelect | null> {
  const [row] = await db
    .delete(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.id, batchId),
        eq(testingBatchesTable.workspaceId, workspaceId),
      ),
    )
    .returning();
  return row ?? null;
}
