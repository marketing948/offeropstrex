// Part B — Admin delete testing batches. Verifies preview counts, admin-only
// access, exact confirmation gating, scoped transactional hard delete (batch +
// cascade dependents only), preservation/unlinking of todo tasks, the audit
// event, and that an out-of-workspace batch cannot be deleted.

import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import app from "../app.ts";
import { ensureProductionLiveCampaignSchema } from "../test-utils/ensure-production-live-campaign-schema.ts";
import {
  campaignDailyMetricsTable,
  campaignsTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  offersTable,
  operationalEventsTable,
  testingBatchesTable,
  todoTasksTable,
  workspacesTable,
} from "@workspace/db";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  await ensureProductionLiveCampaignSchema();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS campaign_daily_metrics (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      date date NOT NULL,
      employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
      cost numeric NOT NULL DEFAULT 0,
      revenue numeric NOT NULL DEFAULT 0,
      conversions integer NOT NULL DEFAULT 0,
      visits integer NOT NULL DEFAULT 0,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT campaign_daily_metrics_workspace_campaign_date_unique UNIQUE (campaign_id, date)
    );
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

async function request(method: string, path: string, employeeId: number, body?: Record<string, unknown>) {
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

async function insertBatch(workspaceId: number, employeeId: number, label: string): Promise<number> {
  const [batch] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId,
      employeeId,
      batchName: `${label} ${Date.now()}`,
      affiliateNetwork: "Network",
      geo: "DE",
      trafficSource: "Source",
      batchTag: `${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      status: "NEW_BATCH",
    })
    .returning({ id: testingBatchesTable.id });
  return batch.id;
}

async function insertCampaign(
  workspaceId: number,
  batchId: number,
  platform: "ios" | "android",
  label: string,
): Promise<number> {
  const [c] = await db
    .insert(campaignsTable)
    .values({
      workspaceId,
      batchId,
      platform,
      campaignName: `${label} ${Date.now()}`,
      status: "live",
      campaignPurpose: "testing",
      voluumCampaignId: `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    })
    .returning({ id: campaignsTable.id });
  return c.id;
}

async function seed() {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `BatchDel ${Date.now()}`, isActive: false })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(ws.id);

  const [admin] = await db
    .insert(employeesTable)
    .values({ name: "BD Admin", email: `bd-admin-${Date.now()}@example.com`, passwordHash: "x", role: "admin" })
    .returning({ id: employeesTable.id });
  const [worker] = await db
    .insert(employeesTable)
    .values({ name: "BD Worker", email: `bd-worker-${Date.now()}@example.com`, passwordHash: "x", role: "employee" })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(admin.id, worker.id);
  for (const id of [admin.id, worker.id]) {
    await db
      .insert(employeeWorkspaceAssignmentsTable)
      .values({ employeeId: id, workspaceId: ws.id, role: "employee" })
      .onConflictDoNothing();
  }

  // Target batch A with 2 campaigns, 2 daily-metric rows, 2 offers, 1 task.
  const batchA = await insertBatch(ws.id, worker.id, "A");
  const cA1 = await insertCampaign(ws.id, batchA, "ios", "A1");
  const cA2 = await insertCampaign(ws.id, batchA, "android", "A2");
  for (const campaignId of [cA1, cA2]) {
    await db.insert(campaignDailyMetricsTable).values({
      workspaceId: ws.id,
      campaignId,
      date: "2026-05-10",
      employeeId: worker.id,
      cost: "1",
      revenue: "2",
      conversions: 1,
      visits: 10,
    });
    await db.insert(offersTable).values({
      workspaceId: ws.id,
      batchId: batchA,
      offerName: `Offer ${campaignId}`,
    });
  }
  const [taskA] = await db
    .insert(todoTasksTable)
    .values({
      workspaceId: ws.id,
      employeeId: worker.id,
      relatedBatchId: batchA,
      title: "Batch A task",
      taskType: "MANUAL",
    })
    .returning({ id: todoTasksTable.id });

  // Unrelated batch B (same workspace) — must survive deletion of A.
  const batchB = await insertBatch(ws.id, worker.id, "B");
  const cB1 = await insertCampaign(ws.id, batchB, "ios", "B1");
  await db.insert(campaignDailyMetricsTable).values({
    workspaceId: ws.id,
    campaignId: cB1,
    date: "2026-05-10",
    employeeId: worker.id,
    cost: "1",
    revenue: "2",
    conversions: 1,
    visits: 5,
  });
  await db.insert(offersTable).values({ workspaceId: ws.id, batchId: batchB, offerName: "Offer B" });

  return { workspaceId: ws.id, adminId: admin.id, workerId: worker.id, batchA, batchB, cB1, taskAId: taskA.id };
}

