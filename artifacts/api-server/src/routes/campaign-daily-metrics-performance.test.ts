import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import app from "../app.ts";
import { ensureProductionLiveCampaignSchema } from "../test-utils/ensure-production-live-campaign-schema.ts";
import {
  affiliateNetworksTable,
  campaignsTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  geosTable,
  testingBatchesTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { queryCanonicalEmployeeRevenue } from "../lib/canonical-campaign-actuals.ts";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

const METRIC_DATE = "2026-05-15";
const VOLUUM_ID = "perf-metrics-vol-001";

const CSV_HEADER =
  "Campaign,Campaign tags,Campaign ID,Created,Visits,Conversions,Cost,Revenue,ROI";

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
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { response, json };
}

async function seedCampaignWithVoluum() {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `Perf ${Date.now()}`, isActive: false })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(ws.id);

  const adminId = (
    await db
      .insert(employeesTable)
      .values({
        name: "Perf Admin",
        email: `perf-admin-${Date.now()}@example.com`,
        passwordHash: "x",
        role: "admin",
      })
      .returning({ id: employeesTable.id })
  )[0]!.id;
  createdEmployeeIds.push(adminId);

  await db.insert(employeeWorkspaceAssignmentsTable).values({
    employeeId: adminId,
    workspaceId: ws.id,
    role: "employee",
  }).onConflictDoNothing();

  const sourceId = (
    await db
      .insert(workspaceTrafficSourcesTable)
      .values({
        workspaceId: ws.id,
        name: `Source ${Date.now()}`,
        position: 1,
        isActive: true,
      })
      .returning({ id: workspaceTrafficSourcesTable.id })
  )[0]!.id;

  const [batch] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId: ws.id,
      employeeId: adminId,
      batchName: `Batch ${Date.now()}`,
      affiliateNetwork: "Net",
      geo: "US",
      trafficSource: "FB",
      batchTag: `perf_${Date.now()}`,
    })
    .returning({ id: testingBatchesTable.id });

  const [campaign] = await db
    .insert(campaignsTable)
    .values({
      workspaceId: ws.id,
      batchId: batch.id,
      platform: "ios",
      campaignName: "Perf Campaign",
      trafficSourceId: sourceId,
      status: "live",
      campaignPurpose: "testing",
      voluumCampaignId: VOLUUM_ID,
    })
    .returning({ id: campaignsTable.id });

  return { workspaceId: ws.id, adminId, batchId: batch.id, campaignId: campaign.id };
}

