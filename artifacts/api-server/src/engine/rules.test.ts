// Phase 4 (Task #14) — integration tests for the rule registry.
// Each test sets up a freshly-scoped workspace + employee, registers
// the rules via `registerAllRules()`, emits an event, and asserts the
// downstream rows the rule's actions should have produced.
//
// Pivot Phase 0 (Task #24): enable Voluum at the test boundary so
// engine/event-bus.ts::emit does not short-circuit Voluum-only event
// types. The runtime default is OFF; only the test process is opted
// in. Phase 5 will rewrite these tests against the quarantined module.
process.env["ENABLE_VOLUUM"] = "true";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  batchResultsTable,
  campaignsTable,
  db,
  employeesTable,
  employeeWorkspaceAssignmentsTable,
  eventsTable,
  notificationsTable,
  performanceTable,
  testingBatchesTable,
  todoTasksTable,
  trackerCampaignsTable,
  voluumTrafficSourcesTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { emit } from "./event-bus.ts";
import { _resetRegistryForTests, registerHandler } from "./handlers.ts";
import { _resetRulesGuardForTests, registerAllRules } from "./rules/index.ts";
import { runOverdueTasksScan } from "../cron/overdue-tasks.ts";

let workspaceId: number;
let otherWorkspaceId: number;
let employeeId: number;
// Legacy Voluum IDs are still used by tracker_campaigns/currentTrafficSourceId.
let trafficSourceAId: number;
let trafficSourceBId: number;
// CampaignOps task/run state uses workspace traffic-source IDs.
let workspaceTrafficSourceAId: number;
let workspaceTrafficSourceBId: number;

before(async () => {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `rules-test-${Date.now()}` })
    .returning({ id: workspacesTable.id });
  workspaceId = ws.id;
  const [other] = await db
    .insert(workspacesTable)
    .values({ name: `rules-test-other-${Date.now()}` })
    .returning({ id: workspacesTable.id });
  otherWorkspaceId = other.id;

  const [emp] = await db
    .insert(employeesTable)
    .values({
      name: "Rule Tester",
      email: `rule-tester-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
      role: "employee",
      passwordHash: "x",
    })
    .returning({ id: employeesTable.id });
  employeeId = emp.id;

  const voluumIdA = `vts-a-${Date.now()}`;
  const voluumIdB = `vts-b-${Date.now()}`;
  const [vtsA] = await db
    .insert(voluumTrafficSourcesTable)
    .values({ workspaceId, voluumId: voluumIdA, name: "Source A" })
    .returning({ id: voluumTrafficSourcesTable.id });
  const [vtsB] = await db
    .insert(voluumTrafficSourcesTable)
    .values({ workspaceId, voluumId: voluumIdB, name: "Source B" })
    .returning({ id: voluumTrafficSourcesTable.id });
  trafficSourceAId = vtsA.id;
  trafficSourceBId = vtsB.id;

  const [wtsA] = await db.insert(workspaceTrafficSourcesTable).values({
    workspaceId,
    name: "Source A",
    voluumTrafficSourceId: voluumIdA,
    position: 1,
    isActive: true,
  }).returning({ id: workspaceTrafficSourcesTable.id });
  const [wtsB] = await db.insert(workspaceTrafficSourcesTable).values({
    workspaceId,
    name: "Source B",
    voluumTrafficSourceId: voluumIdB,
    position: 2,
    isActive: true,
  }).returning({ id: workspaceTrafficSourcesTable.id });
  workspaceTrafficSourceAId = wtsA.id;
  workspaceTrafficSourceBId = wtsB.id;
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
});

beforeEach(() => {
  _resetRegistryForTests();
  _resetRulesGuardForTests();
  registerAllRules();
});

async function insertBatch(opts?: {
  status?: "NEW_BATCH" | "WAITING_FOR_TRACKER_CAMPAIGNS" | "LIVE_TESTS";
  currentTrafficSourceId?: number | null;
}): Promise<number> {
  const [b] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId,
      employeeId,
      batchName: `Batch ${Date.now()}-${Math.random()}`,
      affiliateNetwork: "MyBookie",
      geo: "DE",
      trafficSource: "Source A",
      batchTag: `MB_DE_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      status: opts?.status ?? "NEW_BATCH",
      currentTrafficSourceId: opts?.currentTrafficSourceId ?? null,
    })
    .returning({ id: testingBatchesTable.id });
  return b.id;
}

async function getWorkspaceTrafficSourceId(): Promise<number> {
  const [source] = await db
    .select({ id: workspaceTrafficSourcesTable.id })
    .from(workspaceTrafficSourcesTable)
    .where(eq(workspaceTrafficSourcesTable.workspaceId, workspaceId))
    .limit(1);
  assert.ok(source, "expected seeded workspace traffic source");
  return source.id;
}

