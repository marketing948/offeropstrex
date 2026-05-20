import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import app from "../app.ts";
import { ensureProductionLiveCampaignSchema } from "../test-utils/ensure-production-live-campaign-schema.ts";
import {
  affiliateNetworksTable,
  batchTrafficSourceRunsTable,
  campaignWinnersTable,
  campaignsTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  eventsTable,
  geosTable,
  operationalEventsTable,
  testingBatchesTable,
  todoTasksTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";

const SAMPLE_WIN_A = "3d1ef3ff-01e2-4340-a029-ec28275f50b4";
const SAMPLE_WIN_B = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";

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
  return Buffer.from(`${employeeId}:manual-close:offerops_secret`).toString("base64");
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

async function seedWorkspaceBundle() {
  const workspaceId = (await db.insert(workspacesTable).values({ name: `MC ${Date.now()}`, isActive: false }).returning({ id: workspacesTable.id }))[0]!.id;
  createdWorkspaceIds.push(workspaceId);

  const adminId = (await db.insert(employeesTable).values({ name: "MC Admin", email: `mc-admin-${Date.now()}@example.com`, passwordHash: "x", role: "admin" }).returning({ id: employeesTable.id }))[0]!.id;
  const workerId = (await db.insert(employeesTable).values({ name: "MC Worker", email: `mc-worker-${Date.now()}@example.com`, passwordHash: "x", role: "employee" }).returning({ id: employeesTable.id }))[0]!.id;
  const otherWorkerId = (await db.insert(employeesTable).values({ name: "MC Other", email: `mc-other-${Date.now()}@example.com`, passwordHash: "x", role: "employee" }).returning({ id: employeesTable.id }))[0]!.id;
  createdEmployeeIds.push(adminId, workerId, otherWorkerId);

  for (const empId of [adminId, workerId, otherWorkerId]) {
    await db.insert(employeeWorkspaceAssignmentsTable).values({ employeeId: empId, workspaceId, role: "employee" }).onConflictDoNothing();
  }

  const sourceId = (await db.insert(workspaceTrafficSourcesTable).values({ workspaceId, name: "MC Source", position: 1, isActive: true }).returning({ id: workspaceTrafficSourcesTable.id }))[0]!.id;
  const networkId = (await db.insert(affiliateNetworksTable).values({ workspaceId, name: "MC Network", isActive: true }).returning({ id: affiliateNetworksTable.id }))[0]!.id;
  const geoId = (await db.insert(geosTable).values({ workspaceId, code: "US", name: "United States", isActive: true }).returning({ id: geosTable.id }))[0]!.id;

  return { workspaceId, adminId, workerId, otherWorkerId, sourceId, networkId, geoId };
}

async function seedTestingCampaign(seed: Awaited<ReturnType<typeof seedWorkspaceBundle>>) {
  const batchId = (await db.insert(testingBatchesTable).values({
    workspaceId: seed.workspaceId,
    employeeId: seed.workerId,
    batchName: "MC Batch",
    affiliateNetwork: "MC Network",
    affiliateNetworkId: seed.networkId,
    geo: "US",
    geoId: seed.geoId,
    trafficSource: "MC Source",
    batchTag: `mc_${Date.now()}`,
  }).returning({ id: testingBatchesTable.id }))[0]!.id;

  const [campaign] = await db.insert(campaignsTable).values({
    workspaceId: seed.workspaceId,
    batchId,
    platform: "ios",
    campaignName: "MC Testing iOS",
    trafficSourceId: seed.sourceId,
    status: "live",
    campaignPurpose: "testing",
    liveStartedAt: new Date(),
  }).returning();

  const [run] = await db.insert(batchTrafficSourceRunsTable).values({
    workspaceId: seed.workspaceId,
    batchId,
    trafficSourceId: seed.sourceId,
    position: 1,
    status: "active",
    iosStatus: "active",
    androidStatus: "pending",
    iosCampaignId: campaign.id,
    startedAt: new Date(),
  }).returning();

  return { batchId, campaign, run };
}

async function createWorkingCampaign(
  seed: Awaited<ReturnType<typeof seedWorkspaceBundle>>,
  voluumId: string,
) {
  const { response, json } = await request("POST", "/production-live-campaigns", seed.adminId, {
    workspaceId: seed.workspaceId,
    campaignName: `Working ${voluumId}`,
    campaignPurpose: "working",
    platform: "ios",
    trafficSourceId: seed.sourceId,
    affiliateNetworkId: seed.networkId,
    geoId: seed.geoId,
    voluumCampaignId: voluumId,
    campaignUrl: `https://voluum.example/${voluumId}`,
  });
  assert.equal(response.status, 201);
  return json!;
}

describe("POST /campaigns/:id/manual-close", { concurrency: false }, () => {
  test("admin can manually close testing campaign with opened_by_mistake", async () => {
    const seed = await seedWorkspaceBundle();
    const { campaign, run } = await seedTestingCampaign(seed);

    const { response, json } = await request("POST", `/campaigns/${campaign.id}/manual-close`, seed.adminId, {
      reason: "opened_by_mistake",
      note: "Wrong batch",
    });

    assert.equal(response.status, 200);
    assert.equal(json?.status, "closed");
    assert.equal(json?.closeSource, "manual");
    assert.equal(json?.manualCloseReason, "opened_by_mistake");
    assert.equal(json?.manualCloseNote, "Wrong batch");
    assert.equal(json?.manualClosedByEmployeeId, seed.adminId);
    assert.ok(json?.manualClosedAt);

    const [runAfter] = await db.select().from(batchTrafficSourceRunsTable).where(eq(batchTrafficSourceRunsTable.id, run.id));
    assert.equal(runAfter.iosStatus, "failed");

    const tasks = await db.select().from(todoTasksTable).where(eq(todoTasksTable.workspaceId, seed.workspaceId));
    assert.equal(tasks.length, 0);

    const workflowEvents = await db.select().from(eventsTable).where(eq(eventsTable.workspaceId, seed.workspaceId));
    assert.equal(workflowEvents.length, 0);
  });

  test("production manual close does not touch batch runs or CampaignOps tasks", async () => {
    const seed = await seedWorkspaceBundle();
    const { campaign, run } = await seedTestingCampaign(seed);
    const working = await createWorkingCampaign(seed, `vc-prod-close-${Date.now()}`);

    const { response } = await request("POST", `/campaigns/${working.id}/manual-close`, seed.adminId, {
      reason: "technical_issue",
    });
    assert.equal(response.status, 200);

    const [runAfter] = await db.select().from(batchTrafficSourceRunsTable).where(eq(batchTrafficSourceRunsTable.id, run.id));
    assert.equal(runAfter.iosStatus, run.iosStatus);

    const tasks = await db.select().from(todoTasksTable).where(
      and(eq(todoTasksTable.workspaceId, seed.workspaceId), eq(todoTasksTable.taskType, "find_winners")),
    );
    assert.equal(tasks.length, 0);
  });

  test("no_traffic_dead_campaign marks testing platform run failed", async () => {
    const seed = await seedWorkspaceBundle();
    const { campaign, run } = await seedTestingCampaign(seed);

    const { response } = await request("POST", `/campaigns/${campaign.id}/manual-close`, seed.adminId, {
      reason: "no_traffic_dead_campaign",
    });
    assert.equal(response.status, 200);

    const [runAfter] = await db.select().from(batchTrafficSourceRunsTable).where(eq(batchTrafficSourceRunsTable.id, run.id));
    assert.equal(runAfter.iosStatus, "failed");
  });

  test("winners_found creates follow-up task when working campaign exists", async () => {
    const seed = await seedWorkspaceBundle();
    const { campaign } = await seedTestingCampaign(seed);
    const working = await createWorkingCampaign(seed, `vc-working-win-${Date.now()}`);

    const { response, json } = await request("POST", `/campaigns/${campaign.id}/manual-close`, seed.adminId, {
      reason: "winners_found",
      winnerOfferIds: [SAMPLE_WIN_A, SAMPLE_WIN_B],
    });

    assert.equal(response.status, 200);
    assert.equal(json?.missingWorkingCampaign, false);
    assert.equal(json?.targetWorkingCampaignId, working.id);

    const tasks = await db.select().from(todoTasksTable).where(
      and(eq(todoTasksTable.workspaceId, seed.workspaceId), eq(todoTasksTable.taskType, "MANUAL")),
    );
    assert.equal(tasks.length, 1);
    assert.match(tasks[0]!.title, /Move winners from .+ to working campaign/);
    assert.match(tasks[0]!.description ?? "", /---offerops-winner-handoff---/);
    assert.match(
      tasks[0]!.description ?? "",
      new RegExp(
        `"winnerOfferIds":\\["${SAMPLE_WIN_A}","${SAMPLE_WIN_B}"\\]`,
      ),
    );

    const cw = await db.select().from(campaignWinnersTable).where(eq(campaignWinnersTable.campaignId, campaign.id));
    assert.equal(cw.length, 2);
    assert.ok(cw.some((w) => w.offerId === SAMPLE_WIN_A));
    assert.ok(cw.some((w) => w.offerId === SAMPLE_WIN_B));
    assert.ok(cw.every((w) => w.source === "manual_close"));
  });

  test("winners_found rejects invalid Voluum offer ID format before closing", async () => {
    const seed = await seedWorkspaceBundle();
    const { campaign } = await seedTestingCampaign(seed);
    await createWorkingCampaign(seed, `vc-invalid-offer-${Date.now()}`);

    const before = await db.select({ status: campaignsTable.status }).from(campaignsTable).where(eq(campaignsTable.id, campaign.id));
    assert.equal(before[0]?.status, "live");

    const { response, json } = await request("POST", `/campaigns/${campaign.id}/manual-close`, seed.adminId, {
      reason: "winners_found",
      winnerOfferIds: [SAMPLE_WIN_A, "not-a-uuid"],
    });

    assert.equal(response.status, 400);
    assert.equal(json?.error, "Invalid Voluum offer ID format");

    const after = await db.select({ status: campaignsTable.status }).from(campaignsTable).where(eq(campaignsTable.id, campaign.id));
    assert.equal(after[0]?.status, "live");

    const cw = await db.select().from(campaignWinnersTable).where(eq(campaignWinnersTable.campaignId, campaign.id));
    assert.equal(cw.length, 0);
  });
  test("winners_found signals missing working campaign and creates setup task", async () => {
    const seed = await seedWorkspaceBundle();
    const { campaign } = await seedTestingCampaign(seed);

    const { response, json } = await request("POST", `/campaigns/${campaign.id}/manual-close`, seed.adminId, {
      reason: "winners_found",
    });

    assert.equal(response.status, 200);
    assert.equal(json?.missingWorkingCampaign, true);
    assert.equal(json?.targetWorkingCampaignId, null);

    const tasks = await db.select().from(todoTasksTable).where(
      and(eq(todoTasksTable.workspaceId, seed.workspaceId), eq(todoTasksTable.taskType, "MANUAL")),
    );
    assert.equal(tasks.length, 1);
    assert.match(tasks[0]!.title, /Create\/find working campaign and move winners from/);
  });

  test("emits CAMPAIGN_MANUALLY_CLOSED operational event", async () => {
    const seed = await seedWorkspaceBundle();
    const { campaign } = await seedTestingCampaign(seed);

    const { response, json } = await request("POST", `/campaigns/${campaign.id}/manual-close`, seed.adminId, {
      reason: "technical_issue",
    });
    assert.equal(response.status, 200);

    const [opEvent] = await db.select().from(operationalEventsTable).where(
      and(
        eq(operationalEventsTable.workspaceId, seed.workspaceId),
        eq(operationalEventsTable.eventType, "CAMPAIGN_MANUALLY_CLOSED"),
        eq(operationalEventsTable.entityId, String(json?.id)),
      ),
    );
    assert.ok(opEvent);
  });

  test("cross-workspace manual close is rejected", async () => {
    const seedA = await seedWorkspaceBundle();
    const seedB = await seedWorkspaceBundle();
    const { campaign } = await seedTestingCampaign(seedA);

    const { response } = await request("POST", `/campaigns/${campaign.id}/manual-close`, seedB.adminId, {
      reason: "opened_by_mistake",
    });
    assert.equal(response.status, 403);
  });

  test("worker cannot close another workers testing campaign", async () => {
    const seed = await seedWorkspaceBundle();
    const { campaign } = await seedTestingCampaign(seed);

    const { response } = await request("POST", `/campaigns/${campaign.id}/manual-close`, seed.otherWorkerId, {
      reason: "opened_by_mistake",
    });
    assert.equal(response.status, 403);
  });

  test("batch worker can close their testing campaign", async () => {
    const seed = await seedWorkspaceBundle();
    const { campaign } = await seedTestingCampaign(seed);

    const { response } = await request("POST", `/campaigns/${campaign.id}/manual-close`, seed.workerId, {
      reason: "opened_by_mistake",
    });
    assert.equal(response.status, 200);
  });

  test("PATCH status path remains blocked for production campaigns", async () => {
    const seed = await seedWorkspaceBundle();
    const working = await createWorkingCampaign(seed, `vc-patch-guard-${Date.now()}`);

    const { response } = await request("PATCH", `/campaigns/${working.id}`, seed.adminId, {
      status: "tested",
    });
    assert.equal(response.status, 400);
  });
});
