import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { asc, desc, eq } from "drizzle-orm";
import app from "../../app.ts";
import {
  affiliateNetworksTable,
  batchTrafficSourceRunsTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  geosTable,
  operationalEventsTable,
  testingBatchesTable,
  todoTasksTable,
  workerAffiliateNetworksTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { recordOperationalEvent } from "../../lib/operational-events.ts";
import { testAuthToken as authToken } from "../../lib/test-auth-token.ts";

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

async function createEmployee(role: "admin" | "employee" = "employee"): Promise<number> {
  const [employee] = await db
    .insert(employeesTable)
    .values({
      name: `Batch Health Tester ${Date.now()}`,
      email: `batch-health-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
      passwordHash: "x",
      role,
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
  const workspaceId = await createWorkspace("batch-health");
  const employeeId = await createEmployee("admin");
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

  const batchTag = `health_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const created = await request("POST", "/testing-batches", employeeId, {
    workspaceId,
    assignedWorkerId: employeeId,
    batchName: `Health Batch ${Date.now()}`,
    affiliateNetworkId: network.id,
    geoId: geo.id,
    trafficSourceId: secondSource.id,
    batchTag,
  });
  assert.equal(created.response.status, 201);

  const [activeRun] = await db
    .select({
      id: batchTrafficSourceRunsTable.id,
      trafficSourceId: batchTrafficSourceRunsTable.trafficSourceId,
    })
    .from(batchTrafficSourceRunsTable)
    .where(
      eq(batchTrafficSourceRunsTable.batchId, created.json!.id as number),
    )
    .orderBy(desc(batchTrafficSourceRunsTable.position))
    .limit(1);

  return {
    workspaceId,
    employeeId,
    batchId: created.json!.id as number,
    firstSource,
    secondSource,
    activeRun,
  };
}

type HealthRecommendation = {
  code: string;
  severity: string;
  message: string;
  relatedRunId?: number;
  relatedTaskIds?: number[];
  relatedCampaignIds?: number[];
  suggestedActionType?: string;
};

type HealthBody = {
  batch: Record<string, unknown>;
  activeRun: Record<string, unknown> | null;
  openTasks: Array<Record<string, unknown>>;
  recentEvents: Array<Record<string, unknown>>;
  flags: Record<string, unknown>;
  recommendations: HealthRecommendation[];
};

function recommendationCodes(body: HealthBody): string[] {
  return body.recommendations.map((r) => r.code);
}

function findRecommendation(
  body: HealthBody,
  code: string,
): HealthRecommendation | undefined {
  return body.recommendations.find((r) => r.code === code);
}

describe("GET /admin/batches/:id/health", { concurrency: false }, () => {
  test("workspace member can fetch health for accessible batch", async () => {
    const seed = await seedBatchWithRuns();

    const { response, json } = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );

    assert.equal(response.status, 200);
    const body = json as unknown as HealthBody;
    assert.equal(body.batch.id, seed.batchId);
    assert.equal(body.batch.workspaceId, seed.workspaceId);
    assert.ok(typeof body.batch.status === "string");
    assert.ok(typeof body.batch.batchName === "string");
    assert.equal(body.batch.currentWorkspaceTrafficSourceId, seed.secondSource.id);
    assert.ok(typeof body.batch.trafficSourceStep === "number");
    assert.ok(body.flags);
    assert.equal(typeof body.flags.hasActiveRun, "boolean");
    assert.ok(Array.isArray(body.recommendations));
  });

  test("cross-workspace access is rejected", async () => {
    const seed = await seedBatchWithRuns();
    const otherWorkspaceId = await createWorkspace("batch-health-other");
    const outsiderId = await createEmployee();
    await assign(outsiderId, otherWorkspaceId);

    const { response, json } = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      outsiderId,
    );

    assert.equal(response.status, 403);
    assert.match(String(json!.error), /Access denied/);
  });

  test("health includes active run and open tasks", async () => {
    const seed = await seedBatchWithRuns();

    const { response, json } = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );

    assert.equal(response.status, 200);
    const body = json as unknown as HealthBody;
    assert.ok(body.activeRun);
    assert.equal(body.activeRun!.runId, seed.activeRun.id);
    assert.equal(body.activeRun!.trafficSourceId, seed.secondSource.id);
    assert.equal(body.activeRun!.trafficSourceName, "Second Source");
    assert.equal(body.activeRun!.status, "active");

    assert.ok(body.openTasks.length >= 2);
    const createIos = body.openTasks.find(
      (task) => task.taskType === "create_voluum_campaign_ios",
    );
    const createAndroid = body.openTasks.find(
      (task) => task.taskType === "create_voluum_campaign_android",
    );
    assert.ok(createIos);
    assert.ok(createAndroid);
    assert.equal(createIos!.assignedEmployeeId, seed.employeeId);
    assert.equal(body.flags.openTaskCount, body.openTasks.length);
    assert.equal(body.flags.hasActiveRun, true);
  });

  test("health includes recent batch and run operational events", async () => {
    const seed = await seedBatchWithRuns();

    await recordOperationalEvent({
      workspaceId: seed.workspaceId,
      entityType: "traffic_source_run",
      entityId: seed.activeRun.id,
      eventType: "TRAFFIC_SOURCE_RUN_ACTIVATED",
      source: "test",
      payloadJson: {
        batchId: seed.batchId,
        workspaceId: seed.workspaceId,
        runId: seed.activeRun.id,
        trafficSourceId: seed.activeRun.trafficSourceId,
        position: 2,
      },
    });

    const { response, json } = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );

    assert.equal(response.status, 200);
    const body = json as unknown as HealthBody;
    const types = body.recentEvents.map((e) => e.eventType);
    assert.ok(types.includes("BATCH_CREATED"));
    assert.ok(types.includes("TRAFFIC_SOURCE_RUN_ACTIVATED"));
    const activated = body.recentEvents.find(
      (e) => e.eventType === "TRAFFIC_SOURCE_RUN_ACTIVATED",
    );
    assert.equal(
      (activated!.payloadJson as { batchId: number }).batchId,
      seed.batchId,
    );
  });

  test("derived flags: no active run, missing create tasks, partially terminal", async () => {
    const seed = await seedBatchWithRuns();

    await db
      .update(batchTrafficSourceRunsTable)
      .set({ status: "pending", iosStatus: "pending", androidStatus: "pending" })
      .where(eq(batchTrafficSourceRunsTable.batchId, seed.batchId));

    let health = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );
    assert.equal(health.response.status, 200);
    let flags = (health.json as unknown as HealthBody).flags;
    assert.equal(flags.hasActiveRun, false);
    assert.equal(flags.activeRunMissingCreateTasks, false);
    assert.equal(flags.activeRunPartiallyTerminal, false);
    assert.equal(flags.activeRunFullyTerminalButNotAdvanced, false);
    assert.equal((health.json as unknown as HealthBody).activeRun, null);

    await db
      .update(batchTrafficSourceRunsTable)
      .set({
        status: "active",
        iosStatus: "active",
        androidStatus: "active",
        iosCampaignId: null,
        androidCampaignId: null,
      })
      .where(eq(batchTrafficSourceRunsTable.id, seed.activeRun.id));

    await db
      .delete(todoTasksTable)
      .where(
        eq(todoTasksTable.relatedBatchId, seed.batchId),
      );

    health = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );
    flags = (health.json as unknown as HealthBody).flags;
    assert.equal(flags.hasActiveRun, true);
    assert.equal(flags.activeRunMissingCreateTasks, true);

    await db.insert(todoTasksTable).values([
      {
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        title: "Create iOS",
        taskType: "create_voluum_campaign_ios",
        status: "TODO",
        trafficSourceId: seed.activeRun.trafficSourceId,
      },
      {
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        title: "Create Android",
        taskType: "create_voluum_campaign_android",
        status: "TODO",
        trafficSourceId: seed.activeRun.trafficSourceId,
      },
    ]);

    health = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );
    flags = (health.json as unknown as HealthBody).flags;
    assert.equal(flags.activeRunMissingCreateTasks, false);

    await db
      .update(batchTrafficSourceRunsTable)
      .set({ iosStatus: "completed", androidStatus: "active", status: "active" })
      .where(eq(batchTrafficSourceRunsTable.id, seed.activeRun.id));

    health = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );
    flags = (health.json as unknown as HealthBody).flags;
    assert.equal(flags.activeRunPartiallyTerminal, true);
    assert.equal(flags.activeRunFullyTerminalButNotAdvanced, false);

    await db
      .update(batchTrafficSourceRunsTable)
      .set({ iosStatus: "completed", androidStatus: "failed", status: "active" })
      .where(eq(batchTrafficSourceRunsTable.id, seed.activeRun.id));

    health = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );
    flags = (health.json as unknown as HealthBody).flags;
    assert.equal(flags.activeRunFullyTerminalButNotAdvanced, true);
  });

  test("response does not include unrelated workspace data", async () => {
    const seed = await seedBatchWithRuns();
    const workspaceB = await createWorkspace("batch-health-b");
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
    const [foreignRun] = await db
      .insert(batchTrafficSourceRunsTable)
      .values({
        workspaceId: workspaceB,
        batchId: foreignBatch.id,
        trafficSourceId: foreignSource.id,
        position: 1,
        status: "active",
        iosStatus: "active",
        androidStatus: "active",
        startedAt: new Date(),
      })
      .returning({ id: batchTrafficSourceRunsTable.id });

    await db.insert(todoTasksTable).values({
      workspaceId: workspaceB,
      employeeId: employeeB,
      relatedBatchId: foreignBatch.id,
      title: "Foreign task",
      taskType: "MANUAL",
      status: "TODO",
    });

    await recordOperationalEvent({
      workspaceId: workspaceB,
      entityType: "batch",
      entityId: foreignBatch.id,
      eventType: "BATCH_CREATED",
      source: "test",
      payloadJson: { batchId: foreignBatch.id, workspaceId: workspaceB },
    });

    await recordOperationalEvent({
      workspaceId: seed.workspaceId,
      entityType: "workspace",
      entityId: workspaceB,
      eventType: "RECONCILIATION_VIOLATION",
      source: "test",
      payloadJson: {
        workspaceId: workspaceB,
        invariant: "invariant3",
        violationCount: 1,
        affectedBatchIds: [foreignBatch.id],
        reconciliationPassAt: new Date().toISOString(),
      },
    });

    const { response, json } = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );

    assert.equal(response.status, 200);
    const body = json as unknown as HealthBody;
    assert.equal(body.batch.workspaceId, seed.workspaceId);
    if (body.activeRun) {
      assert.notEqual(body.activeRun.trafficSourceId, foreignSource.id);
    }
    assert.ok(
      body.openTasks.every((task) => task.title !== "Foreign task"),
    );
    const eventBatchIds = body.recentEvents.flatMap((event) => {
      const payload = event.payloadJson as Record<string, unknown>;
      const ids: number[] = [];
      if (typeof payload.batchId === "number") ids.push(payload.batchId);
      if (typeof payload.relatedBatchId === "number") ids.push(payload.relatedBatchId);
      if (Array.isArray(payload.affectedBatchIds)) {
        ids.push(...(payload.affectedBatchIds as number[]));
      }
      return ids;
    });
    assert.ok(!eventBatchIds.includes(foreignBatch.id));

    const runs = await db
      .select({ position: batchTrafficSourceRunsTable.position })
      .from(batchTrafficSourceRunsTable)
      .where(eq(batchTrafficSourceRunsTable.batchId, seed.batchId))
      .orderBy(asc(batchTrafficSourceRunsTable.position));
    assert.equal(runs.length, 2);
    assert.notEqual(body.activeRun?.runId, foreignRun.id);
  });

  test("flags reconciliation violation only when batch is affected", async () => {
    const seed = await seedBatchWithRuns();

    await recordOperationalEvent({
      workspaceId: seed.workspaceId,
      entityType: "workspace",
      entityId: seed.workspaceId,
      eventType: "RECONCILIATION_VIOLATION",
      source: "test",
      payloadJson: {
        workspaceId: seed.workspaceId,
        invariant: "invariant4",
        violationCount: 1,
        affectedBatchIds: [seed.batchId],
        reconciliationPassAt: new Date().toISOString(),
      },
    });

    const { response, json } = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );

    assert.equal(response.status, 200);
    const body = json as unknown as HealthBody;
    assert.equal(body.flags.hasRecentReconciliationViolation, true);
    assert.ok(
      body.recentEvents.some((e) => e.eventType === "RECONCILIATION_VIOLATION"),
    );
  });
});

