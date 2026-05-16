// Phase 3: action executor. Every domain mutation produced by the
// engine flows through here. Routes / handlers must NOT call
// `db.update(testingBatchesTable)` etc. directly — the lint check at
// `scripts/src/check-no-direct-domain-mutations.ts` enforces this.

import {
  campaignsTable,
  db,
  testingBatchesTable,
  todoTasksTable,
  notificationsTable,
  trackerCampaignsTable,
  voluumOffersTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { emitWithinTx } from "./event-bus.ts";
import type { Action, BatchStatus, Tx } from "./types.ts";
import { assertNever } from "./types.ts";

type CreateBatchAction = Extract<Action, { type: "CreateBatch" }>;

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
      await tx
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
        .onConflictDoNothing();
      return;
    }

    case "CompleteTask": {
      await tx
        .update(todoTasksTable)
        .set({ status: "DONE" })
        .where(eq(todoTasksTable.id, action.taskId));
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
        .set({ status: action.status })
        .where(eq(testingBatchesTable.id, action.batchId));
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
      await tx
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
        .onConflictDoNothing();
      await tx
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
        .onConflictDoNothing();
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
        .where(eq(testingBatchesTable.id, action.batchId));
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

export async function executeChangeBatchStatusManual(
  workspaceId: number,
  batchId: number,
  status: BatchStatus,
): Promise<void> {
  await db
    .update(testingBatchesTable)
    .set({ status })
    .where(
      and(
        eq(testingBatchesTable.id, batchId),
        eq(testingBatchesTable.workspaceId, workspaceId),
      ),
    );
}

export async function executeGoLiveBatch(
  workspaceId: number,
  batchId: number,
): Promise<void> {
  await db
    .update(testingBatchesTable)
    .set({ status: "LIVE_TESTS", liveAt: new Date() })
    .where(
      and(
        eq(testingBatchesTable.id, batchId),
        eq(testingBatchesTable.workspaceId, workspaceId),
      ),
    );
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
