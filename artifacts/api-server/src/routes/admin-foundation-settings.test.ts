import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app.ts";
import {
  affiliateNetworksTable,
  db,
  employeesTable,
  employeeWorkspaceAssignmentsTable,
  settingsTable,
  workerAffiliateNetworksTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
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
  if (createdWorkspaceIds.length > 0) {
    await db.delete(settingsTable).where(inArray(settingsTable.workspaceId, createdWorkspaceIds));
    await db.delete(workerAffiliateNetworksTable).where(inArray(workerAffiliateNetworksTable.workspaceId, createdWorkspaceIds));
    await db.delete(workspaceTrafficSourcesTable).where(inArray(workspaceTrafficSourcesTable.workspaceId, createdWorkspaceIds));
    await db.delete(affiliateNetworksTable).where(inArray(affiliateNetworksTable.workspaceId, createdWorkspaceIds));
    await db.delete(employeeWorkspaceAssignmentsTable).where(inArray(employeeWorkspaceAssignmentsTable.workspaceId, createdWorkspaceIds));
  }
  for (const id of [...createdWorkspaceIds].reverse()) {
    await db.delete(workspacesTable).where(eq(workspacesTable.id, id));
  }
  for (const id of [...createdEmployeeIds].reverse()) {
    await db.delete(employeeWorkspaceAssignmentsTable).where(eq(employeeWorkspaceAssignmentsTable.employeeId, id));
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

async function createEmployee(role: "admin" | "employee"): Promise<number> {
  const [employee] = await db
    .insert(employeesTable)
    .values({
      name: `Admin Settings ${Date.now()}`,
      email: `admin-settings-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
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

async function seedAdminWorkspace() {
  const workspaceId = await createWorkspace("admin-foundation");
  const adminId = await createEmployee("admin");
  const workerId = await createEmployee("employee");
  await assign(adminId, workspaceId, "admin");
  await assign(workerId, workspaceId);

  const trafficSources = await db
    .insert(workspaceTrafficSourcesTable)
    .values([
      { workspaceId, name: `TS One ${Date.now()}`, position: 1, isActive: true },
      { workspaceId, name: `TS Two ${Date.now()}`, position: 2, isActive: true },
      { workspaceId, name: `TS Three ${Date.now()}`, position: 3, isActive: true },
    ])
    .returning({ id: workspaceTrafficSourcesTable.id });

  const [network] = await db
    .insert(affiliateNetworksTable)
    .values({ workspaceId, name: `Network ${Date.now()}`, isActive: true })
    .returning({ id: affiliateNetworksTable.id });
  await db.insert(workerAffiliateNetworksTable).values({
    workspaceId,
    employeeId: workerId,
    affiliateNetworkId: network.id,
  });

  return { workspaceId, adminId, workerId, trafficSourceIds: trafficSources.map((row) => row.id), networkId: network.id };
}

describe("admin foundation settings", { concurrency: false }, () => {
  test("returns workspace-scoped defaults and existing affiliate-network assignments", async () => {
    const seed = await seedAdminWorkspace();

    const { response, json } = await request(
      "GET",
      `/settings/admin-foundation?workspace_id=${seed.workspaceId}`,
      seed.adminId,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(json.trafficSourceVisibility, { mode: "all", restrictedEmployeeIds: [] });
    assert.deepEqual(json.testingProgression.trafficSourceIds, []);
    assert.equal(json.defaultTestWindow.durationHours, 48);
    assert.equal(json.clickThresholds.averageVisitsPerOffer, 25000);
    assert.equal(json.winnerThresholds.mode, "positive_roi");
    assert.equal(json.winnerThresholds.roiGreaterThan, 0);
    assert.equal(json.goals.weekly.length, 0);
    assert.equal(json.bonusTiers.length, 0);
    assert.equal(json.affiliateNetworkAssignments.length, 1);
    assert.equal(json.affiliateNetworkAssignments[0].employeeId, seed.workerId);
    assert.equal(json.affiliateNetworkAssignments[0].affiliateNetworkId, seed.networkId);
  });

  test("admin can update ordered progression and threshold foundations for one workspace", async () => {
    const seed = await seedAdminWorkspace();
    const otherWorkspaceId = await createWorkspace("other-admin-foundation");
    await assign(seed.adminId, otherWorkspaceId, "admin");

    const updated = await request("PATCH", "/settings/admin-foundation", seed.adminId, {
      workspaceId: seed.workspaceId,
      testingProgression: { trafficSourceIds: seed.trafficSourceIds },
      defaultTestWindow: { durationHours: 72 },
      clickThresholds: { clicks: 500 },
      winnerThresholds: { mode: "revenue", revenueGreaterThan: 5 },
      goals: {
        weekly: [{ id: "weekly-winners", name: "Weekly winners", target: 2, enabled: true }],
      },
      bonusTiers: [{ id: "tier-1", name: "Starter", minScore: 100, bonusAmount: 25, enabled: true }],
    });

    assert.equal(updated.response.status, 200);
    assert.deepEqual(updated.json.testingProgression.trafficSourceIds, seed.trafficSourceIds);
    assert.equal(updated.json.defaultTestWindow.durationHours, 72);
    assert.equal(updated.json.clickThresholds.averageVisitsPerOffer, 25000);
    assert.equal(updated.json.clickThresholds.clicks, 500);
    assert.equal(updated.json.winnerThresholds.mode, "revenue");
    assert.equal(updated.json.winnerThresholds.revenueGreaterThan, 5);
    assert.equal(updated.json.goals.weekly[0].id, "weekly-winners");
    assert.equal(updated.json.bonusTiers[0].id, "tier-1");

    const otherDefaults = await request(
      "GET",
      `/settings/admin-foundation?workspace_id=${otherWorkspaceId}`,
      seed.adminId,
    );
    assert.equal(otherDefaults.response.status, 200);
    assert.deepEqual(otherDefaults.json.testingProgression.trafficSourceIds, []);

    const rows = await db
      .select()
      .from(settingsTable)
      .where(and(eq(settingsTable.workspaceId, seed.workspaceId), eq(settingsTable.key, "admin_foundation_config")));
    assert.equal(rows.length, 1);
  });

  test("rejects non-admin updates and cross-workspace traffic source references", async () => {
    const seed = await seedAdminWorkspace();
    const otherWorkspaceId = await createWorkspace("foreign-source");
    await assign(seed.adminId, otherWorkspaceId, "admin");
    const [foreignSource] = await db
      .insert(workspaceTrafficSourcesTable)
      .values({ workspaceId: otherWorkspaceId, name: `Foreign TS ${Date.now()}`, position: 1, isActive: true })
      .returning({ id: workspaceTrafficSourcesTable.id });

    const nonAdmin = await request("PATCH", "/settings/admin-foundation", seed.workerId, {
      workspaceId: seed.workspaceId,
      defaultTestWindow: { durationHours: 24 },
    });
    assert.equal(nonAdmin.response.status, 403);

    const badSource = await request("PATCH", "/settings/admin-foundation", seed.adminId, {
      workspaceId: seed.workspaceId,
      testingProgression: { trafficSourceIds: [foreignSource.id] },
    });
    assert.equal(badSource.response.status, 400);
    assert.match(badSource.json.error, /do not belong to this workspace/);
  });
});
