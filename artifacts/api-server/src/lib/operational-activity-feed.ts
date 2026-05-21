import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db, operationalActivityFeedTable } from "@workspace/db";
import type { Tx } from "../engine/types.ts";

export const OPERATIONAL_ACTIVITY_EVENT_TYPES = [
  "task_completed",
  "campaign_created",
  "campaign_linked",
  "campaign_live",
  "manual_metrics_submitted",
  "voluum_metrics_imported",
  "campaign_closed",
  "winner_added",
  "winner_promoted",
] as const;

export type OperationalActivityEventType = (typeof OPERATIONAL_ACTIVITY_EVENT_TYPES)[number];

export type AppendOperationalActivityInput = {
  workspaceId: number;
  eventType: OperationalActivityEventType;
  entityType: string;
  entityId: string | number;
  actorEmployeeId?: number | null;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ActivityDb = Pick<NodePgDatabase, "insert">;

function isTxClient(client: ActivityDb): client is Tx {
  return typeof (client as Tx).rollback === "function";
}

/**
 * Append-only activity row. Does not emit engine events or invoke handlers.
 * When called with a transaction client, failures propagate (rollback).
 * Otherwise failures are logged and swallowed so primary flows continue.
 */
export async function appendOperationalActivity(
  client: ActivityDb,
  input: AppendOperationalActivityInput,
): Promise<typeof operationalActivityFeedTable.$inferSelect | null> {
  const strict = isTxClient(client);
  try {
    const [row] = await client
      .insert(operationalActivityFeedTable)
      .values({
        workspaceId: input.workspaceId,
        eventType: input.eventType,
        entityType: input.entityType,
        entityId: String(input.entityId),
        actorEmployeeId: input.actorEmployeeId ?? null,
        title: input.title,
        description: input.description ?? null,
        metadataJson: input.metadata ?? null,
      })
      .returning();
    return row ?? null;
  } catch (err) {
    if (strict) throw err;
    console.error("[operational-activity-feed] append failed (non-blocking)", {
      workspaceId: input.workspaceId,
      eventType: input.eventType,
      err,
    });
    return null;
  }
}
