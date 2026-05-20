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

const METRIC_DATE = "2026-05-10";

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
    .values({ name: `CDM ${Date.now()}`, isActive: false })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(ws.id);

  const adminId = (
    await db
      .insert(employeesTable)
      .values({
        name: "CDM Admin",
        email: `cdm-admin-${Date.now()}@example.com`,
        passwordHash: "x",
        role: "admin",
      })
      .returning({ id: employeesTable.id })
  )[0]!.id;

  const workerAId = (
    await db
      .insert(employeesTable)
      .values({
        name: "CDM Worker A",
        email: `cdm-a-${Date.now()}@example.com`,
        passwordHash: "x",
        role: "employee",
      })
      .returning({ id: employeesTable.id })
  )[0]!.id;

  const workerBId = (
    await db
      .insert(employeesTable)
      .values({
        name: "CDM Worker B",
        email: `cdm-b-${Date.now()}@example.com`,
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

  const sourceName = `CDM Source ${Date.now()}`;
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
      batchTag: `cdm_a_${Date.now()}`,
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
      batchTag: `cdm_b_${Date.now()}`,
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
      status: "live",
      campaignPurpose: "testing",
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

describe("campaign-daily-metrics", { concurrency: false }, () => {
  test("upsert is unique per campaign_id + date", async () => {
    const seed = await seedBundle();
    const body = {
      workspaceId: seed.workspaceId,
      campaignId: seed.campaignAId,
      date: METRIC_DATE,
      cost: "10",
      revenue: "25",
      conversions: 2,
      visits: 100,
    };

    const first = await request("PUT", "/campaign-daily-metrics", seed.adminId, body);
    assert.equal(first.response.status, 200);
    assert.equal(first.json?.cost, "10");

    const second = await request("PUT", "/campaign-daily-metrics", seed.adminId, {
      ...body,
      cost: "15",
      revenue: "40",
    });
    assert.equal(second.response.status, 200);
    assert.equal(second.json?.cost, "15");
    assert.equal(second.json?.profit, "25");

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
    assert.equal(rows[0]!.cost, "15");
  });

  test("rejects workspace mismatch on upsert", async () => {
    const seed = await seedBundle();
    const [otherWs] = await db
      .insert(workspacesTable)
      .values({ name: `Other ${Date.now()}`, isActive: false })
      .returning({ id: workspacesTable.id });
    createdWorkspaceIds.push(otherWs.id);
    await db.insert(employeeWorkspaceAssignmentsTable).values({
      employeeId: seed.adminId,
      workspaceId: otherWs.id,
      role: "employee",
    }).onConflictDoNothing();

    const { response } = await request("PUT", "/campaign-daily-metrics", seed.adminId, {
      workspaceId: otherWs.id,
      campaignId: seed.campaignAId,
      date: METRIC_DATE,
      cost: "1",
      revenue: "2",
      conversions: 0,
      visits: 0,
    });
    assert.equal(response.status, 404);
  });

  test("rejects negative values", async () => {
    const seed = await seedBundle();
    const { response } = await request("PUT", "/campaign-daily-metrics", seed.adminId, {
      workspaceId: seed.workspaceId,
      campaignId: seed.campaignAId,
      date: METRIC_DATE,
      cost: "-1",
      revenue: "0",
      conversions: 0,
      visits: 0,
    });
    assert.equal(response.status, 400);
  });

  test("worker cannot submit for another workers testing campaign", async () => {
    const seed = await seedBundle();
    const { response } = await request("PUT", "/campaign-daily-metrics", seed.workerAId, {
      workspaceId: seed.workspaceId,
      campaignId: seed.campaignBId,
      date: METRIC_DATE,
      cost: "5",
      revenue: "5",
      conversions: 1,
      visits: 10,
    });
    assert.equal(response.status, 403);
  });

  test("admin can submit within workspace", async () => {
    const seed = await seedBundle();
    const { response, json } = await request("PUT", "/campaign-daily-metrics", seed.adminId, {
      workspaceId: seed.workspaceId,
      campaignId: seed.campaignBId,
      date: METRIC_DATE,
      cost: "20",
      revenue: "50",
      conversions: 3,
      visits: 200,
    });
    assert.equal(response.status, 200);
    assert.equal(json?.campaignId, seed.campaignBId);
    assert.equal(json?.roi, "1.5");
  });

  test("GET scopes metrics to visible campaigns", async () => {
    const seed = await seedBundle();
    await request("PUT", "/campaign-daily-metrics", seed.adminId, {
      workspaceId: seed.workspaceId,
      campaignId: seed.campaignAId,
      date: METRIC_DATE,
      cost: "1",
      revenue: "2",
      conversions: 0,
      visits: 1,
    });
    await request("PUT", "/campaign-daily-metrics", seed.adminId, {
      workspaceId: seed.workspaceId,
      campaignId: seed.campaignBId,
      date: METRIC_DATE,
      cost: "3",
      revenue: "4",
      conversions: 0,
      visits: 2,
    });

    const workerView = await request(
      "GET",
      `/campaign-daily-metrics?workspace_id=${seed.workspaceId}&date=${METRIC_DATE}&status=live`,
      seed.workerAId,
    );
    assert.equal(workerView.response.status, 200);
    const items = workerView.json?.items as { campaignId: number }[];
    assert.equal(items.length, 1);
    assert.equal(items[0]!.campaignId, seed.campaignAId);
  });
});
