// Phase 6b helper: look up admin employees who should be paged when a
// workspace-scoped engine event needs to surface to "the team that runs
// this workspace". Two cohorts qualify:
//
//   1. Global admins (`employees.role = 'admin'`) — they have implicit
//      access to every workspace.
//   2. Members of the workspace via `employee_workspace_assignments`
//      whose row carries `role = 'admin'`. (This is the per-workspace
//      admin grant introduced in Phase 1; an employee may be an admin
//      of WS-A and a regular member of WS-B.)
//
// We union the two and de-duplicate on employee id. The query takes the
// engine's transaction handle so the read joins the same snapshot as
// the rule's other reads.

import { and, eq, or } from "drizzle-orm";
import {
  employeesTable,
  employeeWorkspaceAssignmentsTable,
} from "@workspace/db";
import type { Tx } from "../types.ts";

export async function getWorkspaceAdminEmployeeIds(
  tx: Tx,
  workspaceId: number,
): Promise<number[]> {
  const rows = await tx
    .selectDistinct({ id: employeesTable.id })
    .from(employeesTable)
    .leftJoin(
      employeeWorkspaceAssignmentsTable,
      and(
        eq(employeeWorkspaceAssignmentsTable.employeeId, employeesTable.id),
        eq(employeeWorkspaceAssignmentsTable.workspaceId, workspaceId),
      ),
    )
    .where(
      or(
        eq(employeesTable.role, "admin"),
        eq(employeeWorkspaceAssignmentsTable.role, "admin"),
      ),
    );
  return rows.map((r) => r.id);
}
