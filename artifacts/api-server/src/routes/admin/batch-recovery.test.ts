import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import app from "../../app.ts";
import {
  affiliateNetworksTable,
  batchTrafficSourceRunsTable,
  campaignsTable,
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
import { ensureProductionLiveCampaignSchema } from "../../test-utils/ensure-production-live-campaign-schema.ts";
import { testAuthToken as authToken } from "../../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  await ensureProductionLiveCampaignSchema();
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

async function createEmployee(role: "admin" | "employee"): Promise<number> {
  const [employee] = await db
    .insert(employeesTable)
    .values({
      name: `Recovery Tester ${Date.now()}`,
      email: `recovery-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
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

async function seedBatchWithActiveRun() {
  const workspaceId = await createWorkspace("recovery");
  const adminId = await createEmployee("admin");
  const workerId = await createEmployee("employee");
  await assign(adminId, workspaceId);
  await assign(workerId, workspaceId);

  const [network] = await db
    .insert(affiliateNetworksTable)
    .values({ workspaceId, name: `Network ${Date.now()}`, isActive: true })
    .returning({ id: affiliateNetworksTable.id });
  await db.insert(workerAffiliateNetworksTable).values({
    workspaceId,
    employeeId: workerId,
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

  const created = await request("POST", "/testing-batches", adminId, {
    workspaceId,
    assignedWorkerId: workerId,
    batchName: `Recovery Batch ${Date.now()}`,
    affiliateNetworkId: network.id,
    geoId: geo.id,
    trafficSourceId: secondSource.id,
    batchTag: `recovery_${Date.now()}`,
  });
  assert.equal(created.response.status, 201);
  const batchId = created.json!.id as number;

  const [activeRun] = await db
    .select({
      id: batchTrafficSourceRunsTable.id,
      trafficSourceId: batchTrafficSourceRunsTable.trafficSourceId,
    })
    .from(batchTrafficSourceRunsTable)
    .where(eq(batchTrafficSourceRunsTable.batchId, batchId))
    .orderBy(desc(batchTrafficSourceRunsTable.position))
    .limit(1);

  return {
    workspaceId,
    adminId,
    workerId,
    batchId,
    activeRunId: activeRun!.id,
    activeSourceId: activeRun!.trafficSourceId,
    firstSourceId: firstSource.id,
    secondSourceId: secondSource.id,
  };
}

async function countOpenCreateTasks(batchId: number) {
  const rows = await db
    .select({ taskType: todoTasksTable.taskType })
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.relatedBatchId, batchId),
        inArray(todoTasksTable.taskType, [
          "create_voluum_campaign_ios",
          "create_voluum_campaign_android",
        ]),
        inArray(todoTasksTable.status, ["TODO", "IN_PROGRESS"]),
      ),
    );
  return rows;
}

describe("POST /admin/batches/:id/recovery/:action", { concurrency: false }, () => {
  test("recreate-create-tasks only creates missing tasks", async () => {
    const seed = await seedBatchWithActiveRun();

    await db
      .delete(todoTasksTable)
      .where(eq(todoTasksTable.relatedBatchId, seed.batchId));

    const before = await countOpenCreateTasks(seed.batchId);
    assert.equal(before.length, 0);

    const first = await request(
      "POST",
      `/admin/batches/${seed.batchId}/recovery/recreate-create-tasks`,
      seed.adminId,
    );
    assert.equal(first.response.status, 200);
    assert.equal(first.json!.idempotent, false);
    const created = first.json!.createdTasks as Array<{ taskType: string }>;
    assert.equal(created.length, 2);

    const afterFirst = await countOpenCreateTasks(seed.batchId);
    assert.equal(afterFirst.length, 2);

    const second = await request(
      "POST",
      `/admin/batches/${seed.batchId}/recovery/recreate-create-tasks`,
      seed.adminId,
    );
    assert.equal(second.response.status, 200);
    assert.equal(second.json!.idempotent, true);
    assert.equal((second.json!.createdTasks as unknown[]).length, 0);

    const afterSecond = await countOpenCreateTasks(seed.batchId);
    assert.equal(afterSecond.length, 2);
  });

  test("replay-find-winners does not duplicate progression", async () => {
    const seed = await seedBatchWithActiveRun();

    const [iosCampaign] = await db
      .insert(campaignsTable)
      .values({
        workspaceId: seed.workspaceId,
        batchId: seed.batchId,
        platform: "ios",
        campaignName: "iOS Recovery",
        status: "tested",
        trafficSourceId: seed.activeSourceId,
      })
      .returning({ id: campaignsTable.id });
    const [androidCampaign] = await db
      .insert(campaignsTable)
      .values({
        workspaceId: seed.workspaceId,
        batchId: seed.batchId,
        platform: "android",
        campaignName: "Android Recovery",
        status: "tested",
        trafficSourceId: seed.activeSourceId,
      })
      .returning({ id: campaignsTable.id });

    await db
      .update(batchTrafficSourceRunsTable)
      .set({
        iosStatus: "completed",
        androidStatus: "completed",
        iosCampaignId: iosCampaign.id,
        androidCampaignId: androidCampaign.id,
        status: "active",
      })
      .where(eq(batchTrafficSourceRunsTable.id, seed.activeRunId));

    await db.insert(todoTasksTable).values([
      {
        workspaceId: seed.workspaceId,
        employeeId: seed.workerId,
        relatedBatchId: seed.batchId,
        relatedCampaignId: iosCampaign.id,
        taskType: "find_winners",
        title: "Find winners iOS",
        status: "DONE",
        trafficSourceId: seed.activeSourceId,
      },
      {
        workspaceId: seed.workspaceId,
        employeeId: seed.workerId,
        relatedBatchId: seed.batchId,
        relatedCampaignId: androidCampaign.id,
        taskType: "find_winners",
        title: "Find winners Android",
        status: "DONE",
        trafficSourceId: seed.activeSourceId,
      },
    ]);

    const runsBefore = await db
      .select({ position: batchTrafficSourceRunsTable.position, status: batchTrafficSourceRunsTable.status })
      .from(batchTrafficSourceRunsTable)
      .where(eq(batchTrafficSourceRunsTable.batchId, seed.batchId))
      .orderBy(asc(batchTrafficSourceRunsTable.position));

    const replay1 = await request(
      "POST",
      `/admin/batches/${seed.batchId}/recovery/replay-find-winners`,
      seed.adminId,
    );
    assert.equal(replay1.response.status, 200);

    const runsAfterFirst = await db
      .select({ position: batchTrafficSourceRunsTable.position, status: batchTrafficSourceRunsTable.status })
      .from(batchTrafficSourceRunsTable)
      .where(eq(batchTrafficSourceRunsTable.batchId, seed.batchId))
      .orderBy(asc(batchTrafficSourceRunsTable.position));

    const replay2 = await request(
      "POST",
      `/admin/batches/${seed.batchId}/recovery/replay-find-winners`,
      seed.adminId,
    );
    assert.equal(replay2.response.status, 200);

    const runsAfterSecond = await db
      .select({ position: batchTrafficSourceRunsTable.position, status: batchTrafficSourceRunsTable.status })
      .from(batchTrafficSourceRunsTable)
      .where(eq(batchTrafficSourceRunsTable.batchId, seed.batchId))
      .orderBy(asc(batchTrafficSourceRunsTable.position));

    assert.deepEqual(
      runsAfterSecond.map((r) => r.status),
      runsAfterFirst.map((r) => r.status),
    );
    assert.equal(runsAfterSecond.filter((r) => r.status === "active").length, 1);
    assert.ok(runsAfterSecond.length >= runsBefore.length);
  });

  test("non-admin forbidden", async () => {
    const seed = await seedBatchWithActiveRun();

    const { response, json } = await request(
      "POST",
      `/admin/batches/${seed.batchId}/recovery/mark-run-reviewed`,
      seed.workerId,
      { note: "reviewed" },
    );

    assert.equal(response.status, 403);
    assert.match(String(json!.error), /Admin/i);
  });

  test("cross-workspace forbidden", async () => {
    const seed = await seedBatchWithActiveRun();
    const otherWorkspaceId = await createWorkspace("recovery-other");
    const outsiderAdmin = await createEmployee("admin");
    await assign(outsiderAdmin, otherWorkspaceId);

    const { response, json } = await request(
      "POST",
      `/admin/batches/${seed.batchId}/recovery/mark-run-reviewed`,
      outsiderAdmin,
      { note: "nope" },
    );

    assert.equal(response.status, 403);
    assert.match(String(json!.error), /Access denied/);
  });

  test("recovery actions create operational events", async () => {
    const seed = await seedBatchWithActiveRun();

    const reviewed = await request(
      "POST",
      `/admin/batches/${seed.batchId}/recovery/mark-run-reviewed`,
      seed.adminId,
      { note: "operator acknowledged warning" },
    );
    assert.equal(reviewed.response.status, 200);

    await db
      .delete(todoTasksTable)
      .where(eq(todoTasksTable.relatedBatchId, seed.batchId));

    const recreated = await request(
      "POST",
      `/admin/batches/${seed.batchId}/recovery/recreate-create-tasks`,
      seed.adminId,
    );
    assert.equal(recreated.response.status, 200);

    const events = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, seed.workspaceId),
          eq(operationalEventsTable.eventType, "BATCH_RECOVERY_ACTION"),
        ),
      )
      .orderBy(asc(operationalEventsTable.id));

    assert.ok(events.length >= 2);
    const actions = events.map(
      (e) => (e.payloadJson as { action?: string }).action,
    );
    assert.ok(actions.includes("mark-run-reviewed"));
    assert.ok(actions.includes("recreate-create-tasks"));
    for (const event of events) {
      assert.equal((event.payloadJson as { batchId?: number }).batchId, seed.batchId);
    }
  });
});
