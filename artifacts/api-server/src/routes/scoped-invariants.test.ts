import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, asc, eq, sql } from "drizzle-orm";
import app from "../app.ts";
import {
  affiliateNetworksTable,
  batchTrafficSourceRunsTable,
  campaignsTable,
  db,
  employeesTable,
  employeeWorkspaceAssignmentsTable,
  eventsTable,
  geosTable,
  goalsTable,
  testingBatchesTable,
  todoTasksTable,
  workerAffiliateNetworksTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { registerHandler, _resetRegistryForTests } from "../engine/handlers.ts";
import { _resetRulesGuardForTests, registerAllRules } from "../engine/rules/index.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  await db.execute(sql`
    ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS active_workspace_id integer
  `);
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'employees_active_workspace_id_workspaces_id_fk'
          AND conrelid = 'employees'::regclass
      ) THEN
        ALTER TABLE employees
          ADD CONSTRAINT employees_active_workspace_id_workspaces_id_fk
          FOREIGN KEY (active_workspace_id)
          REFERENCES workspaces(id)
          ON DELETE SET NULL;
      END IF;
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

function authToken(employeeId: number): string {
  return Buffer.from(`${employeeId}:routes-test:offerops_secret`).toString("base64");
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

async function createWorkspace(name: string, isDefault = false): Promise<number> {
  const [workspace] = await db
    .insert(workspacesTable)
    .values({
      name: `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      isDefault,
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
      name: `Route Tester ${Date.now()}`,
      email: `route-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
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

async function seedCampaignOpsBase() {
  const workspaceId = await createWorkspace("campaign-ops");
  const employeeId = await createEmployee();
  await assign(employeeId, workspaceId);

  const [sourceOne] = await db
    .insert(workspaceTrafficSourcesTable)
    .values({ workspaceId, name: `Source One ${Date.now()}`, position: 1, isActive: true })
    .returning({ id: workspaceTrafficSourcesTable.id });
  const [sourceTwo] = await db
    .insert(workspaceTrafficSourcesTable)
    .values({ workspaceId, name: `Source Two ${Date.now()}`, position: 2, isActive: true })
    .returning({ id: workspaceTrafficSourcesTable.id });

  const [batch] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId,
      employeeId,
      batchName: `Batch ${Date.now()}`,
      affiliateNetwork: "Network",
      geo: "DE",
      trafficSource: "Source One",
      batchTag: `BT_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    })
    .returning({ id: testingBatchesTable.id });

  return {
    workspaceId,
    employeeId,
    sourceOneId: sourceOne.id,
    sourceTwoId: sourceTwo.id,
    batchId: batch.id,
  };
}

