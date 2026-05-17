import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, todoTasksTable, employeesTable, testingBatchesTable } from "@workspace/db";
import { z } from "zod/v4";
import {
  CreateTodoTaskBody,
  UpdateTodoTaskBody,
  GetTodoTaskParams,
  UpdateTodoTaskParams,
  DeleteTodoTaskParams,
  ListTodoTasksQueryParams,
} from "@workspace/api-zod";
import { requireWorkspaceFromQuery, requireWorkspaceAccess } from "../lib/workspace-access";
import { requireWorkspaceFromBody } from "../lib/require-workspace";
import { emit } from "../engine/event-bus.ts";
import type { TaskCompletionDetails } from "../engine/types.ts";
import { getEmployeeFromToken } from "./auth";

const router: IRouter = Router();

const CAMPAIGN_OPS_TASK_TYPES = new Set<string>([
  "create_voluum_campaign_ios",
  "create_voluum_campaign_android",
  "take_campaign_live",
  "find_winners",
  "all_traffic_sources_tested",
]);

function serializeTask(
  task: typeof todoTasksTable.$inferSelect,
  employeeName?: string | null,
  batchName?: string | null
) {
  return {
    ...task,
    createdAt: task.createdAt.toISOString(),
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    employeeName: employeeName ?? null,
    batchName: batchName ?? null,
    dueDate: task.dueDate ?? null,
  };
}

async function requireTaskOwnerOrAdmin(
  req: import("express").Request,
  res: import("express").Response,
  task: Pick<typeof todoTasksTable.$inferSelect, "employeeId" | "relatedBatchId">,
): Promise<boolean> {
  const employee = await getEmployeeFromToken(req);
  if (!employee) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (employee.role === "admin" || employee.id === task.employeeId) {
    return true;
  }
  if (task.relatedBatchId != null) {
    const [batch] = await db
      .select({ employeeId: testingBatchesTable.employeeId })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, task.relatedBatchId))
      .limit(1);
    if (batch?.employeeId === employee.id) {
      return true;
    }
  }
  res.status(403).json({ error: "Only the task assignee, batch owner, or an admin can update this task" });
  return false;
}

router.get("/todo-tasks", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const params = ListTodoTasksQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [eq(todoTasksTable.workspaceId, workspaceId)];
  if (params.data.employee_id) {
    conditions.push(eq(todoTasksTable.employeeId, params.data.employee_id));
  }
  type TaskRow = typeof todoTasksTable.$inferSelect;
  if (params.data.status) {
    conditions.push(eq(todoTasksTable.status, params.data.status as TaskRow["status"]));
  }
  if (params.data.priority) {
    conditions.push(eq(todoTasksTable.priority, params.data.priority as TaskRow["priority"]));
  }
  if (params.data.task_type) {
    conditions.push(eq(todoTasksTable.taskType, params.data.task_type as TaskRow["taskType"]));
  }

  const tasks = await db
    .select({
      task: todoTasksTable,
      employeeName: employeesTable.name,
      batchName: testingBatchesTable.batchName,
    })
    .from(todoTasksTable)
    .leftJoin(employeesTable, eq(todoTasksTable.employeeId, employeesTable.id))
    .leftJoin(testingBatchesTable, eq(todoTasksTable.relatedBatchId, testingBatchesTable.id))
    .where(and(...conditions))
    .orderBy(todoTasksTable.createdAt);

  res.json(tasks.map(r => serializeTask(r.task, r.employeeName, r.batchName)));
});

// Phase 3 (Task #13) removed manual task creation. Tasks are now
// always emitted by an engine rule in response to a domain event
// (e.g. `BatchCreated` → `CREATE_IOS_TRACKER_CAMPAIGN`); the route is
// stubbed at `410 Gone` so the legacy frontend gets a clear signal.
// The `CreateTodoTaskBody` Zod schema and `requireWorkspaceFromBody`
// helper are still imported because Phase 4 will reintroduce a
// constrained `POST /todo-tasks` for ad-hoc admin tasks once the
// task_type enum is finalized.
router.post("/todo-tasks", async (_req, res): Promise<void> => {
  res.status(410).json({
    error: "Endpoint removed",
    detail:
      "Phase 3 (Task #13) removed manual todo-task creation. Tasks are " +
      "now emitted by the Automation Bible engine in response to domain " +
      "events. A constrained admin endpoint will return in Phase 4.",
  });
});
void CreateTodoTaskBody; void requireWorkspaceFromBody;

