import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, employeeWorkspaceAssignmentsTable, goalsTable } from "@workspace/db";
import {
  CreateGoalBody,
  UpdateGoalBody,
  GetGoalParams,
  UpdateGoalParams,
  DeleteGoalParams,
  ListGoalsQueryParams,
} from "@workspace/api-zod";
import { requireWorkspaceAccess, requireWorkspaceFromQuery } from "../lib/workspace-access";

const router: IRouter = Router();

function serializeGoal(goal: typeof goalsTable.$inferSelect) {
  return {
    ...goal,
    targetProfitOptional: goal.targetProfitOptional != null ? Number(goal.targetProfitOptional) : null,
    createdAt: goal.createdAt.toISOString(),
  };
}

async function ensureGoalEmployeeInWorkspace(
  employeeId: number,
  workspaceId: number,
): Promise<boolean> {
  const [assignment] = await db
    .select({ id: employeeWorkspaceAssignmentsTable.id })
    .from(employeeWorkspaceAssignmentsTable)
    .where(and(
      eq(employeeWorkspaceAssignmentsTable.employeeId, employeeId),
      eq(employeeWorkspaceAssignmentsTable.workspaceId, workspaceId),
    ))
    .limit(1);
  return Boolean(assignment);
}

router.get("/goals", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const params = ListGoalsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [eq(goalsTable.workspaceId, workspaceId)];
  if (params.data.employee_id) {
    conditions.push(eq(goalsTable.employeeId, params.data.employee_id));
  }
  if (params.data.period_type) {
    conditions.push(eq(goalsTable.periodType, params.data.period_type as "weekly" | "monthly"));
  }

  const goals = await db.select().from(goalsTable).where(and(...conditions)).orderBy(goalsTable.createdAt);

  res.json(goals.map(serializeGoal));
});

router.post("/goals", async (req, res): Promise<void> => {
  const parsed = CreateGoalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const workspaceId = await requireWorkspaceAccess(req, res, parsed.data.workspaceId);
  if (workspaceId === null) return;
  if (!(await ensureGoalEmployeeInWorkspace(parsed.data.employeeId, workspaceId))) {
    res.status(400).json({ error: "employeeId is not assigned to this workspace" });
    return;
  }

  const insertData = {
    ...parsed.data,
    workspaceId,
    targetProfitOptional: parsed.data.targetProfitOptional != null ? String(parsed.data.targetProfitOptional) : null,
  };
  const [goal] = await db.insert(goalsTable).values(insertData as any).returning();
  res.status(201).json(serializeGoal(goal));
});

router.get("/goals/:id", async (req, res): Promise<void> => {
  const params = GetGoalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [goal] = await db.select().from(goalsTable).where(eq(goalsTable.id, params.data.id));

  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }

  if ((await requireWorkspaceAccess(req, res, goal.workspaceId)) === null) return;

  res.json(serializeGoal(goal));
});

router.patch("/goals/:id", async (req, res): Promise<void> => {
  const params = UpdateGoalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateGoalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select({ workspaceId: goalsTable.workspaceId })
    .from(goalsTable)
    .where(eq(goalsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  const updateData = {
    ...parsed.data,
    targetProfitOptional: parsed.data.targetProfitOptional != null ? String(parsed.data.targetProfitOptional) : parsed.data.targetProfitOptional,
  };
  const [goal] = await db
    .update(goalsTable)
    .set(updateData as any)
    .where(and(eq(goalsTable.id, params.data.id), eq(goalsTable.workspaceId, existing.workspaceId)))
    .returning();

  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }

  res.json(serializeGoal(goal));
});

router.delete("/goals/:id", async (req, res): Promise<void> => {
  const params = DeleteGoalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select({ workspaceId: goalsTable.workspaceId })
    .from(goalsTable)
    .where(eq(goalsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  const [goal] = await db
    .delete(goalsTable)
    .where(and(eq(goalsTable.id, params.data.id), eq(goalsTable.workspaceId, existing.workspaceId)))
    .returning();

  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }

  res.json({ success: true });
});

export default router;
