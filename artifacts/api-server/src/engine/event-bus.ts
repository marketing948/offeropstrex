// Phase 3: in-process event bus. `emit()` is the only supported way
// to write an event row + invoke handlers. Producers MUST NOT call
// `db.insert(eventsTable)` directly — doing so bypasses handler
// dispatch and idempotency checks.

import { db, eventsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { isVoluumEnabled, VOLUUM_ONLY_EVENT_TYPES } from "../lib/feature-flags";
import { applyActions } from "./executor.ts";
import { getHandlers } from "./handlers.ts";
import type { EmittedEvent, EventInput, Tx } from "./types.ts";

export interface EmitResult {
  /** The persisted event row id, or null if a duplicate dedupe key
   *  caused the insert to be skipped. */
  eventId: number | null;
  /** Number of handlers that ran for this event. */
  handlerCount: number;
  /** True if this emit was deduped against an existing row. */
  deduped: boolean;
}

/**
 * Persist an event and run its registered handlers atomically.
 *
 * - The event row, all handler reads/writes, and all action mutations
 *   share one DB transaction. Any thrown handler or executor error
 *   rolls back the entire emit (the row will not exist after rollback).
 * - If the event carries a `dedupeKey` and an existing row already has
 *   the same `(workspaceId, type, dedupeKey)`, the emit is a no-op:
 *   no handlers run, no row is written, `deduped: true` is returned.
 * - On a handler error the bus catches, opens a fresh transaction, and
 *   writes a "tombstone" event row with `processing_error` set so the
 *   failure is observable in the audit log even though the original tx
 *   rolled back. The original error is then re-thrown to the caller.
 */
export async function emit(event: EmittedEvent): Promise<EmitResult> {
  // Pivot Phase 0 — short-circuit Voluum-only event types when the
  // ENABLE_VOLUUM flag is off. Manual-flow events (BatchCreated,
  // BatchStatusChanged, BatchTested, BatchStatsUpdated, TaskCompleted,
  // TaskOverdue) continue to flow normally.
  if (!isVoluumEnabled() && VOLUUM_ONLY_EVENT_TYPES.has(event.type)) {
    logger.info(
      { type: event.type, workspaceId: event.workspaceId },
      "[engine] emit skipped — Voluum disabled",
    );
    return { eventId: null, handlerCount: 0, deduped: false };
  }

  const dedupeKey = event.dedupeKey ?? null;

  // Cheap pre-check outside the transaction — narrows the race window
  // but does not replace the unique index, which is the real guard.
  if (dedupeKey !== null) {
    const existing = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.workspaceId, event.workspaceId),
          eq(eventsTable.type, event.type),
          eq(eventsTable.dedupeKey, dedupeKey),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return { eventId: null, handlerCount: 0, deduped: true };
    }
  }

  try {
    return await db.transaction(async (tx) => emitWithinTx(tx, event));
  } catch (err) {
    // Insert violations on the partial unique index land here too —
    // treat them as a successful dedupe rather than a failure.
    const message = err instanceof Error ? err.message : String(err);
    if (
      dedupeKey !== null &&
      /events_workspace_type_dedupe_idx|duplicate key value/i.test(message)
    ) {
      logger.info(
        { workspaceId: event.workspaceId, type: event.type, dedupeKey },
        "[engine] emit deduped via unique-index race",
      );
      return { eventId: null, handlerCount: 0, deduped: true };
    }

    // Best-effort tombstone so the failure is auditable even though
    // the main tx rolled back. Use a fresh outer connection (no tx).
    logger.error(
      { err, workspaceId: event.workspaceId, type: event.type },
      "[engine] emit handler failed — writing tombstone",
    );
    try {
      await db.insert(eventsTable).values({
        workspaceId: event.workspaceId,
        type: event.type,
        payload: event.payload as unknown as Record<string, unknown>,
        dedupeKey: null,
        processedAt: new Date(),
        processingError: message.slice(0, 4000),
      });
    } catch (tombstoneErr) {
      logger.error({ err: tombstoneErr }, "[engine] tombstone write failed");
    }
    throw err;
  }
}

/**
 * Phase 5d: emit within an already-open transaction. Used by rule
 * handlers that need to chain a derived event (e.g. BatchStatsUpdated
 * → BatchTested, BatchTested → BatchStatusChanged) so the chained
 * event's row + side effects share the parent emit's tx and roll back
 * together on any handler error.
 *
 * Same dedupe + handler-dispatch semantics as `emit()`, but:
 *  - No db.transaction wrapper — the caller owns the tx boundary.
 *  - On unique-index dedupe race the partial unique index throws,
 *    which here would abort the parent tx. Callers therefore MUST
 *    guard with the cheap pre-check OR be sure the dedupe key is
 *    unique within the parent tx's scope. Most rule-driven chains
 *    satisfy the latter trivially (one chain per parent event).
 */
export async function emitWithinTx(
  tx: Tx,
  event: EmittedEvent,
): Promise<EmitResult> {
  const dedupeKey = event.dedupeKey ?? null;

  if (dedupeKey !== null) {
    const existing = await tx
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.workspaceId, event.workspaceId),
          eq(eventsTable.type, event.type),
          eq(eventsTable.dedupeKey, dedupeKey),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return { eventId: null, handlerCount: 0, deduped: true };
    }
  }

  const handlers = getHandlers(event.type);

  const [row] = await tx
    .insert(eventsTable)
    .values({
      workspaceId: event.workspaceId,
      type: event.type,
      payload: event.payload as unknown as Record<string, unknown>,
      dedupeKey,
    })
    .returning({ id: eventsTable.id });

  let handlerCount = 0;
  for (const handler of handlers) {
    const actions = await handler(event as EventInput, tx);
    await applyActions(actions, tx);
    handlerCount++;
  }

  await tx
    .update(eventsTable)
    .set({ processedAt: new Date() })
    .where(eq(eventsTable.id, row.id));

  return { eventId: row.id, handlerCount, deduped: false };
}