describe("GET /admin/batches/:id/health recommendations", { concurrency: false }, () => {
  test("healthy batch returns HEALTHY recommendation", async () => {
    const seed = await seedBatchWithRuns();

    const { response, json } = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );

    assert.equal(response.status, 200);
    const body = json as unknown as HealthBody;
    assert.deepEqual(recommendationCodes(body), ["HEALTHY"]);
    const healthy = findRecommendation(body, "HEALTHY")!;
    assert.equal(healthy.severity, "info");
    assert.ok(healthy.message.length > 0);
    assert.equal(healthy.suggestedActionType, undefined);
  });

  test("missing create tasks returns ACTIVE_RUN_MISSING_CREATE_TASKS", async () => {
    const seed = await seedBatchWithRuns();

    await db
      .delete(todoTasksTable)
      .where(eq(todoTasksTable.relatedBatchId, seed.batchId));

    const { response, json } = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );

    assert.equal(response.status, 200);
    const body = json as unknown as HealthBody;
    const rec = findRecommendation(body, "ACTIVE_RUN_MISSING_CREATE_TASKS");
    assert.ok(rec);
    assert.equal(rec!.severity, "warning");
    assert.equal(rec!.relatedRunId, seed.activeRun.id);
    assert.equal(rec!.suggestedActionType, "seed_create_voluum_tasks");
    assert.ok(!recommendationCodes(body).includes("HEALTHY"));
  });

  test("partially terminal run returns WAITING_FOR_SIBLING_PLATFORM", async () => {
    const seed = await seedBatchWithRuns();

    await db
      .update(batchTrafficSourceRunsTable)
      .set({ iosStatus: "completed", androidStatus: "active", status: "active" })
      .where(eq(batchTrafficSourceRunsTable.id, seed.activeRun.id));

    const { response, json } = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );

    assert.equal(response.status, 200);
    const body = json as unknown as HealthBody;
    const rec = findRecommendation(body, "WAITING_FOR_SIBLING_PLATFORM");
    assert.ok(rec);
    assert.equal(rec!.severity, "info");
    assert.equal(rec!.relatedRunId, seed.activeRun.id);
    assert.equal(rec!.suggestedActionType, "complete_platform_run");
    assert.match(rec!.message, /android/i);
    assert.ok(!recommendationCodes(body).includes("HEALTHY"));
  });

  test("fully terminal active run returns TERMINAL_RUN_NOT_ADVANCED", async () => {
    const seed = await seedBatchWithRuns();

    await db
      .update(batchTrafficSourceRunsTable)
      .set({
        iosStatus: "completed",
        androidStatus: "failed",
        status: "active",
      })
      .where(eq(batchTrafficSourceRunsTable.id, seed.activeRun.id));

    const { response, json } = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );

    assert.equal(response.status, 200);
    const body = json as unknown as HealthBody;
    const rec = findRecommendation(body, "TERMINAL_RUN_NOT_ADVANCED");
    assert.ok(rec);
    assert.equal(rec!.severity, "critical");
    assert.equal(rec!.relatedRunId, seed.activeRun.id);
    assert.equal(rec!.suggestedActionType, "advance_traffic_source_run");
    assert.ok(!recommendationCodes(body).includes("HEALTHY"));
  });

  test("recent reconciliation violation returns RECENT_RECONCILIATION_VIOLATION", async () => {
    const seed = await seedBatchWithRuns();

    await recordOperationalEvent({
      workspaceId: seed.workspaceId,
      entityType: "workspace",
      entityId: seed.workspaceId,
      eventType: "RECONCILIATION_VIOLATION",
      source: "test",
      payloadJson: {
        workspaceId: seed.workspaceId,
        invariant: "invariant4",
        violationCount: 1,
        affectedBatchIds: [seed.batchId],
        reconciliationPassAt: new Date().toISOString(),
      },
    });

    const { response, json } = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      seed.employeeId,
    );

    assert.equal(response.status, 200);
    const body = json as unknown as HealthBody;
    const rec = findRecommendation(body, "RECENT_RECONCILIATION_VIOLATION");
    assert.ok(rec);
    assert.equal(rec!.severity, "warning");
    assert.equal(rec!.suggestedActionType, "review_reconciliation");
    assert.ok(!recommendationCodes(body).includes("HEALTHY"));
  });

  test("cross-workspace protection remains green", async () => {
    const seed = await seedBatchWithRuns();
    const otherWorkspaceId = await createWorkspace("batch-health-rec-other");
    const outsiderId = await createEmployee();
    await assign(outsiderId, otherWorkspaceId);

    const { response, json } = await request(
      "GET",
      `/admin/batches/${seed.batchId}/health`,
      outsiderId,
    );

    assert.equal(response.status, 403);
    assert.match(String(json!.error), /Access denied/);
    assert.equal(json!.recommendations, undefined);
  });
});