describe("admin delete testing batch", { concurrency: false }, () => {
  test("preview returns correct dependent counts", async () => {
    const s = await seed();
    const { response, json } = await request("POST", "/testing-batches/admin/delete-preview", s.adminId, {
      workspaceId: s.workspaceId,
      batchId: s.batchA,
    });
    assert.equal(response.status, 200);
    const deletes = json?.deletes as Record<string, number>;
    assert.equal(deletes.campaigns, 2);
    assert.equal(deletes.offers, 2);
    assert.equal(deletes.campaignDailyMetrics, 2);
    const unlinks = json?.unlinks as Record<string, number>;
    assert.equal(unlinks.todoTasks, 1);
    assert.equal(json?.confirmationRequired, "DELETE BATCH");
  });

  test("non-admin cannot preview or delete", async () => {
    const s = await seed();
    const preview = await request("POST", "/testing-batches/admin/delete-preview", s.workerId, {
      workspaceId: s.workspaceId,
      batchId: s.batchA,
    });
    assert.equal(preview.response.status, 403);

    const del = await request("POST", "/testing-batches/admin/delete", s.workerId, {
      workspaceId: s.workspaceId,
      batchId: s.batchA,
      confirmationText: "DELETE BATCH",
    });
    assert.equal(del.response.status, 403);

    const [stillThere] = await db
      .select({ id: testingBatchesTable.id })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, s.batchA));
    assert.ok(stillThere);
  });

  test("delete requires exact confirmation text", async () => {
    const s = await seed();
    const bad = await request("POST", "/testing-batches/admin/delete", s.adminId, {
      workspaceId: s.workspaceId,
      batchId: s.batchA,
      confirmationText: "delete batch",
    });
    assert.equal(bad.response.status, 400);

    const [stillThere] = await db
      .select({ id: testingBatchesTable.id })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, s.batchA));
    assert.ok(stillThere);
  });

  test("delete removes the batch + dependents only, unlinks tasks, writes audit", async () => {
    const s = await seed();
    const { response, json } = await request("POST", "/testing-batches/admin/delete", s.adminId, {
      workspaceId: s.workspaceId,
      batchId: s.batchA,
      confirmationText: "DELETE BATCH",
    });
    assert.equal(response.status, 200);
    assert.equal(json?.deleted, true);

    // Batch A and its campaigns/offers/metrics are gone.
    const batchAGone = await db
      .select({ id: testingBatchesTable.id })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, s.batchA));
    assert.equal(batchAGone.length, 0);
    const campaignsAGone = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(eq(campaignsTable.batchId, s.batchA));
    assert.equal(campaignsAGone.length, 0);
    const offersAGone = await db
      .select({ id: offersTable.id })
      .from(offersTable)
      .where(eq(offersTable.batchId, s.batchA));
    assert.equal(offersAGone.length, 0);

    // Batch B and its data survive.
    const [batchBAlive] = await db
      .select({ id: testingBatchesTable.id })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, s.batchB));
    assert.ok(batchBAlive);
    const cbMetrics = await db
      .select({ id: campaignDailyMetricsTable.id })
      .from(campaignDailyMetricsTable)
      .where(eq(campaignDailyMetricsTable.campaignId, s.cB1));
    assert.equal(cbMetrics.length, 1);

    // The todo task is preserved but unlinked from the deleted batch.
    const [task] = await db
      .select({ id: todoTasksTable.id, relatedBatchId: todoTasksTable.relatedBatchId })
      .from(todoTasksTable)
      .where(eq(todoTasksTable.id, s.taskAId));
    assert.ok(task);
    assert.equal(task.relatedBatchId, null);

    // Audit event recorded against the admin actor.
    const [audit] = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, s.workspaceId),
          eq(operationalEventsTable.eventType, "TESTING_BATCH_DELETED"),
        ),
      );
    assert.ok(audit);
    assert.equal(audit.actorId, String(s.adminId));
    assert.equal(audit.entityId, String(s.batchA));
  });

  test("out-of-workspace batch cannot be deleted", async () => {
    const s = await seed();
    // Another workspace the admin also belongs to.
    const [otherWs] = await db
      .insert(workspacesTable)
      .values({ name: `OtherWs ${Date.now()}`, isActive: false })
      .returning({ id: workspacesTable.id });
    createdWorkspaceIds.push(otherWs.id);
    await db
      .insert(employeeWorkspaceAssignmentsTable)
      .values({ employeeId: s.adminId, workspaceId: otherWs.id, role: "employee" })
      .onConflictDoNothing();

    // Try to delete batch A by claiming it lives in otherWs.
    const { response } = await request("POST", "/testing-batches/admin/delete", s.adminId, {
      workspaceId: otherWs.id,
      batchId: s.batchA,
      confirmationText: "DELETE BATCH",
    });
    assert.equal(response.status, 404);

    const [stillThere] = await db
      .select({ id: testingBatchesTable.id })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, s.batchA));
    assert.ok(stillThere);
  });
});
