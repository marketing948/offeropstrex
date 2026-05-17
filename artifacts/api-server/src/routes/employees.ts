import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  affiliateNetworksTable,
  employeesTable,
  employeeWorkspaceAssignmentsTable,
  workerAffiliateNetworksTable,
  workspacesTable,
} from "@workspace/db";
import { z } from "zod/v4";
import {
  GetEmployeeParams,
  UpdateEmployeeParams,
  DeleteEmployeeParams,
} from "@workspace/api-zod";
import { hashPassword } from "./auth";
import { requireAdmin, requireWorkspaceAccess } from "../lib/workspace-access";

const router: IRouter = Router();

type EmployeeRow = typeof employeesTable.$inferSelect;

function serializeEmployee(emp: EmployeeRow) {
  const { passwordHash: _, ...data } = emp;
  return { ...data, createdAt: data.createdAt.toISOString() };
}

async function serializeEmployeesWithAssignments(employees: EmployeeRow[]) {
  if (employees.length === 0) return [];
  const employeeIds = employees.map((emp) => emp.id);
  const [workspaceAssignments, affiliateAssignments] = await Promise.all([
    db
      .select({
        employeeId: employeeWorkspaceAssignmentsTable.employeeId,
        workspaceId: employeeWorkspaceAssignmentsTable.workspaceId,
        workspaceName: workspacesTable.name,
      })
      .from(employeeWorkspaceAssignmentsTable)
      .leftJoin(workspacesTable, eq(employeeWorkspaceAssignmentsTable.workspaceId, workspacesTable.id))
      .where(inArray(employeeWorkspaceAssignmentsTable.employeeId, employeeIds)),
    db
      .select({
        employeeId: workerAffiliateNetworksTable.employeeId,
        affiliateNetworkId: workerAffiliateNetworksTable.affiliateNetworkId,
        affiliateNetworkName: affiliateNetworksTable.name,
      })
      .from(workerAffiliateNetworksTable)
      .leftJoin(affiliateNetworksTable, eq(workerAffiliateNetworksTable.affiliateNetworkId, affiliateNetworksTable.id))
      .where(inArray(workerAffiliateNetworksTable.employeeId, employeeIds)),
  ]);

  return employees.map((emp) => ({
    ...serializeEmployee(emp),
    workspaceIds: workspaceAssignments.filter((row) => row.employeeId === emp.id).map((row) => row.workspaceId),
    workspaceNames: workspaceAssignments.filter((row) => row.employeeId === emp.id).map((row) => row.workspaceName).filter(Boolean),
    affiliateNetworkIds: affiliateAssignments.filter((row) => row.employeeId === emp.id).map((row) => row.affiliateNetworkId),
    affiliateNetworkNames: affiliateAssignments.filter((row) => row.employeeId === emp.id).map((row) => row.affiliateNetworkName).filter(Boolean),
  }));
}

const employeeManagementBody = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(8).optional(),
  role: z.enum(["admin", "employee"]),
  status: z.enum(["active", "inactive"]).optional(),
  workspaceIds: z.array(z.number().int().positive()).min(1),
  affiliateNetworkIds: z.array(z.number().int().positive()).optional().default([]),
});

const employeeManagementPatchBody = employeeManagementBody.partial().extend({
  workspaceIds: z.array(z.number().int().positive()).min(1).optional(),
  affiliateNetworkIds: z.array(z.number().int().positive()).optional(),
});

function generatedPassword(): string {
  return `OfferOps-${Math.random().toString(36).slice(2, 10)}!`;
}

function uniqueIds(ids: number[]): number[] {
  return [...new Set(ids)];
}

async function validateManagedAssignments(
  req: Parameters<typeof requireWorkspaceAccess>[0],
  res: Parameters<typeof requireWorkspaceAccess>[1],
  workspaceIds: number[],
  affiliateNetworkIds: number[],
): Promise<boolean> {
  for (const workspaceId of workspaceIds) {
    if ((await requireWorkspaceAccess(req, res, workspaceId)) === null) return false;
  }
  if (affiliateNetworkIds.length === 0) return true;
  const networks = await db
    .select({ id: affiliateNetworksTable.id, workspaceId: affiliateNetworksTable.workspaceId })
    .from(affiliateNetworksTable)
    .where(inArray(affiliateNetworksTable.id, affiliateNetworkIds));
  if (
    networks.length !== affiliateNetworkIds.length ||
    networks.some((network) => !workspaceIds.includes(network.workspaceId))
  ) {
    res.status(400).json({ error: "One or more affiliateNetworkIds do not belong to the assigned workspaces" });
    return false;
  }
  return true;
}

async function assignedWorkspaceIds(employeeId: number): Promise<number[]> {
  const assignments = await db
    .select({ workspaceId: employeeWorkspaceAssignmentsTable.workspaceId })
    .from(employeeWorkspaceAssignmentsTable)
    .where(eq(employeeWorkspaceAssignmentsTable.employeeId, employeeId));
  return uniqueIds(assignments.map((assignment) => assignment.workspaceId));
}

