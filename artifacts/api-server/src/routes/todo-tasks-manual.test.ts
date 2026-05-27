import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import app from "../app.ts";
import {
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  eventsTable,
  todoTasksTable,
  workspacesTable,
} from "@workspace/db";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  await db.execute(sql`
    DO $$
    BEGIN
      ALTER TYPE task_type ADD VALUE 'MANUAL';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);

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



async function request(
  method: string,
  path: string,
  employeeId: number,
  body?: Record<string, unknown>,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${authToken(employeeId)}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text } as Record<string, unknown>;
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
      name: `MT ${role} ${Date.now()}`,
      email: `mt-${role}-${Date.now()}@example.com`,
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

describe("POST /todo-tasks/manual", { concurrency: false }, () => {
  test("admin can create MANUAL task and it appears in GET /todo-tasks", async () => {
    const workspaceId = await createWorkspace("manual-ws");
    const adminId = await createEmployee("admin");
    const workerId = await createEmployee("employee");
    await assign(adminId, workspaceId);
    await assign(workerId, workspaceId);

    const created = await request("POST", "/todo-tasks/manual", adminId, {
      workspaceId,
      assignedEmployeeId: workerId,
      title: "Call affiliate about caps",
      description: "Ops reminder",
      priority: "high",
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.json!.taskType, "MANUAL");
    assert.equal(created.json!.employeeId, workerId);

    const list = await request(
      "GET",
      `/todo-tasks?workspace_id=${workspaceId}&task_type=MANUAL`,
      workerId,
    );
    assert.equal(list.response.status, 200);
    const listJson = list.json;
    assert.ok(Array.isArray(listJson));
    const arr = listJson;
    const found = arr.find((t: { id?: number }) => t.id === created.json!.id);
    assert.ok(found);
  });

  test("worker cannot create manual task (admin only)", async () => {
    const workspaceId = await createWorkspace("manual-worker");
    const adminId = await createEmployee("admin");
    const workerId = await createEmployee("employee");
    await assign(adminId, workspaceId);
    await assign(workerId, workspaceId);

    const res = await request("POST", "/todo-tasks/manual", workerId, {
      workspaceId,
      assignedEmployeeId: workerId,
      title: "Should fail",
    });
    assert.equal(res.response.status, 403);
  });

  test("admin cannot assign manual task across workspace boundary", async () => {
    const wsA = await createWorkspace("manual-a");
    const wsB = await createWorkspace("manual-b");
    const adminId = await createEmployee("admin");
    const workerB = await createEmployee("employee");
    await assign(adminId, wsA);
    await assign(adminId, wsB);
    await assign(workerB, wsB);

    const res = await request("POST", "/todo-tasks/manual", adminId, {
      workspaceId: wsA,
      assignedEmployeeId: workerB,
      title: "Cross-ws",
    });
    assert.equal(res.response.status, 400);
    assert.match(String(res.json!.error), /member of the target workspace/i);
  });

  test("completing MANUAL task does not emit TaskCompleted workflow event", async () => {
    const workspaceId = await createWorkspace("manual-complete");
    const adminId = await createEmployee("admin");
    const workerId = await createEmployee("employee");
    await assign(adminId, workspaceId);
    await assign(workerId, workspaceId);

    const created = await request("POST", "/todo-tasks/manual", adminId, {
      workspaceId,
      assignedEmployeeId: workerId,
      title: "Review Q2 numbers",
    });
    assert.equal(created.response.status, 201);
    const taskId = created.json!.id as number;

    const before = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.workspaceId, workspaceId),
          eq(eventsTable.type, "TaskCompleted"),
          eq(eventsTable.dedupeKey, `task_completed:${taskId}`),
        ),
      );

    const done = await request("POST", `/todo-tasks/${taskId}/complete`, workerId, {});
    assert.equal(done.response.status, 200);
    assert.equal(done.json!.status, "DONE");

    const after = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.workspaceId, workspaceId),
          eq(eventsTable.type, "TaskCompleted"),
          eq(eventsTable.dedupeKey, `task_completed:${taskId}`),
        ),
      );
    assert.equal(after.length, before.length);
  });
});
