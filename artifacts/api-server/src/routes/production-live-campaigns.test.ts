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
import { testAuthToken as authToken } from "../lib/test-auth-token.ts";

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
    .values({ name: `PL ${Date.now()}`, isActive: false })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(ws.id);
  return ws.id;
}

async function createEmployee(role: "admin" | "employee"): Promise<number> {
  const [emp] = await db
    .insert(employeesTable)
    .values({
      name: `PL ${role}`,
      email: `pl-${role}-${Date.now()}@example.com`,
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

async function seedWorkspaceWithSource() {
  const workspaceId = await createWorkspace();
  const adminId = await createEmployee("admin");
  const workerId = await createEmployee("employee");
  await assign(adminId, workspaceId);
  await assign(workerId, workspaceId);

  const [source] = await db
    .insert(workspaceTrafficSourcesTable)
    .values({ workspaceId, name: `Source ${Date.now()}`, position: 1, isActive: true })
    .returning({ id: workspaceTrafficSourcesTable.id });

  const [network] = await db
    .insert(affiliateNetworksTable)
    .values({ workspaceId, name: `Network ${Date.now()}`, isActive: true })
    .returning({ id: affiliateNetworksTable.id });

  const [geo] = await db
    .insert(geosTable)
    .values({ workspaceId, code: "US", name: "United States", isActive: true })
    .returning({ id: geosTable.id });

  return {
    workspaceId,
    adminId,
    workerId,
    sourceId: source.id,
    networkId: network.id,
    geoId: geo.id,
  };
}

function workingBody(
  seed: { workspaceId: number; sourceId: number; networkId: number; geoId: number },
  voluumId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    workspaceId: seed.workspaceId,
    campaignName: `Working ${voluumId}`,
    campaignPurpose: "working",
    platform: "ios",
    trafficSourceId: seed.sourceId,
    affiliateNetworkId: seed.networkId,
    geoId: seed.geoId,
    voluumCampaignId: voluumId,
    campaignUrl: `https://voluum.example/${voluumId}`,
    ...overrides,
  };
}

describe("POST /production-live-campaigns", { concurrency: false }, () => {
  test("admin can create working live campaign without batchId", async () => {
    const seed = await seedWorkspaceWithSource();
    const voluumId = `vc-working-${Date.now()}`;
    const { response, json } = await request(
      "POST",
      "/production-live-campaigns",
      seed.adminId,
      workingBody(seed, voluumId),
    );

    assert.equal(response.status, 201);
    assert.equal(json?.status, "live");
    assert.equal(json?.campaignPurpose, "working");
    assert.equal(json?.voluumCampaignId, voluumId);
    assert.equal(json?.batchId, null);

    const [row] = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.id, json?.id as number));
    assert.equal(row.batchId, null);
    assert.equal(row.campaignPurpose, "working");
    assert.ok(row.liveStartedAt);

    const liveList = await request(
      "GET",
      `/live-campaigns?workspace_id=${seed.workspaceId}&status=live`,
      seed.adminId,
    );
    assert.equal(liveList.response.status, 200);
    const items = (liveList.json?.items as { id: number }[]) ?? [];
    assert.ok(items.some((c) => c.id === json?.id));
  });

  test("admin can create scaling campaign with parentCampaignId", async () => {
    const seed = await seedWorkspaceWithSource();
    const parentVoluum = `vc-parent-${Date.now()}`;
    const parent = await request(
      "POST",
      "/production-live-campaigns",
      seed.adminId,
      workingBody(seed, parentVoluum),
    );
    assert.equal(parent.response.status, 201);

    const childVoluum = `vc-scale-${Date.now()}`;
    const { response, json } = await request("POST", "/production-live-campaigns", seed.adminId, {
      workspaceId: seed.workspaceId,
      campaignPurpose: "scaling",
      campaignName: "Scaled variant",
      parentCampaignId: parent.json?.id,
      voluumCampaignId: childVoluum,
      campaignUrl: `https://voluum.example/${childVoluum}`,
    });
    assert.equal(response.status, 201);
    assert.equal(json?.campaignPurpose, "scaling");
    assert.equal(json?.parentCampaignId, parent.json?.id);
    assert.equal(json?.platform, parent.json?.platform);
    assert.equal(json?.trafficSourceId, parent.json?.trafficSourceId);
    assert.equal(json?.affiliateNetworkId, parent.json?.affiliateNetworkId);
    assert.equal(json?.geoId, parent.json?.geoId);
  });

  test("working campaign requires affiliateNetworkId and geoId", async () => {
    const seed = await seedWorkspaceWithSource();
    const base = workingBody(seed, `vc-missing-fields-${Date.now()}`);

    const { affiliateNetworkId: _network, ...withoutNetwork } = base;
    const noNetwork = await request("POST", "/production-live-campaigns", seed.adminId, withoutNetwork);
    assert.equal(noNetwork.response.status, 400);

    const { geoId: _geo, ...withoutGeo } = base;
    const noGeo = await request("POST", "/production-live-campaigns", seed.adminId, withoutGeo);
    assert.equal(noGeo.response.status, 400);
  });

  test("duplicate live working campaign slot returns 409", async () => {
    const seed = await seedWorkspaceWithSource();
    const first = await request(
      "POST",
      "/production-live-campaigns",
      seed.adminId,
      workingBody(seed, `vc-slot-a-${Date.now()}`),
    );
    assert.equal(first.response.status, 201);

    const second = await request(
      "POST",
      "/production-live-campaigns",
      seed.adminId,
      workingBody(seed, `vc-slot-b-${Date.now()}`),
    );
    assert.equal(second.response.status, 409);
  });

  test("closed working campaign does not block a new live working in the same slot", async () => {
    const seed = await seedWorkspaceWithSource();
    const voluumA = `vc-closed-slot-${Date.now()}`;
    const first = await request(
      "POST",
      "/production-live-campaigns",
      seed.adminId,
      workingBody(seed, voluumA),
    );
    assert.equal(first.response.status, 201);

    await db
      .update(campaignsTable)
      .set({ status: "closed" })
      .where(eq(campaignsTable.id, first.json?.id as number));

    const second = await request(
      "POST",
      "/production-live-campaigns",
      seed.adminId,
      workingBody(seed, `${voluumA}-replacement`),
    );
    assert.equal(second.response.status, 201);
    assert.equal(second.json?.status, "live");
  });

  test("scaling rejects metadata that conflicts with parent", async () => {
    const seed = await seedWorkspaceWithSource();
    const parent = await request(
      "POST",
      "/production-live-campaigns",
      seed.adminId,
      workingBody(seed, `vc-scale-parent-${Date.now()}`),
    );
    assert.equal(parent.response.status, 201);

    const { response, json } = await request("POST", "/production-live-campaigns", seed.adminId, {
      workspaceId: seed.workspaceId,
      campaignPurpose: "scaling",
      campaignName: "Bad scaling",
      parentCampaignId: parent.json?.id,
      platform: "android",
      voluumCampaignId: `vc-scale-bad-${Date.now()}`,
      campaignUrl: "https://voluum.example/bad",
    });
    assert.equal(response.status, 400);
    assert.equal(json?.error, "scaling campaign platform must match parent working campaign");
  });

  test("cross-workspace parentCampaignId is rejected", async () => {
    const seedA = await seedWorkspaceWithSource();
    const seedB = await seedWorkspaceWithSource();
    const parent = await request(
      "POST",
      "/production-live-campaigns",
      seedA.adminId,
      workingBody(seedA, `vc-parent-ws-a-${Date.now()}`),
    );
    assert.equal(parent.response.status, 201);

    const { response } = await request("POST", "/production-live-campaigns", seedB.adminId, {
      workspaceId: seedB.workspaceId,
      campaignPurpose: "scaling",
      campaignName: "Wrong workspace parent",
      parentCampaignId: parent.json?.id,
      voluumCampaignId: `vc-scale-wrong-ws-${Date.now()}`,
      campaignUrl: "https://voluum.example/wrong-ws",
    });
    assert.equal(response.status, 400);
  });

  test("scaling parent must be working, not another scaling campaign", async () => {
    const seed = await seedWorkspaceWithSource();
    const workingParent = await request(
      "POST",
      "/production-live-campaigns",
      seed.adminId,
      workingBody(seed, `vc-working-parent-${Date.now()}`),
    );
    assert.equal(workingParent.response.status, 201);

    const scalingParent = await request("POST", "/production-live-campaigns", seed.adminId, {
      ...workingBody(seed, `vc-scaling-parent-${Date.now()}`),
      campaignPurpose: "scaling",
      campaignName: "First scaling",
      parentCampaignId: workingParent.json?.id,
    });
    assert.equal(scalingParent.response.status, 201);

    const { response, json } = await request("POST", "/production-live-campaigns", seed.adminId, {
      ...workingBody(seed, `vc-scaling-child-${Date.now()}`),
      campaignPurpose: "scaling",
      campaignName: "Nested scaling attempt",
      parentCampaignId: scalingParent.json?.id,
    });
    assert.equal(response.status, 400);
    assert.equal(json?.error, "parentCampaignId must reference a working campaign");
  });

  test("voluumCampaignId is required", async () => {
    const seed = await seedWorkspaceWithSource();
    const { response } = await request("POST", "/production-live-campaigns", seed.adminId, {
      ...workingBody(seed, "ignored"),
      voluumCampaignId: "  ",
    });
    assert.equal(response.status, 400);
  });

  test("duplicate voluumCampaignId in same workspace is rejected", async () => {
    const seed = await seedWorkspaceWithSource();
    const voluumId = `vc-dup-prod-${Date.now()}`;
    const first = await request(
      "POST",
      "/production-live-campaigns",
      seed.adminId,
      workingBody(seed, voluumId),
    );
    assert.equal(first.response.status, 201);

    const second = await request("POST", "/production-live-campaigns", seed.adminId, {
      ...workingBody(seed, voluumId),
      campaignName: "Duplicate attempt",
    });
    assert.equal(second.response.status, 409);
  });

  test("no CampaignOps tasks or batch run mutations", async () => {
    const seed = await seedWorkspaceWithSource();
    const [batch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId: seed.workspaceId,
        employeeId: seed.adminId,
        batchName: "Ops batch",
        affiliateNetwork: "Net",
        geo: "DE",
        trafficSource: "Source",
        batchTag: `ops_${Date.now()}`,
      })
      .returning({ id: testingBatchesTable.id });

    const [runBefore] = await db
      .insert(batchTrafficSourceRunsTable)
      .values({
        workspaceId: seed.workspaceId,
        batchId: batch.id,
        trafficSourceId: seed.sourceId,
        position: 1,
        status: "active",
        iosStatus: "active",
        androidStatus: "pending",
        startedAt: new Date(),
      })
      .returning();

    const voluumId = `vc-side-effect-${Date.now()}`;
    const { response, json } = await request(
      "POST",
      "/production-live-campaigns",
      seed.adminId,
      workingBody(seed, voluumId),
    );
    assert.equal(response.status, 201);

    const tasks = await db
      .select()
      .from(todoTasksTable)
      .where(eq(todoTasksTable.workspaceId, seed.workspaceId));
    assert.equal(tasks.length, 0);

    const [runAfter] = await db
      .select()
      .from(batchTrafficSourceRunsTable)
      .where(eq(batchTrafficSourceRunsTable.id, runBefore.id));
    assert.equal(runAfter.iosCampaignId, runBefore.iosCampaignId);
    assert.equal(runAfter.androidCampaignId, runBefore.androidCampaignId);

    const workflowEvents = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.workspaceId, seed.workspaceId));
    assert.equal(workflowEvents.length, 0);

    const [opEvent] = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, seed.workspaceId),
          eq(operationalEventsTable.eventType, "PRODUCTION_LIVE_CAMPAIGN_CREATED"),
          eq(operationalEventsTable.entityId, String(json?.id)),
        ),
      );
    assert.equal(opEvent.entityType, "campaign");
  });

  test("cross-workspace creation is rejected", async () => {
    const seedA = await seedWorkspaceWithSource();
    const seedB = await seedWorkspaceWithSource();
    const { response } = await request("POST", "/production-live-campaigns", seedA.adminId, {
      ...workingBody(seedA, `vc-wrong-ws-${Date.now()}`),
      workspaceId: seedB.workspaceId,
    });
    assert.equal(response.status, 403);
  });

  test("non-admin cannot create production live campaigns", async () => {
    const seed = await seedWorkspaceWithSource();
    const { response } = await request(
      "POST",
      "/production-live-campaigns",
      seed.workerId,
      workingBody(seed, `vc-worker-${Date.now()}`),
    );
    assert.equal(response.status, 403);
  });
});
