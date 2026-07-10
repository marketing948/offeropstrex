import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import app from "../app.ts";
import {
  campaignsTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  testingBatchesTable,
  workspacesTable,
} from "@workspace/db";
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

let server: Server;
let baseUrl: string;
let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
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
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = { raw: text };
  }
  return { response, json };
}

async function createWorkspace(): Promise<number> {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `Go Live ${Date.now()}`, isActive: false })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(ws.id);
  return ws.id;
}

async function createEmployee(role: "admin" | "employee"): Promise<number> {
  const [emp] = await db
    .insert(employeesTable)
    .values({
      name: `Go Live ${role}`,
      email: `go-live-${role}-${Date.now()}@example.com`,
      passwordHash: "x",
      role,
    })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(emp.id);
  return emp.id;
}

async function assign(employeeId: number, workspaceId: number): Promise<void> {
  await db
    .insert(employeeWorkspaceAssignmentsTable)
    .values({ employeeId, workspaceId, role: "employee" })
    .onConflictDoNothing();
}

async function seedBatchWithReadyCampaigns(numberOfOffers: number | null) {
  const workspaceId = await createWorkspace();
  const adminId = await createEmployee("admin");
  await assign(adminId, workspaceId);

  const [batch] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId,
      employeeId: adminId,
      batchName: "Go Live Batch",
      affiliateNetwork: "Network",
      geo: "US",
      trafficSource: "Source",
      batchTag: `go_live_${Date.now()}`,
      status: "LIVE_TESTS",
      numberOfOffers,
    })
    .returning({ id: testingBatchesTable.id });

  await db.insert(campaignsTable).values([
    {
      workspaceId,
      batchId: batch.id,
      platform: "ios",
      campaignName: "Ready iOS",
      status: "ready",
      campaignPurpose: "testing",
    },
    {
      workspaceId,
      batchId: batch.id,
      platform: "android",
      campaignName: "Ready Android",
      status: "ready",
      campaignPurpose: "testing",
    },
  ]);

  return { workspaceId, adminId, batchId: batch.id };
}

describe("POST /testing-batches/:id/campaigns-go-live", () => {
  test("rejects go-live when numberOfOffers is missing", async () => {
    const seed = await seedBatchWithReadyCampaigns(null);
    const { response, json } = await request(
      "POST",
      `/testing-batches/${seed.batchId}/campaigns-go-live`,
      seed.adminId,
    );
    assert.equal(response.status, 400);
    assert.equal(json?.error, "numberOfOffers is required before campaigns can go live");
  });

  test("allows go-live when numberOfOffers is positive", async () => {
    const seed = await seedBatchWithReadyCampaigns(2);
    const { response } = await request(
      "POST",
      `/testing-batches/${seed.batchId}/campaigns-go-live`,
      seed.adminId,
    );
    assert.equal(response.status, 200);

    const liveCampaigns = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.workspaceId, seed.workspaceId),
          eq(campaignsTable.batchId, seed.batchId),
          eq(campaignsTable.status, "live"),
        ),
      );
    assert.equal(liveCampaigns.length, 2);
  });

  test("go-live backfills offerCount from batch.numberOfOffers", async () => {
    const seed = await seedBatchWithReadyCampaigns(10);
    const { response } = await request(
      "POST",
      `/testing-batches/${seed.batchId}/campaigns-go-live`,
      seed.adminId,
    );
    assert.equal(response.status, 200);

    // Campaigns were seeded WITHOUT offerCount — go-live must populate it from
    // the batch so Live Campaigns / Health / VPO never see a missing count.
    const campaigns = await db
      .select({ id: campaignsTable.id, offerCount: campaignsTable.offerCount })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.workspaceId, seed.workspaceId),
          eq(campaignsTable.batchId, seed.batchId),
        ),
      );
    assert.equal(campaigns.length, 2);
    for (const c of campaigns) {
      assert.equal(c.offerCount, 10);
    }
  });

  test("GET /campaigns backfills offerCount from batch when missing", async () => {
    const seed = await seedBatchWithReadyCampaigns(7);

    // Simulate a legacy campaign that went live WITHOUT offerCount by clearing
    // it after go-live, then confirm the read path repopulates it.
    await request(
      "POST",
      `/testing-batches/${seed.batchId}/campaigns-go-live`,
      seed.adminId,
    );
    await db
      .update(campaignsTable)
      .set({ offerCount: null })
      .where(
        and(
          eq(campaignsTable.workspaceId, seed.workspaceId),
          eq(campaignsTable.batchId, seed.batchId),
        ),
      );

    const { response, json } = await request(
      "GET",
      `/campaigns?workspace_id=${seed.workspaceId}&batch_id=${seed.batchId}`,
      seed.adminId,
    );
    assert.equal(response.status, 200);
    const list = json as unknown as { id: number; offerCount: number | null }[];
    assert.equal(list.length, 2);
    for (const c of list) {
      assert.equal(c.offerCount, 7);
    }

    // And the read-time backfill persisted the value to the DB.
    const persisted = await db
      .select({ offerCount: campaignsTable.offerCount })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.workspaceId, seed.workspaceId),
          eq(campaignsTable.batchId, seed.batchId),
        ),
      );
    for (const c of persisted) {
      assert.equal(c.offerCount, 7);
    }
  });
});
