import { Router, type IRouter } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, employeesTable, employeeWorkspaceAssignmentsTable } from "@workspace/db";
import {
  CreateEmployeeBody,
  UpdateEmployeeBody,
  GetEmployeeParams,
  UpdateEmployeeParams,
  DeleteEmployeeParams,
} from "@workspace/api-zod";
import { hashPassword } from "./auth";
import { checkWorkspaceAccess, requireAdmin } from "../lib/workspace-access";

const router: IRouter = Router();

function serializeEmployee(emp: typeof employeesTable.$inferSelect) {
  const { passwordHash: _, ...data } = emp;
  return { ...data, createdAt: data.createdAt.toISOString() };
}

router.get("/employees", async (req, res): Promise<void> => {
  // Optional workspace_id query param: if present, scope to employees assigned
  // to that workspace (admins are always included since they have global
  // access). If absent, this endpoint requires admin and returns all employees
  // (used by the workspace member-add picker in Settings).
  const rawWs = req.query.workspace_id;
  if (rawWs !== undefined && rawWs !== "") {
    const workspaceId = Number(rawWs);
    if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "workspace_id must be a positive integer" });
      return;
    }
    const access = await checkWorkspaceAccess(req, workspaceId);
    if (!access.allowed) {
      res.status(access.status).json({ error: access.reason });
      return;
    }

    const assignments = await db
      .select({ employeeId: employeeWorkspaceAssignmentsTable.employeeId })
      .from(employeeWorkspaceAssignmentsTable)
      .where(eq(employeeWorkspaceAssignmentsTable.workspaceId, workspaceId));
    const assignedIds = assignments.map(a => a.employeeId);

    // Workspace-scoped listing: admins are included automatically (they have
    // access to every workspace) PLUS any employees explicitly assigned to
    // this workspace. Inactive employees are filtered out so workspace views
    // never surface terminated/disabled accounts.
    const membershipConditions = [eq(employeesTable.role, "admin")];
    if (assignedIds.length > 0) {
      membershipConditions.push(inArray(employeesTable.id, assignedIds));
    }
    const employees = await db
      .select()
      .from(employeesTable)
      .where(and(eq(employeesTable.status, "active"), or(...membershipConditions)))
      .orderBy(employeesTable.createdAt);
    res.json(employees.map(serializeEmployee));
    return;
  }

  // No workspace filter: admin-only global listing
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const employees = await db.select().from(employeesTable).orderBy(employeesTable.createdAt);
  res.json(employees.map(serializeEmployee));
});

router.post("/employees", async (req, res): Promise<void> => {
  // Phase 8c (Task #18): worker management is admin-only.
  if ((await requireAdmin(req, res)) === null) return;
  const parsed = CreateEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { password, ...rest } = parsed.data;
  const passwordHash = hashPassword(password);

  const [employee] = await db
    .insert(employeesTable)
    .values({ ...rest, passwordHash })
    .returning();

  res.status(201).json(serializeEmployee(employee));
});

router.get("/employees/:id", async (req, res): Promise<void> => {
  // Phase 8c (Task #18): worker management is admin-only. Self-service
  // profile reads go through GET /auth/me, not this route.
  if ((await requireAdmin(req, res)) === null) return;
  const params = GetEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, params.data.id));

  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  res.json(serializeEmployee(employee));
});

router.patch("/employees/:id", async (req, res): Promise<void> => {
  // Phase 8c: worker management is admin-only (role changes, password
  // resets, status flips). Self-service profile edits are not exposed
  // here.
  if ((await requireAdmin(req, res)) === null) return;
  const params = UpdateEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { password, ...rest } = parsed.data;
  const updates: Record<string, unknown> = { ...rest };
  if (password) {
    updates.passwordHash = hashPassword(password);
  }

  const [employee] = await db
    .update(employeesTable)
    .set(updates)
    .where(eq(employeesTable.id, params.data.id))
    .returning();

  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  res.json(serializeEmployee(employee));
});

router.delete("/employees/:id", async (req, res): Promise<void> => {
  // Phase 8c: worker management is admin-only.
  if ((await requireAdmin(req, res)) === null) return;
  const params = DeleteEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [employee] = await db
    .delete(employeesTable)
    .where(eq(employeesTable.id, params.data.id))
    .returning();

  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }

  res.json({ success: true });
});

export default router;