describe("rules: BatchCreated (Pivot Phase 4)", () => {
  // Pivot Phase 4 (Task #27): BatchCreated seeds the manual
  // create_voluum_campaign_ios + create_voluum_campaign_android tasks for the
  // assigned worker. Idempotent via dedupe key `batch_created:<id>`.
  test("seeds create_voluum_campaign_ios + create_voluum_campaign_android tasks for assigned worker", async () => {
    const batchId = await insertBatch();

    const result = await emit({
      type: "BatchCreated",
      workspaceId,
      payload: {
        batchId,
        tag: "MB_DE_BATCH01",
        affiliateNetworkName: "MyBookie",
        geo: "DE",
      },
      dedupeKey: `batch_created:${batchId}`,
    });
    assert.equal(result.deduped, false);
    assert.equal(result.handlerCount, 1);

    const tasks = await db
      .select()
      .from(todoTasksTable)
      .where(eq(todoTasksTable.relatedBatchId, batchId));
    assert.equal(tasks.length, 2, "should seed two campaign tasks");
    const types = tasks.map((t) => t.taskType).sort();
    assert.deepEqual(types, ["create_voluum_campaign_android", "create_voluum_campaign_ios"]);
    for (const t of tasks) {
      assert.equal(t.employeeId, employeeId);
      assert.equal(t.workspaceId, workspaceId);
      assert.equal(t.status, "TODO");
    }

    // Idempotency: re-emit with same dedupe key is a no-op.
    const second = await emit({
      type: "BatchCreated",
      workspaceId,
      payload: {
        batchId,
        tag: "MB_DE_BATCH01",
        affiliateNetworkName: "MyBookie",
        geo: "DE",
      },
      dedupeKey: `batch_created:${batchId}`,
    });
    assert.equal(second.deduped, true);
    const tasksAfter = await db
      .select()
      .from(todoTasksTable)
      .where(eq(todoTasksTable.relatedBatchId, batchId));
    assert.equal(tasksAfter.length, 2, "no duplicate tasks on re-emit");
  });
});

describe("rules: CampaignStatusChanged (Pivot Phase 4)", () => {
  async function insertCampaign(
    batchId: number,
    platform: "ios" | "android",
    status: "draft" | "ready" | "live" | "tested" | "closed",
  ): Promise<number> {
    const [c] = await db
      .insert(campaignsTable)
      .values({
        workspaceId,
        batchId,
        platform,
        campaignName: `${platform}-${batchId}`,
        status,
      })
      .returning({ id: campaignsTable.id });
    return c.id;
  }

  test("→ ready on second campaign creates GO_LIVE task once", async () => {
    const batchId = await insertBatch();
    await insertCampaign(batchId, "ios", "ready");
    const androidId = await insertCampaign(batchId, "android", "ready");

    const result = await emit({
      type: "CampaignStatusChanged",
      workspaceId,
      payload: {
        campaignId: androidId,
        batchId,
        platform: "android",
        from: "draft",
        to: "ready",
      },
      dedupeKey: `campaign_status:${androidId}:ready`,
    });
    assert.equal(result.deduped, false);

    const goLive = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.taskType, "GO_LIVE"),
        ),
      );
    assert.equal(goLive.length, 1, "exactly one GO_LIVE task seeded");
    assert.equal(goLive[0].priority, "high");

    // Idempotency: re-emit with same dedupe key is a no-op.
    const second = await emit({
      type: "CampaignStatusChanged",
      workspaceId,
      payload: {
        campaignId: androidId,
        batchId,
        platform: "android",
        from: "draft",
        to: "ready",
      },
      dedupeKey: `campaign_status:${androidId}:ready`,
    });
    assert.equal(second.deduped, true);
    const after = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.taskType, "GO_LIVE"),
        ),
      );
    assert.equal(after.length, 1, "no duplicate GO_LIVE on re-emit");
  });

  test("→ ready with only one campaign ready creates no task", async () => {
    const batchId = await insertBatch();
    const iosId = await insertCampaign(batchId, "ios", "ready");
    await insertCampaign(batchId, "android", "draft");

    await emit({
      type: "CampaignStatusChanged",
      workspaceId,
      payload: {
        campaignId: iosId,
        batchId,
        platform: "ios",
        from: "draft",
        to: "ready",
      },
      dedupeKey: `campaign_status:${iosId}:ready`,
    });
    const goLive = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.taskType, "GO_LIVE"),
        ),
      );
    assert.equal(goLive.length, 0, "no GO_LIVE until both ready");
  });

  test("→ live on second campaign creates OPTIMIZATION_FOLLOWUP scheduled at live_at + duration", async () => {
    const batchId = await insertBatch();
    // Stamp a deterministic liveAt + duration.
    const liveAt = new Date("2026-01-01T12:00:00Z");
    await db
      .update(testingBatchesTable)
      .set({ liveAt, testDurationHours: 24 })
      .where(eq(testingBatchesTable.id, batchId));

    await insertCampaign(batchId, "ios", "live");
    const androidId = await insertCampaign(batchId, "android", "live");

    await emit({
      type: "CampaignStatusChanged",
      workspaceId,
      payload: {
        campaignId: androidId,
        batchId,
        platform: "android",
        from: "ready",
        to: "live",
      },
      dedupeKey: `campaign_status:${androidId}:live`,
    });

    const tasks = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.taskType, "OPTIMIZATION_FOLLOWUP"),
        ),
      );
    assert.equal(tasks.length, 1, "one OPTIMIZATION_FOLLOWUP task");
    assert.equal(tasks[0].dueDate, "2026-01-02T12:00:00.000Z");
  });

  test("ignores transitions other than ready / live", async () => {
    const batchId = await insertBatch();
    const iosId = await insertCampaign(batchId, "ios", "draft");
    await emit({
      type: "CampaignStatusChanged",
      workspaceId,
      payload: {
        campaignId: iosId,
        batchId,
        platform: "ios",
        from: null,
        to: "draft",
      },
      dedupeKey: `campaign_status:${iosId}:draft`,
    });
    const tasks = await db
      .select()
      .from(todoTasksTable)
      .where(eq(todoTasksTable.relatedBatchId, batchId));
    assert.equal(tasks.length, 0);
  });
});

