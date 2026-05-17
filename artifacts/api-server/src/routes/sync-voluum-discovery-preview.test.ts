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
  eventsTable,
  workspacesTable,
} from "@workspace/db";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

const originalEnableVoluum = process.env["ENABLE_VOLUUM"];
const originalEnableVoluumDryRun = process.env["ENABLE_VOLUUM_DRY_RUN"];

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  restoreEnv();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  process.env["ENABLE_VOLUUM"] = "false";
  delete process.env["ENABLE_VOLUUM_DRY_RUN"];
  createdWorkspaceIds = [];
  createdEmployeeIds = [];
});

afterEach(async () => {
  restoreEnv();

  for (const id of [...createdWorkspaceIds].reverse()) {
    await db.delete(employeeWorkspaceAssignmentsTable).where(eq(employeeWorkspaceAssignmentsTable.workspaceId, id));
    await db.delete(workspacesTable).where(eq(workspacesTable.id, id));
  }
  for (const id of [...createdEmployeeIds].reverse()) {
    await db.delete(employeeWorkspaceAssignmentsTable).where(eq(employeeWorkspaceAssignmentsTable.employeeId, id));
    await db.delete(employeesTable).where(eq(employeesTable.id, id));
  }
});

function restoreEnv(): void {
  setOrDeleteEnv("ENABLE_VOLUUM", originalEnableVoluum);
  setOrDeleteEnv("ENABLE_VOLUUM_DRY_RUN", originalEnableVoluumDryRun);
}

function setOrDeleteEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function authToken(employeeId: number): string {
  return Buffer.from(`${employeeId}:voluum-discovery-preview-test:offerops_secret`).toString("base64");
}

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
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { response, json };
}

async function createWorkspace(name: string): Promise<number> {
  const [workspace] = await db
    .insert(workspacesTable)
    .values({
      name: `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      isDefault: false,
      isActive: false,
    })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(workspace.id);
  return workspace.id;
}

async function createEmployee(role: "admin" | "employee" = "employee"): Promise<number> {
  const [employee] = await db
    .insert(employeesTable)
    .values({
      name: `Voluum Preview ${Date.now()}`,
      email: `voluum-preview-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
      passwordHash: "x",
      role,
    })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(employee.id);
  return employee.id;
}

async function assign(employeeId: number, workspaceId: number, role = "employee"): Promise<void> {
  await db
    .insert(employeeWorkspaceAssignmentsTable)
    .values({ employeeId, workspaceId, role })
    .onConflictDoNothing();
}

async function seedWorkspaceAccess(role: "admin" | "employee" = "employee") {
  const workspaceId = await createWorkspace("voluum-discovery-preview");
  const employeeId = await createEmployee(role);
  await assign(employeeId, workspaceId, role);
  return { workspaceId, employeeId };
}

async function eventCount(workspaceId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(eventsTable)
    .where(eq(eventsTable.workspaceId, workspaceId));
  return row?.count ?? 0;
}

describe("Voluum discovery preview dry-run route", { concurrency: false }, () => {
  test("is disabled unless ENABLE_VOLUUM_DRY_RUN=true", async () => {
    const { workspaceId, employeeId } = await seedWorkspaceAccess();

    const globallyDisabled = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });

    assert.equal(globallyDisabled.response.status, 410);
    assert.equal(globallyDisabled.json.error, "voluum_disabled");

    process.env["ENABLE_VOLUUM"] = "true";
    const dryRunDisabled = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });

    assert.equal(dryRunDisabled.response.status, 410);
    assert.equal(dryRunDisabled.json.error, "voluum_dry_run_disabled");
  });

  test("can be enabled while ENABLE_VOLUUM=false", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess();

    const { response, json } = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });

    assert.equal(response.status, 200);
    assert.deepEqual(json, {
      mode: "dry_run",
      workspaceId,
      enabled: true,
      sideEffects: {
        voluumCalls: false,
        dbWrites: false,
        events: false,
        tasks: false,
        batches: false,
      },
    });
  });

  test("does not unlock existing mutating Voluum routes", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess("admin");

    const { response, json } = await request("POST", "/sync/voluum/trigger", employeeId, { workspaceId });

    assert.equal(response.status, 410);
    assert.equal(json.error, "voluum_disabled");
  });

  test("rejects missing or inaccessible workspace", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId } = await seedWorkspaceAccess();
    const otherEmployeeId = await createEmployee();

    const missing = await request("POST", "/sync/voluum/discovery-preview", otherEmployeeId, {});
    assert.equal(missing.response.status, 400);
    assert.match(missing.json.error, /workspaceId is required/);

    const inaccessible = await request("POST", "/sync/voluum/discovery-preview", otherEmployeeId, { workspaceId });
    assert.equal(inaccessible.response.status, 403);
    assert.match(inaccessible.json.error, /not a member/);
  });

  test("emits no events", async () => {
    process.env["ENABLE_VOLUUM"] = "false";
    process.env["ENABLE_VOLUUM_DRY_RUN"] = "true";
    const { workspaceId, employeeId } = await seedWorkspaceAccess();
    const beforeCount = await eventCount(workspaceId);

    const { response } = await request("POST", "/sync/voluum/discovery-preview", employeeId, { workspaceId });
    const afterCount = await eventCount(workspaceId);

    assert.equal(response.status, 200);
    assert.equal(afterCount, beforeCount);
  });
});
