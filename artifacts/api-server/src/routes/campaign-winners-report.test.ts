import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import app from "../app.ts";
import {
  campaignWinnersTable,
  campaignsTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  testingBatchesTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { ensureProductionLiveCampaignSchema } from "../test-utils/ensure-production-live-campaign-schema.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  await ensureProductionLiveCampaignSchema();
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
  return Buffer.from(`${employeeId}:cw-report:offerops_secret`).toString("base64");
}

async function getReport(employeeId: number, workspaceId: number) {
  const response = await fetch(`${baseUrl}/reports/campaign-winners?workspace_id=${workspaceId}`, {
    headers: { authorization: `Bearer ${authToken(employeeId)}` },
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, json };
}

describe("GET /reports/campaign-winners", { concurrency: false }, () => {
  test("returns winner rows with offer IDs for the workspace", async () => {
    const workspaceId = (await db.insert(workspacesTable).values({ name: `CW ${Date.now()}`, isActive: false }).returning({ id: workspacesTable.id }))[0]!.id;
    createdWorkspaceIds.push(workspaceId);

    const adminId = (await db.insert(employeesTable).values({ name: "CW Admin", email: `cw-${Date.now()}@example.com`, passwordHash: "x", role: "admin" }).returning({ id: employeesTable.id }))[0]!.id;
    createdEmployeeIds.push(adminId);
    await db.insert(employeeWorkspaceAssignmentsTable).values({ employeeId: adminId, workspaceId, role: "employee" }).onConflictDoNothing();

    const sourceId = (await db.insert(workspaceTrafficSourcesTable).values({ workspaceId, name: "CW Source", position: 1, isActive: true }).returning({ id: workspaceTrafficSourcesTable.id }))[0]!.id;

    const batchId = (await db.insert(testingBatchesTable).values({
      workspaceId,
      employeeId: adminId,
      batchName: "CW Batch",
      affiliateNetwork: "Net",
      geo: "US",
      trafficSource: "CW Source",
      batchTag: `cw_${Date.now()}`,
    }).returning({ id: testingBatchesTable.id }))[0]!.id;

    const [campaign] = await db.insert(campaignsTable).values({
      workspaceId,
      batchId,
      platform: "ios",
      campaignName: "CW Campaign",
      trafficSourceId: sourceId,
      status: "tested",
      campaignPurpose: "testing",
    }).returning();

    await db.insert(campaignWinnersTable).values({
      workspaceId,
      batchId,
      campaignId: campaign.id,
      trafficSourceId: sourceId,
      platform: "ios",
      offerId: "cafe0001-0002-4003-8004-000000099001",
      source: "manual_close",
      detectedByEmployeeId: adminId,
      notes: "from test",
    });

    const { response, json } = await getReport(adminId, workspaceId);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(json));
    const rows = json as { offerId: string; sourceLabel: string; campaignName: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.offerId, "cafe0001-0002-4003-8004-000000099001");
    assert.equal(rows[0]!.sourceLabel, "Manual close");
    assert.equal(rows[0]!.campaignName, "CW Campaign");
  });
});