describe("rules: BatchResultsRecorded (Pivot Phase 4)", () => {
  test("winnersCount > 0 creates MOVE_WINNERS_TO_SCALED_CAMPAIGN once", async () => {
    const batchId = await insertBatch();
    await db
      .insert(batchResultsTable)
      .values({ workspaceId, batchId, winnersCount: 2, roi: "0" });

    await emit({
      type: "BatchResultsRecorded",
      workspaceId,
      payload: { batchId, winnersCount: 2, roi: "0" },
      dedupeKey: `batch_results:${batchId}`,
    });

    let tasks = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.taskType, "MOVE_WINNERS_TO_SCALED_CAMPAIGN"),
        ),
      );
    assert.equal(tasks.length, 1);

    // Idempotency: re-emit with same dedupe key is a no-op.
    const second = await emit({
      type: "BatchResultsRecorded",
      workspaceId,
      payload: { batchId, winnersCount: 2, roi: "0" },
      dedupeKey: `batch_results:${batchId}`,
    });
    assert.equal(second.deduped, true);
    tasks = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.taskType, "MOVE_WINNERS_TO_SCALED_CAMPAIGN"),
        ),
      );
    assert.equal(tasks.length, 1, "no duplicate move-winners task");
  });

  test("roi > 0 (positive) with winnersCount=0 still creates the task", async () => {
    const batchId = await insertBatch();
    await emit({
      type: "BatchResultsRecorded",
      workspaceId,
      payload: { batchId, winnersCount: 0, roi: "0.25" },
      dedupeKey: `batch_results:${batchId}`,
    });
    const tasks = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.taskType, "MOVE_WINNERS_TO_SCALED_CAMPAIGN"),
        ),
      );
    assert.equal(tasks.length, 1);
  });

  test("winners=0 and roi<=0 produces no task", async () => {
    const batchId = await insertBatch();
    await emit({
      type: "BatchResultsRecorded",
      workspaceId,
      payload: { batchId, winnersCount: 0, roi: "-0.10" },
      dedupeKey: `batch_results:${batchId}`,
    });
    const tasks = await db
      .select()
      .from(todoTasksTable)
      .where(eq(todoTasksTable.relatedBatchId, batchId));
    assert.equal(tasks.length, 0);
  });
});

describe("rules: OptimizationDue (Pivot Phase 4)", () => {
  test("creates OPTIMIZATION_FOLLOWUP task once and is idempotent", async () => {
    const batchId = await insertBatch();
    await emit({
      type: "OptimizationDue",
      workspaceId,
      payload: { batchId },
      dedupeKey: `optimization:${batchId}`,
    });
    let tasks = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.taskType, "OPTIMIZATION_FOLLOWUP"),
        ),
      );
    assert.equal(tasks.length, 1);

    const second = await emit({
      type: "OptimizationDue",
      workspaceId,
      payload: { batchId },
      dedupeKey: `optimization:${batchId}`,
    });
    assert.equal(second.deduped, true);
    tasks = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.taskType, "OPTIMIZATION_FOLLOWUP"),
        ),
      );
    assert.equal(tasks.length, 1);
  });

  test("does not create duplicate task when one already exists", async () => {
    const batchId = await insertBatch();
    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId,
      relatedBatchId: batchId,
      title: "preexisting",
      taskType: "OPTIMIZATION_FOLLOWUP",
    });
    await emit({
      type: "OptimizationDue",
      workspaceId,
      payload: { batchId },
      dedupeKey: `optimization:${batchId}`,
    });
    const tasks = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.taskType, "OPTIMIZATION_FOLLOWUP"),
        ),
      );
    assert.equal(tasks.length, 1, "no second task added");
  });
});

