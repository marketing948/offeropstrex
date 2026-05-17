import type { Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, employeeWorkspaceAssignmentsTable } from "@workspace/db";
import { getEmployeeFromToken } from "../routes/auth";

export type WorkspaceAccessResult =
  | { allowed: true; employee: NonNullable<Awaited<ReturnType<typeof getEmployeeFromToken>>> }
  | { allowed: false; status: number; reason: string };

/**
 * Verify that the requesting employee has access to the given workspace.
 * All employees, including admins, must be explicitly assigned to the
 * workspace. Admin role controls privileged actions inside an allowed
 * workspace; it is not global workspace access.
 *
 * No fallback: an employee with zero assignments will receive 403. Seed any
 * existing employees into the Default Workspace before deploying this change.
 */
export async function checkWorkspaceAccess(
  req: Request,
  workspaceId: number,
): Promise<WorkspaceAccessResult> {
  const employee = await getEmployeeFromToken(req);
  if (!employee) return { allowed: false, status: 401, reason: "Unauthorized" };
  const [assignment] = await db
    .select({ id: employeeWorkspaceAssignmentsTable.id })
    .from(employeeWorkspaceAssignmentsTable)
    .where(and(
      eq(employeeWorkspaceAssignmentsTable.employeeId, employee.id),
      eq(employeeWorkspaceAssignmentsTable.workspaceId, workspaceId),
    ));
  if (assignment) return { allowed: true, employee };

  return { allowed: false, status: 403, reason: "Access denied: not a member of this workspace" };
}

/**
 * Guard for admin-only routes (workspace management, etc).
 * On failure, sends 401/403 and returns null. On success returns the employee.
 */
export async function requireAdmin(
  req: Request,
  res: Response,
): Promise<NonNullable<Awaited<ReturnType<typeof getEmployeeFromToken>>> | null> {
  const employee = await getEmployeeFromToken(req);
  if (!employee) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (employee.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return employee;
}

/**
 * Helper for mutation routes: validate access to `workspaceId` (typically
 * derived from a record or request body). On failure, sends the appropriate
 * HTTP error response and returns null. On success returns the workspaceId.
 */
export async function requireWorkspaceAccess(
  req: Request,
  res: Response,
  workspaceId: number | null | undefined,
): Promise<number | null> {
  if (workspaceId === null || workspaceId === undefined || !Number.isInteger(workspaceId) || workspaceId <= 0) {
    res.status(400).json({ error: "workspaceId is required" });
    return null;
  }
  const access = await checkWorkspaceAccess(req, workspaceId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return null;
  }
  return workspaceId;
}

/**
 * Validate `workspace_id` from req.query and run the access check.
 * On any failure, sends the appropriate HTTP error response and returns null.
 * On success, returns the validated workspaceId.
 */
export async function requireWorkspaceFromQuery(
  req: Request,
  res: Response,
): Promise<number | null> {
  const raw = req.query.workspace_id;
  if (raw === undefined || raw === null || raw === "") {
    res.status(400).json({ error: "workspace_id query parameter is required" });
    return null;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "workspace_id must be a positive integer" });
    return null;
  }
  const access = await checkWorkspaceAccess(req, id);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return null;
  }
  return id;
}
