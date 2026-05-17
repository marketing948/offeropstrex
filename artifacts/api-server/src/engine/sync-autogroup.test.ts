// Pivot Phase 0 (Task #24): enable Voluum at the test boundary so
// engine/event-bus.ts::emit does not short-circuit Voluum-only event
// types and reconciliation auto-group keeps running in tests. The
// product runtime default is OFF; only the test process is opted in.
process.env["ENABLE_VOLUUM"] = "true";

// Phase 5h — sync integration tests for autoGroupOffersIntoBatches.
//
// Covers:
//   1. Snapshot:    pinned events emitted from a fixed voluum_offers
//                   fixture (BatchCreated × N + cascaded rows).
//   2. Idempotency: re-running the same auto-group on the same data
//                   produces zero new events + zero new batches.
//   3. Cross-WS:    a sync for workspace A never emits events or
//                   creates batches in workspace B even when both
//                   contain offers with identical tags.
//   4. Bad-tag:     offers with malformed/unknown tags are skipped
//                   silently — no batch row, no event row.
//
// Out of scope here: API_SYNC_FAILURE notification (that wraps the
// outer Voluum-fetch path, not the auto-group pass).

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  db,
  employeesTable,
  eventsTable,
  notificationsTable,
  testingBatchesTable,
  todoTasksTable,
  trackerCampaignsTable,
  voluumCampaignsTable,
  voluumOffersTable,
  voluumTrafficSourcesTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { _resetRegistryForTests } from "./handlers.ts";
import { _resetRulesGuardForTests, registerAllRules } from "./rules/index.ts";
import { autoGroupOffersIntoBatches } from "../routes/sync.ts";

// Minimal pino-shaped logger that swallows output (the production
// logger writes to stdout via pino and would noisy-up the test run).
const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Parameters<typeof autoGroupOffersIntoBatches>[1];

let workspaceId: number;
let otherWorkspaceId: number;
let employeeId: number;