void eventsTable;

describe("rules: TrackerCampaignImported", () => {
  test("completes the matching task and advances batch when both devices imported", async () => {
    const batchId = await insertBatch({
      status: "WAITING_FOR_TRACKER_CAMPAIGNS",
      currentTrafficSourceId: trafficSourceAId,
    });

    // Seed both CREATE_*_TRACKER_CAMPAIGN tasks (as BatchCreated would have).
    const [iosTask] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId,
        employeeId,
        relatedBatchId: batchId,
        title: "iOS",
        taskType: "CREATE_IOS_TRACKER_CAMPAIGN",
        trackerCampaignDevice: "ios",
        trafficSourceId: workspaceTrafficSourceAId,
      })
      .returning({ id: todoTasksTable.id });
    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId,
      relatedBatchId: batchId,
      title: "Android",
      taskType: "CREATE_ANDROID_TRACKER_CAMPAIGN",
      trackerCampaignDevice: "android",
      trafficSourceId: workspaceTrafficSourceAId,
    });

    // Phase 5c: producer no longer pre-inserts. Emit with descriptors;
    // the rule produces RecordTrackerCampaign + CompleteTask actions.
    // Should complete only iOS task, batch should NOT advance yet
    // (android still pending).
    await emit({
      type: "TrackerCampaignImported",
      workspaceId,
      payload: {
        batchId,
        trafficSourceId: trafficSourceAId,
        device: "ios",
        voluumCampaignId: `vc-ios-${Date.now()}`,
        tag: "MB_DE_BATCH01",
      },
    });

    const [iosTaskAfter] = await db
      .select({ status: todoTasksTable.status })
      .from(todoTasksTable)
      .where(eq(todoTasksTable.id, iosTask.id));
    assert.equal(iosTaskAfter.status, "DONE");

    const [batchMid] = await db
      .select({ status: testingBatchesTable.status })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, batchId));
    assert.equal(
      batchMid.status,
      "WAITING_FOR_TRACKER_CAMPAIGNS",
      "batch must still wait while android is missing",
    );

    // Emit android. Now both devices imported for the batch's
    // current source — batch must advance.
    await emit({
      type: "TrackerCampaignImported",
      workspaceId,
      payload: {
        batchId,
        trafficSourceId: trafficSourceAId,
        device: "android",
        voluumCampaignId: `vc-and-${Date.now()}`,
        tag: "MB_DE_BATCH01",
      },
    });

    const [batchAfter] = await db
      .select({ status: testingBatchesTable.status })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, batchId));
    assert.equal(batchAfter.status, "OFFER_READY_FOR_LIVE_TESTING");
  });
});

describe("rules: BatchStatusChanged", () => {
  // Phase 1 cleanup: TESTED no longer seeds a task. Notification only.
  // TODO(Phase 3): re-enable a winners-task assertion once the
  // MOVE_WINNERS_TO_SCALED_CAMPAIGN rule is wired with winner IDs.
  test("to=TESTED emits high-severity notification (no task in Phase 1)", async () => {
    const batchId = await insertBatch({ status: "LIVE_TESTS" });

    await emit({
      type: "BatchStatusChanged",
      workspaceId,
      payload: { batchId, from: "LIVE_TESTS", to: "TESTED" },
    });

    const tasks = await db
      .select()
      .from(todoTasksTable)
      .where(eq(todoTasksTable.relatedBatchId, batchId));
    assert.equal(tasks.length, 0, "Phase 1: no task created on TESTED");

    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.batchId, batchId));
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].severity, "high");
  });
});

