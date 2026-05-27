import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import app from "../app.ts";
import {
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  settingsTable,
  workspacesTable,
} from "@workspace/db";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

const originalFetch = globalThis.fetch;
const originalEnableVoluum = process.env.ENABLE_VOLUUM;
const originalStaleMs = process.env.VOLUUM_SYNC_LOCK_STALE_MS;
let voluumCalls = 0;

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (originalEnableVoluum === undefined) delete process.env.ENABLE_VOLUUM;
  else process.env.ENABLE_VOLUUM = originalEnableVoluum;
  if (originalStaleMs === undefined) delete process.env.VOLUUM_SYNC_LOCK_STALE_MS;
  else process.env.VOLUUM_SYNC_LOCK_STALE_MS = originalStaleMs;
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

beforeEach(() => {
  process.env.ENABLE_VOLUUM = "true";
  process.env.VOLUUM_SYNC_LOCK_STALE_MS = "300000";
  voluumCalls = 0;
  globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.voluum.com")) {
      voluumCalls++;
      const pathname = new URL(url).pathname;
      if (pathname === "/auth/access/session") {
        return new Response(JSON.stringify({ token: "token" }), { status: 200 });
      }
      if (pathname === "/traffic-source") {
        return new Response(JSON.stringify({ trafficSources: [] }), { status: 200 });
      }
      if (pathname === "/affiliate-network") {
        return new Response(JSON.stringify({ affiliateNetworks: [] }), { status: 200 });
      }
      if (pathname === "/campaign") {
        return new Response(JSON.stringify({ campaigns: [] }), { status: 200 });
      }
      if (pathname === "/offer") {
        return new Response(JSON.stringify({ offers: [] }), { status: 200 });
      }
      if (pathname === "/report") {
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }
      throw new Error(`Unexpected Voluum endpoint in test: ${url}`);
    }
    return originalFetch(input, init);
  };
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const id of [...createdWorkspaceIds].reverse()) {
    await db.delete(employeeWorkspaceAssignmentsTable).where(eq(employeeWorkspaceAssignmentsTable.workspaceId, id));
    await db.delete(workspacesTable).where(eq(workspacesTable.id, id));
  }
  for (const id of [...createdEmployeeIds].reverse()) {
    await db.delete(employeeWorkspaceAssignmentsTable).where(eq(employeeWorkspaceAssignmentsTable.employeeId, id));
    await db.delete(employeesTable).where(eq(employeesTable.id, id));
  }
  createdWorkspaceIds = [];
  createdEmployeeIds = [];
});

async function createWorkspace(name: string): Promise<number> {
  const [workspace] = await db.insert(workspacesTable).values({
    name: `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    isDefault: false,
    isActive: false,
    voluumAccessId: "aid",
    voluumAccessKey: "akey",
    voluumApiBaseUrl: "https://api.voluum.com",
    voluumWorkspaceId: "ws-1",
    voluumWorkspaceName: "WS1",
  }).returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(workspace.id);
  return workspace.id;
}

async function createEmployee(role: "admin" | "employee" = "employee"): Promise<number> {
  const [employee] = await db.insert(employeesTable).values({
    name: `sync-concurrency-${Date.now()}`,
    email: `sync-concurrency-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
    passwordHash: "x",
    role,
  }).returning({ id: employeesTable.id });
  createdEmployeeIds.push(employee.id);
  return employee.id;
}

async function assign(employeeId: number, workspaceId: number, role: "admin" | "employee" = "employee"): Promise<void> {
  await db.insert(employeeWorkspaceAssignmentsTable).values({ employeeId, workspaceId, role }).onConflictDoNothing();
}

async function callSync(workspaceId: number, employeeId: number): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl}/sync/voluum/workspaces/${workspaceId}/sync`, {
    method: "POST",
    headers: { authorization: `Bearer ${authToken(employeeId)}` },
  });
  const json = await response.json();
  return { status: response.status, json };
}

async function callTrigger(workspaceId: number, employeeId: number): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl}/sync/voluum/trigger`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken(employeeId)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ workspaceId }),
  });
  const json = await response.json();
  return { status: response.status, json };
}

async function markWorkspaceSyncing(workspaceId: number, updatedAt: Date): Promise<void> {
  await db.update(workspacesTable)
    .set({ syncStatus: "syncing", updatedAt })
    .where(eq(workspacesTable.id, workspaceId));
  await db.insert(settingsTable).values({
    workspaceId,
    key: "voluum_sync_lock_started_at",
    value: updatedAt.toISOString(),
  }).onConflictDoUpdate({
    target: [settingsTable.workspaceId, settingsTable.key],
    set: { value: updatedAt.toISOString() },
  });
}

