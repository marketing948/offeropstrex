// SPEC Phase 1 — reconciliation invariant tests.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  db,
  employeesTable,
  operationalEventsTable,
  testingBatchesTable,
  todoTasksTable,
  voluumOffersTable,
  voluumTrafficSourcesTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { RECONCILIATION_VIOLATION_PAYLOAD_KEYS } from "../../lib/campaignops-operational-events.ts";
import { logger } from "../../lib/logger.ts";
import { reconcileWorkspace } from "./index.ts";

const silentLog = logger.child({ test: "reconciliation" });

let workspaceId: number;
let employeeId: number;
let trafficSourceId: number;
let workspaceTrafficSourceId: number;

function assertSafeReconciliationPayload(payload: unknown): void {
  assert.ok(payload !== null && typeof payload === "object");
  const record = payload as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    assert.ok(
      (RECONCILIATION_VIOLATION_PAYLOAD_KEYS as readonly string[]).includes(key),
      `unexpected payload key: ${key}`,
    );
    const value = record[key];
    if (key === "affectedBatchIds") {
      assert.ok(Array.isArray(value));
      assert.ok(value.every((id) => typeof id === "number"));
      continue;
    }
    assert.ok(
      typeof value === "number" || typeof value === "string",
      `unexpected value type for ${key}`,
    );
  }
}

async function countReconciliationViolationEvents(wsId: number): Promise<number> {
  const rows = await db
    .select({ id: operationalEventsTable.id })
    .from(operationalEventsTable)
    .where(
      and(
        eq(operationalEventsTable.workspaceId, wsId),
        eq(operationalEventsTable.eventType, "RECONCILIATION_VIOLATION"),
      ),
    );
  return rows.length;
}

before(async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS operational_events (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      event_type text NOT NULL,
      actor_type text NOT NULL DEFAULT 'system',
      actor_id text,
      source text NOT NULL,
      payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

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

    const beforeEvents = await countReconciliationViolationEvents(workspaceId);
    const result = await reconcileWorkspace(workspaceId, silentLog);
    assert.ok(result.invariant4Violations >= 1, "invariant 4 violation reported");

    const events = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, workspaceId),
          eq(operationalEventsTable.eventType, "RECONCILIATION_VIOLATION"),
        ),
      );
    assert.ok(events.length > beforeEvents);
    const latest = events[events.length - 1]!;
    assert.equal(latest.entityType, "workspace");
    assert.equal(latest.source, "engine.reconciliation");
    const latestPayload = latest.payloadJson as Record<string, unknown>;
    assertSafeReconciliationPayload(latestPayload);
    assert.equal(latestPayload.invariant, "invariant4");
    assert.ok((latestPayload.violationCount as number) >= 1);
    assert.ok((latestPayload.affectedBatchIds as number[]).includes(batch.id));
    assert.ok(typeof latestPayload.reconciliationPassAt === "string");
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
    assert.equal(
      await countReconciliationViolationEvents(isolatedWs.id),
      0,
      "healthy workspace emits no RECONCILIATION_VIOLATION",
    );

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

    const inv3Events = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, workspaceId),
          eq(operationalEventsTable.eventType, "RECONCILIATION_VIOLATION"),
        ),
      );
    const inv3 = inv3Events.find((row) => {
      const payload = row.payloadJson as Record<string, unknown>;
      return payload.invariant === "invariant3";
    });
    assert.ok(inv3, "invariant 3 emits RECONCILIATION_VIOLATION");
    const inv3Payload = inv3!.payloadJson as Record<string, unknown>;
    assertSafeReconciliationPayload(inv3Payload);
    assert.equal(inv3Payload.invariant, "invariant3");
    assert.ok((inv3Payload.violationCount as number) >= 1);
    assert.ok(!("affectedBatchIds" in inv3Payload));
    assert.ok(typeof inv3Payload.reconciliationPassAt === "string");
  });
});

describe("reconciliation: operational event telemetry", { concurrency: false }, () => {
  test("invariant 2 violation emits structured RECONCILIATION_VIOLATION", async () => {
    const [ws] = await db
      .insert(workspacesTable)
      .values({ name: `recon-ops-i2-${Date.now()}` })
      .returning({ id: workspacesTable.id });

    const [batch] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId: ws.id,
        employeeId,
        batchName: `recon-ops-i2-${Date.now()}`,
        affiliateNetwork: "AN",
        geo: "DE",
        trafficSource: "Source R",
        currentTrafficSourceId: trafficSourceId,
        currentWorkspaceTrafficSourceId: workspaceTrafficSourceId,
        status: "WAITING_FOR_TRACKER_CAMPAIGNS",
      })
      .returning({ id: testingBatchesTable.id });

    await db.insert(todoTasksTable).values({
      workspaceId: ws.id,
      employeeId,
      relatedBatchId: batch.id,
      trafficSourceId: workspaceTrafficSourceId,
      title: "Create iOS tracker",
      taskType: "CREATE_IOS_TRACKER_CAMPAIGN",
      trackerCampaignDevice: "ios",
      status: "TODO",
    });

    const result = await reconcileWorkspace(ws.id, silentLog);
    assert.equal(result.invariant2Violations, 1);

    const [event] = await db
      .select()
      .from(operationalEventsTable)
      .where(
        and(
          eq(operationalEventsTable.workspaceId, ws.id),
          eq(operationalEventsTable.eventType, "RECONCILIATION_VIOLATION"),
        ),
      );
    assert.ok(event);
    const eventPayload = event.payloadJson as Record<string, unknown>;
    assert.equal(eventPayload.invariant, "invariant2");
    assert.deepEqual(eventPayload.affectedBatchIds, [batch.id]);
    assertSafeReconciliationPayload(eventPayload);

    await db.delete(workspacesTable).where(eq(workspacesTable.id, ws.id));
  });
});