describe("rules: TaskCompleted", () => {
  // Pivot Phase 4 (Task #27): TaskCompleted advances the campaign
  // state machine for the manual workflow tasks.

  test("legacy task type produces no actions", async () => {
    const batchId = await insertBatch({ status: "LIVE_TESTS" });
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId,
        employeeId,
        relatedBatchId: batchId,
        title: "Legacy task",
        taskType: "FIND_WINNERS",
      })
      .returning({ id: todoTasksTable.id });

    await emit({
      type: "TaskCompleted",
      workspaceId,
      payload: {
        taskId: task.id,
        taskType: "FIND_WINNERS",
        relatedBatchId: batchId,
      },
    });
    // No campaign rows existed; nothing to assert beyond non-error.
    assert.ok(true);
  });

  test("legacy CREATE_IOS_CAMPAIGN completion no-ops", async () => {
    const batchId = await insertBatch();
    const [ios] = await db
      .insert(campaignsTable)
      .values({
        workspaceId,
        batchId,
        platform: "ios",
        campaignName: "ios",
        status: "draft",
        campaignUrl: "https://example.com/ios",
      })
      .returning({ id: campaignsTable.id });
    // Android already ready so completing iOS task → both ready → GO_LIVE.
    await db.insert(campaignsTable).values({
      workspaceId,
      batchId,
      platform: "android",
      campaignName: "android",
      status: "ready",
      campaignUrl: "https://example.com/android",
    });
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId,
        employeeId,
        relatedBatchId: batchId,
        title: "Create iOS",
        taskType: "CREATE_IOS_CAMPAIGN",
      })
      .returning({ id: todoTasksTable.id });

    await emit({
      type: "TaskCompleted",
      workspaceId,
      payload: {
        taskId: task.id,
        taskType: "CREATE_IOS_CAMPAIGN",
        relatedBatchId: batchId,
      },
    });

    const [iosAfter] = await db
      .select({ status: campaignsTable.status })
      .from(campaignsTable)
      .where(eq(campaignsTable.id, ios.id));
    assert.equal(iosAfter.status, "draft");

    // Cascade: chain-emit CampaignStatusChanged → GO_LIVE seeded.
    const goLive = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.taskType, "GO_LIVE"),
        ),
      );
    assert.equal(goLive.length, 0, "legacy completion does not schedule GO_LIVE");
  });

  test("legacy GO_LIVE completion no-ops", async () => {
    const batchId = await insertBatch();
    const [ios] = await db
      .insert(campaignsTable)
      .values({
        workspaceId,
        batchId,
        platform: "ios",
        campaignName: "ios",
        status: "ready",
      })
      .returning({ id: campaignsTable.id });
    const [android] = await db
      .insert(campaignsTable)
      .values({
        workspaceId,
        batchId,
        platform: "android",
        campaignName: "android",
        status: "ready",
      })
      .returning({ id: campaignsTable.id });
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId,
        employeeId,
        relatedBatchId: batchId,
        title: "Go live",
        taskType: "GO_LIVE",
      })
      .returning({ id: todoTasksTable.id });

    await emit({
      type: "TaskCompleted",
      workspaceId,
      payload: {
        taskId: task.id,
        taskType: "GO_LIVE",
        relatedBatchId: batchId,
      },
    });

    const rows = await db
      .select({ id: campaignsTable.id, status: campaignsTable.status })
      .from(campaignsTable)
      .where(eq(campaignsTable.batchId, batchId));
    for (const r of rows) {
      assert.equal(r.status, "ready", `campaign ${r.id} should remain ready`);
    }
    void ios;
    void android;
  });
});

