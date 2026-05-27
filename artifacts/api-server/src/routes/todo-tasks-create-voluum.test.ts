import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import app from "../app.ts";
import {
  campaignsTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  testingBatchesTable,
  todoTasksTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS campaigns_workspace_voluum_campaign_id_unique
      ON campaigns (workspace_id, voluum_campaign_id)
      WHERE voluum_campaign_id IS NOT NULL
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
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = { raw: text };
  }
  return { response, json };
}

async function createWorkspace(): Promise<number> {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `CV ${Date.now()}`, isActive: false })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(ws.id);
  return ws.id;
}

async function createEmployee(role: "admin" | "employee" = "employee"): Promise<number> {
  const [emp] = await db
    .insert(employeesTable)
    .values({
      name: `CV ${role}`,
      email: `cv-${role}-${Date.now()}@example.com`,
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

async function seedBatchWithCreateTask() {
  const workspaceId = await createWorkspace();
  const employeeId = await createEmployee();
  await assign(employeeId, workspaceId);

  const [source] = await db
    .insert(workspaceTrafficSourcesTable)
    .values({ workspaceId, name: `Source ${Date.now()}`, position: 1, isActive: true })
    .returning({ id: workspaceTrafficSourcesTable.id });

  const [batch] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId,
      employeeId,
      batchName: `Batch ${Date.now()}`,
      affiliateNetwork: "Net",
      geo: "DE",
      trafficSource: "Source",
      batchTag: `CV_${Date.now()}`,
    })
    .returning({ id: testingBatchesTable.id });

  const [task] = await db
    .insert(todoTasksTable)
    .values({
      workspaceId,
      employeeId,
      relatedBatchId: batch.id,
      taskType: "create_voluum_campaign_ios",
      title: "Create iOS Voluum campaign",
      trafficSourceId: source.id,
    })
    .returning({ id: todoTasksTable.id });

  return { workspaceId, employeeId, batchId: batch.id, sourceId: source.id, taskId: task.id };
}

function completeBody(voluumCampaignId: string) {
  return {
    voluumCampaignId,
    campaignUrl: `https://voluum.example/${voluumCampaignId}`,
  };
}

describe("POST /todo-tasks/:id/complete create_voluum_campaign", { concurrency: false }, () => {
  test("requires voluumCampaignId in request body", async () => {
    const seed = await seedBatchWithCreateTask();
    const missing = await request("POST", `/todo-tasks/${seed.taskId}/complete`, seed.employeeId, {
      campaignUrl: "https://example.test/ios-only",
    });
    assert.equal(missing.response.status, 400);

    const blank = await request("POST", `/todo-tasks/${seed.taskId}/complete`, seed.employeeId, {
      voluumCampaignId: "  ",
      campaignUrl: "https://example.test/ios",
    });
    assert.equal(blank.response.status, 400);
  });

  test("stores voluumCampaignId and spawns take_campaign_live", async () => {
    const seed = await seedBatchWithCreateTask();
    const voluumId = `vc-store-${Date.now()}`;
    const { response, json } = await request(
      "POST",
      `/todo-tasks/${seed.taskId}/complete`,
      seed.employeeId,
      completeBody(voluumId),
    );
    assert.equal(response.status, 200);
    assert.equal(json?.status, "DONE");

    const campaignId = json?.campaignId as number;
    const [campaign] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId));
    assert.equal(campaign.voluumCampaignId, voluumId);
    assert.equal(campaign.campaignUrl, `https://voluum.example/${voluumId}`);

    const [followUp] = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedCampaignId, campaignId),
          eq(todoTasksTable.taskType, "take_campaign_live"),
        ),
      );
    assert.equal(followUp.status, "TODO");
  });

  test("take_campaign_live title uses batch display name not create_voluum task title", async () => {
    const workspaceId = await createWorkspace();
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceId);

    const batchName = "LB_US_batch1";
    const [source] = await db
      .insert(workspaceTrafficSourcesTable)
      .values({ workspaceId, name: "Source", position: 1, isActive: true })
      .returning({ id: workspaceTrafficSourcesTable.id });

    const [batch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId,
        employeeId,
        batchName,
        affiliateNetwork: "Net",
        geo: "DE",
        trafficSource: "Source",
        batchTag: `CV_${Date.now()}`,
      })
      .returning({ id: testingBatchesTable.id });

    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId,
        employeeId,
        relatedBatchId: batch.id,
        taskType: "create_voluum_campaign_android",
        title: `Create Voluum campaign for ${batchName} Android`,
        trafficSourceId: source.id,
      })
      .returning({ id: todoTasksTable.id });

    const voluumId = `vc-title-${Date.now()}`;
    const { response } = await request(
      "POST",
      `/todo-tasks/${task.id}/complete`,
      employeeId,
      completeBody(voluumId),
    );
    assert.equal(response.status, 200);

    const [campaign] = await db
      .select({ id: campaignsTable.id, campaignName: campaignsTable.campaignName })
      .from(campaignsTable)
      .where(eq(campaignsTable.voluumCampaignId, voluumId));
    assert.equal(campaign.campaignName, `${batchName} Android`);

    const [followUp] = await db
      .select({ title: todoTasksTable.title })
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedCampaignId, campaign.id),
          eq(todoTasksTable.taskType, "take_campaign_live"),
        ),
      );
    assert.equal(followUp.title, `Take "${batchName} Android" live`);
  });

  test("rejects duplicate voluumCampaignId in same workspace", async () => {
    const seed = await seedBatchWithCreateTask();
    const voluumId = `vc-dup-${Date.now()}`;

    const [androidTask] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        taskType: "create_voluum_campaign_android",
        title: "Create Android Voluum campaign",
        trafficSourceId: seed.sourceId,
      })
      .returning({ id: todoTasksTable.id });

    const first = await request(
      "POST",
      `/todo-tasks/${seed.taskId}/complete`,
      seed.employeeId,
      completeBody(voluumId),
    );
    assert.equal(first.response.status, 200);

    const second = await request(
      "POST",
      `/todo-tasks/${androidTask.id}/complete`,
      seed.employeeId,
      completeBody(voluumId),
    );
    assert.equal(second.response.status, 409);
    assert.match(String(second.json?.error ?? ""), /already linked/i);
  });

  test("MANUAL task completion is unaffected", async () => {
    const workspaceId = await createWorkspace();
    const adminId = await createEmployee("admin");
    const workerId = await createEmployee("employee");
    await assign(adminId, workspaceId);
    await assign(workerId, workspaceId);

    const createRes = await request("POST", "/todo-tasks/manual", adminId, {
      workspaceId,
      assignedEmployeeId: workerId,
      title: "Manual checklist item",
    });
    assert.equal(createRes.response.status, 201);
    const manualTaskId = createRes.json?.id as number;

    const complete = await request("POST", `/todo-tasks/${manualTaskId}/complete`, workerId);
    assert.equal(complete.response.status, 200);
    assert.equal(complete.json?.status, "DONE");
  });
});