async function requireEmployeeManagementAccess(
  req: Parameters<typeof requireWorkspaceAccess>[0],
  res: Parameters<typeof requireWorkspaceAccess>[1],
  employeeId: number,
): Promise<number[] | null> {
  const workspaceIds = await assignedWorkspaceIds(employeeId);
  if (workspaceIds.length === 0) {
    res.status(403).json({ error: "Employee is not assigned to a manageable workspace" });
    return null;
  }
  for (const workspaceId of workspaceIds) {
    if ((await requireWorkspaceAccess(req, res, workspaceId)) === null) return null;
  }
  return workspaceIds;
}

async function manageableEmployeeIds(adminWorkspaceIds: number[], scopedWorkspaceId?: number): Promise<number[]> {
  if (adminWorkspaceIds.length === 0) return [];
  const candidateRows = await db
    .select({ employeeId: employeeWorkspaceAssignmentsTable.employeeId })
    .from(employeeWorkspaceAssignmentsTable)
    .where(
      scopedWorkspaceId
        ? eq(employeeWorkspaceAssignmentsTable.workspaceId, scopedWorkspaceId)
        : inArray(employeeWorkspaceAssignmentsTable.workspaceId, adminWorkspaceIds),
    );
  const candidateIds = uniqueIds(candidateRows.map((assignment) => assignment.employeeId));
  if (candidateIds.length === 0) return [];

  const allAssignments = await db
    .select({
      employeeId: employeeWorkspaceAssignmentsTable.employeeId,
      workspaceId: employeeWorkspaceAssignmentsTable.workspaceId,
    })
    .from(employeeWorkspaceAssignmentsTable)
    .where(inArray(employeeWorkspaceAssignmentsTable.employeeId, candidateIds));
  const adminWorkspaceSet = new Set(adminWorkspaceIds);
  return candidateIds.filter((employeeId) => {
    const employeeAssignments = allAssignments.filter((assignment) => assignment.employeeId === employeeId);
    return (
      employeeAssignments.length > 0 &&
      employeeAssignments.every((assignment) => adminWorkspaceSet.has(assignment.workspaceId))
    );
  });
}

async function replaceManagedAssignments(
  employeeId: number,
  role: "admin" | "employee",
  workspaceIds: number[],
  affiliateNetworkIds: number[],
) {
  await db.transaction(async (tx) => {
    await tx
      .delete(employeeWorkspaceAssignmentsTable)
      .where(eq(employeeWorkspaceAssignmentsTable.employeeId, employeeId));
    await tx.insert(employeeWorkspaceAssignmentsTable).values(
      workspaceIds.map((workspaceId) => ({
        employeeId,
        workspaceId,
        role,
      })),
    );

    await tx
      .delete(workerAffiliateNetworksTable)
      .where(eq(workerAffiliateNetworksTable.employeeId, employeeId));
    if (role === "employee" && affiliateNetworkIds.length > 0) {
      const networks = await tx
        .select({ id: affiliateNetworksTable.id, workspaceId: affiliateNetworksTable.workspaceId })
        .from(affiliateNetworksTable)
        .where(inArray(affiliateNetworksTable.id, affiliateNetworkIds));
      await tx.insert(workerAffiliateNetworksTable).values(
        networks.map((network) => ({
          employeeId,
          workspaceId: network.workspaceId,
          affiliateNetworkId: network.id,
        })),
      );
    }
  });
}

router.get("/employees", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  // Optional workspace_id query param: if present, require admin access to
  // that workspace and scope to employees assigned there. If absent, return
  // the global admin listing used by the workspace member-add picker.
  const rawWs = req.query.workspace_id;
  if (rawWs !== undefined && rawWs !== "") {
    const workspaceId = Number(rawWs);
    if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "workspace_id must be a positive integer" });
      return;
    }
    if ((await requireWorkspaceAccess(req, res, workspaceId)) === null) return;

    const adminWorkspaceIds = await assignedWorkspaceIds(admin.id);
    const assignedIds = await manageableEmployeeIds(adminWorkspaceIds, workspaceId);

    if (assignedIds.length === 0) {
      res.json([]);
      return;
    }
    const statusRaw = req.query.status;
    const status = statusRaw === "all" || statusRaw === "inactive" ? statusRaw : "active";
    const conditions = [inArray(employeesTable.id, assignedIds)];
    if (status !== "all") conditions.push(eq(employeesTable.status, status));
    const employees = await db
      .select()
      .from(employeesTable)
      .where(and(...conditions))
      .orderBy(employeesTable.createdAt);
    res.json(await serializeEmployeesWithAssignments(employees));
    return;
  }

  // No workspace filter: list only users in workspaces this admin can manage.
  const adminWorkspaceIds = await assignedWorkspaceIds(admin.id);
  const visibleEmployeeIds = await manageableEmployeeIds(adminWorkspaceIds);
  if (visibleEmployeeIds.length === 0) {
    res.json([]);
    return;
  }
  const statusRaw = req.query.status;
  const status = statusRaw === "all" || statusRaw === "inactive" ? statusRaw : "active";
  const employees = status === "all"
    ? await db.select().from(employeesTable).where(inArray(employeesTable.id, visibleEmployeeIds)).orderBy(employeesTable.createdAt)
    : await db.select().from(employeesTable).where(and(inArray(employeesTable.id, visibleEmployeeIds), eq(employeesTable.status, status))).orderBy(employeesTable.createdAt);
  res.json(await serializeEmployeesWithAssignments(employees));
});

