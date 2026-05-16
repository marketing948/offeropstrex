// Phase 3: replay an event from the events log without re-emitting.
//
// Usage (from the api-server package):
//   pnpm --filter @workspace/api-server run replay:event -- <event-id>
//
// The replay loads the persisted row, invokes registered handlers, and
// applies their actions inside a fresh transaction. The original
// event row's processedAt / processingError are NOT touched — replay
// is for recovery and audit, not for re-marking the timeline.
//
// IMPORTANT: replay only does anything if the relevant handler has
// been registered in this process. The Phase-4 rules registry is
// imported below so the CLI sees the same handler set as the live
// server.

import { db, eventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { applyActions } from "../engine/executor.ts";
import { getHandlers } from "../engine/handlers.ts";
import type { EventInput } from "../engine/types.ts";

// Side-effect import — registering rules in the registry is what
// makes replay non-trivial. Must come before main().
import "../engine/rules/index.ts";

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: replay-event <event-id>");
    process.exit(2);
  }
  const eventId = Number(arg);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    console.error(`invalid event id: ${arg}`);
    process.exit(2);
  }

  const [row] = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.id, eventId));
  if (!row) {
    console.error(`event ${eventId} not found`);
    process.exit(1);
  }

  const handlers = getHandlers(row.type as EventInput["type"]);
  if (handlers.length === 0) {
    console.warn(
      `[replay] no handlers registered for type=${row.type}; replay is a no-op. ` +
        `Either the event type is no longer in the rules registry, or it ` +
        `was always informational (no side effects).`,
    );
    process.exit(0);
  }

  const event = {
    type: row.type,
    workspaceId: row.workspaceId,
    payload: row.payload as Record<string, unknown>,
  } as EventInput;

  await db.transaction(async (tx) => {
    for (const handler of handlers) {
      const actions = await handler(event, tx);
      await applyActions(actions, tx);
    }
  });

  console.log(
    `[replay] event id=${eventId} type=${row.type} workspace=${row.workspaceId} replayed via ${handlers.length} handler(s).`,
  );
}

main().catch((err) => {
  console.error("[replay] failed:", err);
  process.exit(1);
});
