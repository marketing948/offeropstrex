import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { asc, eq } from "drizzle-orm";
import app from "../app.ts";
import {
  affiliateNetworksTable,
  batchTrafficSourceRunsTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  geosTable,
  testingBatchesTable,
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
    json = { raw: text };
  }
  return { response, json };
}

async function createWorkspace(name: string): Promise<number> {
  const [workspace] = await db
    .insert(workspacesTable)
    .values({
      name: `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
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
      name: `Batch Include Tester ${Date.now()}`,
      email: `batch-include-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
      passwordHash: "x",
      role: "employee",
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

async function seedBatchWithRuns() {
  const workspaceId = await createWorkspace("batch-includes");
  const employeeId = await createEmployee();
  await assign(employeeId, workspaceId);

  const [network] = await db
    .insert(affiliateNetworksTable)
    .values({ workspaceId, name: `Network ${Date.now()}`, isActive: true })
    .returning({ id: affiliateNetworksTable.id });
  await db.insert(workerAffiliateNetworksTable).values({
    workspaceId,
    employeeId,
    affiliateNetworkId: network.id,
  });
  const [geo] = await db
    .insert(geosTable)
    .values({
      workspaceId,
      code: `G${Math.floor(Math.random() * 90 + 10)}`,
      name: "Geo",
      isActive: true,
    })
    .returning({ id: geosTable.id });
  const [firstSource] = await db
    .insert(workspaceTrafficSourcesTable)
    .values({ workspaceId, name: "First Source", position: 1, isActive: true })
    .returning({ id: workspaceTrafficSourcesTable.id });
  const [secondSource] = await db
    .insert(workspaceTrafficSourcesTable)
    .values({ workspaceId, name: "Second Source", position: 2, isActive: true })
    .returning({ id: workspaceTrafficSourcesTable.id });

  const batchTag = `include_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const created = await request("POST", "/testing-batches", employeeId, {
    workspaceId,
    assignedWorkerId: employeeId,
    batchName: `Include Batch ${Date.now()}`,
    affiliateNetworkId: network.id,
    geoId: geo.id,
    trafficSourceId: secondSource.id,
    batchTag,
  });
  assert.equal(created.response.status, 201);

  return {
    workspaceId,
    employeeId,
    batchId: created.json!.id as number,
    firstSource,
    secondSource,
  };
}

describe("GET /testing-batches/:id include traffic_source_runs", { concurrency: false }, () => {
  test("without include param omits trafficSourceRuns", async () => {
    const seed = await seedBatchWithRuns();

    const { response, json } = await request(
      "GET",
      `/testing-batches/${seed.batchId}`,
      seed.employeeId,
    );

    assert.equal(response.status, 200);
    assert.equal(json!.id, seed.batchId);
    assert.ok(!("trafficSourceRuns" in json!));
  });

  test("with include=traffic_source_runs returns ordered runs and names", async () => {
    const seed = await seedBatchWithRuns();

    const { response, json } = await request(
      "GET",
      `/testing-batches/${seed.batchId}?include=traffic_source_runs`,
      seed.employeeId,
    );

    assert.equal(response.status, 200);
    assert.equal(json!.id, seed.batchId);
    const runs = json!.trafficSourceRuns as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(runs));
    assert.equal(runs.length, 2);

    assert.equal(runs[0]!.position, 1);
    assert.equal(runs[0]!.trafficSourceId, seed.firstSource.id);
    assert.equal(runs[0]!.trafficSourceName, "First Source");
    assert.equal(runs[0]!.status, "pending");
    assert.equal(runs[0]!.iosStatus, "pending");
    assert.equal(runs[0]!.androidStatus, "pending");
    assert.equal(runs[0]!.startedAt, null);
    assert.equal(runs[0]!.completedAt, null);
    assert.ok(typeof runs[0]!.createdAt === "string");

    assert.equal(runs[1]!.position, 2);
    assert.equal(runs[1]!.trafficSourceId, seed.secondSource.id);
    assert.equal(runs[1]!.trafficSourceName, "Second Source");
    assert.equal(runs[1]!.status, "active");
    assert.equal(runs[1]!.iosStatus, "active");
    assert.equal(runs[1]!.androidStatus, "active");
    assert.ok(runs[1]!.startedAt);
    assert.equal(runs[1]!.completedAt, null);

    const expectedKeys = [
      "id",
      "position",
      "status",
      "trafficSourceId",
      "trafficSourceName",
      "iosStatus",
      "androidStatus",
      "iosCampaignId",
      "androidCampaignId",
      "startedAt",
      "completedAt",
      "createdAt",
    ].sort();
    for (const run of runs) {
      assert.deepEqual(Object.keys(run).sort(), expectedKeys);
    }

    const dbRuns = await db
      .select({ position: batchTrafficSourceRunsTable.position })
      .from(batchTrafficSourceRunsTable)
      .where(eq(batchTrafficSourceRunsTable.batchId, seed.batchId))
      .orderBy(asc(batchTrafficSourceRunsTable.position));
    assert.deepEqual(
      runs.map((run) => run.position),
      dbRuns.map((run) => run.position),
    );
  });

  test("rejects access to batch in another workspace", async () => {
    const seed = await seedBatchWithRuns();
    const otherWorkspaceId = await createWorkspace("batch-includes-other");
    const outsiderId = await createEmployee();
    await assign(outsiderId, otherWorkspaceId);

    const { response, json } = await request(
      "GET",
      `/testing-batches/${seed.batchId}?include=traffic_source_runs`,
      outsiderId,
    );

    assert.equal(response.status, 403);
    assert.match(String(json!.error), /Access denied/);
  });

  test("does not return runs from another workspace batch", async () => {
    const seedA = await seedBatchWithRuns();
    const workspaceB = await createWorkspace("batch-includes-b");
    const employeeB = await createEmployee();
    await assign(employeeB, workspaceB);

    const [foreignSource] = await db
      .insert(workspaceTrafficSourcesTable)
      .values({ workspaceId: workspaceB, name: "Foreign Source", position: 1, isActive: true })
      .returning({ id: workspaceTrafficSourcesTable.id });
    const [foreignBatch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId: workspaceB,
        employeeId: employeeB,
        batchName: "Foreign Batch",
        affiliateNetwork: "Foreign Network",
        geo: "US",
        trafficSource: "Foreign Source",
        batchTag: `foreign_${Date.now()}`,
        currentWorkspaceTrafficSourceId: foreignSource.id,
      })
      .returning({ id: testingBatchesTable.id });
    await db.insert(batchTrafficSourceRunsTable).values({
      workspaceId: workspaceB,
      batchId: foreignBatch.id,
      trafficSourceId: foreignSource.id,
      position: 1,
      status: "active",
      iosStatus: "active",
      androidStatus: "active",
      startedAt: new Date(),
    });

    const { response, json } = await request(
      "GET",
      `/testing-batches/${seedA.batchId}?include=traffic_source_runs`,
      seedA.employeeId,
    );

    assert.equal(response.status, 200);
    const runs = json!.trafficSourceRuns as Array<{ trafficSourceId: number }>;
    assert.ok(runs.every((run) => run.trafficSourceId !== foreignSource.id));
    assert.equal(runs.length, 2);
  });
});
