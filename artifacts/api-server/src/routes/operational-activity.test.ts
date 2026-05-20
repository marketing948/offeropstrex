import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import app from "../app.ts";
import {
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  eventsTable,
  operationalActivityFeedTable,
  workspacesTable,
} from "@workspace/db";
import { appendOperationalActivity } from "../lib/operational-activity-feed.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS operational_activity_feed (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      event_type text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      actor_employee_id integer REFERENCES employees(id) ON DELETE SET NULL,
      title text NOT NULL,
      description text,
      metadata_json jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS operational_activity_feed_workspace_created_at_idx
      ON operational_activity_feed (workspace_id, created_at DESC, id DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS operational_activity_feed_workspace_event_type_idx
      ON operational_activity_feed (workspace_id, event_type, created_at DESC)
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

function authToken(employeeId: number): string {
  return Buffer.from(`${employeeId}:operational-activity-test:offerops_secret`).toString("base64");
}

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
      name: `Activity Tester ${Date.now()}`,
      email: `activity-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
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

describe("operational activity feed", { concurrency: false }, () => {
  test("can append activity", async () => {
    const workspaceId = await createWorkspace("activity-append");
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceId);

    const row = await appendOperationalActivity(db, {
      workspaceId,
      eventType: "task_completed",
      entityType: "task",
      entityId: 42,
      actorEmployeeId: employeeId,
      title: "Completed task: Test task",
      metadata: { taskType: "MANUAL" },
    });

    assert.ok(row);
    assert.equal(row!.workspaceId, workspaceId);
    assert.equal(row!.eventType, "task_completed");
    assert.equal(row!.title, "Completed task: Test task");
  });

  test("GET is workspace scoped and returns newest first", async () => {
    const workspaceA = await createWorkspace("activity-a");
    const workspaceB = await createWorkspace("activity-b");
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceA);

    const older = new Date("2026-05-20T10:00:00.000Z");
    const newer = new Date("2026-05-20T14:00:00.000Z");

    await db.insert(operationalActivityFeedTable).values({
      workspaceId: workspaceA,
      eventType: "task_completed",
      entityType: "task",
      entityId: "1",
      title: "Older activity",
      createdAt: older,
    });
    await db.insert(operationalActivityFeedTable).values({
      workspaceId: workspaceA,
      eventType: "campaign_closed",
      entityType: "campaign",
      entityId: "2",
      title: "Newer activity",
      createdAt: newer,
    });
    await db.insert(operationalActivityFeedTable).values({
      workspaceId: workspaceB,
      eventType: "task_completed",
      entityType: "task",
      entityId: "9",
      title: "Other workspace",
      createdAt: newer,
    });

    const { response, json } = await request(
      `/operational-activity?workspace_id=${workspaceA}&date=2026-05-20`,
      employeeId,
    );

    assert.equal(response.status, 200);
    assert.equal(json.date, "2026-05-20");
    assert.equal(json.items.length, 2);
    assert.equal(json.items[0].title, "Newer activity");
    assert.equal(json.items[1].title, "Older activity");
    assert.ok(json.items.every((item: { workspaceId: number }) => item.workspaceId === workspaceA));
  });

  test("filters by event type and actor", async () => {
    const workspaceId = await createWorkspace("activity-filters");
    const actorA = await createEmployee();
    const actorB = await createEmployee();
    await assign(actorA, workspaceId);

    const day = "2026-05-19T12:00:00.000Z";
    await db.insert(operationalActivityFeedTable).values([
      {
        workspaceId,
        eventType: "task_completed",
        entityType: "task",
        entityId: "t1",
        actorEmployeeId: actorA,
        title: "Task A",
        createdAt: new Date(day),
      },
      {
        workspaceId,
        eventType: "winner_added",
        entityType: "campaign",
        entityId: "c1",
        actorEmployeeId: actorB,
        title: "Winner B",
        createdAt: new Date(day),
      },
    ]);

    const byType = await request(
      `/operational-activity?workspace_id=${workspaceId}&date=2026-05-19&event_type=winner_added`,
      actorA,
    );
    assert.equal(byType.response.status, 200);
    assert.equal(byType.json.items.length, 1);
    assert.equal(byType.json.items[0].eventType, "winner_added");

    const byActor = await request(
      `/operational-activity?workspace_id=${workspaceId}&date=2026-05-19&actor_employee_id=${actorA}`,
      actorA,
    );
    assert.equal(byActor.response.status, 200);
    assert.equal(byActor.json.items.length, 1);
    assert.equal(byActor.json.items[0].actorEmployeeId, actorA);
  });

  test("worker without workspace access is rejected", async () => {
    const workspaceId = await createWorkspace("activity-denied");
    const outsider = await createEmployee();

    const { response, json } = await request(
      `/operational-activity?workspace_id=${workspaceId}`,
      outsider,
    );

    assert.equal(response.status, 403);
    assert.equal(json.error, "Access denied: not a member of this workspace");
  });

  test("activity append does not trigger workflow engine events", async () => {
    const workspaceId = await createWorkspace("activity-no-engine");
    const employeeId = await createEmployee();
    await assign(employeeId, workspaceId);

    const before = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(eventsTable)
      .where(eq(eventsTable.workspaceId, workspaceId));

    await appendOperationalActivity(db, {
      workspaceId,
      eventType: "manual_metrics_submitted",
      entityType: "campaign",
      entityId: 99,
      actorEmployeeId: employeeId,
      title: "Submitted daily metrics for Test (2026-05-20)",
    });

    const after = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(eventsTable)
      .where(eq(eventsTable.workspaceId, workspaceId));

    assert.equal(after[0]?.count ?? 0, before[0]?.count ?? 0);

    const feedRows = await db
      .select({ id: operationalActivityFeedTable.id })
      .from(operationalActivityFeedTable)
      .where(
        and(
          eq(operationalActivityFeedTable.workspaceId, workspaceId),
          eq(operationalActivityFeedTable.eventType, "manual_metrics_submitted"),
        ),
      );
    assert.equal(feedRows.length, 1);
  });

  test("rejects requests without workspace_id", async () => {
    const employeeId = await createEmployee();
    const { response, json } = await request("/operational-activity", employeeId);
    assert.equal(response.status, 400);
    assert.equal(json.error, "workspace_id query parameter is required");
  });
});
