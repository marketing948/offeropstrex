import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import app from "../app.ts";
import {
  batchTrafficSourceRunsTable,
  campaignsTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  testingBatchesTable,
  todoTasksTable,
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
  return Buffer.from(`${employeeId}:winner-target:offerops_secret`).toString("base64");
}

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

describe("PATCH campaigns clicks → traffic target winner review", { concurrency: false }, () => {
  test("reaches target: campaigns become ready_for_winner_review and review task is created (no auto find_winners)", async () => {
    const workspaceId = (await db.insert(workspacesTable).values({ name: `WT ${Date.now()}`, isActive: false }).returning({ id: workspacesTable.id }))[0]!.id;
    createdWorkspaceIds.push(workspaceId);

    const adminId = (await db.insert(employeesTable).values({ name: "WT Admin", email: `wt-${Date.now()}@example.com`, passwordHash: "x", role: "admin" }).returning({ id: employeesTable.id }))[0]!.id;
    createdEmployeeIds.push(adminId);
    await db.insert(employeeWorkspaceAssignmentsTable).values({ employeeId: adminId, workspaceId, role: "employee" }).onConflictDoNothing();

    const sourceId = (await db.insert(workspaceTrafficSourcesTable).values({ workspaceId, name: "WT Source", position: 1, isActive: true }).returning({ id: workspaceTrafficSourcesTable.id }))[0]!.id;

    const batchId = (await db.insert(testingBatchesTable).values({
      workspaceId,
      employeeId: adminId,
      batchName: "WT Batch",
      affiliateNetwork: "Net",
      geo: "US",
      trafficSource: "WT Source",
      batchTag: `wt_${Date.now()}`,
      numberOfOffers: 10,
      averageVisitsThresholdPerOffer: 10,
    }).returning({ id: testingBatchesTable.id }))[0]!.id;

    const [ios] = await db.insert(campaignsTable).values({
      workspaceId,
      batchId,
      platform: "ios",
      campaignName: "WT iOS",
      trafficSourceId: sourceId,
      status: "live",
      campaignPurpose: "testing",
      liveStartedAt: new Date(),
      clicks: 0,
    }).returning();

    const [android] = await db.insert(campaignsTable).values({
      workspaceId,
      batchId,
      platform: "android",
      campaignName: "WT Android",
      trafficSourceId: sourceId,
      status: "live",
      campaignPurpose: "testing",
      liveStartedAt: new Date(),
      clicks: 0,
    }).returning();

    await db.insert(batchTrafficSourceRunsTable).values({
      workspaceId,
      batchId,
      trafficSourceId: sourceId,
      position: 1,
      status: "active",
      iosStatus: "active",
      androidStatus: "active",
      iosCampaignId: ios.id,
      androidCampaignId: android.id,
      startedAt: new Date(),
      targetAvgVisitsPerOffer: 10,
      offerCount: 10,
    });

    const first = await request("PATCH", `/campaigns/${ios.id}`, adminId, { clicks: 50 });
    assert.equal(first.response.status, 200);
    assert.equal(first.json?.status, "live");

    const second = await request("PATCH", `/campaigns/${android.id}`, adminId, { clicks: 55 });
    assert.equal(second.response.status, 200);

    const [iosAfter] = await db.select({ status: campaignsTable.status }).from(campaignsTable).where(eq(campaignsTable.id, ios.id));
    const [androidAfter] = await db.select({ status: campaignsTable.status }).from(campaignsTable).where(eq(campaignsTable.id, android.id));
    assert.equal(iosAfter?.status, "ready_for_winner_review");
    assert.equal(androidAfter?.status, "ready_for_winner_review");

    const reviewTasks = await db.select().from(todoTasksTable).where(
      and(
        eq(todoTasksTable.workspaceId, workspaceId),
        eq(todoTasksTable.taskType, "review_winners_target"),
      ),
    );
    assert.equal(reviewTasks.length, 1);
    assert.match(String(reviewTasks[0]!.title), /Review winners for/);

    const findWinnersTasks = await db.select().from(todoTasksTable).where(
      and(eq(todoTasksTable.workspaceId, workspaceId), eq(todoTasksTable.taskType, "find_winners")),
    );
    assert.equal(findWinnersTasks.length, 0);
  });
});
