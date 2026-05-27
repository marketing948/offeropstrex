import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import app from "../app.ts";
import {
  db,
  employeesTable,
  employeeWorkspaceAssignmentsTable,
  testingBatchesTable,
  workspacesTable,
} from "@workspace/db";
import { _resetRegistryForTests } from "../engine/handlers.ts";
import { _resetRulesGuardForTests, registerAllRules } from "../engine/rules/index.ts";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  await db.execute(sql`
    ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS active_workspace_id integer
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
  _resetRegistryForTests();
  _resetRulesGuardForTests();
  registerAllRules();
  createdWorkspaceIds = [];
  createdEmployeeIds = [];
});

afterEach(async () => {
  _resetRegistryForTests();
  _resetRulesGuardForTests();
  registerAllRules();

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
  body?: unknown,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${authToken(employeeId)}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: { error?: string; detail?: string; notes?: string | null; status?: string } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, json };
}

async function createWorkspace(): Promise<number> {
  const [workspace] = await db
    .insert(workspacesTable)
    .values({
      name: `batch-patch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      isDefault: false,
      isActive: false,
    })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(workspace.id);
  return workspace.id;
}

async function createEmployee(): Promise<number> {
  const [employee] = await db
    .insert(employeesTable)
    .values({
      name: `Batch Patch Tester ${Date.now()}`,
      email: `batch-patch-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
      passwordHash: "x",
      role: "admin",
    })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(employee.id);
  return employee.id;
}

async function assign(employeeId: number, workspaceId: number): Promise<void> {
  await db
    .insert(employeeWorkspaceAssignmentsTable)
    .values({ employeeId, workspaceId, role: "employee" })
    .onConflictDoNothing();
}

async function seedBatch() {
  const workspaceId = await createWorkspace();
  const employeeId = await createEmployee();
  await assign(employeeId, workspaceId);

  const [batch] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId,
      employeeId,
      batchName: `Patch Lifecycle ${Date.now()}`,
      affiliateNetwork: "Network",
      geo: "DE",
      trafficSource: "Source",
      batchTag: `patch_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      status: "NEW_BATCH",
      notes: "before",
    })
    .returning({
      id: testingBatchesTable.id,
      status: testingBatchesTable.status,
    });

  return { workspaceId, employeeId, batchId: batch.id, initialStatus: batch.status };
}

describe("PATCH /testing-batches/:id lifecycle boundary", { concurrency: false }, () => {
  test("rejects status in PATCH body", async () => {
    const { employeeId, batchId, initialStatus } = await seedBatch();

    const { response, json } = await request("PATCH", `/testing-batches/${batchId}`, employeeId, {
      status: "LIVE_TESTS",
    });

    assert.equal(response.status, 400);
    assert.match(String(json?.error), /status cannot be changed via PATCH/i);
    assert.match(String(json?.detail), /go-live/i);

    const [row] = await db
      .select({ status: testingBatchesTable.status })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, batchId));
    assert.equal(row?.status, initialStatus);
  });

  test("allows PATCH for non-status fields", async () => {
    const { employeeId, batchId } = await seedBatch();

    const { response, json } = await request("PATCH", `/testing-batches/${batchId}`, employeeId, {
      notes: "Slice 4D updated",
    });

    assert.equal(response.status, 200);
    assert.equal(json?.notes, "Slice 4D updated");

    const [row] = await db
      .select({ notes: testingBatchesTable.notes })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, batchId));
    assert.equal(row?.notes, "Slice 4D updated");
  });

  test("POST go-live still transitions batch status", async () => {
    const { employeeId, batchId } = await seedBatch();

    await db
      .update(testingBatchesTable)
      .set({ status: "OFFER_READY_FOR_LIVE_TESTING" })
      .where(eq(testingBatchesTable.id, batchId));

    const { response, json } = await request(
      "POST",
      `/testing-batches/${batchId}/go-live`,
      employeeId,
    );

    assert.equal(response.status, 200);
    assert.equal(json?.status, "LIVE_TESTS");
  });
});
