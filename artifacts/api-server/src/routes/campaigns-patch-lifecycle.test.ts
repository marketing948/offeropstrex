import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import app from "../app.ts";
import {
  campaignsTable,
  db,
  employeesTable,
  employeeWorkspaceAssignmentsTable,
  eventsTable,
  testingBatchesTable,
  todoTasksTable,
  workspacesTable,
} from "@workspace/db";
import { _resetRegistryForTests } from "../engine/handlers.ts";
import { _resetRulesGuardForTests, registerAllRules } from "../engine/rules/index.ts";
import { ensureProductionLiveCampaignSchema } from "../test-utils/ensure-production-live-campaign-schema.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  await ensureProductionLiveCampaignSchema();
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

function authToken(employeeId: number): string {
  return Buffer.from(`${employeeId}:campaign-patch-lifecycle:offerops_secret`).toString("base64");
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
  let json: Record<string, unknown> | null = null;
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
      name: `campaign-patch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
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
      name: `Campaign Patch Tester ${Date.now()}`,
      email: `campaign-patch-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
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

async function seedCampaign(platform: "ios" | "android", status: "draft" | "ready" = "draft") {
  const workspaceId = await createWorkspace();
  const employeeId = await createEmployee();
  await assign(employeeId, workspaceId);

  const [batch] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId,
      employeeId,
      batchName: `Campaign Patch Batch ${Date.now()}`,
      affiliateNetwork: "Network",
      geo: "DE",
      trafficSource: "Source",
      batchTag: `cp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    })
    .returning({ id: testingBatchesTable.id });

  const [campaign] = await db
    .insert(campaignsTable)
    .values({
      workspaceId,
      batchId: batch.id,
      platform,
      campaignName: `${platform} campaign ${Date.now()}`,
      status,
    })
    .returning({
      id: campaignsTable.id,
      status: campaignsTable.status,
    });

  return {
    workspaceId,
    employeeId,
    batchId: batch.id,
    campaignId: campaign.id,
    initialStatus: campaign.status,
  };
}

describe("PATCH /campaigns/:id lifecycle boundary", { concurrency: false }, () => {
  test("status PATCH uses engine path and records CampaignStatusChanged", async () => {
    const { employeeId, workspaceId, campaignId, initialStatus } = await seedCampaign("ios");

    const { response, json } = await request("PATCH", `/campaigns/${campaignId}`, employeeId, {
      status: "ready",
    });

    assert.equal(response.status, 200);
    assert.equal(json?.status, "ready");

    const [row] = await db
      .select({ status: campaignsTable.status })
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId));
    assert.equal(row?.status, "ready");
    assert.notEqual(row?.status, initialStatus);

    const statusEvents = await db
      .select({ type: eventsTable.type, payload: eventsTable.payload })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.workspaceId, workspaceId),
          eq(eventsTable.type, "CampaignStatusChanged"),
        ),
      );
    assert.ok(
      statusEvents.some((event) => {
        const payload = event.payload as { campaignId?: number; to?: string };
        return payload.campaignId === campaignId && payload.to === "ready";
      }),
      "expected CampaignStatusChanged event for status transition",
    );
  });

  test("identical status PATCH skips engine transition", async () => {
    const { employeeId, workspaceId, campaignId } = await seedCampaign("ios", "ready");

    const eventsBefore = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.workspaceId, workspaceId),
          eq(eventsTable.type, "CampaignStatusChanged"),
        ),
      );

    const { response, json } = await request("PATCH", `/campaigns/${campaignId}`, employeeId, {
      status: "ready",
    });

    assert.equal(response.status, 200);
    assert.equal(json?.status, "ready");

    const eventsAfter = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.workspaceId, workspaceId),
          eq(eventsTable.type, "CampaignStatusChanged"),
        ),
      );
    assert.equal(eventsAfter.length, eventsBefore.length);
  });

  test("allows PATCH for non-status fields", async () => {
    const { employeeId, campaignId } = await seedCampaign("android");

    const { response, json } = await request("PATCH", `/campaigns/${campaignId}`, employeeId, {
      campaignName: "Slice 4E renamed",
    });

    assert.equal(response.status, 200);
    assert.equal(json?.campaignName, "Slice 4E renamed");
    assert.equal(json?.status, "draft");

    const [row] = await db
      .select({
        campaignName: campaignsTable.campaignName,
        status: campaignsTable.status,
      })
      .from(campaignsTable)
      .where(eq(campaignsTable.id, campaignId));
    assert.equal(row?.campaignName, "Slice 4E renamed");
    assert.equal(row?.status, "draft");
  });

  test("POST /campaigns manual create remains compatible", async () => {
    const workspaceId = await createWorkspace();
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceId);

    const [batch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId,
        employeeId,
        batchName: `Create Campaign Batch ${Date.now()}`,
        affiliateNetwork: "Network",
        geo: "DE",
        trafficSource: "Source",
        batchTag: `create_${Date.now()}`,
      })
      .returning({ id: testingBatchesTable.id });

    const { response, json } = await request("POST", "/campaigns", employeeId, {
      workspaceId,
      batchId: batch.id,
      platform: "ios",
      campaignName: "Manual create 4E",
      status: "draft",
    });

    assert.equal(response.status, 201);
    assert.equal(json?.status, "draft");
    assert.equal(json?.platform, "ios");
  });

  test("status PATCH to ready on both platforms seeds legacy GO_LIVE task", async () => {
    const workspaceId = await createWorkspace();
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceId);

    const [batch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId,
        employeeId,
        batchName: `Dual ready ${Date.now()}`,
        affiliateNetwork: "Network",
        geo: "DE",
        trafficSource: "Source",
        batchTag: `dual_${Date.now()}`,
      })
      .returning({ id: testingBatchesTable.id });

    const [ios] = await db
      .insert(campaignsTable)
      .values({
        workspaceId,
        batchId: batch.id,
        platform: "ios",
        campaignName: "ios",
        status: "draft",
      })
      .returning({ id: campaignsTable.id });
    const [android] = await db
      .insert(campaignsTable)
      .values({
        workspaceId,
        batchId: batch.id,
        platform: "android",
        campaignName: "android",
        status: "draft",
      })
      .returning({ id: campaignsTable.id });

    const first = await request("PATCH", `/campaigns/${ios.id}`, employeeId, { status: "ready" });
    assert.equal(first.response.status, 200);

    const second = await request("PATCH", `/campaigns/${android.id}`, employeeId, { status: "ready" });
    assert.equal(second.response.status, 200);

    const goLiveTasks = await db
      .select({ id: todoTasksTable.id })
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.workspaceId, workspaceId),
          eq(todoTasksTable.relatedBatchId, batch.id),
          eq(todoTasksTable.taskType, "GO_LIVE"),
        ),
      );
    assert.equal(goLiveTasks.length, 1);
  });
});
