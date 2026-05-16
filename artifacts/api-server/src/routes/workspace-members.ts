import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, employeeWorkspaceAssignmentsTable, employeesTable, workspacesTable } from "@workspace/db";
import { getEmployeeFromToken } from "./auth";
import { requireWorkspaceFromQuery, requireAdmin } from "../lib/workspace-access";

const router: IRouter = Router();

async function serializeMember(row: {
  assignment: typeof employeeWorkspaceAssignmentsTable.$inferSelect;
  employee: { name: string; email: string; role: string } | null;
}) {
  return {
    id: row.assignment.id,
    employeeId: row.assignment.employeeId,
    workspaceId: row.assignment.workspaceId,
    role: row.assignment.role,
    createdAt: row.assignment.createdAt.toISOString(),
    employeeName: row.employee?.name ?? "",
    employeeEmail: row.employee?.email ?? "",
    employeeRole: row.employee?.role ?? "",
  };
}

// PATCH /workspaces/:id/activate — sets a workspace as the caller's
// active workspace. Pivot Phase 0: this replaces the legacy
// /sync/voluum/workspaces/:id/set-active so workspace switching keeps
// working when Voluum is disabled. Workspace activation is independent
// of Voluum credentials.
router.patch("/workspaces/:id/activate", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const employee = await getEmployeeFromToken(req);
  if (!employee) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Caller must have access to the target workspace (admin OR assigned).
  if (employee.role !== "admin") {
    const [assignment] = await db
      .select({ id: employeeWorkspaceAssignmentsTable.id })
      .from(employeeWorkspaceAssignmentsTable)
      .where(
        and(
          eq(employeeWorkspaceAssignmentsTable.employeeId, employee.id),
          eq(employeeWorkspaceAssignmentsTable.workspaceId, id),
        ),
      )
      .limit(1);
    if (!assignment) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }
  const [ws] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, id));
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  await db.update(workspacesTable).set({ isActive: false, updatedAt: new Date() });
  const [updated] = await db
    .update(workspacesTable)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(workspacesTable.id, id))
    .returning();
  req.log.info({ workspaceId: id, employeeId: employee.id }, "Workspace activated");
  res.json(updated);
});

// GET /workspace-members?workspace_id=N
router.get("/workspace-members", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const rows = await db
    .select({
      assignment: employeeWorkspaceAssignmentsTable,
      employee: {
        name: employeesTable.name,
        email: employeesTable.email,
        role: employeesTable.role,
      },
    })
    .from(employeeWorkspaceAssignmentsTable)
    .leftJoin(employeesTable, eq(employeeWorkspaceAssignmentsTable.employeeId, employeesTable.id))
    .where(eq(employeeWorkspaceAssignmentsTable.workspaceId, workspaceId))
    .orderBy(employeesTable.name);

  res.json(await Promise.all(rows.map(serializeMember)));
});

// POST /workspace-members
router.post("/workspace-members", async (req, res): Promise<void> => {
  const { employeeId, workspaceId, role = "employee" } = req.body;
  if (!employeeId || !workspaceId) {
    res.status(400).json({ error: "employeeId and workspaceId are required" });
    return;
  }

  if ((await requireAdmin(req, res)) === null) return;

  // Check for existing assignment
  const [existing] = await db
    .select()
    .from(employeeWorkspaceAssignmentsTable)
    .where(and(
      eq(employeeWorkspaceAssignmentsTable.employeeId, Number(employeeId)),
      eq(employeeWorkspaceAssignmentsTable.workspaceId, Number(workspaceId))
    ));

  if (existing) {
    res.status(409).json({ error: "Employee is already assigned to this workspace" });
    return;
  }

  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, Number(employeeId)));
  const [workspace] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, Number(workspaceId)));

  if (!employee || !workspace) {
    res.status(404).json({ error: "Employee or workspace not found" });
    return;
  }

  const [inserted] = await db
    .insert(employeeWorkspaceAssignmentsTable)
    .values({ employeeId: Number(employeeId), workspaceId: Number(workspaceId), role })
    .returning();

  res.status(201).json({
    id: inserted.id,
    employeeId: inserted.employeeId,
    workspaceId: inserted.workspaceId,
    role: inserted.role,
    createdAt: inserted.createdAt.toISOString(),
    employeeName: employee.name,
    employeeEmail: employee.email,
    employeeRole: employee.role,
  });
});

// DELETE /workspace-members/:id
router.delete("/workspace-members/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [target] = await db
    .select()
    .from(employeeWorkspaceAssignmentsTable)
    .where(eq(employeeWorkspaceAssignmentsTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  if ((await requireAdmin(req, res)) === null) return;

  const [deleted] = await db
    .delete(employeeWorkspaceAssignmentsTable)
    .where(eq(employeeWorkspaceAssignmentsTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }

  res.json({ success: true });
});

// GET /auth/my-workspaces — returns workspaces the current user can access
router.get("/auth/my-workspaces", async (req, res): Promise<void> => {
  const employee = await getEmployeeFromToken(req);
  if (!employee) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Ensure Default Workspace exists (same logic as listVoluumWorkspaces)
  const allWorkspaces = await db.select().from(workspacesTable).orderBy(workspacesTable.id);
  if (allWorkspaces.length === 0) {
    const [defaultWs] = await db
      .insert(workspacesTable)
      .values({ name: "Default Workspace", isDefault: true, isActive: true })
      .returning();
    allWorkspaces.push(defaultWs);
  }

  // Admins see all workspaces
  if (employee.role === "admin") {
    res.json(allWorkspaces.map(ws => ({
      ...ws,
      lastSyncAt: ws.lastSyncAt?.toISOString() ?? null,
      createdAt: ws.createdAt.toISOString(),
      updatedAt: ws.updatedAt.toISOString(),
    })));
    return;
  }

  // Employees: see only assigned workspaces. No fallback — an employee with
  // zero assignments returns an empty list (must be explicitly added by an
  // admin via Settings → Workspace → Members).
  const assignments = await db
    .select()
    .from(employeeWorkspaceAssignmentsTable)
    .where(eq(employeeWorkspaceAssignmentsTable.employeeId, employee.id));

  const assignedIds = new Set(assignments.map(a => a.workspaceId));
  const myWorkspaces = allWorkspaces.filter(ws => assignedIds.has(ws.id));

  res.json(myWorkspaces.map(ws => ({
    ...ws,
    lastSyncAt: ws.lastSyncAt?.toISOString() ?? null,
    createdAt: ws.createdAt.toISOString(),
    updatedAt: ws.updatedAt.toISOString(),
  })));
});

export default router;
