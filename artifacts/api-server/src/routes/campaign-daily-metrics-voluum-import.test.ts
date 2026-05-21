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
  testingBatchesTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

const METRIC_DATE = "2026-05-12";
const VOLUUM_A = "voluum-csv-a-001";
const VOLUUM_B = "voluum-csv-b-002";
const VOLUUM_UNKNOWN = "voluum-csv-missing";

const CSV_HEADER =
  "Campaign,Campaign tags,Campaign ID,Created,Visits,Conversions,Cost,Revenue,ROI";

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

function authToken(employeeId: number): string {
  return Buffer.from(`${employeeId}:metrics:offerops_secret`).toString("base64");
}

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

async function seedBundle() {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `Voluum CSV ${Date.now()}`, isActive: false })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(ws.id);

  const adminId = (
    await db
      .insert(employeesTable)
      .values({
        name: "CSV Admin",
        email: `csv-admin-${Date.now()}@example.com`,
        passwordHash: "x",
        role: "admin",
      })
      .returning({ id: employeesTable.id })
  )[0]!.id;

  const workerAId = (
    await db
      .insert(employeesTable)
      .values({
        name: "CSV Worker A",
        email: `csv-a-${Date.now()}@example.com`,
        passwordHash: "x",
        role: "employee",
      })
      .returning({ id: employeesTable.id })
  )[0]!.id;

  const workerBId = (
    await db
      .insert(employeesTable)
      .values({
        name: "CSV Worker B",
        email: `csv-b-${Date.now()}@example.com`,
        passwordHash: "x",
        role: "employee",
      })
      .returning({ id: employeesTable.id })
  )[0]!.id;
  createdEmployeeIds.push(adminId, workerAId, workerBId);

  for (const empId of [adminId, workerAId, workerBId]) {
    await db.insert(employeeWorkspaceAssignmentsTable).values({
      employeeId: empId,
      workspaceId: ws.id,
      role: "employee",
    }).onConflictDoNothing();
  }

  const sourceName = `CSV Source ${Date.now()}`;
  const sourceId = (
    await db
      .insert(workspaceTrafficSourcesTable)
      .values({
        workspaceId: ws.id,
        name: sourceName,
        position: 1,
        isActive: true,
      })
      .returning({ id: workspaceTrafficSourcesTable.id })
  )[0]!.id;

  const [batchA] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId: ws.id,
      employeeId: workerAId,
      batchName: `Batch A ${Date.now()}`,
      affiliateNetwork: "Net",
      geo: "US",
      trafficSource: sourceName,
      batchTag: `csv_a_${Date.now()}`,
    })
    .returning({ id: testingBatchesTable.id });

  const [batchB] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId: ws.id,
      employeeId: workerBId,
      batchName: `Batch B ${Date.now()}`,
      affiliateNetwork: "Net",
      geo: "US",
      trafficSource: sourceName,
      batchTag: `csv_b_${Date.now()}`,
    })
    .returning({ id: testingBatchesTable.id });

  const [campaignA] = await db
    .insert(campaignsTable)
    .values({
      workspaceId: ws.id,
      batchId: batchA.id,
      platform: "ios",
      campaignName: "Campaign A",
      trafficSourceId: sourceId,
      status: "closed",
      campaignPurpose: "testing",
      voluumCampaignId: VOLUUM_A,
      liveStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    })
    .returning({ id: campaignsTable.id });

  const [campaignB] = await db
    .insert(campaignsTable)
    .values({
      workspaceId: ws.id,
      batchId: batchB.id,
      platform: "android",
      campaignName: "Campaign B",
      trafficSourceId: sourceId,
      status: "live",
      campaignPurpose: "testing",
      voluumCampaignId: VOLUUM_B,
      liveStartedAt: new Date("2026-05-01T00:00:00.000Z"),
    })
    .returning({ id: campaignsTable.id });

  return {
    workspaceId: ws.id,
    adminId,
    workerAId,
    workerBId,
    campaignAId: campaignA.id,
    campaignBId: campaignB.id,
  };
}