before(async () => {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `sync-autogroup-test-${Date.now()}` })
    .returning({ id: workspacesTable.id });
  workspaceId = ws.id;

  const [other] = await db
    .insert(workspacesTable)
    .values({ name: `sync-autogroup-other-${Date.now()}` })
    .returning({ id: workspacesTable.id });
  otherWorkspaceId = other.id;

  // autoGroupOffersIntoBatches assigns the first global admin as the
  // batch employee. The rules.test.ts run already creates one; we
  // create our own deterministically scoped admin here as well to
  // avoid order coupling. Using a non-admin role would still let the
  // function fall back to id=1 — but the BatchCreated cascade reads
  // workspace_traffic_sources, not employees, so any admin is fine.
  const [emp] = await db
    .insert(employeesTable)
    .values({
      name: "Sync AutoGroup Tester",
      email: `sync-autogroup-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
      role: "admin",
      passwordHash: "x",
    })
    .returning({ id: employeesTable.id });
  employeeId = emp.id;

  // Seed traffic sources for BOTH workspaces so the BatchCreated
  // cascade has somewhere to seed CREATE_*_TRACKER_CAMPAIGN tasks.
  for (const ws of [workspaceId, otherWorkspaceId]) {
    const voluumIdA = `vts-a-ws${ws}-${Date.now()}`;
    await db
      .insert(voluumTrafficSourcesTable)
      .values({ workspaceId: ws, voluumId: voluumIdA, name: "Source A" });
    await db.insert(workspaceTrafficSourcesTable).values({
      workspaceId: ws,
      name: "Source A",
      voluumTrafficSourceId: voluumIdA,
      position: 1,
      isActive: true,
    });
  }
});

after(async () => {
  if (workspaceId) {
    await db.delete(workspacesTable).where(eq(workspacesTable.id, workspaceId));
  }
  if (otherWorkspaceId) {
    await db
      .delete(workspacesTable)
      .where(eq(workspacesTable.id, otherWorkspaceId));
  }
  if (employeeId) {
    await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
  }
});

beforeEach(async () => {
  _resetRegistryForTests();
  _resetRulesGuardForTests();
  registerAllRules();

  // Clean per-test state for both workspaces. Order matters: events
  // first (no FKs blocking), then batches (cascades to tasks/offers/
  // notifications), then voluum_offers (independent).
  for (const ws of [workspaceId, otherWorkspaceId]) {
    await db.delete(eventsTable).where(eq(eventsTable.workspaceId, ws));
    await db
      .delete(testingBatchesTable)
      .where(eq(testingBatchesTable.workspaceId, ws));
    await db
      .delete(voluumCampaignsTable)
      .where(eq(voluumCampaignsTable.workspaceId, ws));
    await db
      .delete(voluumOffersTable)
      .where(eq(voluumOffersTable.workspaceId, ws));
    await db
      .delete(notificationsTable)
      .where(eq(notificationsTable.workspaceId, ws));
    await db.delete(todoTasksTable).where(eq(todoTasksTable.workspaceId, ws));
  }
});

async function seedOffers(
  ws: number,
  rows: Array<{ offerId: string; offerName: string; primaryTag: string | null }>,
) {
  if (rows.length === 0) return;
  await db.insert(voluumOffersTable).values(
    rows.map((r) => ({
      workspaceId: ws,
      offerId: r.offerId,
      offerName: r.offerName,
      primaryTag: r.primaryTag,
      isActive: true,
    })),
  );
}

async function seedCampaigns(
  ws: number,
  rows: Array<{
    campaignId: string;
    campaignName: string;
    trafficSourceName: string | null;
    tags: string[];
  }>,
) {
  if (rows.length === 0) return;
  await db.insert(voluumCampaignsTable).values(
    rows.map((r) => ({
      workspaceId: ws,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      trafficSourceName: r.trafficSourceName,
      allTags: JSON.stringify(r.tags),
      primaryTag: r.tags[0] ?? null,
      isActive: true,
    })),
  );
}

describe("sync.autoGroupOffersIntoBatches (Phase 5h)", () => {
  test("snapshot: emits BatchCreated per unique tag + cascaded tasks/notification", async () => {
    await seedOffers(workspaceId, [
      // Two offers under tag sl_de_batch1 → one batch with 2 offers.
      { offerId: "o1", offerName: "O1", primaryTag: "sl_de_batch1" },
      { offerId: "o2", offerName: "O2", primaryTag: "sl_de_batch1" },
      // One offer under tag yk_us_batch7 → one batch with 1 offer.
      { offerId: "o3", offerName: "O3", primaryTag: "yk_us_batch7" },
      // Untagged → skipped.
      { offerId: "o4", offerName: "O4", primaryTag: null },
      // Malformed tag → skipped.
      { offerId: "o5", offerName: "O5", primaryTag: "not_a_real_tag" },
    ]);

    const result = await autoGroupOffersIntoBatches(workspaceId, silentLog);

    assert.equal(result.batchesCreated, 2, "exactly 2 new batches");
    assert.equal(result.offersGrouped, 3, "3 valid offers linked");

    const batches = await db
      .select()
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.workspaceId, workspaceId));
    assert.equal(batches.length, 2);
    const tagsCreated = new Set(batches.map((b) => b.batchTag));
    assert.ok(tagsCreated.has("sl_de_batch1"));
    assert.ok(tagsCreated.has("yk_us_batch7"));
    // Spec-correction (post Phase 10): batches stay NEW_BATCH at
    // creation; transition to WAITING_FOR_TRACKER_CAMPAIGNS only
    // happens when the FIRST tracker campaign is imported.
    assert.ok(
      batches.every((b) => b.status === "NEW_BATCH"),
      "BatchCreated rule no longer auto-transitions to WAITING",
    );
    // Pivot Phase 4 (Task #27): the legacy traffic-source rotation
    // (snapshot + currentTrafficSourceId pin) is gone. The manual
    // workflow seeds CREATE_IOS_CAMPAIGN + CREATE_ANDROID_CAMPAIGN
    // tasks instead — see the BatchCreated suite in rules.test.ts.
    // numberOfOffers carried through the CreateBatch action.
    const slBatch = batches.find((b) => b.batchTag === "sl_de_batch1")!;
    const ykBatch = batches.find((b) => b.batchTag === "yk_us_batch7")!;
    assert.equal(slBatch.numberOfOffers, 2);
    assert.equal(ykBatch.numberOfOffers, 1);

    // Exactly one BatchCreated event per unique tag, with the
    // expected dedupeKey shape.
    const batchCreatedEvents = await db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.workspaceId, workspaceId),
          eq(eventsTable.type, "BatchCreated"),
        ),
      );
    assert.equal(batchCreatedEvents.length, 2);
    const dedupeKeys = new Set(batchCreatedEvents.map((e) => e.dedupeKey));
    assert.ok(dedupeKeys.has("voluum_tag:sl_de_batch1"));
    assert.ok(dedupeKeys.has("voluum_tag:yk_us_batch7"));

    // 2 batches × (ios + android) = 4 CampaignOps create-campaign tasks.
    const tasks = await db
      .select()
      .from(todoTasksTable)
      .where(eq(todoTasksTable.workspaceId, workspaceId));
    assert.equal(tasks.length, 4);
    const taskTypes = tasks.map((t) => t.taskType).sort();
    assert.deepEqual(taskTypes, [
      "create_voluum_campaign_android",
      "create_voluum_campaign_android",
      "create_voluum_campaign_ios",
      "create_voluum_campaign_ios",
    ]);

    // 2 NEW_BATCH_CREATED notifications.
    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.workspaceId, workspaceId));
    assert.equal(notifs.length, 2);
    assert.ok(notifs.every((n) => n.type === "NEW_BATCH_CREATED"));

    // Voluum offers are linked to their batch row.
    const linkedOffers = await db
      .select()
      .from(voluumOffersTable)
      .where(
        and(
          eq(voluumOffersTable.workspaceId, workspaceId),
          inArray(voluumOffersTable.offerId, ["o1", "o2", "o3"]),
        ),
      );
    assert.ok(linkedOffers.every((o) => o.batchId !== null));
    const slLinked = linkedOffers.filter((o) => o.batchId === slBatch.id);
    assert.equal(slLinked.length, 2);

    // Untagged + bad-tag offers stay unlinked.
    const skipped = await db
      .select()
      .from(voluumOffersTable)
      .where(
        and(
          eq(voluumOffersTable.workspaceId, workspaceId),
          inArray(voluumOffersTable.offerId, ["o4", "o5"]),
        ),
      );
    assert.ok(skipped.every((o) => o.batchId === null));
  });

  test("idempotency: second run with same data produces zero new events/batches", async () => {
    await seedOffers(workspaceId, [
      { offerId: "o1", offerName: "O1", primaryTag: "sl_de_batch1" },
      { offerId: "o2", offerName: "O2", primaryTag: "yk_us_batch7" },
    ]);

    const firstRun = await autoGroupOffersIntoBatches(workspaceId, silentLog);
    assert.equal(firstRun.batchesCreated, 2);

    const eventsAfterFirst = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(eq(eventsTable.workspaceId, workspaceId));
    const tasksAfterFirst = await db
      .select({ id: todoTasksTable.id })
      .from(todoTasksTable)
      .where(eq(todoTasksTable.workspaceId, workspaceId));
    const notifsAfterFirst = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(eq(notificationsTable.workspaceId, workspaceId));

    const secondRun = await autoGroupOffersIntoBatches(workspaceId, silentLog);
    assert.equal(secondRun.batchesCreated, 0, "no new batches on re-run");

    const eventsAfterSecond = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(eq(eventsTable.workspaceId, workspaceId));
    const tasksAfterSecond = await db
      .select({ id: todoTasksTable.id })
      .from(todoTasksTable)
      .where(eq(todoTasksTable.workspaceId, workspaceId));
    const notifsAfterSecond = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(eq(notificationsTable.workspaceId, workspaceId));

    assert.equal(
      eventsAfterSecond.length,
      eventsAfterFirst.length,
      "no new event rows on idempotent re-run",
    );
    assert.equal(
      tasksAfterSecond.length,
      tasksAfterFirst.length,
      "no duplicate tracker tasks on idempotent re-run",
    );
    assert.equal(
      notifsAfterSecond.length,
      notifsAfterFirst.length,
      "no duplicate notifications on idempotent re-run",
    );

    // The total batch count in the workspace stays at 2.
    const batches = await db
      .select({ id: testingBatchesTable.id })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.workspaceId, workspaceId));
    assert.equal(batches.length, 2);
  });

  test("duplicate exact lowercase tags create one batch and uppercase tags are ignored", async () => {
    await seedOffers(workspaceId, [
      { offerId: "dup-1", offerName: "Dup 1", primaryTag: "sl_de_batch1" },
      { offerId: "dup-2", offerName: "Dup 2", primaryTag: "sl_de_batch1" },
      { offerId: "upper", offerName: "Uppercase ignored", primaryTag: "SL_DE_BATCH1" },
    ]);

    const result = await autoGroupOffersIntoBatches(workspaceId, silentLog);

    assert.equal(result.batchesCreated, 1);
    assert.equal(result.offersGrouped, 2);

    const batches = await db
      .select()
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.workspaceId, workspaceId));
    assert.equal(batches.length, 1);
    assert.equal(batches[0].batchTag, "sl_de_batch1");
    assert.equal(batches[0].numberOfOffers, 2);

    const ignored = await db
      .select()
      .from(voluumOffersTable)
      .where(
        and(
          eq(voluumOffersTable.workspaceId, workspaceId),
          eq(voluumOffersTable.offerId, "upper"),
        ),
      );
    assert.equal(ignored[0].batchId, null);
  });

  test("campaign matching links ios and and campaigns to the same batch and traffic source", async () => {
    await seedOffers(workspaceId, [
      { offerId: "match-offer", offerName: "Match offer", primaryTag: "sl_de_batch1" },
    ]);
    await seedCampaigns(workspaceId, [
      {
        campaignId: "camp-ios",
        campaignName: "iOS tracker",
        trafficSourceName: "Source A",
        tags: ["sl_de_batch1_ios"],
      },
      {
        campaignId: "camp-and",
        campaignName: "Android tracker",
        trafficSourceName: "Source A",
        tags: ["sl_de_batch1_and"],
      },
      {
        campaignId: "camp-no-suffix",
        campaignName: "Ignored missing suffix",
        trafficSourceName: "Source A",
        tags: ["sl_de_batch1"],
      },
      {
        campaignId: "camp-legacy-android",
        campaignName: "Ignored legacy suffix",
        trafficSourceName: "Source A",
        tags: ["sl_de_batch1_android"],
      },
    ]);

    const result = await autoGroupOffersIntoBatches(workspaceId, silentLog);
    assert.equal(result.batchesCreated, 1);

    const [batch] = await db
      .select()
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.workspaceId, workspaceId));
    assert.equal(batch.batchTag, "sl_de_batch1");

    const trackerCampaigns = await db
      .select()
      .from(trackerCampaignsTable)
      .where(eq(trackerCampaignsTable.workspaceId, workspaceId));
    assert.equal(trackerCampaigns.length, 2);
    assert.ok(trackerCampaigns.every((c) => c.batchId === batch.id));

    const trafficSourceIds = new Set(trackerCampaigns.map((c) => c.trafficSourceId));
    assert.equal(trafficSourceIds.size, 1);
    assert.deepEqual(
      trackerCampaigns.map((c) => c.device).sort(),
      ["android", "ios"],
    );
    assert.deepEqual(
      trackerCampaigns.map((c) => c.tag).sort(),
      ["sl_de_batch1_and", "sl_de_batch1_ios"],
    );
  });

  test("cross-workspace isolation: same tag in WS-A and WS-B produces independent batches", async () => {
    // Identical tag in both workspaces.
    await seedOffers(workspaceId, [
      { offerId: "o-a", offerName: "WS-A offer", primaryTag: "sl_de_batch1" },
    ]);
    await seedOffers(otherWorkspaceId, [
      { offerId: "o-b", offerName: "WS-B offer", primaryTag: "sl_de_batch1" },
    ]);

    // Auto-group only WS-A.
    const aResult = await autoGroupOffersIntoBatches(workspaceId, silentLog);
    assert.equal(aResult.batchesCreated, 1);

    // WS-B must be untouched: no batches, no events, no tasks, no
    // notifications, voluum_offers.batchId still null.
    const bBatches = await db
      .select()
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.workspaceId, otherWorkspaceId));
    assert.equal(bBatches.length, 0, "WS-B has no batches");

    const bEvents = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.workspaceId, otherWorkspaceId));
    assert.equal(bEvents.length, 0, "WS-B has no events");

    const bTasks = await db
      .select()
      .from(todoTasksTable)
      .where(eq(todoTasksTable.workspaceId, otherWorkspaceId));
    assert.equal(bTasks.length, 0, "WS-B has no tasks");

    const bNotifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.workspaceId, otherWorkspaceId));
    assert.equal(bNotifs.length, 0, "WS-B has no notifications");

    const [bOffer] = await db
      .select()
      .from(voluumOffersTable)
      .where(
        and(
          eq(voluumOffersTable.workspaceId, otherWorkspaceId),
          eq(voluumOffersTable.offerId, "o-b"),
        ),
      );
    assert.equal(bOffer.batchId, null, "WS-B offer not linked");

    // Now auto-group WS-B independently — gets its own batch under
    // the same tag (the (workspaceId, batchTag) unique key allows
    // the same tag string per workspace).
    const bResult = await autoGroupOffersIntoBatches(
      otherWorkspaceId,
      silentLog,
    );
    assert.equal(bResult.batchesCreated, 1);

    const aBatch = (
      await db
        .select()
        .from(testingBatchesTable)
        .where(eq(testingBatchesTable.workspaceId, workspaceId))
    )[0];
    const bBatch = (
      await db
        .select()
        .from(testingBatchesTable)
        .where(eq(testingBatchesTable.workspaceId, otherWorkspaceId))
    )[0];
    assert.notEqual(
      aBatch.id,
      bBatch.id,
      "the two workspaces own distinct batch rows",
    );
    assert.equal(aBatch.batchTag, "sl_de_batch1");
    assert.equal(bBatch.batchTag, "sl_de_batch1");
  });
});