describe("route scoped invariants", { concurrency: false }, () => {
  test("manual batch creation requires batchTag", async () => {
    const workspaceId = await createWorkspace("batch-tag-required");
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceId);
    const [source] = await db
      .insert(workspaceTrafficSourcesTable)
      .values({ workspaceId, name: `Required Source ${Date.now()}`, position: 1, isActive: true })
      .returning({ id: workspaceTrafficSourcesTable.id });

    const created = await request("POST", "/testing-batches", employeeId, {
      workspaceId,
      employeeId,
      batchName: `Missing Tag Batch ${Date.now()}`,
      affiliateNetwork: "Network",
      geo: "DE",
      trafficSourceId: source.id,
    });

    assert.equal(created.response.status, 400);
    assert.match(String(created.json.error), /batchTag/);
  });

  test("manual batch creation initializes traffic-source workflow memory", async () => {
    const workspaceId = await createWorkspace("batch-memory");
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceId);
    const [network] = await db
      .insert(affiliateNetworksTable)
      .values({ workspaceId, name: `Network ${Date.now()}`, isActive: true })
      .returning({ id: affiliateNetworksTable.id, name: affiliateNetworksTable.name });
    await db.insert(workerAffiliateNetworksTable).values({
      workspaceId,
      employeeId,
      affiliateNetworkId: network.id,
    });
    const [geo] = await db
      .insert(geosTable)
      .values({ workspaceId, code: `G${Math.floor(Math.random() * 90 + 10)}`, name: "Geo", isActive: true })
      .returning({ id: geosTable.id, code: geosTable.code });

    const [firstSource] = await db
      .insert(workspaceTrafficSourcesTable)
      .values({ workspaceId, name: `First Source ${Date.now()}`, position: 1, isActive: true })
      .returning({ id: workspaceTrafficSourcesTable.id, name: workspaceTrafficSourcesTable.name });
    const [secondSource] = await db
      .insert(workspaceTrafficSourcesTable)
      .values({ workspaceId, name: `Second Source ${Date.now()}`, position: 2, isActive: true })
      .returning({ id: workspaceTrafficSourcesTable.id, name: workspaceTrafficSourcesTable.name });
    await db
      .insert(workspaceTrafficSourcesTable)
      .values({ workspaceId, name: `Inactive Source ${Date.now()}`, position: 3, isActive: false });

    const batchTag = `memory_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const created = await request("POST", "/testing-batches", employeeId, {
      workspaceId,
      assignedWorkerId: employeeId,
      batchName: `Memory Batch ${Date.now()}`,
      affiliateNetworkId: network.id,
      geoId: geo.id,
      trafficSourceId: secondSource.id,
      batchTag,
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.json.batchTag, batchTag);
    assert.equal(created.json.affiliateNetwork, network.name);
    assert.equal(created.json.geo, geo.code);
    assert.equal(created.json.trafficSource, secondSource.name);
    assert.equal(created.json.currentWorkspaceTrafficSourceId, secondSource.id);
    assert.equal(created.json.averageVisitsThresholdPerOffer, 25000);
    assert.deepEqual(created.json.optimizationCriteria, {});
    assert.equal(created.json.optimizationRunStatus, "not_ready");
    assert.equal(created.json.optimizationWinnersCount, 0);
    assert.equal(created.json.scalingCandidatesCount, 0);
    assert.equal(created.json.lastOptimizationRunAt, null);
    assert.equal(created.json.scalingExportStatus, "not_exported");

    const runs = await db
      .select()
      .from(batchTrafficSourceRunsTable)
      .where(eq(batchTrafficSourceRunsTable.batchId, created.json.id))
      .orderBy(asc(batchTrafficSourceRunsTable.position));

    assert.equal(runs.length, 2);
    assert.equal(runs[0].trafficSourceId, firstSource.id);
    assert.equal(runs[0].status, "pending");
    assert.equal(runs[0].iosStatus, "pending");
    assert.equal(runs[0].androidStatus, "pending");
    assert.equal(runs[0].startedAt, null);
    assert.equal(runs[1].trafficSourceId, secondSource.id);
    assert.equal(runs[1].status, "active");
    assert.equal(runs[1].iosStatus, "active");
    assert.equal(runs[1].androidStatus, "active");
    assert.ok(runs[1].startedAt);

    const [batch] = await db
      .select({
        batchTag: testingBatchesTable.batchTag,
        trafficSource: testingBatchesTable.trafficSource,
        currentWorkspaceTrafficSourceId: testingBatchesTable.currentWorkspaceTrafficSourceId,
        averageVisitsThresholdPerOffer: testingBatchesTable.averageVisitsThresholdPerOffer,
        optimizationRunStatus: testingBatchesTable.optimizationRunStatus,
        scalingExportStatus: testingBatchesTable.scalingExportStatus,
      })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, created.json.id));
    assert.equal(batch.batchTag, batchTag);
    assert.equal(batch.trafficSource, secondSource.name);
    assert.equal(batch.currentWorkspaceTrafficSourceId, secondSource.id);
    assert.equal(batch.averageVisitsThresholdPerOffer, 25000);
    assert.equal(batch.optimizationRunStatus, "not_ready");
    assert.equal(batch.scalingExportStatus, "not_exported");

    const tasks = await db
      .select()
      .from(todoTasksTable)
      .where(eq(todoTasksTable.relatedBatchId, created.json.id));
    assert.equal(tasks.length, 2);
    assert.deepEqual(tasks.map((task) => task.taskType).sort(), [
      "create_voluum_campaign_android",
      "create_voluum_campaign_ios",
    ]);
    assert.deepEqual(tasks.map((task) => task.title).sort(), [
      `Create Voluum campaign for ${batchTag} Android`,
      `Create Voluum campaign for ${batchTag} iOS`,
    ]);
    assert.ok(tasks.every((task) => task.trafficSourceId === secondSource.id));
  });

  test("per-user workspace activation is isolated", async () => {
    const wsOne = await createWorkspace("activation-one");
    const wsTwo = await createWorkspace("activation-two");
    const employeeOne = await createEmployee();
    const employeeTwo = await createEmployee();
    await assign(employeeOne, wsOne);
    await assign(employeeOne, wsTwo);
    await assign(employeeTwo, wsOne);
    await assign(employeeTwo, wsTwo);

    assert.equal((await request("PATCH", `/workspaces/${wsOne}/activate`, employeeOne)).response.status, 200);
    assert.equal((await request("PATCH", `/workspaces/${wsTwo}/activate`, employeeTwo)).response.status, 200);

    const one = await request("GET", "/auth/my-workspaces", employeeOne);
    const two = await request("GET", "/auth/my-workspaces", employeeTwo);
    assert.equal(one.json.find((ws: { id: number }) => ws.id === wsOne).isActive, true);
    assert.equal(one.json.find((ws: { id: number }) => ws.id === wsTwo).isActive, false);
    assert.equal(two.json.find((ws: { id: number }) => ws.id === wsOne).isActive, false);
    assert.equal(two.json.find((ws: { id: number }) => ws.id === wsTwo).isActive, true);

    const globals = await db
      .select({ id: workspacesTable.id, isActive: workspacesTable.isActive })
      .from(workspacesTable)
      .where(sql`${workspacesTable.id} in (${wsOne}, ${wsTwo})`);
    assert.equal(globals.every((ws) => ws.isActive === false), true);
  });

  test("non-member activation fails", async () => {
    const allowedWs = await createWorkspace("allowed");
    const blockedWs = await createWorkspace("blocked");
    const employeeId = await createEmployee();
    await assign(employeeId, allowedWs);

    const { response } = await request("PATCH", `/workspaces/${blockedWs}/activate`, employeeId);
    assert.equal(response.status, 403);

    const [employee] = await db
      .select({ activeWorkspaceId: employeesTable.activeWorkspaceId })
      .from(employeesTable)
      .where(eq(employeesTable.id, employeeId));
    assert.equal(employee.activeWorkspaceId, null);
  });

  test("admin workspace access is limited to explicit assignments", async () => {
    const assignedWs = await createWorkspace("admin-assigned");
    const unassignedWs = await createWorkspace("admin-unassigned");
    const adminId = await createEmployee("admin");
    await assign(adminId, assignedWs);

    const visible = await request("GET", "/auth/my-workspaces", adminId);
    assert.equal(visible.response.status, 200);
    assert.deepEqual(visible.json.map((ws: { id: number }) => ws.id), [assignedWs]);

    const denied = await request("PATCH", `/workspaces/${unassignedWs}/activate`, adminId);
    assert.equal(denied.response.status, 403);

    const allowed = await request("PATCH", `/workspaces/${assignedWs}/activate`, adminId);
    assert.equal(allowed.response.status, 200);
  });

  test("goals are scoped to workspace membership", async () => {
    const wsOne = await createWorkspace("goals-one");
    const wsTwo = await createWorkspace("goals-two");
    const employeeOne = await createEmployee();
    const employeeTwo = await createEmployee();
    await assign(employeeOne, wsOne);
    await assign(employeeTwo, wsTwo);

    const [goalOne] = await db
      .insert(goalsTable)
      .values({
        workspaceId: wsOne,
        employeeId: employeeOne,
        periodType: "weekly",
        periodStart: "2026-05-11",
        periodEnd: "2026-05-17",
      })
      .returning({ id: goalsTable.id });
    await db.insert(goalsTable).values({
      workspaceId: wsTwo,
      employeeId: employeeTwo,
      periodType: "weekly",
      periodStart: "2026-05-11",
      periodEnd: "2026-05-17",
    });

    const ownGoals = await request("GET", `/goals?workspace_id=${wsOne}`, employeeOne);
    assert.equal(ownGoals.response.status, 200);
    assert.deepEqual(ownGoals.json.map((goal: { id: number }) => goal.id), [goalOne.id]);

    const deniedList = await request("GET", `/goals?workspace_id=${wsTwo}`, employeeOne);
    assert.equal(deniedList.response.status, 403);

    const deniedGoal = await request("GET", `/goals/${goalOne.id}`, employeeTwo);
    assert.equal(deniedGoal.response.status, 403);
  });

  test("legacy sync activation path is isolated", async () => {
    const wsOne = await createWorkspace("legacy-one");
    const wsTwo = await createWorkspace("legacy-two");
    const employeeOne = await createEmployee();
    const employeeTwo = await createEmployee();
    await assign(employeeOne, wsOne);
    await assign(employeeOne, wsTwo);
    await assign(employeeTwo, wsOne);
    await assign(employeeTwo, wsTwo);

    assert.equal((await request("PATCH", `/sync/voluum/workspaces/${wsOne}/set-active`, employeeOne)).response.status, 200);
    assert.equal((await request("PATCH", `/sync/voluum/workspaces/${wsTwo}/set-active`, employeeTwo)).response.status, 200);

    const [one] = await db
      .select({ activeWorkspaceId: employeesTable.activeWorkspaceId })
      .from(employeesTable)
      .where(eq(employeesTable.id, employeeOne));
    const [two] = await db
      .select({ activeWorkspaceId: employeesTable.activeWorkspaceId })
      .from(employeesTable)
      .where(eq(employeesTable.id, employeeTwo));
    assert.equal(one.activeWorkspaceId, wsOne);
    assert.equal(two.activeWorkspaceId, wsTwo);
  });

  test("typed CampaignOps completion succeeds atomically with follow-up", async () => {
    const seed = await seedCampaignOpsBase();
    await db.insert(batchTrafficSourceRunsTable).values({
      workspaceId: seed.workspaceId,
      batchId: seed.batchId,
      trafficSourceId: seed.sourceOneId,
      position: 1,
      status: "active",
      iosStatus: "active",
      androidStatus: "active",
      startedAt: new Date(),
    });

    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        taskType: "create_voluum_campaign_ios",
        title: "Create iOS campaign",
        trafficSourceId: seed.sourceOneId,
      })
      .returning({ id: todoTasksTable.id });

    const { response, json } = await request("POST", `/todo-tasks/${task.id}/complete`, seed.employeeId, {
      trafficSourceId: seed.sourceOneId,
      voluumCampaignId: `voluum-${Date.now()}`,
      voluumCampaignName: "Voluum Campaign",
      campaignName: "Manual Campaign",
    });
    assert.equal(response.status, 200);
    assert.equal(json.status, "DONE");

    const [campaign] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, json.campaignId));
    assert.equal(campaign.status, "voluum_created");

    const [runAfterIos] = await db
      .select()
      .from(batchTrafficSourceRunsTable)
      .where(and(eq(batchTrafficSourceRunsTable.batchId, seed.batchId), eq(batchTrafficSourceRunsTable.trafficSourceId, seed.sourceOneId)));
    assert.equal(runAfterIos.iosCampaignId, campaign.id);
    assert.equal(runAfterIos.androidCampaignId, null);

    const [event] = await db
      .select()
      .from(eventsTable)
      .where(and(eq(eventsTable.workspaceId, seed.workspaceId), eq(eventsTable.dedupeKey, `task_completed:${task.id}`)));
    assert.equal(event.type, "TaskCompleted");

    const [followUp] = await db
      .select()
      .from(todoTasksTable)
      .where(and(eq(todoTasksTable.relatedCampaignId, campaign.id), eq(todoTasksTable.taskType, "take_campaign_live")));
    assert.equal(followUp.status, "TODO");

    const [androidTask] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        taskType: "create_voluum_campaign_android",
        title: "Create Android campaign",
        trafficSourceId: seed.sourceOneId,
      })
      .returning({ id: todoTasksTable.id });
    const android = await request("POST", `/todo-tasks/${androidTask.id}/complete`, seed.employeeId, {
      trafficSourceId: seed.sourceOneId,
      voluumCampaignId: `voluum-android-${Date.now()}`,
      voluumCampaignName: "Android Voluum Campaign",
      campaignName: "Android Manual Campaign",
    });
    assert.equal(android.response.status, 200);

    const [runAfterAndroid] = await db
      .select()
      .from(batchTrafficSourceRunsTable)
      .where(and(eq(batchTrafficSourceRunsTable.batchId, seed.batchId), eq(batchTrafficSourceRunsTable.trafficSourceId, seed.sourceOneId)));
    assert.equal(runAfterAndroid.iosCampaignId, campaign.id);
    assert.equal(runAfterAndroid.androidCampaignId, android.json.campaignId);
  });

  test("typed CampaignOps completion rolls back on follow-up failure", async () => {
    _resetRegistryForTests();
    _resetRulesGuardForTests();
    registerAllRules();
    registerHandler("TaskCompleted", async () => {
      throw new Error("forced follow-up failure");
    });

    const seed = await seedCampaignOpsBase();
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        taskType: "create_voluum_campaign_android",
        title: "Create Android campaign",
        trafficSourceId: seed.sourceOneId,
      })
      .returning({ id: todoTasksTable.id });

    const { response } = await request("POST", `/todo-tasks/${task.id}/complete`, seed.employeeId, {
      trafficSourceId: seed.sourceOneId,
      voluumCampaignId: `rollback-${Date.now()}`,
      voluumCampaignName: "Rollback Campaign",
      campaignName: "Rollback Campaign",
    });
    assert.equal(response.status, 500);

    const [taskAfter] = await db
      .select({ status: todoTasksTable.status, relatedCampaignId: todoTasksTable.relatedCampaignId })
      .from(todoTasksTable)
      .where(eq(todoTasksTable.id, task.id));
    assert.equal(taskAfter.status, "TODO");
    assert.equal(taskAfter.relatedCampaignId, null);

    const campaigns = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.batchId, seed.batchId));
    assert.equal(campaigns.length, 0);

    const events = await db
      .select()
      .from(eventsTable)
      .where(and(eq(eventsTable.workspaceId, seed.workspaceId), eq(eventsTable.dedupeKey, `task_completed:${task.id}`)));
    assert.equal(events.length, 0);

    const followUps = await db
      .select()
      .from(todoTasksTable)
      .where(and(eq(todoTasksTable.relatedBatchId, seed.batchId), eq(todoTasksTable.taskType, "take_campaign_live")));
    assert.equal(followUps.length, 0);
  });

  test("duplicate typed CampaignOps completion is idempotent without duplicate automation", async () => {
    const seed = await seedCampaignOpsBase();
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        taskType: "create_voluum_campaign_ios",
        title: "Create iOS campaign",
        trafficSourceId: seed.sourceOneId,
      })
      .returning({ id: todoTasksTable.id });

    const payload = {
      trafficSourceId: seed.sourceOneId,
      voluumCampaignId: `duplicate-${Date.now()}`,
      voluumCampaignName: "Duplicate Campaign",
      campaignName: "Duplicate Campaign",
    };

    const first = await request("POST", `/todo-tasks/${task.id}/complete`, seed.employeeId, payload);
    assert.equal(first.response.status, 200);

    const second = await request("POST", `/todo-tasks/${task.id}/complete`, seed.employeeId, payload);
    assert.equal(second.response.status, 200);

    const campaigns = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.batchId, seed.batchId));
    assert.equal(campaigns.length, 1);

    const events = await db
      .select()
      .from(eventsTable)
      .where(and(eq(eventsTable.workspaceId, seed.workspaceId), eq(eventsTable.dedupeKey, `task_completed:${task.id}`)));
    assert.equal(events.length, 1);

    const followUps = await db
      .select()
      .from(todoTasksTable)
      .where(and(eq(todoTasksTable.relatedCampaignId, campaigns[0]!.id), eq(todoTasksTable.taskType, "take_campaign_live")));
    assert.equal(followUps.length, 1);
  });

  test("generic PATCH cannot complete CampaignOps tasks", async () => {
    const seed = await seedCampaignOpsBase();
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        taskType: "find_winners",
        title: "Find winners",
      })
      .returning({ id: todoTasksTable.id });

    const { response } = await request("PATCH", `/todo-tasks/${task.id}`, seed.employeeId, { status: "DONE" });
    assert.equal(response.status, 400);

    const fakeCompletion = await request("PATCH", `/todo-tasks/${task.id}`, seed.employeeId, {
      completionPayload: {
        winnersCount: 1,
        revenue: 100,
        cost: 20,
      },
    });
    assert.equal(fakeCompletion.response.status, 400);

    const [taskAfter] = await db
      .select({
        status: todoTasksTable.status,
        completedAt: todoTasksTable.completedAt,
        completionPayload: todoTasksTable.completionPayload,
      })
      .from(todoTasksTable)
      .where(eq(todoTasksTable.id, task.id));
    assert.equal(taskAfter.status, "TODO");
    assert.equal(taskAfter.completedAt, null);
    assert.equal(taskAfter.completionPayload, null);
  });

  test("generic PATCH rejects taskType mutation bypass", async () => {
    const seed = await seedCampaignOpsBase();
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        taskType: "create_voluum_campaign_ios",
        title: "Create campaign",
      })
      .returning({ id: todoTasksTable.id });

    const { response } = await request("PATCH", `/todo-tasks/${task.id}`, seed.employeeId, {
      taskType: "FIND_WINNERS",
    });
    assert.equal(response.status, 400);

    const [taskAfter] = await db
      .select({ taskType: todoTasksTable.taskType })
      .from(todoTasksTable)
      .where(eq(todoTasksTable.id, task.id));
    assert.equal(taskAfter.taskType, "create_voluum_campaign_ios");

    const ownership = await request("PATCH", `/todo-tasks/${task.id}`, seed.employeeId, {
      relatedBatchId: null,
    });
    assert.equal(ownership.response.status, 400);
  });

  test("same-workspace non-owner cannot update or complete another worker's task", async () => {
    const seed = await seedCampaignOpsBase();
    const otherEmployeeId = await createEmployee();
    await assign(otherEmployeeId, seed.workspaceId);
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        taskType: "create_voluum_campaign_ios",
        title: "Create campaign",
      })
      .returning({ id: todoTasksTable.id });

    const patch = await request("PATCH", `/todo-tasks/${task.id}`, otherEmployeeId, { status: "IN_PROGRESS" });
    assert.equal(patch.response.status, 403);

    const complete = await request("POST", `/todo-tasks/${task.id}/complete`, otherEmployeeId, {
      trafficSourceId: seed.sourceOneId,
      voluumCampaignId: "voluum-campaign-1",
      voluumCampaignName: "Voluum Campaign 1",
      campaignName: "Internal Campaign 1",
    });
    assert.equal(complete.response.status, 403);

    const [taskAfter] = await db
      .select({ status: todoTasksTable.status, relatedCampaignId: todoTasksTable.relatedCampaignId })
      .from(todoTasksTable)
      .where(eq(todoTasksTable.id, task.id));
    assert.equal(taskAfter.status, "TODO");
    assert.equal(taskAfter.relatedCampaignId, null);
  });

  test("batch owner can update a related task assigned to another worker", async () => {
    const seed = await seedCampaignOpsBase();
    const assignedEmployeeId = await createEmployee();
    await assign(assignedEmployeeId, seed.workspaceId);
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: assignedEmployeeId,
        relatedBatchId: seed.batchId,
        taskType: "all_traffic_sources_tested",
        title: "All sources tested",
      })
      .returning({ id: todoTasksTable.id });

    const patch = await request("PATCH", `/todo-tasks/${task.id}`, seed.employeeId, { status: "IN_PROGRESS" });
    assert.equal(patch.response.status, 200);
    assert.equal(patch.json.status, "IN_PROGRESS");

    const invalidReason = await request("PATCH", `/todo-tasks/${task.id}`, seed.employeeId, {
      blockedReason: "waiting on source approval",
    });
    assert.equal(invalidReason.response.status, 400);

    const blocked = await request("PATCH", `/todo-tasks/${task.id}`, seed.employeeId, {
      status: "BLOCKED",
      blockedReason: "waiting on source approval",
    });
    assert.equal(blocked.response.status, 200);
    assert.equal(blocked.json.status, "BLOCKED");
    assert.equal(blocked.json.blockedReason, "waiting on source approval");
  });

  test("take_campaign_live and find_winners typed behavior", async () => {
    const seed = await seedCampaignOpsBase();
    await db.insert(batchTrafficSourceRunsTable).values([
      {
        workspaceId: seed.workspaceId,
        batchId: seed.batchId,
        trafficSourceId: seed.sourceOneId,
        position: 1,
        status: "active",
        iosStatus: "active",
        androidStatus: "active",
        startedAt: new Date(),
      },
      {
        workspaceId: seed.workspaceId,
        batchId: seed.batchId,
        trafficSourceId: seed.sourceTwoId,
        position: 2,
        status: "pending",
        iosStatus: "pending",
        androidStatus: "pending",
      },
    ]);
    const [campaign] = await db
      .insert(campaignsTable)
      .values({
        workspaceId: seed.workspaceId,
        batchId: seed.batchId,
        platform: "ios",
        campaignName: "iOS Source One",
        trafficSourceId: seed.sourceOneId,
        status: "voluum_created",
      })
      .returning({ id: campaignsTable.id });
    const [takeLive] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        relatedCampaignId: campaign.id,
        taskType: "take_campaign_live",
        title: "Take live",
      })
      .returning({ id: todoTasksTable.id });

    const missingLiveData = await request("POST", `/todo-tasks/${takeLive.id}/complete`, seed.employeeId, {});
    assert.equal(missingLiveData.response.status, 400);

    const [beforeLiveCampaign] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaign.id));
    assert.equal(beforeLiveCampaign.status, "voluum_created");
    assert.equal(beforeLiveCampaign.liveStartedAt, null);

    const live = await request("POST", `/todo-tasks/${takeLive.id}/complete`, seed.employeeId, {
      trafficSourceCampaignId: "ts-campaign-1",
      trafficSourceCampaignUrl: "https://example.test/campaign",
      notes: "live notes",
    });
    assert.equal(live.response.status, 200);
    assert.equal(live.json.completedByEmployeeId, seed.employeeId);
    assert.ok(live.json.completedAt);
    assert.deepEqual(live.json.completionPayload, {
      trafficSourceCampaignId: "ts-campaign-1",
      trafficSourceCampaignUrl: "https://example.test/campaign",
      notes: "live notes",
    });

    const [completedTakeLiveTask] = await db
      .select({
        completedAt: todoTasksTable.completedAt,
        completedByEmployeeId: todoTasksTable.completedByEmployeeId,
        completionPayload: todoTasksTable.completionPayload,
      })
      .from(todoTasksTable)
      .where(eq(todoTasksTable.id, takeLive.id));
    assert.ok(completedTakeLiveTask.completedAt);
    assert.equal(completedTakeLiveTask.completedByEmployeeId, seed.employeeId);
    assert.deepEqual(completedTakeLiveTask.completionPayload, {
      trafficSourceCampaignId: "ts-campaign-1",
      trafficSourceCampaignUrl: "https://example.test/campaign",
      notes: "live notes",
    });

    const [liveCampaign] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaign.id));
    assert.equal(liveCampaign.status, "live");
    assert.ok(liveCampaign.liveStartedAt);
    assert.equal(liveCampaign.trafficSourceCampaignId, "ts-campaign-1");

    const [androidCampaign] = await db
      .insert(campaignsTable)
      .values({
        workspaceId: seed.workspaceId,
        batchId: seed.batchId,
        platform: "android",
        campaignName: "Android Source One",
        trafficSourceId: seed.sourceOneId,
        status: "live",
      })
      .returning({ id: campaignsTable.id });
    const [androidFindWinners] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        relatedCampaignId: androidCampaign.id,
        taskType: "find_winners",
        title: "Find Android winners",
      })
      .returning({ id: todoTasksTable.id });
    const androidFailed = await request("POST", `/todo-tasks/${androidFindWinners.id}/complete`, seed.employeeId, {
      outcome: "failed",
      failureReason: "source rejected campaign",
    });
    assert.equal(androidFailed.response.status, 200);

    const [findWinners] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        relatedCampaignId: campaign.id,
        taskType: "find_winners",
        title: "Find winners",
      })
      .returning({ id: todoTasksTable.id });

    const tested = await request("POST", `/todo-tasks/${findWinners.id}/complete`, seed.employeeId, {
      winnersCount: 2,
      revenue: 150,
      cost: 100,
      clicks: 300,
      conversions: 12,
      notes: "tested notes",
    });
    assert.equal(tested.response.status, 200);

    const [testedCampaign] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaign.id));
    assert.equal(testedCampaign.status, "tested");
    assert.equal(testedCampaign.winnersCount, 2);
    assert.equal(String(testedCampaign.roi), "0.5");

    const [nextTask] = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, seed.batchId),
          eq(todoTasksTable.taskType, "create_voluum_campaign_ios"),
          eq(todoTasksTable.trafficSourceId, seed.sourceTwoId),
        ),
      );
    assert.equal(nextTask.status, "TODO");
  });
});
