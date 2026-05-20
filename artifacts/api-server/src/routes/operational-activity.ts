import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { db, operationalActivityFeedTable } from "@workspace/db";
import {
  OPERATIONAL_ACTIVITY_EVENT_TYPES,
  type OperationalActivityEventType,
} from "../lib/operational-activity-feed.ts";
import { requireWorkspaceFromQuery } from "../lib/workspace-access";

const router: IRouter = Router();

const METRIC_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcDayBounds(dateStr: string): { start: Date; endExclusive: Date } {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const endExclusive = new Date(start);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, endExclusive };
}

function parseLimit(raw: unknown, res: Response): number | null {
  if (raw == null || raw === "") return 50;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: "limit must be a positive integer" });
    return null;
  }
  return Math.min(n, 200);
}

function parseDateQuery(raw: unknown, res: Response): string | null {
  if (raw == null || raw === "") return todayUtcDateString();
  if (typeof raw !== "string" || !METRIC_DATE_RE.test(raw)) {
    res.status(400).json({ error: "date must be YYYY-MM-DD" });
    return null;
  }
  return raw;
}

function parseEventType(
  raw: unknown,
  res: Response,
): OperationalActivityEventType | undefined | false {
  if (raw == null || raw === "") return undefined;
  const value = String(raw);
  if (!(OPERATIONAL_ACTIVITY_EVENT_TYPES as readonly string[]).includes(value)) {
    res.status(400).json({ error: `event_type must be one of: ${OPERATIONAL_ACTIVITY_EVENT_TYPES.join(", ")}` });
    return false;
  }
  return value as OperationalActivityEventType;
}

function parseActorEmployeeId(raw: unknown, res: Response): number | undefined | false {
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: "actor_employee_id must be a positive integer" });
    return false;
  }
  return n;
}

function serialize(row: typeof operationalActivityFeedTable.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    eventType: row.eventType,
    entityType: row.entityType,
    entityId: row.entityId,
    actorEmployeeId: row.actorEmployeeId,
    title: row.title,
    description: row.description,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/operational-activity", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const limit = parseLimit(req.query["limit"], res);
  if (limit === null) return;
  const date = parseDateQuery(req.query["date"], res);
  if (date === null) return;
  const eventType = parseEventType(req.query["event_type"], res);
  if (eventType === false) return;
  const actorEmployeeId = parseActorEmployeeId(req.query["actor_employee_id"], res);
  if (actorEmployeeId === false) return;

  const { start, endExclusive } = utcDayBounds(date);
  const conditions: SQL[] = [
    eq(operationalActivityFeedTable.workspaceId, workspaceId),
    gte(operationalActivityFeedTable.createdAt, start),
    lt(operationalActivityFeedTable.createdAt, endExclusive),
  ];

  if (eventType !== undefined) {
    conditions.push(eq(operationalActivityFeedTable.eventType, eventType));
  }
  if (actorEmployeeId !== undefined) {
    conditions.push(eq(operationalActivityFeedTable.actorEmployeeId, actorEmployeeId));
  }

  const where = and(...conditions);
  const rows = await db
    .select()
    .from(operationalActivityFeedTable)
    .where(where)
    .orderBy(desc(operationalActivityFeedTable.createdAt), desc(operationalActivityFeedTable.id))
    .limit(limit);

  res.json({
    date,
    items: rows.map(serialize),
  });
});

export default router;