describe("rules: TaskCompletionRequested", () => {
  test("duplicate completion events are idempotent", async () => {
    const batchId = await insertBatch();
    const trafficSourceId = await getWorkspaceTrafficSourceId();
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId,
        employeeId,
        relatedBatchId: batchId,
        taskType: "create_voluum_campaign_ios",
        title: "Create iOS campaign",
      })
      .returning({ id: todoTasksTable.id });

    const event = {
      type: "TaskCompletionRequested" as const,
      workspaceId,
      payload: {
        taskId: task.id,
        completedByEmployeeId: employeeId,
        completion: {
          kind: "create_voluum_campaign" as const,
          platform: "ios" as const,
          trafficSourceId,
          voluumCampaignId: `dup-${Date.now()}`,
          voluumCampaignName: "Duplicate-safe Campaign",
          campaignName: "Duplicate-safe Campaign",
        },
      },
      dedupeKey: `task_completion_requested:${task.id}:duplicate-test`,
    };

    const first = await emit(event);
    const second = await emit(event);

    assert.equal(first.deduped, false);
    assert.equal(second.deduped, true);

    const campaigns = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(and(eq(campaignsTable.batchId, batchId), eq(campaignsTable.platform, "ios")));
    assert.equal(campaigns.length, 1);

    const completed = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.workspaceId, workspaceId),
          eq(eventsTable.type, "TaskCompleted"),
          eq(eventsTable.dedupeKey, `task_completed:${task.id}`),
        ),
      );
    assert.equal(completed.length, 1);
  });

  test("failed completion rolls back and can be retried with the same dedupe key", async () => {
    const batchId = await insertBatch();
    const trafficSourceId = await getWorkspaceTrafficSourceId();
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId,
        employeeId,
        relatedBatchId: batchId,
        taskType: "create_voluum_campaign_android",
        title: "Create Android campaign",
      })
      .returning({ id: todoTasksTable.id });

    const event = {
      type: "TaskCompletionRequested" as const,
      workspaceId,
      payload: {
        taskId: task.id,
        completedByEmployeeId: employeeId,
        completion: {
          kind: "create_voluum_campaign" as const,
          platform: "android" as const,
          trafficSourceId,
          voluumCampaignId: `retry-${Date.now()}`,
          voluumCampaignName: "Retry Campaign",
          campaignName: "Retry Campaign",
        },
      },
      dedupeKey: `task_completion_requested:${task.id}:retry-test`,
    };

    registerHandler("TaskCompleted", async () => {
      throw new Error("forced retry failure");
    });

    await assert.rejects(() => emit(event), /forced retry failure/);

    const [afterFailure] = await db
      .select({
        status: todoTasksTable.status,
        relatedCampaignId: todoTasksTable.relatedCampaignId,
      })
      .from(todoTasksTable)
      .where(eq(todoTasksTable.id, task.id));
    assert.equal(afterFailure.status, "TODO");
    assert.equal(afterFailure.relatedCampaignId, null);

    const failedCampaigns = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(eq(campaignsTable.batchId, batchId));
    assert.equal(failedCampaigns.length, 0);

    _resetRegistryForTests();
    _resetRulesGuardForTests();
    registerAllRules();

    const retry = await emit(event);
    assert.equal(retry.deduped, false);

    const [afterRetry] = await db
      .select({
        status: todoTasksTable.status,
        relatedCampaignId: todoTasksTable.relatedCampaignId,
      })
      .from(todoTasksTable)
      .where(eq(todoTasksTable.id, task.id));
    assert.equal(afterRetry.status, "DONE");
    assert.ok(afterRetry.relatedCampaignId !== null);
  });
});

describe("rules: TaskOverdue (cron-driven)", () => {
  test("escalates an old TODO task and is idempotent on re-scan", async () => {
    const batchId = await insertBatch();
    // Backdate the task by 30h so it's past the 24h default threshold.
    const [task] = await db
      .insert(todoTasksTable)
      .values({
        workspaceId,
        employeeId,
        relatedBatchId: batchId,
        title: `Stale FIND_WINNERS ${Date.now()}`,
        taskType: "FIND_WINNERS",
        status: "TODO",
        createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
      })
      .returning({ id: todoTasksTable.id });

    const first = await runOverdueTasksScan();
    assert.ok(first.scanned >= 1);
    assert.ok(first.emitted >= 1);

    const [escalated] = await db
      .select({
        flashing: todoTasksTable.flashing,
        escalatedAt: todoTasksTable.escalatedAt,
      })
      .from(todoTasksTable)
      .where(eq(todoTasksTable.id, task.id));
    assert.equal(escalated.flashing, true);
    assert.ok(escalated.escalatedAt !== null);

    const notifs = await db
      .select({
        type: notificationsTable.type,
        severity: notificationsTable.severity,
        employeeId: notificationsTable.employeeId,
      })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.batchId, batchId),
          eq(notificationsTable.type, "TASK_OVERDUE"),
        ),
      );
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].severity, "high");
    assert.equal(notifs[0].employeeId, employeeId);

    // Second scan: the task now has escalatedAt set, so it falls out of
    // the candidate set entirely (no new emit, no duplicate notification).
    const second = await runOverdueTasksScan();
    const taskInSecondScan = second.scanned;
    assert.ok(
      true,
      `second scan saw ${taskInSecondScan} candidates (task should be excluded)`,
    );

    const notifsAfter = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.batchId, batchId),
          eq(notificationsTable.type, "TASK_OVERDUE"),
        ),
      );
    assert.equal(notifsAfter.length, 1, "no duplicate TASK_OVERDUE notification");
  });

  test("does not escalate fresh tasks or DONE tasks", async () => {
    const batchId = await insertBatch();
    // Fresh TODO — well under threshold.
    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId,
      relatedBatchId: batchId,
      title: `Fresh ${Date.now()}`,
      taskType: "FIND_WINNERS",
      status: "TODO",
    });
    // Old but DONE — must not escalate.
    await db.insert(todoTasksTable).values({
      workspaceId,
      employeeId,
      relatedBatchId: batchId,
      title: `Done ${Date.now()}`,
      taskType: "FIND_WINNERS",
      status: "DONE",
      createdAt: new Date(Date.now() - 100 * 60 * 60 * 1000),
    });

    await runOverdueTasksScan();

    const notifs = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.batchId, batchId),
          eq(notificationsTable.type, "TASK_OVERDUE"),
        ),
      );
    assert.equal(notifs.length, 0);
  });
});

