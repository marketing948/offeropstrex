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
  eventsTable,
  operationalEventsTable,
  testingBatchesTable,
  todoTasksTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { recordOperationalEvent } from "../lib/operational-events.ts";
import { applyAction } from "../engine/executor.ts";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS operational_events (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      event_type text NOT NULL,
      actor_type text NOT NULL DEFAULT 'system',
      actor_id text,
      source text NOT NULL,
      payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS operational_events_workspace_created_at_idx
      ON operational_events (workspace_id, created_at, id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS operational_events_workspace_entity_idx
      ON operational_events (workspace_id, entity_type, entity_id, created_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS operational_events_workspace_event_type_idx
      ON operational_events (workspace_id, event_type, created_at)
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



async function request(path: string, employeeId: number) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${authToken(employeeId)}` },
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
      name: `Audit Tester ${Date.now()}`,
      email: `audit-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
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
  const workspaceId = await createWorkspace("audit-hook");
  const employeeId = await createEmployee();
  await assign(employeeId, workspaceId);

  const [source] = await db
    .insert(workspaceTrafficSourcesTable)
    .values({ workspaceId, name: `Audit Source ${Date.now()}`, position: 1, isActive: true })
    .returning({ id: workspaceTrafficSourcesTable.id });
  const [batch] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId,
      employeeId,
      batchName: `Audit Batch ${Date.now()}`,
      affiliateNetwork: "Audit Network",
      geo: "DE",
      trafficSource: "Audit Source",
      batchTag: `audit_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      currentWorkspaceTrafficSourceId: source.id,
    })
    .returning({ id: testingBatchesTable.id });

  return { workspaceId, employeeId, batchId: batch.id, trafficSourceId: source.id };
}

describe("operational events timeline", { concurrency: false }, () => {
  test("records append-only operational events with workspace_id", async () => {
    const workspaceId = await createWorkspace("audit-foundation");
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceId);

    const event = await recordOperationalEvent({
      workspaceId,
      entityType: "task",
      entityId: 123,
      eventType: "TASK_COMPLETED",
      actorType: "employee",
      actorId: employeeId,
      source: "routes-test",
      payloadJson: { field: "value" },
    });

    assert.equal(event.workspaceId, workspaceId);
    assert.equal(event.entityType, "task");
    assert.equal(event.entityId, "123");
    assert.equal(event.eventType, "TASK_COMPLETED");
    assert.deepEqual(event.payloadJson, { field: "value" });
  });

  test("returns server-authorized timeline filtered by workspace, entity, event type, and date", async () => {
    const workspaceId = await createWorkspace("audit-filter");
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceId);
    const createdAt = new Date("2026-05-18T00:00:00.000Z");

    await recordOperationalEvent({
      workspaceId,
      entityType: "task",
      entityId: "task-1",
      eventType: "TASK_CREATED",
      source: "routes-test",
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
    });
    await recordOperationalEvent({
      workspaceId,
      entityType: "task",
      entityId: "task-1",
      eventType: "TASK_COMPLETED",
      source: "routes-test",
      createdAt,
      payloadJson: { result: "done" },
    });

    const params = new URLSearchParams({
      workspace_id: String(workspaceId),
      entity_type: "task",
      entity_id: "task-1",
      event_type: "TASK_COMPLETED",
      date_from: "2026-05-18T00:00:00.000Z",
      date_to: "2026-05-19T00:00:00.000Z",
    });
    const { response, json } = await request(`/operational-events?${params.toString()}`, employeeId);

    assert.equal(response.status, 200);
    assert.equal(json.pagination.total, 1);
    assert.equal(json.items.length, 1);
    assert.equal(json.items[0].workspaceId, workspaceId);
    assert.equal(json.items[0].entityType, "task");
    assert.equal(json.items[0].entityId, "task-1");
    assert.equal(json.items[0].eventType, "TASK_COMPLETED");
    assert.deepEqual(json.items[0].payloadJson, { result: "done" });
    assert.equal(json.items[0].createdAt, createdAt.toISOString());
  });

  test("does not expose another workspace timeline", async () => {
    const workspaceA = await createWorkspace("audit-a");
    const workspaceB = await createWorkspace("audit-b");
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceA);

    await recordOperationalEvent({
      workspaceId: workspaceB,
      entityType: "batch",
      entityId: "b-1",
      eventType: "BATCH_CREATED",
      source: "routes-test",
    });

    const { response, json } = await request(`/operational-events?workspace_id=${workspaceB}`, employeeId);

    assert.equal(response.status, 403);
    assert.equal(json.error, "Access denied: not a member of this workspace");
  });

  test("read route does not mutate workflow engine events", async () => {
    const workspaceId = await createWorkspace("audit-readonly");
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceId);
    await recordOperationalEvent({
      workspaceId,
      entityType: "sync",
      entityId: "preview",
      eventType: "SYNC_PREVIEW_RUN",
      source: "routes-test",
    });
    const before = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(eventsTable)
      .where(eq(eventsTable.workspaceId, workspaceId));

    const { response } = await request(`/operational-events?workspace_id=${workspaceId}`, employeeId);

    const after = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(eventsTable)
      .where(eq(eventsTable.workspaceId, workspaceId));
    assert.equal(response.status, 200);
    assert.equal(after[0]?.count ?? 0, before[0]?.count ?? 0);
  });

  test("rejects requests without server-authorized workspace_id", async () => {
    const employeeId = await createEmployee();

    const { response, json } = await request("/operational-events", employeeId);

    assert.equal(response.status, 400);
    assert.equal(json.error, "workspace_id query parameter is required");
  });

  test("does not expose mutation routes for operational events", async () => {
    const workspaceId = await createWorkspace("audit-no-mutation");
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceId);

    const response = await fetch(`${baseUrl}/operational-events`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${authToken(employeeId)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workspaceId }),
    });

    assert.equal(response.status, 404);
    const rows = await db
      .select({ id: operationalEventsTable.id })
      .from(operationalEventsTable)
      .where(eq(operationalEventsTable.workspaceId, workspaceId));
    assert.equal(rows.length, 0);
  });

  test("records TASK_CREATED from the engine task creation boundary", async () => {
    const seed = await seedCampaignOpsBase();

    await db.transaction((tx) =>
      applyAction({
        type: "CreateTask",
        workspaceId: seed.workspaceId,
        data: {
          employeeId: seed.employeeId,
          relatedBatchId: seed.batchId,
          title: "Audit task creation",
          taskType: "find_winners",
          priority: "high",
          trafficSourceId: seed.trafficSourceId,
        },
      }, tx),
    );

    const [task] = await db
      .select({ id: todoTasksTable.id })
      .from(todoTasksTable)
      .where(and(eq(todoTasksTable.workspaceId, seed.workspaceId), eq(todoTasksTable.title, "Audit task creation")));
    const [event] = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, seed.workspaceId),
          eq(operationalEventsTable.eventType, "TASK_CREATED"),
          eq(operationalEventsTable.entityId, String(task.id)),
        ),
      );

    assert.equal(event.entityType, "task");
    assert.equal(event.actorType, "system");
    assert.equal(event.source, "engine");
    assert.deepEqual(event.payloadJson, {
      taskType: "find_winners",
      employeeId: seed.employeeId,
      relatedBatchId: seed.batchId,
      relatedCampaignId: null,
      priority: "high",
      trafficSourceId: seed.trafficSourceId,
    });
  });

  test("records CAMPAIGN_LINKED and TASK_COMPLETED after create-campaign completion succeeds", async () => {
    const seed = await seedCampaignOpsBase();
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.employeeId,
        relatedBatchId: seed.batchId,
        title: "Create campaign for audit",
        taskType: "create_voluum_campaign_ios",
        status: "TODO",
        trafficSourceId: seed.trafficSourceId,
      })
      .returning({ id: todoTasksTable.id });

    const response = await fetch(`${baseUrl}/todo-tasks/${task.id}/complete`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${authToken(seed.employeeId)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        voluumCampaignId: `voluum-audit-${Date.now()}`,
        campaignUrl: "https://campaign.example/audit",
      }),
    });
    const json = await response.json() as { status: string };

    assert.equal(response.status, 200);
    assert.equal(json.status, "DONE");

    const campaignEvents = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, seed.workspaceId),
          eq(operationalEventsTable.eventType, "CAMPAIGN_LINKED"),
        ),
      );
    const completedEvents = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, seed.workspaceId),
          eq(operationalEventsTable.eventType, "TASK_COMPLETED"),
          eq(operationalEventsTable.entityId, String(task.id)),
        ),
      );
    const [campaign] = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(eq(campaignsTable.workspaceId, seed.workspaceId));

    assert.equal(campaignEvents.length, 1);
    assert.equal(campaignEvents[0]!.entityType, "campaign");
    assert.equal(campaignEvents[0]!.entityId, String(campaign.id));
    assert.deepEqual(campaignEvents[0]!.payloadJson, {
      taskId: task.id,
      taskType: "create_voluum_campaign_ios",
      batchId: seed.batchId,
      platform: "ios",
      trafficSourceId: seed.trafficSourceId,
    });
    assert.equal(completedEvents.length, 1);
    assert.deepEqual(completedEvents[0]!.payloadJson, {
      taskType: "create_voluum_campaign_ios",
      relatedBatchId: seed.batchId,
      relatedCampaignId: campaign.id,
      completionKind: "create_voluum_campaign",
    });
  });
});
