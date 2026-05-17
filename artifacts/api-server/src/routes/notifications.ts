import { Router, type IRouter } from "express";
import { eq, and, desc, type SQL } from "drizzle-orm";
import { db, notificationsTable, testingBatchesTable } from "@workspace/db";
import { requireWorkspaceFromQuery, requireWorkspaceAccess } from "../lib/workspace-access";
import { getEmployeeFromToken } from "./auth";

const router: IRouter = Router();

// Phase 2 / Bible §9 spec-canonical notification taxonomy. Mirrors the
// `notification_type` Postgres enum on `notificationsTable.type`.
const NOTIFICATION_TYPES = [
  "NEW_BATCH_CREATED",
  "TRACKER_CAMPAIGN_MISSING",
  "INVALID_TAG",
  "DUPLICATE_TRACKER_CAMPAIGN",
  "SUSPICIOUS_BATCH_UPDATE",
  "API_SYNC_FAILURE",
  "TASK_OVERDUE",
] as const;
type NotificationTypeStr = (typeof NOTIFICATION_TYPES)[number];

const NOTIFICATION_SEVERITIES = ["info", "warning", "high", "critical"] as const;
type NotificationSeverityStr = (typeof NOTIFICATION_SEVERITIES)[number];

function serializeNotification(
  n: typeof notificationsTable.$inferSelect,
  batchName?: string | null
) {
  return {
    ...n,
    createdAt: n.createdAt.toISOString(),
    batchName: batchName ?? null,
  };
}

router.get("/notifications", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const employeeId = req.query.employee_id ? Number(req.query.employee_id) : null;
  // Phase 7: support both legacy `unread_only` and spec name `unread`.
  const unreadOnly =
    req.query.unread_only === "true" || req.query.unread === "true";

  if (!employeeId || isNaN(employeeId)) {
    res.status(400).json({ error: "employee_id is required" });
    return;
  }

  const caller = await getEmployeeFromToken(req);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (caller.role !== "admin" && caller.id !== employeeId) {
    res.status(403).json({ error: "Cannot read another employee's notifications" });
    return;
  }

  const conditions: SQL[] = [
    eq(notificationsTable.employeeId, employeeId),
    eq(notificationsTable.workspaceId, workspaceId),
  ];
  if (unreadOnly) {
    conditions.push(eq(notificationsTable.read, false));
  }

  // Phase 7a: filter by Bible §9 type / severity.
  const typeParam = typeof req.query.type === "string" ? req.query.type : null;
  if (typeParam) {
    if (!(NOTIFICATION_TYPES as readonly string[]).includes(typeParam)) {
      res.status(400).json({
        error: `Invalid type. Allowed: ${NOTIFICATION_TYPES.join(", ")}`,
      });
      return;
    }
    conditions.push(
      eq(notificationsTable.type, typeParam as NotificationTypeStr),
    );
  }
  const sevParam = typeof req.query.severity === "string" ? req.query.severity : null;
  if (sevParam) {
    if (!(NOTIFICATION_SEVERITIES as readonly string[]).includes(sevParam)) {
      res.status(400).json({
        error: `Invalid severity. Allowed: ${NOTIFICATION_SEVERITIES.join(", ")}`,
      });
      return;
    }
    conditions.push(
      eq(notificationsTable.severity, sevParam as NotificationSeverityStr),
    );
  }

  const rows = await db
    .select({
      notification: notificationsTable,
      batchName: testingBatchesTable.batchName,
    })
    .from(notificationsTable)
    .leftJoin(testingBatchesTable, eq(notificationsTable.batchId, testingBatchesTable.id))
    .where(and(...conditions))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);

  res.json(rows.map(r => serializeNotification(r.notification, r.batchName)));
});

router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const { employeeId, workspaceId } = req.body;
  if (!employeeId) {
    res.status(400).json({ error: "employeeId is required" });
    return;
  }

  if ((await requireWorkspaceAccess(req, res, workspaceId ?? null)) === null) return;

  const caller = await getEmployeeFromToken(req);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (caller.role !== "admin" && caller.id !== Number(employeeId)) {
    res.status(403).json({ error: "Cannot modify another employee's notifications" });
    return;
  }

  await db
    .update(notificationsTable)
    .set({ read: true })
    .where(and(
      eq(notificationsTable.employeeId, employeeId),
      eq(notificationsTable.workspaceId, workspaceId),
      eq(notificationsTable.read, false)
    ));

  res.json({ success: true });
});

router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db.select({ workspaceId: notificationsTable.workspaceId, employeeId: notificationsTable.employeeId }).from(notificationsTable).where(eq(notificationsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Notification not found" }); return; }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  const caller = await getEmployeeFromToken(req);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (caller.role !== "admin" && caller.id !== existing.employeeId) {
    res.status(403).json({ error: "Cannot modify another employee's notifications" });
    return;
  }

  // SPEC Phase 1 (T006): defense-in-depth — scope the update by
  // workspaceId in addition to the pre-check above so a TOCTOU race
  // (notification reassigned between SELECT and UPDATE) cannot bleed
  // across workspaces.
  const [notification] = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(and(
      eq(notificationsTable.id, id),
      eq(notificationsTable.workspaceId, existing.workspaceId),
    ))
    .returning();

  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  const [row] = await db
    .select({ notification: notificationsTable, batchName: testingBatchesTable.batchName })
    .from(notificationsTable)
    .leftJoin(testingBatchesTable, eq(notificationsTable.batchId, testingBatchesTable.id))
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.workspaceId, existing.workspaceId)));

  res.json(serializeNotification(row.notification, row.batchName));
});

export default router;