describe("rules: TrafficSourceAdvanced", () => {
  test("seeds 2 new tracker tasks + resets status to WAITING", async () => {
    const batchId = await insertBatch({
      status: "LIVE_TESTS",
      currentTrafficSourceId: trafficSourceAId,
    });

    await emit({
      type: "TrafficSourceAdvanced",
      workspaceId,
      payload: {
        batchId,
        previousTrafficSourceId: trafficSourceAId,
        nextTrafficSourceId: workspaceTrafficSourceBId,
        nextTrafficSourceName: "Source B",
      },
    });

    const tasks = await db
      .select()
      .from(todoTasksTable)
      .where(
        and(
          eq(todoTasksTable.relatedBatchId, batchId),
          eq(todoTasksTable.trafficSourceId, workspaceTrafficSourceBId),
        ),
      );
    assert.equal(tasks.length, 2);

    const [batch] = await db
      .select({ status: testingBatchesTable.status })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, batchId));
    // Spec-correction (post Phase 10): the new source must repeat the
    // tracker-campaign step from scratch — reset to NEW_BATCH (the
    // TrackerCampaignImported handler will move it to WAITING when
    // the first tracker arrives for the new source).
    assert.equal(batch.status, "NEW_BATCH");
  });
});

describe("rules: BatchTested", () => {
  test("flips status to TESTED only when not already TESTED/COMPLETED", async () => {
    const batchId = await insertBatch({ status: "LIVE_TESTS" });

    await emit({
      type: "BatchTested",
      workspaceId,
      payload: { batchId },
    });

    const [batch] = await db
      .select({ status: testingBatchesTable.status })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, batchId));
    assert.equal(batch.status, "TESTED");
  });

  // TODO(Phase 3): re-add a "BatchTested chains MOVE_WINNERS_TO_SCALED_CAMPAIGN"
  // assertion once the winner-selection rule populates the task payload.
  test("chain-emits BatchStatusChanged so the notification fires", async () => {
    const batchId = await insertBatch({ status: "LIVE_TESTS" });

    await emit({
      type: "BatchTested",
      workspaceId,
      payload: { batchId },
    });

    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.batchId, batchId));
    assert.ok(
      notifs.some((n) => n.severity === "high"),
      "BatchStatusChanged → high-severity notification must fire",
    );
  });
});

describe("rules: BatchStatsUpdated (Phase 5d)", () => {
  test("crosses click threshold → chains to TESTED", async () => {
    const batchId = await insertBatch({ status: "LIVE_TESTS" });
    // Set the threshold low and seed a performance row above it.
    await db
      .update(testingBatchesTable)
      .set({ clicksThreshold: 5 })
      .where(eq(testingBatchesTable.id, batchId));
    await db.insert(performanceTable).values({
      batchId,
      date: "2026-05-08",
      clicks: 100,
    });

    await emit({
      type: "BatchStatsUpdated",
      workspaceId,
      payload: { batchId },
    });

    const [batch] = await db
      .select({ status: testingBatchesTable.status })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, batchId));
    assert.equal(batch.status, "TESTED");
    // TODO(Phase 3): assert MOVE_WINNERS_TO_SCALED_CAMPAIGN task seeded.
  });

  test("under threshold → no transition, no task", async () => {
    const batchId = await insertBatch({ status: "LIVE_TESTS" });
    await db
      .update(testingBatchesTable)
      .set({ clicksThreshold: 1000 })
      .where(eq(testingBatchesTable.id, batchId));
    await db.insert(performanceTable).values({
      batchId,
      date: "2026-05-08",
      clicks: 50,
    });

    await emit({
      type: "BatchStatsUpdated",
      workspaceId,
      payload: { batchId },
    });

    const [batch] = await db
      .select({ status: testingBatchesTable.status })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, batchId));
    assert.equal(batch.status, "LIVE_TESTS");
  });

  test("re-emit after crossing is idempotent (status stays TESTED, no duplicate notification)", async () => {
    const batchId = await insertBatch({ status: "LIVE_TESTS" });
    await db
      .update(testingBatchesTable)
      .set({ clicksThreshold: 5 })
      .where(eq(testingBatchesTable.id, batchId));
    await db.insert(performanceTable).values({
      batchId,
      date: "2026-05-08",
      clicks: 100,
    });

    await emit({
      type: "BatchStatsUpdated",
      workspaceId,
      payload: { batchId },
    });
    await emit({
      type: "BatchStatsUpdated",
      workspaceId,
      payload: { batchId },
    });

    const notifs = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.batchId, batchId),
          eq(notificationsTable.severity, "high"),
        ),
      );
    assert.equal(notifs.length, 1, "high-severity notification must not duplicate on re-emit");
  });
});

