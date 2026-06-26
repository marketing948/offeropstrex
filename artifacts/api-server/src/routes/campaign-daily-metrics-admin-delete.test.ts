// Feature 3 — Admin delete daily metrics by employee + date range.
// Verifies preview counts, confirmation gating, scoped hard delete, audit
// event, and that non-admins are rejected.

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
  operationalEventsTable,
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
      cost numeric NOT NULL DEFAULT 0 CHECK (cost >= 0),
      revenue numeric NOT NULL DEFAULT 0 CHECK (revenue >= 0),
      conversions integer NOT NULL DEFAULT 0 CHECK (conversions >= 0),
      visits integer NOT NULL DEFAULT 0 CHECK (visits >= 0),
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT campaign_daily_metrics_workspace_campaign_date_unique
        UNIQUE (campaign_id, date)
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

async function seed() {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `Del ${Date.now()}`, isActive: false })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(ws.id);

  const [admin] = await db
    .insert(employeesTable)
    .values({ name: "Del Admin", email: `del-admin-${Date.now()}@example.com`, passwordHash: "x", role: "admin" })
    .returning({ id: employeesTable.id });
  const [worker] = await db
    .insert(employeesTable)
    .values({ name: "Del Worker", email: `del-worker-${Date.now()}@example.com`, passwordHash: "x", role: "employee" })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(admin.id, worker.id);
  for (const id of [admin.id, worker.id]) {
    await db
      .insert(employeeWorkspaceAssignmentsTable)
      .values({ employeeId: id, workspaceId: ws.id, role: "employee" })
      .onConflictDoNothing();
  }

  const [campaignA] = await db
    .insert(campaignsTable)
    .values({
      workspaceId: ws.id,
      platform: "ios",
      campaignName: "Del Campaign A",
      status: "live",
      campaignPurpose: "working",
      voluumCampaignId: `del-a-${Date.now()}`,
    })
    .returning({ id: campaignsTable.id });
  const [campaignB] = await db
    .insert(campaignsTable)
    .values({
      workspaceId: ws.id,
      platform: "android",
      campaignName: "Del Campaign B",
      status: "live",
      campaignPurpose: "working",
      voluumCampaignId: `del-b-${Date.now()}`,
    })
    .returning({ id: campaignsTable.id });

  // Worker rows: campaignA on 05-10, 05-11, 05-12.
  for (const date of ["2026-05-10", "2026-05-11", "2026-05-12"]) {
    await db.insert(campaignDailyMetricsTable).values({
      workspaceId: ws.id,
      campaignId: campaignA.id,
      date,
      employeeId: worker.id,
      cost: "1",
      revenue: "2",
      conversions: 1,
      visits: 1,
    });
  }
  // Admin row: campaignB on 05-11 (must never be deleted when targeting worker).
  await db.insert(campaignDailyMetricsTable).values({
    workspaceId: ws.id,
    campaignId: campaignB.id,
    date: "2026-05-11",
    employeeId: admin.id,
    cost: "1",
    revenue: "2",
    conversions: 1,
    visits: 1,
  });

  return { workspaceId: ws.id, adminId: admin.id, workerId: worker.id, campaignAId: campaignA.id, campaignBId: campaignB.id };
}

describe("admin delete daily metrics by employee + date range", { concurrency: false }, () => {
  test("preview returns scoped count and affected campaigns", async () => {
    const s = await seed();
    const { response, json } = await request(
      "POST",
      "/campaign-daily-metrics/admin/delete-preview",
      s.adminId,
      { workspaceId: s.workspaceId, employeeId: s.workerId, dateFrom: "2026-05-10", dateTo: "2026-05-11" },
    );
    assert.equal(response.status, 200);
    assert.equal(json?.matchingRows, 2); // 05-10 + 05-11 for worker
    assert.equal(json?.affectedCampaignsCount, 1);
    assert.equal(json?.confirmationRequired, "DELETE DATA");
  });

  test("delete requires exact confirmation text", async () => {
    const s = await seed();
    const bad = await request("POST", "/campaign-daily-metrics/admin/delete", s.adminId, {
      workspaceId: s.workspaceId,
      employeeId: s.workerId,
      dateFrom: "2026-05-10",
      dateTo: "2026-05-12",
      confirmationText: "delete data",
    });
    assert.equal(bad.response.status, 400);

    // Nothing deleted.
    const remaining = await db
      .select()
      .from(campaignDailyMetricsTable)
      .where(eq(campaignDailyMetricsTable.workspaceId, s.workspaceId));
    assert.equal(remaining.length, 4);
  });

  test("delete removes only scoped rows and writes an audit event", async () => {
    const s = await seed();
    const { response, json } = await request(
      "POST",
      "/campaign-daily-metrics/admin/delete",
      s.adminId,
      {
        workspaceId: s.workspaceId,
        employeeId: s.workerId,
        dateFrom: "2026-05-10",
        dateTo: "2026-05-11",
        confirmationText: "DELETE DATA",
      },
    );
    assert.equal(response.status, 200);
    assert.equal(json?.deleted, 2);

    // Worker 05-12 remains; admin 05-11 remains.
    const remaining = await db
      .select()
      .from(campaignDailyMetricsTable)
      .where(eq(campaignDailyMetricsTable.workspaceId, s.workspaceId));
    assert.equal(remaining.length, 2);
    assert.ok(remaining.some((r) => r.employeeId === s.workerId && r.date === "2026-05-12"));
    assert.ok(remaining.some((r) => r.employeeId === s.adminId && r.date === "2026-05-11"));

    const [audit] = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, s.workspaceId),
          eq(operationalEventsTable.eventType, "LIVE_CAMPAIGN_METRICS_BULK_DELETED"),
        ),
      );
    assert.ok(audit);
    assert.equal(audit.actorId, String(s.adminId));
  });

  test("non-admin cannot preview or delete", async () => {
    const s = await seed();
    const preview = await request("POST", "/campaign-daily-metrics/admin/delete-preview", s.workerId, {
      workspaceId: s.workspaceId,
      employeeId: s.workerId,
      dateFrom: "2026-05-10",
      dateTo: "2026-05-12",
    });
    assert.equal(preview.response.status, 403);

    const del = await request("POST", "/campaign-daily-metrics/admin/delete", s.workerId, {
      workspaceId: s.workspaceId,
      employeeId: s.workerId,
      dateFrom: "2026-05-10",
      dateTo: "2026-05-12",
      confirmationText: "DELETE DATA",
    });
    assert.equal(del.response.status, 403);

    const remaining = await db
      .select()
      .from(campaignDailyMetricsTable)
      .where(eq(campaignDailyMetricsTable.workspaceId, s.workspaceId));
    assert.equal(remaining.length, 4);
  });
});
