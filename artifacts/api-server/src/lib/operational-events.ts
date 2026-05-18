import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db, operationalEventsTable } from "@workspace/db";

export const OPERATIONAL_EVENT_TYPES = [
  "BATCH_CREATED",
  "CAMPAIGN_LINKED",
  "TASK_CREATED",
  "TASK_COMPLETED",
  "SYNC_PREVIEW_RUN",
  "WINNER_DETECTED",
  "AI_INSIGHT_CREATED",
] as const;

export type OperationalEventType = (typeof OPERATIONAL_EVENT_TYPES)[number] | (string & {});

export type RecordOperationalEventInput = {
  workspaceId: number;
  entityType: string;
  entityId: string | number;
  eventType: OperationalEventType;
  actorType?: string;
  actorId?: string | number | null;
  source: string;
  payloadJson?: Record<string, unknown>;
  createdAt?: Date;
};

type OperationalEventsDb = Pick<NodePgDatabase, "insert">;

export async function recordOperationalEvent(
  input: RecordOperationalEventInput,
  client: OperationalEventsDb = db,
): Promise<typeof operationalEventsTable.$inferSelect> {
  const [event] = await client
    .insert(operationalEventsTable)
    .values({
      workspaceId: input.workspaceId,
      entityType: input.entityType,
      entityId: String(input.entityId),
      eventType: input.eventType,
      actorType: input.actorType ?? "system",
      actorId: input.actorId == null ? null : String(input.actorId),
      source: input.source,
      payloadJson: input.payloadJson ?? {},
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning();

  return event;
}