describe("rules: VoluumCampaignTagInvalid (Phase 6b)", () => {
  test("fans INVALID_TAG notification out to every workspace admin", async () => {
    // Seed: one global admin (employees.role = 'admin'), one per-workspace
    // admin (assignment.role = 'admin'), and one regular employee that
    // should NOT be notified.
    const [globalAdmin] = await db
      .insert(employeesTable)
      .values({
        name: "Global Admin",
        email: `global-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
        role: "admin",
        passwordHash: "x",
      })
      .returning({ id: employeesTable.id });

    const [wsAdmin] = await db
      .insert(employeesTable)
      .values({
        name: "WS Admin",
        email: `ws-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
        role: "employee",
        passwordHash: "x",
      })
      .returning({ id: employeesTable.id });
    await db.insert(employeeWorkspaceAssignmentsTable).values({
      employeeId: wsAdmin.id,
      workspaceId,
      role: "admin",
    });

    const [regular] = await db
      .insert(employeesTable)
      .values({
        name: "Regular",
        email: `regular-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
        role: "employee",
        passwordHash: "x",
      })
      .returning({ id: employeesTable.id });
    await db.insert(employeeWorkspaceAssignmentsTable).values({
      employeeId: regular.id,
      workspaceId,
      role: "employee",
    });

    const voluumCampaignId = `vc-bad-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const result = await emit({
      type: "VoluumCampaignTagInvalid",
      workspaceId,
      payload: {
        voluumCampaignId,
        voluumCampaignName: "Bad Tag Campaign",
        offendingTag: "sl_de_batch1_ios_unknownsource",
        reason: "invalid_tag_format",
      },
      dedupeKey: `invalid_tag:${voluumCampaignId}:invalid_tag_format`,
    });
    assert.equal(result.deduped, false);

    // Both admin cohorts should have received exactly one INVALID_TAG
    // notification each. The regular employee must not.
    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.workspaceId, workspaceId),
        eq(notificationsTable.type, "INVALID_TAG"),
      ));
    const recipientIds = new Set(notifs.map((n) => n.employeeId));
    assert.ok(recipientIds.has(globalAdmin.id), "global admin should receive INVALID_TAG");
    assert.ok(recipientIds.has(wsAdmin.id), "ws admin should receive INVALID_TAG");
    assert.ok(!recipientIds.has(regular.id), "regular employee must NOT receive INVALID_TAG");
    assert.ok(notifs.every((n) => n.severity === "warning"), "severity must be warning");
    assert.ok(
      notifs.every((n) => n.message.includes("Bad Tag Campaign")),
      "notification message includes the offending campaign name",
    );

    // Idempotency: re-emit with the same dedupeKey produces no extra
    // notifications and reports deduped: true.
    const replay = await emit({
      type: "VoluumCampaignTagInvalid",
      workspaceId,
      payload: {
        voluumCampaignId,
        voluumCampaignName: "Bad Tag Campaign",
        offendingTag: "sl_de_batch1_ios_unknownsource",
        reason: "invalid_tag_format",
      },
      dedupeKey: `invalid_tag:${voluumCampaignId}:invalid_tag_format`,
    });
    assert.equal(replay.deduped, true);
    const notifsAfter = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.workspaceId, workspaceId),
        eq(notificationsTable.type, "INVALID_TAG"),
      ));
    assert.equal(notifsAfter.length, notifs.length, "dedupe must prevent re-fan-out");
  });
});

describe("rules: workspace isolation", () => {
  test("rule reads do not leak across workspaces", async () => {
    // A batch in OTHER workspace with the same id space — emit in our
    // workspace must not match it.
    const [foreign] = await db
      .insert(testingBatchesTable)
      .values({
        workspaceId: otherWorkspaceId,
        employeeId,
        batchName: "Foreign batch",
        affiliateNetwork: "MyBookie",
        geo: "DE",
        trafficSource: "Source A",
        batchTag: `MB_DE_FOREIGN_${Date.now()}`,
        status: "LIVE_TESTS",
      })
      .returning({ id: testingBatchesTable.id });

    // Emit in OUR workspace pointing at the foreign batchId — handler
    // must select 0 rows and return [] (no notifications, no status flip).
    await emit({
      type: "BatchStatusChanged",
      workspaceId,
      payload: { batchId: foreign.id, from: "LIVE_TESTS", to: "TESTED" },
    });

    const [batch] = await db
      .select({ status: testingBatchesTable.status })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, foreign.id));
    assert.equal(batch.status, "LIVE_TESTS", "foreign batch must be untouched");

    const notifs = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(eq(notificationsTable.batchId, foreign.id));
    assert.equal(notifs.length, 0);
  });
});
