import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, todoTasksTable, employeesTable, testingBatchesTable, campaignsTable, workspaceTrafficSourcesTable } from "@workspace/db";
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
import { emit, emitWithinTx } from "../engine/event-bus.ts";
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

  // Spec-correction (post Phase 10): the engine TaskCompleted handler
  // (FIND_WINNERS → PAUSE; PAUSE → AdvanceTrafficSource) only runs if
  // someone actually emits TaskCompleted. The PATCH route is the only
  // place workers mark tasks DONE, so emit from here when the status
  // transitions TO DONE (and was not DONE before). Idempotent via the
  // event log: dedupeKey `task_completed:<taskId>`.
  const [task] = await db
    .update(todoTasksTable)
    .set(parsed.data as Partial<typeof todoTasksTable.$inferInsert>)
    .where(eq(todoTasksTable.id, params.data.id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (
    task.status === "DONE" &&
    existing.status !== "DONE" &&
    task.relatedBatchId !== null
  ) {
    try {
      await emit({
        type: "TaskCompleted",
        workspaceId: task.workspaceId,
        payload: {
          taskId: task.id,
          taskType: task.taskType,
          relatedBatchId: task.relatedBatchId,
          relatedCampaignId: task.relatedCampaignId,
        },
        dedupeKey: `task_completed:${task.id}`,
      });
    } catch (err) {
      req.log.warn(
        { err, taskId: task.id },
        "[todo-tasks] TaskCompleted emit failed — tombstoned",
      );
    }
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
//      { winnersCount, revenue, cost, clicks?, conversions?, notes? }
//      → updates Campaign perf cols + status=tested, marks DONE, emits.
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
const findWinnersSchema = z.object({
  winnersCount: z.number().int().min(0),
  revenue: z.number().min(0),
  cost: z.number().min(0),
  clicks: z.number().int().min(0).nullable().optional(),
  conversions: z.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
});

class CompletionHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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
    res.status(409).json({ error: "Task already complete" });
    return;
  }

  const platformFromType = task.taskType === "create_voluum_campaign_ios"
    ? "ios"
    : task.taskType === "create_voluum_campaign_android"
      ? "android"
      : null;

  let parsedCreate: z.infer<typeof createVoluumCampaignSchema> | null = null;
  let parsedTakeLive: z.infer<typeof takeCampaignLiveSchema> | null = null;
  let parsedFindWinners: z.infer<typeof findWinnersSchema> | null = null;

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
    parsedCreate = parsed.data;
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
    parsedTakeLive = parsed.data;
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
    parsedFindWinners = parsed.data;
  } else if (task.taskType === "all_traffic_sources_tested") {
    // no payload, just an ack
  } else {
    res.status(400).json({
      error: `Task type "${task.taskType}" is not supported by this endpoint. Use PATCH /todo-tasks/:id for legacy task types.`,
    });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      let resolvedCampaignId: number | null = task.relatedCampaignId ?? null;

      if (platformFromType !== null && parsedCreate !== null) {
        const [tsRow] = await tx
          .select({ id: workspaceTrafficSourcesTable.id })
          .from(workspaceTrafficSourcesTable)
          .where(
            and(
              eq(workspaceTrafficSourcesTable.id, parsedCreate.trafficSourceId),
              eq(workspaceTrafficSourcesTable.workspaceId, task.workspaceId),
            ),
          );
        if (!tsRow) {
          throw new CompletionHttpError(400, "trafficSourceId does not belong to this workspace");
        }

        const [c] = await tx
          .insert(campaignsTable)
          .values({
            workspaceId: task.workspaceId,
            batchId: task.relatedBatchId!,
            platform: platformFromType,
            campaignName: parsedCreate.campaignName,
            trafficSourceId: parsedCreate.trafficSourceId,
            campaignUrl: parsedCreate.campaignUrl ?? null,
            voluumCampaignId: parsedCreate.voluumCampaignId,
            voluumCampaignName: parsedCreate.voluumCampaignName,
            status: "voluum_created",
          })
          .returning();
        resolvedCampaignId = c.id;
      } else if (task.taskType === "take_campaign_live" && parsedTakeLive !== null) {
        const updatedCampaign = await tx
          .update(campaignsTable)
          .set({
            status: "live",
            liveStartedAt: new Date(),
            trafficSourceCampaignId: parsedTakeLive.trafficSourceCampaignId ?? null,
            trafficSourceCampaignUrl: parsedTakeLive.trafficSourceCampaignUrl ?? null,
            notes: parsedTakeLive.notes ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(campaignsTable.id, task.relatedCampaignId!),
              eq(campaignsTable.workspaceId, task.workspaceId),
            ),
          )
          .returning({ id: campaignsTable.id });
        if (updatedCampaign.length === 0) {
          throw new CompletionHttpError(404, "Campaign not found");
        }
        resolvedCampaignId = task.relatedCampaignId;
      } else if (task.taskType === "find_winners" && parsedFindWinners !== null) {
        const roi = parsedFindWinners.cost > 0
          ? (parsedFindWinners.revenue - parsedFindWinners.cost) / parsedFindWinners.cost
          : null;
        const updatedCampaign = await tx
          .update(campaignsTable)
          .set({
            status: "tested",
            winnersCount: parsedFindWinners.winnersCount,
            revenue: String(parsedFindWinners.revenue),
            cost: String(parsedFindWinners.cost),
            clicks: parsedFindWinners.clicks ?? null,
            conversions: parsedFindWinners.conversions ?? null,
            roi: roi != null ? String(roi) : null,
            notes: parsedFindWinners.notes ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(campaignsTable.id, task.relatedCampaignId!),
              eq(campaignsTable.workspaceId, task.workspaceId),
            ),
          )
          .returning({ id: campaignsTable.id });
        if (updatedCampaign.length === 0) {
          throw new CompletionHttpError(404, "Campaign not found");
        }
        resolvedCampaignId = task.relatedCampaignId;
      }

      const [updated] = await tx
        .update(todoTasksTable)
        .set({
          status: "DONE",
          relatedCampaignId: resolvedCampaignId,
        })
        .where(eq(todoTasksTable.id, taskId))
        .returning();

      if (updated.relatedBatchId !== null) {
        await emitWithinTx(tx, {
          type: "TaskCompleted",
          workspaceId: updated.workspaceId,
          payload: {
            taskId: updated.id,
            taskType: updated.taskType,
            relatedBatchId: updated.relatedBatchId,
            relatedCampaignId: resolvedCampaignId,
          },
          dedupeKey: `task_completed:${updated.id}`,
        });
      }

      return { updated, resolvedCampaignId };
    });

    res.json({ ...serializeTask(result.updated), campaignId: result.resolvedCampaignId });
  } catch (err) {
    if (err instanceof CompletionHttpError) {
      res.status(err.status).json({ error: err.message });
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

  const [task] = await db.delete(todoTasksTable).where(eq(todoTasksTable.id, params.data.id)).returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json({ success: true });
});

export default router;
