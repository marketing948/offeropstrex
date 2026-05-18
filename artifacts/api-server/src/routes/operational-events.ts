import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db, operationalEventsTable } from "@workspace/db";
import { requireWorkspaceFromQuery } from "../lib/workspace-access";

const router: IRouter = Router();

function parseLimit(raw: unknown, res: Response): number | null {
  if (raw == null || raw === "") return 50;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: "limit must be a positive integer" });
    return null;
  }
  return Math.min(n, 200);
}

function parseOffset(raw: unknown, res: Response): number | null {
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    res.status(400).json({ error: "offset must be a non-negative integer" });
    return null;
  }
  return n;
}

function parseDateQuery(raw: unknown, name: string, res: Response): Date | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") {
    res.status(400).json({ error: `${name} must be a date string` });
    return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    res.status(400).json({ error: `${name} must be a valid date` });
    return null;
  }
  return date;
}

function serialize(row: typeof operationalEventsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/operational-events", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const limit = parseLimit(req.query["limit"], res);
  if (limit === null) return;
  const offset = parseOffset(req.query["offset"], res);
  if (offset === null) return;
  const dateFrom = parseDateQuery(req.query["date_from"], "date_from", res);
  if (res.headersSent) return;
  const dateTo = parseDateQuery(req.query["date_to"], "date_to", res);
  if (res.headersSent) return;

  const conditions: SQL[] = [eq(operationalEventsTable.workspaceId, workspaceId)];

  if (req.query["entity_type"] != null && req.query["entity_type"] !== "") {
    conditions.push(eq(operationalEventsTable.entityType, String(req.query["entity_type"])));
  }
  if (req.query["event_type"] != null && req.query["event_type"] !== "") {
    conditions.push(eq(operationalEventsTable.eventType, String(req.query["event_type"])));
  }

  if (req.query["entity_id"] != null && req.query["entity_id"] !== "") {
    conditions.push(eq(operationalEventsTable.entityId, String(req.query["entity_id"])));
  }
  if (dateFrom !== null) conditions.push(gte(operationalEventsTable.createdAt, dateFrom));
  if (dateTo !== null) conditions.push(lte(operationalEventsTable.createdAt, dateTo));

  const where = and(...conditions);
  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(operationalEventsTable)
    .where(where);

  const rows = await db
    .select()
    .from(operationalEventsTable)
    .where(where)
    .orderBy(desc(operationalEventsTable.createdAt), desc(operationalEventsTable.id))
    .limit(limit)
    .offset(offset);

  res.json({
    items: rows.map(serialize),
    pagination: {
      limit,
      offset,
      total: Number(totalRow?.total ?? 0),
    },
  });
});

export default router;