router.post("/employees", async (req, res): Promise<void> => {
  // Phase 8c (Task #18): worker management is admin-only.
  if ((await requireAdmin(req, res)) === null) return;
  const parsed = employeeManagementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { password, workspaceIds: rawWorkspaceIds, affiliateNetworkIds: rawAffiliateNetworkIds, ...rest } = parsed.data;
  const workspaceIds = uniqueIds(rawWorkspaceIds);
  const affiliateNetworkIds = uniqueIds(rawAffiliateNetworkIds);
  if (rest.role === "employee" && affiliateNetworkIds.length === 0) {
    res.status(400).json({ error: "Assigned affiliate network(s) are required for workers" });
    return;
  }
  if (!(await validateManagedAssignments(req, res, workspaceIds, affiliateNetworkIds))) return;

  const initialPassword = password ?? generatedPassword();
  let employee: EmployeeRow;
  try {
    [employee] = await db
      .insert(employeesTable)
      .values({ ...rest, passwordHash: hashPassword(initialPassword) })
      .returning();
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } })?.code
      ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "An employee with this email already exists" });
      return;
    }
    throw err;
  }
  await replaceManagedAssignments(employee.id, rest.role, workspaceIds, affiliateNetworkIds);

  const [serialized] = await serializeEmployeesWithAssignments([employee]);
  res.status(201).json(serialized);
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
  if ((await requireEmployeeManagementAccess(req, res, employee.id)) === null) return;

  const [serialized] = await serializeEmployeesWithAssignments([employee]);
  res.json(serialized);
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

  const parsed = employeeManagementPatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  if ((await requireEmployeeManagementAccess(req, res, existing.id)) === null) return;

  const { password, workspaceIds: rawWorkspaceIds, affiliateNetworkIds: rawAffiliateNetworkIds, ...rest } = parsed.data;
  const workspaceIds = rawWorkspaceIds ? uniqueIds(rawWorkspaceIds) : undefined;
  const affiliateNetworkIds = rawAffiliateNetworkIds ? uniqueIds(rawAffiliateNetworkIds) : undefined;
  const nextRole = rest.role ?? existing.role;
  let nextWorkspaceIds = workspaceIds;
  if (!nextWorkspaceIds) nextWorkspaceIds = await assignedWorkspaceIds(params.data.id);
  const currentAffiliateIds = (
    await db
      .select({ affiliateNetworkId: workerAffiliateNetworksTable.affiliateNetworkId })
      .from(workerAffiliateNetworksTable)
      .where(eq(workerAffiliateNetworksTable.employeeId, params.data.id))
  ).map((assignment) => assignment.affiliateNetworkId);
  const nextAffiliateIds = affiliateNetworkIds ?? currentAffiliateIds;
  if (nextRole === "employee" && rest.status !== "inactive" && nextAffiliateIds.length === 0) {
    res.status(400).json({ error: "Assigned affiliate network(s) are required for workers" });
    return;
  }
  if (nextWorkspaceIds.length === 0) {
    res.status(400).json({ error: "At least one assigned workspace is required" });
    return;
  }
  if (workspaceIds || affiliateNetworkIds || rest.role || rest.status === "active") {
    if (!(await validateManagedAssignments(req, res, nextWorkspaceIds, nextRole === "employee" ? nextAffiliateIds : []))) return;
  }

  const updates: Record<string, unknown> = { ...rest };
  if (password) {
    updates.passwordHash = hashPassword(password);
  }
  if (rest.status === "inactive") {
    updates.activeWorkspaceId = null;
  }

  let employee: EmployeeRow;
  try {
    [employee] = await db
      .update(employeesTable)
      .set(updates)
      .where(eq(employeesTable.id, params.data.id))
      .returning();
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } })?.code
      ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "An employee with this email already exists" });
      return;
    }
    throw err;
  }
  if (workspaceIds || affiliateNetworkIds || rest.role) {
    await replaceManagedAssignments(
      employee.id,
      nextRole,
      nextWorkspaceIds,
      nextRole === "employee" ? nextAffiliateIds : [],
    );
  }

  const [serialized] = await serializeEmployeesWithAssignments([employee]);
  res.json(serialized);
});

router.delete("/employees/:id", async (req, res): Promise<void> => {
  // Phase 8c: worker management is admin-only. Delete is a soft
  // deactivate so historical tasks/campaigns keep their employee links.
  if ((await requireAdmin(req, res)) === null) return;
  const params = DeleteEmployeeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  if ((await requireEmployeeManagementAccess(req, res, existing.id)) === null) return;

  const [employee] = await db
    .update(employeesTable)
    .set({ status: "inactive", activeWorkspaceId: null })
    .where(eq(employeesTable.id, params.data.id))
    .returning();

  res.json(serializeEmployee(employee));
});

export default router;