describe("performance and dashboard read campaign_daily_metrics", { concurrency: false }, () => {
  test("GET /performance returns imported daily metrics as clicks/spend", async () => {
    const seed = await seedCampaignWithVoluum();
    const csvText = [CSV_HEADER, `X,,${VOLUUM_ID},2020-01-01,500,25,50,125,0`].join("\n");

    const confirm = await request(
      "POST",
      "/campaign-daily-metrics/voluum-import/confirm",
      seed.adminId,
      { workspaceId: seed.workspaceId, date: METRIC_DATE, csvText },
    );
    assert.equal(confirm.response.status, 200);

    const perf = await request(
      "GET",
      `/performance?workspace_id=${seed.workspaceId}&date_from=${METRIC_DATE}&date_to=${METRIC_DATE}&batch_id=${seed.batchId}`,
      seed.adminId,
    );
    assert.equal(perf.response.status, 200);
    const rows = perf.json as Array<{
      batchId: number;
      date: string;
      clicks: number;
      spend: number;
      revenue: number;
      profit: number;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.batchId, seed.batchId);
    assert.equal(rows[0]!.date, METRIC_DATE);
    assert.equal(rows[0]!.clicks, 500);
    assert.equal(rows[0]!.spend, 50);
    assert.equal(rows[0]!.revenue, 125);
    assert.equal(rows[0]!.profit, 75);
  });

  test("GET /dashboard/admin-summary financial totals use imported metrics", async () => {
    const seed = await seedCampaignWithVoluum();
    const csvText = [CSV_HEADER, `X,,${VOLUUM_ID},2020-01-01,1000,10,100,300,0`].join("\n");

    await request(
      "POST",
      "/campaign-daily-metrics/voluum-import/confirm",
      seed.adminId,
      { workspaceId: seed.workspaceId, date: METRIC_DATE, csvText },
    );

    const summary = await request(
      "GET",
      `/dashboard/admin-summary?workspace_id=${seed.workspaceId}&date_from=${METRIC_DATE}&date_to=${METRIC_DATE}`,
      seed.adminId,
    );
    assert.equal(summary.response.status, 200);
    const body = summary.json as { totalSpend: number; totalRevenue: number; totalProfit: number };
    assert.equal(body.totalSpend, 100);
    assert.equal(body.totalRevenue, 300);
    assert.equal(body.totalProfit, 200);
  });

  test("GET /dashboard/breakdowns uses weekly metrics window with clicks from visits", async () => {
    const seed = await seedCampaignWithVoluum();
    const csvText = [CSV_HEADER, `X,,${VOLUUM_ID},2020-01-01,200,4,20,60,0`].join("\n");

    await request(
      "POST",
      "/campaign-daily-metrics/voluum-import/confirm",
      seed.adminId,
      { workspaceId: seed.workspaceId, date: METRIC_DATE, csvText },
    );

    const breakdowns = await request(
      "GET",
      `/dashboard/breakdowns?workspace_id=${seed.workspaceId}&date_from=${METRIC_DATE}&date_to=${METRIC_DATE}`,
      seed.adminId,
    );
    assert.equal(breakdowns.response.status, 200);
    const body = breakdowns.json as {
      byWorker: Array<{ clicks: number; cost: number; revenue: number }>;
    };
    const workerRow = body.byWorker.find((r) => r.clicks > 0);
    assert.ok(workerRow);
    assert.equal(workerRow!.clicks, 200);
    assert.equal(workerRow!.cost, 20);
    assert.equal(workerRow!.revenue, 60);
  });

  test("GET /performance includes manual working campaign revenue without batch_id", async () => {
    const [ws] = await db
      .insert(workspacesTable)
      .values({ name: `Perf Manual ${Date.now()}`, isActive: false })
      .returning({ id: workspacesTable.id });
    createdWorkspaceIds.push(ws.id);

    const workerId = (
      await db
        .insert(employeesTable)
        .values({
          name: "Perf Worker",
          email: `perf-worker-${Date.now()}@example.com`,
          passwordHash: "x",
          role: "employee",
        })
        .returning({ id: employeesTable.id })
    )[0]!.id;
    createdEmployeeIds.push(workerId);

    await db.insert(employeeWorkspaceAssignmentsTable).values({
      employeeId: workerId,
      workspaceId: ws.id,
      role: "employee",
    }).onConflictDoNothing();

    const adminId = (
      await db
        .insert(employeesTable)
        .values({
          name: "Perf Admin 2",
          email: `perf-admin2-${Date.now()}@example.com`,
          passwordHash: "x",
          role: "admin",
        })
        .returning({ id: employeesTable.id })
    )[0]!.id;
    createdEmployeeIds.push(adminId);

    await db.insert(employeeWorkspaceAssignmentsTable).values({
      employeeId: adminId,
      workspaceId: ws.id,
      role: "employee",
    }).onConflictDoNothing();

    const sourceId = (
      await db
        .insert(workspaceTrafficSourcesTable)
        .values({
          workspaceId: ws.id,
          name: `Manual Source ${Date.now()}`,
          position: 1,
          isActive: true,
        })
        .returning({ id: workspaceTrafficSourcesTable.id })
    )[0]!.id;

    const networkId = (
      await db
        .insert(affiliateNetworksTable)
        .values({ workspaceId: ws.id, name: "Manual Net" })
        .returning({ id: affiliateNetworksTable.id })
    )[0]!.id;

    const geoId = (
      await db
        .insert(geosTable)
        .values({ workspaceId: ws.id, code: "US", name: "United States" })
        .returning({ id: geosTable.id })
    )[0]!.id;

    const manualVoluum = `perf-manual-${Date.now()}`;
    await db.insert(campaignsTable).values({
      workspaceId: ws.id,
      batchId: null,
      platform: "ios",
      campaignName: "Manual Working",
      trafficSourceId: sourceId,
      status: "live",
      campaignPurpose: "working",
      voluumCampaignId: manualVoluum,
      affiliateNetworkId: networkId,
      geoId,
      geo: "US",
      createdByEmployeeId: workerId,
      liveStartedAt: new Date(),
    });

    const csvText = [CSV_HEADER, `Manual,,${manualVoluum},2020-01-01,300,10,30,180,0`].join("\n");
    const confirm = await request(
      "POST",
      "/campaign-daily-metrics/voluum-import/confirm",
      adminId,
      { workspaceId: ws.id, date: METRIC_DATE, csvText, override: true },
    );
    assert.equal(confirm.response.status, 200);

    const perf = await request(
      "GET",
      `/performance?workspace_id=${ws.id}&date_from=${METRIC_DATE}&date_to=${METRIC_DATE}`,
      adminId,
    );
    assert.equal(perf.response.status, 200);
    const rows = perf.json as Array<{ campaignId: number; batchId: number | null; revenue: number }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.batchId, null);
    assert.equal(rows[0]!.revenue, 180);

    const canonical = await queryCanonicalEmployeeRevenue(ws.id, {
      dateFrom: METRIC_DATE,
      dateTo: METRIC_DATE,
    });
    assert.equal(canonical.get(workerId)?.revenue, 180);
    assert.equal(canonical.get(adminId)?.revenue ?? 0, 0);
  });

  test("GET /dashboard/breakdowns includes manual and batch-linked campaign revenue", async () => {
    const [ws] = await db
      .insert(workspacesTable)
      .values({ name: `Dash ${Date.now()}`, isActive: false })
      .returning({ id: workspacesTable.id });
    createdWorkspaceIds.push(ws.id);

    const workerId = (
      await db
        .insert(employeesTable)
        .values({
          name: "Dash Worker",
          email: `dash-worker-${Date.now()}@example.com`,
          passwordHash: "x",
          role: "employee",
        })
        .returning({ id: employeesTable.id })
    )[0]!.id;
    createdEmployeeIds.push(workerId);

    await db.insert(employeeWorkspaceAssignmentsTable).values({
      employeeId: workerId,
      workspaceId: ws.id,
      role: "employee",
    }).onConflictDoNothing();

    const adminId = (
      await db
        .insert(employeesTable)
        .values({
          name: "Dash Admin",
          email: `dash-admin-${Date.now()}@example.com`,
          passwordHash: "x",
          role: "admin",
        })
        .returning({ id: employeesTable.id })
    )[0]!.id;
    createdEmployeeIds.push(adminId);

    await db.insert(employeeWorkspaceAssignmentsTable).values({
      employeeId: adminId,
      workspaceId: ws.id,
      role: "employee",
    }).onConflictDoNothing();

    const sourceId = (
      await db
        .insert(workspaceTrafficSourcesTable)
        .values({
          workspaceId: ws.id,
          name: "Dash Source",
          position: 1,
          isActive: true,
        })
        .returning({ id: workspaceTrafficSourcesTable.id })
    )[0]!.id;

    const networkId = (
      await db
        .insert(affiliateNetworksTable)
        .values({ workspaceId: ws.id, name: "Dash Net" })
        .returning({ id: affiliateNetworksTable.id })
    )[0]!.id;

    const geoId = (
      await db
        .insert(geosTable)
        .values({ workspaceId: ws.id, code: "US", name: "United States" })
        .returning({ id: geosTable.id })
    )[0]!.id;

    const [batch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId: ws.id,
        employeeId: workerId,
        batchName: "Dash Batch",
        affiliateNetwork: "Dash Net",
        geo: "US",
        trafficSource: "Dash Source",
        batchTag: `dash_${Date.now()}`,
        affiliateNetworkId: networkId,
        geoId,
      })
      .returning({ id: testingBatchesTable.id });

    const batchVoluum = `dash-batch-${Date.now()}`;
    const manualVoluum = `dash-manual-${Date.now()}`;

    await db.insert(campaignsTable).values({
      workspaceId: ws.id,
      batchId: batch!.id,
      platform: "ios",
      campaignName: "Batch Campaign",
      trafficSourceId: sourceId,
      status: "live",
      campaignPurpose: "testing",
      voluumCampaignId: batchVoluum,
      affiliateNetworkId: networkId,
      geoId,
      geo: "US",
      createdByEmployeeId: workerId,
    });

    await db.insert(campaignsTable).values({
      workspaceId: ws.id,
      batchId: null,
      platform: "android",
      campaignName: "Manual Campaign",
      trafficSourceId: sourceId,
      status: "live",
      campaignPurpose: "working",
      voluumCampaignId: manualVoluum,
      affiliateNetworkId: networkId,
      geoId,
      geo: "US",
      createdByEmployeeId: workerId,
      liveStartedAt: new Date(),
    });

    const csvText = [
      CSV_HEADER,
      `Batch,,${batchVoluum},2020-01-01,100,5,10,40,0`,
      `Manual,,${manualVoluum},2020-01-01,200,8,20,80,0`,
    ].join("\n");

    const confirm = await request(
      "POST",
      "/campaign-daily-metrics/voluum-import/confirm",
      adminId,
      { workspaceId: ws.id, date: METRIC_DATE, csvText, override: true },
    );
    assert.equal(confirm.response.status, 200);

    const breakdowns = await request(
      "GET",
      `/dashboard/breakdowns?workspace_id=${ws.id}&date_from=${METRIC_DATE}&date_to=${METRIC_DATE}`,
      adminId,
    );
    assert.equal(breakdowns.response.status, 200);
    const body = breakdowns.json as {
      byWorker: Array<{ key: string; revenue: number }>;
      byNetwork: Array<{ key: string; label: string; revenue: number }>;
      byGeo: Array<{ key: string; revenue: number }>;
    };

    const teamRevenue = body.byWorker.reduce((s, r) => s + r.revenue, 0);
    assert.equal(teamRevenue, 120);

    const workerRow = body.byWorker.find((r) => r.key === String(workerId));
    assert.ok(workerRow);
    assert.equal(workerRow!.revenue, 120);

    const networkRow = body.byNetwork.find((r) => r.label === "Dash Net");
    assert.ok(networkRow);
    assert.equal(networkRow!.revenue, 120);

    const geoRow = body.byGeo.find((r) => r.key === "US");
    assert.ok(geoRow);
    assert.equal(geoRow!.revenue, 120);
  });
});
