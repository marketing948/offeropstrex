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
import { emit } from "../engine/event-bus";

const router: IRouter = Router();

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

  const parsed = UpdateTodoTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select({ workspaceId: todoTasksTable.workspaceId }).from(todoTasksTable).where(eq(todoTasksTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  // Spec-correction (post Phase 10): the engine TaskCompleted handler
  // (FIND_WINNERS → PAUSE; PAUSE → AdvanceTrafficSource) only runs if
  // someone actually emits TaskCompleted. The PATCH route is the only
  // place workers mark tasks DONE, so emit from here when the status
  // transitions TO DONE (and was not DONE before). Idempotent via the
  // event log: dedupeKey `task_completed:<taskId>`.
  const [prevTask] = await db
    .select({ status: todoTasksTable.status })
    .from(todoTasksTable)
    .where(eq(todoTasksTable.id, params.data.id));

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
    prevTask?.status !== "DONE" &&
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
});
const findWinnersSchema = z.object({
  winnersCount: z.number().int().min(0),
  revenue: z.number().min(0),
  cost: z.number().min(0),
  clicks: z.number().int().min(0).nullable().optional(),
  conversions: z.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
});

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
  if (task.status === "DONE") {
    res.status(409).json({ error: "Task already complete" });
    return;
  }

  const platformFromType = task.taskType === "create_voluum_campaign_ios"
    ? "ios"
    : task.taskType === "create_voluum_campaign_android"
      ? "android"
      : null;

  let resolvedCampaignId: number | null = task.relatedCampaignId ?? null;

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
    const data = parsed.data;
    // Workspace-scope guard: trafficSourceId must belong to task.workspaceId.
    const [tsRow] = await db
      .select({ id: workspaceTrafficSourcesTable.id })
      .from(workspaceTrafficSourcesTable)
      .where(
        and(
          eq(workspaceTrafficSourcesTable.id, data.trafficSourceId),
          eq(workspaceTrafficSourcesTable.workspaceId, task.workspaceId),
        ),
      );
    if (!tsRow) {
      res.status(400).json({ error: "trafficSourceId does not belong to this workspace" });
      return;
    }
    try {
      const [c] = await db
        .insert(campaignsTable)
        .values({
          workspaceId: task.workspaceId,
          batchId: task.relatedBatchId,
          platform: platformFromType,
          campaignName: data.campaignName,
          trafficSourceId: data.trafficSourceId,
          campaignUrl: data.campaignUrl ?? null,
          voluumCampaignId: data.voluumCampaignId,
          voluumCampaignName: data.voluumCampaignName,
          status: "voluum_created",
        })
        .returning();
      resolvedCampaignId = c.id;
    } catch (err) {
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
    const data = parsed.data;
    await db
      .update(campaignsTable)
      .set({
        status: "live",
        liveStartedAt: new Date(),
        trafficSourceCampaignId: data.trafficSourceCampaignId ?? null,
        trafficSourceCampaignUrl: data.trafficSourceCampaignUrl ?? null,
        notes: data.notes ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(campaignsTable.id, task.relatedCampaignId),
          eq(campaignsTable.workspaceId, task.workspaceId),
        ),
      );
    resolvedCampaignId = task.relatedCampaignId;
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
    const data = parsed.data;
    const roi = data.cost > 0 ? (data.revenue - data.cost) / data.cost : null;
    await db
      .update(campaignsTable)
      .set({
        status: "tested",
        winnersCount: data.winnersCount,
        revenue: String(data.revenue),
        cost: String(data.cost),
        clicks: data.clicks ?? null,
        conversions: data.conversions ?? null,
        roi: roi != null ? String(roi) : null,
        notes: data.notes ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(campaignsTable.id, task.relatedCampaignId),
          eq(campaignsTable.workspaceId, task.workspaceId),
        ),
      );
    resolvedCampaignId = task.relatedCampaignId;
  } else if (task.taskType === "all_traffic_sources_tested") {
    // no payload, just an ack
  } else {
    res.status(400).json({
      error: `Task type "${task.taskType}" is not supported by this endpoint. Use PATCH /todo-tasks/:id for legacy task types.`,
    });
    return;
  }

  // Mark task DONE + persist relatedCampaignId so engine handler can read it.
  const [updated] = await db
    .update(todoTasksTable)
    .set({
      status: "DONE",
      relatedCampaignId: resolvedCampaignId,
    })
    .where(eq(todoTasksTable.id, taskId))
    .returning();

  if (updated.relatedBatchId !== null) {
    try {
      await emit({
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
    } catch (err) {
      req.log.warn(
        { err, taskId: updated.id },
        "[todo-tasks] TaskCompleted emit failed (complete endpoint)",
      );
    }
  }

  res.json({ ...serializeTask(updated), campaignId: resolvedCampaignId });
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
