import { and, eq } from "drizzle-orm";
import {
  db,
  employeesTable,
  employeeWorkspaceAssignmentsTable,
  workspacesTable,
} from "@workspace/db";
import { hashPassword } from "../routes/auth.ts";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function ensureWorkspace(name: string): Promise<typeof workspacesTable.$inferSelect> {
  const [defaultWorkspace] = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.isDefault, true))
    .limit(1);

  if (defaultWorkspace) return defaultWorkspace;

  const [namedWorkspace] = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.name, name))
    .limit(1);

  if (namedWorkspace) {
    const [updated] = await db
      .update(workspacesTable)
      .set({ isDefault: true, isActive: true, updatedAt: new Date() })
      .where(eq(workspacesTable.id, namedWorkspace.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(workspacesTable)
    .values({ name, isDefault: true, isActive: true })
    .returning();
  return created;
}

async function ensureAdmin(
  email: string,
  password: string,
  name: string,
  workspaceId: number,
): Promise<typeof employeesTable.$inferSelect> {
  const [existing] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.email, email))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(employeesTable)
      .set({
        role: "admin",
        status: "active",
        activeWorkspaceId: existing.activeWorkspaceId ?? workspaceId,
      })
      .where(eq(employeesTable.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(employeesTable)
    .values({
      name,
      email,
      passwordHash: hashPassword(password),
      role: "admin",
      status: "active",
      activeWorkspaceId: workspaceId,
    })
    .returning();
  return created;
}

async function ensureWorkspaceAssignment(
  employeeId: number,
  workspaceId: number,
): Promise<void> {
  const [existing] = await db
    .select({ id: employeeWorkspaceAssignmentsTable.id })
    .from(employeeWorkspaceAssignmentsTable)
    .where(
      and(
        eq(employeeWorkspaceAssignmentsTable.employeeId, employeeId),
        eq(employeeWorkspaceAssignmentsTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (existing) return;

  await db.insert(employeeWorkspaceAssignmentsTable).values({
    employeeId,
    workspaceId,
    role: "workspace_admin",
  });
}

async function main(): Promise<void> {
  const email = requiredEnv("BOOTSTRAP_ADMIN_EMAIL");
  const password = requiredEnv("BOOTSTRAP_ADMIN_PASSWORD");
  const name = process.env["BOOTSTRAP_ADMIN_NAME"]?.trim() || "Internal Admin";
  const workspaceName =
    process.env["BOOTSTRAP_WORKSPACE_NAME"]?.trim() || "Default Workspace";

  const workspace = await ensureWorkspace(workspaceName);
  const admin = await ensureAdmin(email, password, name, workspace.id);
  await ensureWorkspaceAssignment(admin.id, workspace.id);

  console.log(
    JSON.stringify(
      {
        ok: true,
        adminEmail: admin.email,
        adminId: admin.id,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
