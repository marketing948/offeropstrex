// Feature 2 — Voluum CSV upload override mode.
// Verifies that override=false preserves existing (campaign, date) rows and
// skips them, while override=true replaces them. New rows are inserted in both
// modes.

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
  workspacesTable,
} from "@workspace/db";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

const METRIC_DATE = "2026-05-12";
const CSV_HEADER = "Campaign,Campaign tags,Campaign ID,Created,Visits,Conversions,Cost,Revenue,ROI";

function buildCsv(rows: string[]): string {
  return [CSV_HEADER, ...rows].join("\n");
}

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
    .values({ name: `Override ${Date.now()}`, isActive: false })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(ws.id);

  const [admin] = await db
    .insert(employeesTable)
    .values({ name: "OV Admin", email: `ov-admin-${Date.now()}@example.com`, passwordHash: "x", role: "admin" })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(admin.id);
  await db
    .insert(employeeWorkspaceAssignmentsTable)
    .values({ employeeId: admin.id, workspaceId: ws.id, role: "employee" })
    .onConflictDoNothing();

  const voluumA = `ov-a-${Date.now()}`;
  const voluumB = `ov-b-${Date.now()}`;
  const [campaignA] = await db
    .insert(campaignsTable)
    .values({
      workspaceId: ws.id,
      platform: "ios",
      campaignName: "Override Campaign A",
      status: "live",
      campaignPurpose: "working",
      voluumCampaignId: voluumA,
    })
    .returning({ id: campaignsTable.id });
  const [campaignB] = await db
    .insert(campaignsTable)
    .values({
      workspaceId: ws.id,
      platform: "android",
      campaignName: "Override Campaign B",
      status: "live",
      campaignPurpose: "working",
      voluumCampaignId: voluumB,
    })
    .returning({ id: campaignsTable.id });

  return { workspaceId: ws.id, adminId: admin.id, campaignAId: campaignA.id, campaignBId: campaignB.id, voluumA, voluumB };
}

describe("voluum CSV import override mode", { concurrency: false }, () => {
  test("override=false skips existing rows and preserves data", async () => {
    const s = await seed();
    await db.insert(campaignDailyMetricsTable).values({
      workspaceId: s.workspaceId,
      campaignId: s.campaignAId,
      date: METRIC_DATE,
      employeeId: s.adminId,
      cost: "1",
      revenue: "2",
      conversions: 3,
      visits: 4,
    });

    const csvText = buildCsv([
      `A,,${s.voluumA},2020-01-01,999,99,888.5,777,0`, // existing
      `B,,${s.voluumB},2020-01-01,10,1,5,6,0`, // new
    ]);

    const { response, json } = await request(
      "POST",
      "/campaign-daily-metrics/voluum-import/confirm",
      s.adminId,
      { workspaceId: s.workspaceId, date: METRIC_DATE, csvText, override: false },
    );
    assert.equal(response.status, 200);
    assert.equal(json?.imported, 1); // only B
    assert.equal(json?.updated, 0);
    assert.equal(json?.skippedExisting, 1); // A preserved
    assert.equal(json?.override, false);

    const [rowA] = await db
      .select()
      .from(campaignDailyMetricsTable)
      .where(and(eq(campaignDailyMetricsTable.campaignId, s.campaignAId), eq(campaignDailyMetricsTable.date, METRIC_DATE)));
    assert.equal(rowA.visits, 4); // unchanged
    assert.equal(rowA.cost, "1");

    const [rowB] = await db
      .select()
      .from(campaignDailyMetricsTable)
      .where(and(eq(campaignDailyMetricsTable.campaignId, s.campaignBId), eq(campaignDailyMetricsTable.date, METRIC_DATE)));
    assert.equal(rowB.visits, 10); // inserted
  });

  test("override=true updates existing rows and inserts new", async () => {
    const s = await seed();
    await db.insert(campaignDailyMetricsTable).values({
      workspaceId: s.workspaceId,
      campaignId: s.campaignAId,
      date: METRIC_DATE,
      employeeId: s.adminId,
      cost: "1",
      revenue: "2",
      conversions: 3,
      visits: 4,
    });

    const csvText = buildCsv([
      `A,,${s.voluumA},2020-01-01,999,99,888.5,777,0`, // existing -> update
      `B,,${s.voluumB},2020-01-01,10,1,5,6,0`, // new -> insert
    ]);

    const { response, json } = await request(
      "POST",
      "/campaign-daily-metrics/voluum-import/confirm",
      s.adminId,
      { workspaceId: s.workspaceId, date: METRIC_DATE, csvText, override: true },
    );
    assert.equal(response.status, 200);
    assert.equal(json?.imported, 1); // B
    assert.equal(json?.updated, 1); // A
    assert.equal(json?.skippedExisting, 0);
    assert.equal(json?.override, true);

    const [rowA] = await db
      .select()
      .from(campaignDailyMetricsTable)
      .where(and(eq(campaignDailyMetricsTable.campaignId, s.campaignAId), eq(campaignDailyMetricsTable.date, METRIC_DATE)));
    assert.equal(rowA.visits, 999); // replaced
    assert.equal(rowA.cost, "888.5");
  });

  test("preview reflects override mode (existing kept vs to override)", async () => {
    const s = await seed();
    await db.insert(campaignDailyMetricsTable).values({
      workspaceId: s.workspaceId,
      campaignId: s.campaignAId,
      date: METRIC_DATE,
      employeeId: s.adminId,
      cost: "1",
      revenue: "2",
      conversions: 0,
      visits: 1,
    });
    const csvText = buildCsv([`A,,${s.voluumA},2020-01-01,5,1,1,1,0`]);

    const off = await request("POST", "/campaign-daily-metrics/voluum-import/preview", s.adminId, {
      workspaceId: s.workspaceId,
      date: METRIC_DATE,
      csvText,
      override: false,
    });
    const offSummary = off.json?.summary as Record<string, number>;
    assert.equal(offSummary.updating, 0);
    assert.equal(offSummary.skippedExisting, 1);

    const on = await request("POST", "/campaign-daily-metrics/voluum-import/preview", s.adminId, {
      workspaceId: s.workspaceId,
      date: METRIC_DATE,
      csvText,
      override: true,
    });
    const onSummary = on.json?.summary as Record<string, number>;
    assert.equal(onSummary.updating, 1);
    assert.equal(onSummary.skippedExisting, 0);
  });
});