router.get("/todo-tasks/:id", async (req, res): Promise<void> => {
  const params = GetTodoTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [result] = await db
    .select({
      task: todoTasksTable,
      employeeName: employeesTable.name,
      batchName: testingBatchesTable.batchName,
    })
    .from(todoTasksTable)
    .leftJoin(employeesTable, eq(todoTasksTable.employeeId, employeesTable.id))
    .leftJoin(testingBatchesTable, eq(todoTasksTable.relatedBatchId, testingBatchesTable.id))
    .where(eq(todoTasksTable.id, params.data.id));

  if (!result) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if ((await requireWorkspaceAccess(req, res, result.task.workspaceId)) === null) return;

  res.json(serializeTask(result.task, result.employeeName, result.batchName));
});

router.patch("/todo-tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTodoTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (req.body && typeof req.body === "object" && "taskType" in req.body) {
    res.status(400).json({ error: "taskType cannot be changed" });
    return;
  }
  if (
    req.body &&
    typeof req.body === "object" &&
    ("completedAt" in req.body ||
      "completedByEmployeeId" in req.body ||
      "completionPayload" in req.body)
  ) {
    res.status(400).json({ error: "Task completion memory can only be set via POST /todo-tasks/:id/complete" });
    return;
  }

  const parsed = UpdateTodoTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select({
      workspaceId: todoTasksTable.workspaceId,
      status: todoTasksTable.status,
      taskType: todoTasksTable.taskType,
      employeeId: todoTasksTable.employeeId,
      relatedBatchId: todoTasksTable.relatedBatchId,
    })
    .from(todoTasksTable)
    .where(eq(todoTasksTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;
  if (!(await requireTaskOwnerOrAdmin(req, res, existing))) return;

  if (
    req.body &&
    typeof req.body === "object" &&
    "blockedReason" in req.body &&
    parsed.data.status !== "BLOCKED"
  ) {
    res.status(400).json({ error: "blockedReason can only be set when status is BLOCKED" });
    return;
  }

  if (
    CAMPAIGN_OPS_TASK_TYPES.has(existing.taskType) &&
    req.body && typeof req.body === "object" && "relatedBatchId" in req.body
  ) {
    res.status(400).json({
      error: "CampaignOps task ownership fields cannot be changed via PATCH",
    });
    return;
  }

  if (
    CAMPAIGN_OPS_TASK_TYPES.has(existing.taskType) &&
    parsed.data.status === "DONE" &&
    existing.status !== "DONE"
  ) {
    res.status(400).json({
      error: "CampaignOps tasks must be completed via POST /todo-tasks/:id/complete",
    });
    return;
  }

  if (parsed.data.status === "DONE" && existing.status !== "DONE") {
    const actor = await getEmployeeFromToken(req);
    if (!actor) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    await emit({
      type: "TaskCompletionRequested",
      workspaceId: existing.workspaceId,
      payload: {
        taskId: params.data.id,
        completedByEmployeeId: actor.id,
        completion: { kind: "generic" },
      },
      dedupeKey: `task_completion_requested:${params.data.id}`,
    });

    const [completedTask] = await db
      .select()
      .from(todoTasksTable)
      .where(eq(todoTasksTable.id, params.data.id));
    if (!completedTask) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(serializeTask(completedTask));
    return;
  }

  const [task] = await db
    .update(todoTasksTable)
    .set(parsed.data as Partial<typeof todoTasksTable.$inferInsert>)
    .where(and(eq(todoTasksTable.id, params.data.id), eq(todoTasksTable.workspaceId, existing.workspaceId)))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json(serializeTask(task));
});

// CampaignOps redesign — task completion endpoint that also performs
// the per-task-type side effects on the Campaign row (campaigns is
// not in FORBIDDEN_TABLES, so the route may write it directly).
//
// POST /todo-tasks/:id/complete
// Body shape varies by task.taskType:
//  - create_voluum_campaign_ios | create_voluum_campaign_android:
//      { trafficSourceId, voluumCampaignId, voluumCampaignName, campaignName, campaignUrl? }
//      → inserts a Campaign(status=voluum_created), stores ids back on the
//        task (relatedCampaignId), marks task DONE, emits TaskCompleted.
//  - take_campaign_live:
//      { trafficSourceCampaignId?, trafficSourceCampaignUrl?, notes? }
//      → updates Campaign(status=live, liveStartedAt=now()), marks DONE, emits.
//  - find_winners:
//      success: { winnersCount, revenue, cost, clicks?, conversions?, notes? }
//      failure: { outcome: "failed", failureReason, notes? }
//      → updates Campaign outcome, marks DONE, emits.
//  - all_traffic_sources_tested:
//      no body — terminal acknowledgement; just mark DONE.

