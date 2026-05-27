import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import app from "../app.ts";
import {
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  todoTasksTable,
  workspacesTable,
} from "@workspace/db";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  createdWorkspaceIds = [];
  createdEmployeeIds = [];
});

afterEach(async () => {
  for (const id of [...createdWorkspaceIds].reverse()) {
    await db.delete(workspacesTable).where(eq(workspacesTable.id, id));
  }
  for (const id of [...createdEmployeeIds].reverse()) {
    await db.delete(employeesTable).where(eq(employeesTable.id, id));
  }
});



async function request(path: string, employeeId: number) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${authToken(employeeId)}` },
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { response, json };
}

async function createWorkspace(name: string): Promise<number> {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `${name}-${Date.now()}`, isActive: false })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(ws.id);
  return ws.id;
}

async function createEmployee(role: "admin" | "employee"): Promise<number> {
  const [emp] = await db
    .insert(employeesTable)
    .values({
      name: `SF ${role} ${Date.now()}`,
      email: `sf-${role}-${Date.now()}@example.com`,
      passwordHash: "x",
      role,
    })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(emp.id);
  return emp.id;
}

async function assign(employeeId: number, workspaceId: number): Promise<void> {
  await db
    .insert(employeeWorkspaceAssignmentsTable)
    .values({ employeeId, workspaceId, role: "employee" })
    .onConflictDoNothing();
}

type TaskRow = { id: number; status: string; employeeId: number };

describe("GET /todo-tasks status_filter", { concurrency: false }, () => {
  test("active excludes completed tasks", async () => {
    const workspaceId = await createWorkspace("sf-active");
    const workerId = await createEmployee("employee");
    await assign(workerId, workspaceId);

    const [openTask] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId,
        employeeId: workerId,
        title: "Open task",
        taskType: "MANUAL",
        status: "TODO",
      })
      .returning({ id: todoTasksTable.id, status: todoTasksTable.status });

    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId: workerId,
      title: "Done task",
      taskType: "MANUAL",
      status: "DONE",
      completedAt: new Date(),
    });

    const { response, json } = await request(
      `/todo-tasks?workspace_id=${workspaceId}&employee_id=${workerId}&status_filter=active`,
      workerId,
    );

    assert.equal(response.status, 200);
    const items = json as TaskRow[];
    assert.ok(items.every((t) => t.status !== "DONE"));
    assert.ok(items.some((t) => t.id === openTask.id));
  });

  test("completed returns only DONE tasks", async () => {
    const workspaceId = await createWorkspace("sf-completed");
    const workerId = await createEmployee("employee");
    await assign(workerId, workspaceId);

    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId: workerId,
      title: "Still open",
      taskType: "MANUAL",
      status: "IN_PROGRESS",
    });

    const [doneTask] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId,
        employeeId: workerId,
        title: "Finished",
        taskType: "MANUAL",
        status: "DONE",
        completedAt: new Date(),
      })
      .returning({ id: todoTasksTable.id, status: todoTasksTable.status });

    const { response, json } = await request(
      `/todo-tasks?workspace_id=${workspaceId}&employee_id=${workerId}&status_filter=completed`,
      workerId,
    );

    assert.equal(response.status, 200);
    const items = json as TaskRow[];
    assert.equal(items.length, 1);
    assert.equal(items[0]!.id, doneTask.id);
    assert.equal(items[0]!.status, "DONE");
  });

  test("all returns open and completed tasks", async () => {
    const workspaceId = await createWorkspace("sf-all");
    const workerId = await createEmployee("employee");
    await assign(workerId, workspaceId);

    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId: workerId,
      title: "Open",
      taskType: "MANUAL",
      status: "TODO",
    });
    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId: workerId,
      title: "Done",
      taskType: "MANUAL",
      status: "DONE",
      completedAt: new Date(),
    });

    const { response, json } = await request(
      `/todo-tasks?workspace_id=${workspaceId}&employee_id=${workerId}&status_filter=all`,
      workerId,
    );

    assert.equal(response.status, 200);
    const items = json as TaskRow[];
    assert.equal(items.length, 2);
    const statuses = new Set(items.map((t) => t.status));
    assert.ok(statuses.has("TODO"));
    assert.ok(statuses.has("DONE"));
  });

  test("worker without workspace access is rejected", async () => {
    const workspaceId = await createWorkspace("sf-denied");
    const outsider = await createEmployee("employee");

    const { response, json } = await request(
      `/todo-tasks?workspace_id=${workspaceId}&status_filter=active`,
      outsider,
    );

    assert.equal(response.status, 403);
    assert.equal((json as { error: string }).error, "Access denied: not a member of this workspace");
  });

  test("admin can list workspace tasks without employee_id filter", async () => {
    const workspaceId = await createWorkspace("sf-admin");
    const adminId = await createEmployee("admin");
    const workerId = await createEmployee("employee");
    await assign(adminId, workspaceId);
    await assign(workerId, workspaceId);

    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId: workerId,
      title: "Worker open",
      taskType: "MANUAL",
      status: "TODO",
    });
    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId: workerId,
      title: "Worker done",
      taskType: "MANUAL",
      status: "DONE",
      completedAt: new Date(),
    });

    const active = await request(
      `/todo-tasks?workspace_id=${workspaceId}&status_filter=active`,
      adminId,
    );
    assert.equal(active.response.status, 200);
    assert.ok((active.json as TaskRow[]).every((t) => t.status !== "DONE"));

    const completed = await request(
      `/todo-tasks?workspace_id=${workspaceId}&status_filter=completed`,
      adminId,
    );
    assert.equal(completed.response.status, 200);
    assert.ok((completed.json as TaskRow[]).every((t) => t.status === "DONE"));
  });

  test("exact status overrides status_filter (status=DONE wins over status_filter=active)", async () => {
    const workspaceId = await createWorkspace("sf-status-override");
    const workerId = await createEmployee("employee");
    await assign(workerId, workspaceId);

    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId: workerId,
      title: "Still open",
      taskType: "MANUAL",
      status: "TODO",
    });

    const [doneTask] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId,
        employeeId: workerId,
        title: "Finished",
        taskType: "MANUAL",
        status: "DONE",
        completedAt: new Date(),
      })
      .returning({ id: todoTasksTable.id, status: todoTasksTable.status });

    const { response, json } = await request(
      `/todo-tasks?workspace_id=${workspaceId}&employee_id=${workerId}&status=DONE&status_filter=active`,
      workerId,
    );

    assert.equal(response.status, 200);
    const items = json as TaskRow[];
    assert.equal(items.length, 1);
    assert.equal(items[0]!.id, doneTask.id);
    assert.equal(items[0]!.status, "DONE");
  });

  test("rejects invalid status_filter", async () => {
    const workspaceId = await createWorkspace("sf-invalid");
    const workerId = await createEmployee("employee");
    await assign(workerId, workspaceId);

    const { response, json } = await request(
      `/todo-tasks?workspace_id=${workspaceId}&status_filter=archived`,
      workerId,
    );

    assert.equal(response.status, 400);
    assert.match(String((json as { error: string }).error), /status_filter/);
  });
});
