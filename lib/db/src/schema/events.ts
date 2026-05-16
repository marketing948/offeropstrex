import { pgTable, text, serial, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspacesTable } from "./workspaces";

// Phase 2: Append-only event log feeding the Phase 3 engine. Every state
// transition the engine cares about (sync detected campaign, worker
// closed task, threshold crossed, etc.) is appended here first; the
// engine drains the log, evaluates rules, and writes side effects.
export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  // Phase 3: optional dedupe key. When supplied by the producer, the
  // composite (workspace_id, type, dedupe_key) is unique — the engine
  // can be re-run safely against the same Voluum offer / batch / task
  // and only one event row will land. NULL keys are ignored by the
  // partial unique index, so untagged ad-hoc events are still allowed.
  dedupeKey: text("dedupe_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Engine sets processedAt when the event has been handled. NULL = pending.
  processedAt: timestamp("processed_at", { withTimezone: true }),
  // Last engine-error encountered while processing this event. NULL if
  // unprocessed or processed successfully.
  processingError: text("processing_error"),
}, (t) => ({
  // Cheap index for the engine's draining query: pending events per workspace
  // in arrival order.
  pendingByWorkspaceIdx: index("events_workspace_pending_idx").on(t.workspaceId, t.processedAt, t.id),
  // Phase 3: enforce idempotency when a dedupe key is provided. Postgres
  // treats multiple NULLs in a unique index as distinct, so this acts as
  // a partial unique constraint without needing an explicit WHERE.
  dedupeIdx: uniqueIndex("events_workspace_type_dedupe_idx").on(t.workspaceId, t.type, t.dedupeKey),
}));

export const insertEventSchema = createInsertSchema(eventsTable).omit({ id: true, createdAt: true, processedAt: true, processingError: true });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof eventsTable.$inferSelect;