const createVoluumCampaignSchema = z.object({
  trafficSourceId: z.number().int().positive(),
  voluumCampaignId: z.string().trim().min(1),
  voluumCampaignName: z.string().trim().min(1),
  campaignName: z.string().trim().min(1),
  campaignUrl: z.string().trim().nullable().optional(),
});
const takeCampaignLiveSchema = z.object({
  trafficSourceCampaignId: z.string().trim().nullable().optional(),
  trafficSourceCampaignUrl: z.string().trim().nullable().optional(),
  notes: z.string().nullable().optional(),
}).superRefine((data, ctx) => {
  if (!data.trafficSourceCampaignId && !data.trafficSourceCampaignUrl) {
    ctx.addIssue({
      code: "custom",
      message: "trafficSourceCampaignId or trafficSourceCampaignUrl is required",
      path: ["trafficSourceCampaignId"],
    });
  }
});
const findWinnersSuccessSchema = z.object({
  outcome: z.literal("success").optional(),
  winnersCount: z.number().int().min(0),
  revenue: z.number().min(0),
  cost: z.number().min(0),
  clicks: z.number().int().min(0).nullable().optional(),
  conversions: z.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
});
const findWinnersFailureSchema = z.object({
  outcome: z.literal("failed"),
  failureReason: z.string().trim().min(1),
  notes: z.string().nullable().optional(),
});
const findWinnersSchema = z.union([findWinnersSuccessSchema, findWinnersFailureSchema]);

router.post("/todo-tasks/:id/complete", async (req, res): Promise<void> => {
  const taskId = Number(req.params.id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [task] = await db
    .select()
    .from(todoTasksTable)
    .where(eq(todoTasksTable.id, taskId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, task.workspaceId)) === null) return;
  if (!(await requireTaskOwnerOrAdmin(req, res, task))) return;
  if (task.status === "DONE") {
    res.json({ ...serializeTask(task), campaignId: task.relatedCampaignId ?? null });
    return;
  }

  const platformFromType = task.taskType === "create_voluum_campaign_ios"
    ? "ios"
    : task.taskType === "create_voluum_campaign_android"
      ? "android"
      : null;

  let completion: TaskCompletionDetails;

  if (platformFromType !== null) {
    if (task.relatedBatchId == null) {
      res.status(400).json({ error: "Task is missing relatedBatchId" });
      return;
    }
    const parsed = createVoluumCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    completion = { kind: "create_voluum_campaign", platform: platformFromType, ...parsed.data };
  } else if (task.taskType === "take_campaign_live") {
    if (task.relatedCampaignId == null) {
      res.status(400).json({ error: "Task missing relatedCampaignId" });
      return;
    }
    const parsed = takeCampaignLiveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    completion = { kind: "take_campaign_live", ...parsed.data };
  } else if (task.taskType === "find_winners") {
    if (task.relatedCampaignId == null) {
      res.status(400).json({ error: "Task missing relatedCampaignId" });
      return;
    }
    const parsed = findWinnersSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    completion = { kind: "find_winners", ...parsed.data };
  } else if (task.taskType === "all_traffic_sources_tested") {
    completion = { kind: "all_traffic_sources_tested" };
  } else {
    res.status(400).json({
      error: `Task type "${task.taskType}" is not supported by this endpoint. Use PATCH /todo-tasks/:id for legacy task types.`,
    });
    return;
  }

  try {
    const actor = await getEmployeeFromToken(req);
    if (!actor) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    await emit({
      type: "TaskCompletionRequested",
      workspaceId: task.workspaceId,
      payload: {
        taskId,
        completedByEmployeeId: actor.id,
        completion,
      },
      dedupeKey: `task_completion_requested:${taskId}`,
    });

    const [updated] = await db
      .select()
      .from(todoTasksTable)
      .where(eq(todoTasksTable.id, taskId));
    if (!updated) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.json({ ...serializeTask(updated), campaignId: updated.relatedCampaignId ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message === "trafficSourceId does not belong to this workspace" ||
      message === "Task is missing relatedBatchId" ||
      message === "Task missing relatedCampaignId"
    ) {
      res.status(400).json({ error: message });
      return;
    }
    if (message === "Campaign not found") {
      res.status(404).json({ error: message });
      return;
    }
    const code =
      (err as { code?: string; cause?: { code?: string } })?.code
        ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      res.status(409).json({
        error: "A campaign for this batch + platform + traffic source already exists",
      });
      return;
    }
    throw err;
  }
});

router.delete("/todo-tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTodoTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select({ workspaceId: todoTasksTable.workspaceId }).from(todoTasksTable).where(eq(todoTasksTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  const [task] = await db
    .delete(todoTasksTable)
    .where(and(eq(todoTasksTable.id, params.data.id), eq(todoTasksTable.workspaceId, existing.workspaceId)))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json({ success: true });
});

export default router;
