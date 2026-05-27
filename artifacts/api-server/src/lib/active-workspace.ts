import { eq } from "drizzle-orm";
import { db, employeesTable, workspacesTable } from "@workspace/db";
import { redactWorkspaceForApi } from "./voluum-credentials.ts";

type EmployeeWithActiveWorkspace = Pick<typeof employeesTable.$inferSelect, "id" | "activeWorkspaceId">;
type WorkspaceRow = typeof workspacesTable.$inferSelect;

function effectiveActiveWorkspaceId(
  employee: EmployeeWithActiveWorkspace,
  workspaces: readonly WorkspaceRow[],
): number | null {
  if (employee.activeWorkspaceId != null && workspaces.some((ws) => ws.id === employee.activeWorkspaceId)) {
    return employee.activeWorkspaceId;
  }
  return workspaces.find((ws) => ws.isDefault)?.id ?? workspaces[0]?.id ?? null;
}

export function serializeWorkspaceForEmployee(
  workspace: WorkspaceRow,
  employee: EmployeeWithActiveWorkspace,
  allWorkspaces: readonly WorkspaceRow[] = [workspace],
) {
  const activeWorkspaceId = effectiveActiveWorkspaceId(employee, allWorkspaces);
  const redacted = redactWorkspaceForApi(workspace);
  return {
    ...redacted,
    isActive: workspace.id === activeWorkspaceId,
    lastSyncAt: workspace.lastSyncAt?.toISOString() ?? null,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}

export function serializeWorkspacesForEmployee(
  workspaces: readonly WorkspaceRow[],
  employee: EmployeeWithActiveWorkspace,
) {
  return workspaces.map((workspace) => serializeWorkspaceForEmployee(workspace, employee, workspaces));
}

export async function setActiveWorkspaceForEmployee(
  employeeId: number,
  workspaceId: number,
): Promise<WorkspaceRow | null> {
  const [workspace] = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.id, workspaceId));
  if (!workspace) return null;

  await db
    .update(employeesTable)
    .set({ activeWorkspaceId: workspaceId })
    .where(eq(employeesTable.id, employeeId));

  return workspace;
}
