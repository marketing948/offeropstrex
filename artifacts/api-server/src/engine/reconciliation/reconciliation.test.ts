// SPEC Phase 1 — reconciliation invariant tests.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  db,
  employeesTable,
  testingBatchesTable,
  todoTasksTable,
  voluumOffersTable,
  voluumTrafficSourcesTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger.ts";
import { reconcileWorkspace } from "./index.ts";

const silentLog = logger.child({ test: "reconciliation" });

let workspaceId: number;
let employeeId: number;
let trafficSourceId: number;
let workspaceTrafficSourceId: number;

before(async () => {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `reconcile-test-${Date.now()}` })
    .returning({ id: workspacesTable.id });
  workspaceId = ws.id;

  const [emp] = await db
    .insert(employeesTable)
    .values({
      name: "Reconcile Tester",
      email: `reconcile-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
      role: "employee",
      passwordHash: "x",
    })
    .returning({ id: employeesTable.id });
  employeeId = emp.id;

  const [vts] = await db
    .insert(voluumTrafficSourcesTable)
    .values({ workspaceId, voluumId: `vts-recon-${Date.now()}`, name: "Source R" })
    .returning({ id: voluumTrafficSourcesTable.id });
  trafficSourceId = vts.id;
  const [wts] = await db
    .insert(workspaceTrafficSourcesTable)
    .values({
      workspaceId,
      name: "Source R",
      voluumTrafficSourceId: `vts-recon-${Date.now()}`,
      position: 1,
      isActive: true,
    })
    .returning({ id: workspaceTrafficSourcesTable.id });
  workspaceTrafficSourceId = wts.id;
});

after(async () => {
  await db.delete(workspacesTable).where(eq(workspacesTable.id, workspaceId));
});

describe("reconciliation: invariants on a healthy workspace", () => {
  test("returns zero violations and is idempotent", async () => {
    // Healthy state: insert a batch with currentTrafficSourceId set + 2 OPEN
    // tracker-creation tasks (one ios, one android) for that batch+TS.
    const [batch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId,
        employeeId,
        batchName: `recon-healthy-${Date.now()}`,
        affiliateNetwork: "AN",
        geo: "DE",
        trafficSource: "Source R",
        currentTrafficSourceId: trafficSourceId,
        currentWorkspaceTrafficSourceId: workspaceTrafficSourceId,
        status: "WAITING_FOR_TRACKER_CAMPAIGNS",
      })
      .returning({ id: testingBatchesTable.id });

    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId,
      relatedBatchId: batch.id,
      trafficSourceId: workspaceTrafficSourceId,
      title: "Create iOS tracker",
      taskType: "CREATE_IOS_TRACKER_CAMPAIGN",
      trackerCampaignDevice: "ios",
      status: "TODO",
    });
    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId,
      relatedBatchId: batch.id,
      trafficSourceId: workspaceTrafficSourceId,
      title: "Create Android tracker",
      taskType: "CREATE_ANDROID_TRACKER_CAMPAIGN",
      trackerCampaignDevice: "android",
      status: "TODO",
    });

    const first = await reconcileWorkspace(workspaceId, silentLog);
    assert.equal(first.invariant1Violations, 0, "invariant 1 (retired — always 0)");
    assert.equal(first.invariant2Violations, 0, "invariant 2 (2 open tracker tasks)");
    assert.equal(first.invariant3Violations, 0, "invariant 3 (no orphan offers)");

    // Second run must produce identical zero counts (idempotency).
    const second = await reconcileWorkspace(workspaceId, silentLog);
    assert.deepEqual(
      {
        i1: second.invariant1Violations,
        i2: second.invariant2Violations,
        i3: second.invariant3Violations,
      },
      { i1: 0, i2: 0, i3: 0 },
    );
  });

  test("invariant 1 is retired — null currentTrafficSourceId no longer flagged", async () => {
    // After the CampaignOps redesign, the manual flow never populates
    // currentTrafficSourceId. Reconciliation must NOT flag this as drift.
    await db.insert(testingBatchesTable).values({
      workspaceId,
      employeeId,
      batchName: `recon-no-ts-${Date.now()}`,
      affiliateNetwork: "AN",
      geo: "DE",
      trafficSource: "Source R",
      currentTrafficSourceId: null,
      status: "NEW_BATCH",
    });

    const result = await reconcileWorkspace(workspaceId, silentLog);
    assert.equal(result.invariant1Violations, 0, "invariant 1 retired — counter must stay 0");
  });

  test("detects invariant 4: NEW_BATCH missing create_voluum_campaign_* tasks", async () => {
    const [batch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId,
        employeeId,
        batchName: `recon-missing-camp-${Date.now()}`,
        affiliateNetwork: "AN",
        geo: "DE",
        trafficSource: "Source R",
        currentTrafficSourceId: null,
        status: "NEW_BATCH",
      })
      .returning({ id: testingBatchesTable.id });

    // Only the iOS task is present — Android is missing → invariant 4 fires.
    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId,
      relatedBatchId: batch.id,
      title: "Create iOS Voluum campaign",
      taskType: "create_voluum_campaign_ios",
      status: "TODO",
    });

    const result = await reconcileWorkspace(workspaceId, silentLog);
    assert.ok(result.invariant4Violations >= 1, "invariant 4 violation reported");
  });

  test("invariant 4 healthy: NEW_BATCH with both create_voluum_campaign_* tasks", async () => {
    const [batch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId,
        employeeId,
        batchName: `recon-camp-pair-${Date.now()}`,
        affiliateNetwork: "AN",
        geo: "DE",
        trafficSource: "Source R",
        currentTrafficSourceId: null,
        status: "NEW_BATCH",
      })
      .returning({ id: testingBatchesTable.id });

    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId,
      relatedBatchId: batch.id,
      title: "Create iOS Voluum campaign",
      taskType: "create_voluum_campaign_ios",
      status: "TODO",
    });
    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId,
      relatedBatchId: batch.id,
      title: "Create Android Voluum campaign",
      taskType: "create_voluum_campaign_android",
      status: "TODO",
    });

    // Run reconciliation in a freshly-created workspace so we can assert
    // an absolute zero count for invariant 4 (other tests in the shared
    // workspace may have left missing-task batches behind).
    const [isolatedWs] = await db
      .insert(workspacesTable)
      .values({ name: `recon-i4-healthy-${Date.now()}` })
      .returning({ id: workspacesTable.id });
    const [isolatedBatch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId: isolatedWs.id,
        employeeId,
        batchName: `recon-i4-pair-${Date.now()}`,
        affiliateNetwork: "AN",
        geo: "DE",
        trafficSource: "Source R",
        currentTrafficSourceId: null,
        status: "NEW_BATCH",
      })
      .returning({ id: testingBatchesTable.id });
    await db.insert(todoTasksTable).values({
      workspaceId: isolatedWs.id,
      employeeId,
      relatedBatchId: isolatedBatch.id,
      title: "iOS",
      taskType: "create_voluum_campaign_ios",
      status: "TODO",
    });
    await db.insert(todoTasksTable).values({
      workspaceId: isolatedWs.id,
      employeeId,
      relatedBatchId: isolatedBatch.id,
      title: "Android",
      taskType: "create_voluum_campaign_android",
      status: "TODO",
    });

    const result = await reconcileWorkspace(isolatedWs.id, silentLog);
    assert.equal(result.invariant1Violations, 0, "invariant 1 (retired)");
    assert.equal(result.invariant4Violations, 0, "invariant 4 (healthy task pair)");

    await db.delete(workspacesTable).where(eq(workspacesTable.id, isolatedWs.id));
    // Invariant 4 cardinality (duplicate detection) is defense-in-depth
    // against schema bypass; the partial unique index
    // `todo_tasks_open_create_campaign_unique` blocks duplicate OPEN
    // create_voluum_campaign_* tasks at write time, so we cannot stage a
    // duplicate via normal inserts to assert it end-to-end here.
  });

  test("detects invariant 2: batch with currentTS missing tracker tasks", async () => {
    const [batch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId,
        employeeId,
        batchName: `recon-no-tasks-${Date.now()}`,
        affiliateNetwork: "AN",
        geo: "DE",
        trafficSource: "Source R",
        currentTrafficSourceId: trafficSourceId,
        currentWorkspaceTrafficSourceId: workspaceTrafficSourceId,
        status: "WAITING_FOR_TRACKER_CAMPAIGNS",
      })
      .returning({ id: testingBatchesTable.id });

    // Only 1 of the 2 required tasks exists — should violate invariant 2.
    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId,
      relatedBatchId: batch.id,
      trafficSourceId: workspaceTrafficSourceId,
      title: "Create iOS tracker",
      taskType: "CREATE_IOS_TRACKER_CAMPAIGN",
      trackerCampaignDevice: "ios",
      status: "TODO",
    });

    const result = await reconcileWorkspace(workspaceId, silentLog);
    assert.ok(result.invariant2Violations >= 1, "invariant 2 violation reported");
  });

  test("detects invariant 3: tagged orphan offer (no batchId)", async () => {
    await db.insert(voluumOffersTable).values({
      workspaceId,
      offerId: `vo-orphan-${Date.now()}`,
      offerName: "Orphan offer",
      primaryTag: "SL_DE_BATCH99",
      isActive: true,
      batchId: null,
    });

    const result = await reconcileWorkspace(workspaceId, silentLog);
    assert.ok(result.invariant3Violations >= 1, "invariant 3 violation reported");
  });
});