async function getLockSetting(workspaceId: number, key: string): Promise<string | null> {
  const [row] = await db.select({ value: settingsTable.value })
    .from(settingsTable)
    .where(and(eq(settingsTable.workspaceId, workspaceId), eq(settingsTable.key, key)));
  return row?.value ?? null;
}

async function waitForLockCleared(workspaceId: number, key: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const value = await getLockSetting(workspaceId, key);
    if (value === null) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Expected lock setting ${key} to be cleared for workspace ${workspaceId}`);
}

describe("Voluum sync concurrency lock", { concurrency: false }, () => {
  test("first sync can start", async () => {
    const workspaceId = await createWorkspace("sync-lock-first");
    const employeeId = await createEmployee("employee");
    await assign(employeeId, workspaceId, "employee");

    const result = await callSync(workspaceId, employeeId);
    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(voluumCalls > 0, true);
  });

  test("second sync for same workspace is rejected while active", async () => {
    const workspaceId = await createWorkspace("sync-lock-conflict");
    const employeeId = await createEmployee("employee");
    await assign(employeeId, workspaceId, "employee");
    await markWorkspaceSyncing(workspaceId, new Date());

    const result = await callSync(workspaceId, employeeId);
    assert.equal(result.status, 409);
    assert.equal(result.json.error, "Voluum sync already running for this workspace");
    assert.equal(result.json.status, "already_running");
    assert.equal(voluumCalls, 0);
  });

  test("different workspaces can sync independently", async () => {
    const workspaceA = await createWorkspace("sync-lock-a");
    const workspaceB = await createWorkspace("sync-lock-b");
    const employeeId = await createEmployee("employee");
    await assign(employeeId, workspaceA, "employee");
    await assign(employeeId, workspaceB, "employee");
    await markWorkspaceSyncing(workspaceA, new Date());

    const result = await callSync(workspaceB, employeeId);
    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
  });

  test("stale active sync is recovered", async () => {
    const workspaceId = await createWorkspace("sync-lock-stale");
    const employeeId = await createEmployee("employee");
    await assign(employeeId, workspaceId, "employee");
    const staleDate = new Date(Date.now() - 301_000);
    await markWorkspaceSyncing(workspaceId, staleDate);

    const result = await callSync(workspaceId, employeeId);
    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
  });

  test("lock metadata is cleared after successful sync", async () => {
    const workspaceId = await createWorkspace("sync-lock-release-success");
    const employeeId = await createEmployee("employee");
    await assign(employeeId, workspaceId, "employee");

    const result = await callSync(workspaceId, employeeId);
    assert.equal(result.status, 200);
    await waitForLockCleared(workspaceId, "voluum_sync_lock_started_at");
    await waitForLockCleared(workspaceId, "voluum_sync_lock_request_id");

    const [workspace] = await db.select({
      syncStatus: workspacesTable.syncStatus,
    }).from(workspacesTable).where(eq(workspacesTable.id, workspaceId));
    assert.equal(workspace?.syncStatus, "success");
  });

  test("lock metadata is cleared and status marked error when sync fails", async () => {
    const workspaceId = await createWorkspace("sync-lock-release-error");
    const employeeId = await createEmployee("employee");
    await assign(employeeId, workspaceId, "employee");

    globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://api.voluum.com")) {
        if (new URL(url).pathname === "/auth/access/session") {
          return new Response(JSON.stringify({ error: "bad auth" }), { status: 401 });
        }
        return new Response(JSON.stringify({}), { status: 500 });
      }
      return originalFetch(input, init);
    };

    const result = await callSync(workspaceId, employeeId);
    assert.equal(result.status, 500);
    await waitForLockCleared(workspaceId, "voluum_sync_lock_started_at");

    const [workspace] = await db.select({
      syncStatus: workspacesTable.syncStatus,
    }).from(workspacesTable).where(eq(workspacesTable.id, workspaceId));
    assert.equal(workspace?.syncStatus, "error");
  });

  test("unauthorized user cannot use another workspace sync lock", async () => {
    const workspaceA = await createWorkspace("sync-lock-unauth-a");
    const workspaceB = await createWorkspace("sync-lock-unauth-b");
    const employeeId = await createEmployee("employee");
    await assign(employeeId, workspaceB, "employee");
    await markWorkspaceSyncing(workspaceA, new Date());

    const unauthorized = await callSync(workspaceA, employeeId);
    assert.equal(unauthorized.status, 403);

    const allowed = await callSync(workspaceB, employeeId);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.json.success, true);
  });

  test("legacy trigger route also rejects while lock is active", async () => {
    const workspaceId = await createWorkspace("sync-lock-trigger");
    const adminId = await createEmployee("admin");
    await assign(adminId, workspaceId, "admin");
    await markWorkspaceSyncing(workspaceId, new Date());

    const result = await callTrigger(workspaceId, adminId);
    assert.equal(result.status, 409);
    assert.equal(result.json.error, "Voluum sync already running for this workspace");
  });
});