describe("campaign-daily-metrics voluum import", { concurrency: false }, () => {
  test("preview classifies import, update, skip, and not_allowed", async () => {
    const seed = await seedBundle();
    await db.insert(campaignDailyMetricsTable).values({
      workspaceId: seed.workspaceId,
      campaignId: seed.campaignAId,
      date: METRIC_DATE,
      employeeId: seed.adminId,
      cost: "1",
      revenue: "2",
      conversions: 0,
      visits: 1,
    });

    const csvText = buildCsv([
      `A,,${VOLUUM_A},2020-01-01,100,5,10,20,0`,
      `B,,${VOLUUM_B},2020-01-01,200,6,11,21,0`,
      `X,,${VOLUUM_UNKNOWN},2020-01-01,50,1,5,10,0`,
    ]);

    const { response, json } = await request(
      "POST",
      "/campaign-daily-metrics/voluum-import/preview",
      seed.adminId,
      { workspaceId: seed.workspaceId, date: METRIC_DATE, csvText },
    );
    assert.equal(response.status, 200);
    const summary = json?.summary as Record<string, number>;
    assert.equal(summary.importable, 1);
    assert.equal(summary.updating, 1);
    assert.equal(summary.skipped, 1);

    const rows = json?.rows as { action: string; skipReason?: string }[];
    assert.ok(rows.some((r) => r.action === "update" && !r.skipReason));
    assert.ok(rows.some((r) => r.action === "import"));
    assert.ok(rows.some((r) => r.skipReason === "campaign_not_found"));
  });

  test("confirm upserts and re-parse matches preview counts", async () => {
    const seed = await seedBundle();
    const csvText = buildCsv([`A,,${VOLUUM_A},2020-01-01,1000,50,100.5,250,0`]);

    const confirm = await request(
      "POST",
      "/campaign-daily-metrics/voluum-import/confirm",
      seed.workerAId,
      { workspaceId: seed.workspaceId, date: METRIC_DATE, csvText },
    );
    assert.equal(confirm.response.status, 200);
    assert.equal(confirm.json?.imported, 1);
    assert.equal(confirm.json?.updated, 0);

    const rows = await db
      .select()
      .from(campaignDailyMetricsTable)
      .where(
        and(
          eq(campaignDailyMetricsTable.campaignId, seed.campaignAId),
          eq(campaignDailyMetricsTable.date, METRIC_DATE),
        ),
      );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.visits, 1000);
    assert.equal(rows[0]!.cost, "100.5");

    const confirm2 = await request(
      "POST",
      "/campaign-daily-metrics/voluum-import/confirm",
      seed.workerAId,
      { workspaceId: seed.workspaceId, date: METRIC_DATE, csvText },
    );
    assert.equal(confirm2.json?.imported, 0);
    assert.equal(confirm2.json?.updated, 1);
  });

  test("worker skips other workers campaign as not_allowed", async () => {
    const seed = await seedBundle();
    const csvText = buildCsv([`B,,${VOLUUM_B},2020-01-01,100,5,10,20,0`]);

    const { response, json } = await request(
      "POST",
      "/campaign-daily-metrics/voluum-import/confirm",
      seed.workerAId,
      { workspaceId: seed.workspaceId, date: METRIC_DATE, csvText },
    );
    assert.equal(response.status, 200);
    assert.equal(json?.imported, 0);
    assert.equal(json?.skipped, 1);
    const breakdown = json?.skippedBreakdown as Record<string, number>;
    assert.equal(breakdown.not_allowed, 1);
  });

  test("rejects unreadable csv", async () => {
    const seed = await seedBundle();
    const { response } = await request(
      "POST",
      "/campaign-daily-metrics/voluum-import/preview",
      seed.adminId,
      { workspaceId: seed.workspaceId, date: METRIC_DATE, csvText: "Campaign only\nx" },
    );
    assert.equal(response.status, 400);
  });
});
