import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { ensureProductionLiveCampaignSchema } from "../test-utils/ensure-production-live-campaign-schema.ts";
import {
  affiliateNetworksTable,
  campaignsTable,
  db,
  employeeWorkspaceAssignmentsTable,
  employeesTable,
  testingBatchesTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
  geosTable,
} from "@workspace/db";
import {
  queryCanonicalTestingCounts,
  queryCanonicalWorkingCounts,
  queryCanonicalWorkingNetworkGeo,
} from "./canonical-campaign-actuals.ts";
import {
  assertProductionLiveCampaignPrerequisites,
  insertProductionLiveCampaign,
} from "./production-live-campaigns.ts";

let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

before(async () => {
  await ensureProductionLiveCampaignSchema();
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

async function seed() {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `canonical-${Date.now()}`, isActive: false })
    .returning();
  createdWorkspaceIds.push(ws!.id);
  const workspaceId = ws!.id;

  const [network] = await db
    .insert(affiliateNetworksTable)
    .values({ workspaceId, name: "Test Network" })
    .returning();
  const [geo] = await db
    .insert(geosTable)
    .values({ workspaceId, code: "US", name: "United States" })
    .returning();
  const [ts] = await db
    .insert(workspaceTrafficSourcesTable)
    .values({ workspaceId, name: "Test TS", position: 1, isActive: true })
    .returning();
  const [employee] = await db
    .insert(employeesTable)
    .values({
      name: "Tester",
      email: `tester-${Date.now()}@example.com`,
      passwordHash: "x",
      role: "employee",
    })
    .returning();
  createdEmployeeIds.push(employee!.id);
  await db.insert(employeeWorkspaceAssignmentsTable).values({
    workspaceId,
    employeeId: employee!.id,
  });

  return {
    workspaceId,
    employeeId: employee!.id,
    affiliateNetworkId: network!.id,
    geoId: geo!.id,
    trafficSourceId: ts!.id,
  };
}

describe("canonical campaign actuals", () => {
  it("manual working campaign counts in working totals and network/geo breakdown", async () => {
    const s = await seed();
    const resolved = await assertProductionLiveCampaignPrerequisites({
      workspaceId: s.workspaceId,
      campaignName: "Manual Working US",
      campaignPurpose: "working",
      platform: "ios",
      trafficSourceId: s.trafficSourceId,
      voluumCampaignId: `vol-${Date.now()}`,
      campaignUrl: "https://example.com",
      affiliateNetworkId: s.affiliateNetworkId,
      geoId: s.geoId,
    });
    await insertProductionLiveCampaign(resolved, s.employeeId);

    const monthKey = new Date().toISOString().slice(0, 7);
    const counts = await queryCanonicalWorkingCounts(s.workspaceId, monthKey);
    assert.equal(counts.get(s.employeeId), 1);

    const networkGeo = await queryCanonicalWorkingNetworkGeo(
      s.workspaceId,
      s.employeeId,
      undefined,
      monthKey,
    );
    assert.equal(networkGeo.get("Test Network")?.get("US"), 1);
  });

  it("batch-linked working campaign counts once via batch employee fallback", async () => {
    const s = await seed();
    const [batch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId: s.workspaceId,
        employeeId: s.employeeId,
        batchName: "Batch Working",
        batchTag: `tag-${Date.now()}`,
        affiliateNetwork: "Test Network",
        geo: "US",
        trafficSource: "Test TS",
        affiliateNetworkId: s.affiliateNetworkId,
        geoId: s.geoId,
      })
      .returning();
    await db.insert(campaignsTable).values({
      workspaceId: s.workspaceId,
      batchId: batch!.id,
      platform: "ios",
      campaignName: "Batch Working iOS",
      trafficSourceId: s.trafficSourceId,
      status: "live",
      campaignPurpose: "working",
      affiliateNetworkId: s.affiliateNetworkId,
      geoId: s.geoId,
      geo: "US",
      liveStartedAt: new Date(),
    });

    const monthKey = new Date().toISOString().slice(0, 7);
    const counts = await queryCanonicalWorkingCounts(s.workspaceId, monthKey);
    assert.equal(counts.get(s.employeeId), 1);
  });

  it("testing batch counts respect month scope", async () => {
    const s = await seed();
    await db.insert(testingBatchesTable).values({
      workspaceId: s.workspaceId,
      employeeId: s.employeeId,
      batchName: "July Batch",
      batchTag: `july-${Date.now()}`,
      affiliateNetwork: "Test Network",
      geo: "US",
      trafficSource: "Test TS",
      affiliateNetworkId: s.affiliateNetworkId,
      geoId: s.geoId,
    });

    const monthKey = new Date().toISOString().slice(0, 7);
    const counts = await queryCanonicalTestingCounts(s.workspaceId, monthKey);
    assert.equal(counts.get(s.employeeId), 1);
  });
});
