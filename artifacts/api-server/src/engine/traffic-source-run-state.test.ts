import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, asc, eq } from "drizzle-orm";
import {
  batchTrafficSourceRunsTable,
  campaignsTable,
  db,
  employeesTable,
  testingBatchesTable,
  todoTasksTable,
  workspacesTable,
  workspaceTrafficSourcesTable,
} from "@workspace/db";
import { emit } from "./event-bus.ts";
import { _resetRegistryForTests } from "./handlers.ts";
import { _resetRulesGuardForTests, registerAllRules } from "./rules/index.ts";

type PlatformOutcome = "success" | "failed";

let createdWorkspaceIds: number[] = [];
let createdEmployeeIds: number[] = [];

beforeEach(() => {
  _resetRegistryForTests();
  _resetRulesGuardForTests();
  registerAllRules();
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

async function seedRunMachine() {
  const [workspace] = await db
    .insert(workspacesTable)
    .values({ name: `run-machine-${Date.now()}-${Math.floor(Math.random() * 1e6)}` })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(workspace.id);

  const [employee] = await db
    .insert(employeesTable)
    .values({
      name: "Run Machine Tester",
      email: `run-machine-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
      passwordHash: "x",
      role: "employee",
    })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(employee.id);

  const [sourceOne] = await db
    .insert(workspaceTrafficSourcesTable)
    .values({ workspaceId: workspace.id, name: "Source One", position: 1, isActive: true })
    .returning({ id: workspaceTrafficSourcesTable.id });
  const [sourceTwo] = await db
    .insert(workspaceTrafficSourcesTable)
    .values({ workspaceId: workspace.id, name: "Source Two", position: 2, isActive: true })
    .returning({ id: workspaceTrafficSourcesTable.id });

  const [batch] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId: workspace.id,
      employeeId: employee.id,
      batchName: `Run Batch ${Date.now()}`,
      affiliateNetwork: "Network",
      geo: "DE",
      trafficSource: "Source One",
      currentWorkspaceTrafficSourceId: sourceOne.id,
      batchTag: `run_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    })
    .returning({ id: testingBatchesTable.id });

  await db.insert(batchTrafficSourceRunsTable).values([
    {
      workspaceId: workspace.id,
      batchId: batch.id,
      trafficSourceId: sourceOne.id,
      position: 1,
      status: "active",
      iosStatus: "active",
      androidStatus: "active",
      startedAt: new Date(),
    },
    {
      workspaceId: workspace.id,
      batchId: batch.id,
      trafficSourceId: sourceTwo.id,
      position: 2,
      status: "pending",
      iosStatus: "pending",
      androidStatus: "pending",
    },
  ]);

  const [iosCampaign] = await db
    .insert(campaignsTable)
    .values({
      workspaceId: workspace.id,
      batchId: batch.id,
      platform: "ios",
      campaignName: "iOS Source One",
      trafficSourceId: sourceOne.id,
      status: "live",
    })
    .returning({ id: campaignsTable.id });
  const [androidCampaign] = await db
    .insert(campaignsTable)
    .values({
      workspaceId: workspace.id,
      batchId: batch.id,
      platform: "android",
      campaignName: "Android Source One",
      trafficSourceId: sourceOne.id,
      status: "live",
    })
    .returning({ id: campaignsTable.id });

  return {
    workspaceId: workspace.id,
    employeeId: employee.id,
    batchId: batch.id,
    sourceOneId: sourceOne.id,
    sourceTwoId: sourceTwo.id,
    iosCampaignId: iosCampaign.id,
    androidCampaignId: androidCampaign.id,
  };
}

type RunMachineSeed = {
  workspaceId: number;
  employeeId: number;
  batchId: number;
  iosCampaignId: number;
  androidCampaignId: number;
};

async function completeFindWinners(
  seed: RunMachineSeed,
  platform: "ios" | "android",
  outcome: PlatformOutcome,
) {
  const campaignId = platform === "ios" ? seed.iosCampaignId : seed.androidCampaignId;
  const failureReason = `${platform} source rejected campaign`;
  await db
    .update(campaignsTable)
    .set({ status: outcome === "success" ? "tested" : "closed" })
    .where(eq(campaignsTable.id, campaignId));

  const [task] = await db
    .insert(todoTasksTable)
    .values({
      workspaceId: seed.workspaceId,
      employeeId: seed.employeeId,
      relatedBatchId: seed.batchId,
      relatedCampaignId: campaignId,
      taskType: "find_winners",
      title: `Find winners ${platform}`,
      status: "DONE",
      completionPayload:
        outcome === "success"
          ? { winnersCount: 1, revenue: 10, cost: 5 }
          : { outcome: "failed", failureReason },
    })
    .returning({ id: todoTasksTable.id });

  await emit({
    type: "TaskCompleted",
    workspaceId: seed.workspaceId,
    payload: {
      taskId: task.id,
      taskType: "find_winners",
      relatedBatchId: seed.batchId,
      relatedCampaignId: campaignId,
    },
    dedupeKey: `test_find_winners:${task.id}`,
  });

  return { taskId: task.id, failureReason };
}

async function getRuns(batchId: number) {
  return db
    .select()
    .from(batchTrafficSourceRunsTable)
    .where(eq(batchTrafficSourceRunsTable.batchId, batchId))
    .orderBy(asc(batchTrafficSourceRunsTable.position));
}

async function getCreateTasks(batchId: number, sourceId: number) {
  return db
    .select()
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.relatedBatchId, batchId),
        eq(todoTasksTable.trafficSourceId, sourceId),
      ),
    );
}

async function seedSingleSourceRun() {
  const [workspace] = await db
    .insert(workspacesTable)
    .values({ name: `run-terminal-${Date.now()}-${Math.floor(Math.random() * 1e6)}` })
    .returning({ id: workspacesTable.id });
  createdWorkspaceIds.push(workspace.id);

  const [employee] = await db
    .insert(employeesTable)
    .values({
      name: "Run Terminal Tester",
      email: `run-terminal-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`,
      passwordHash: "x",
      role: "employee",
    })
    .returning({ id: employeesTable.id });
  createdEmployeeIds.push(employee.id);

  const [sourceOne] = await db
    .insert(workspaceTrafficSourcesTable)
    .values({ workspaceId: workspace.id, name: "Only Source", position: 1, isActive: true })
    .returning({ id: workspaceTrafficSourcesTable.id });

  const [batch] = await db
    .insert(testingBatchesTable)
    .values({
      workspaceId: workspace.id,
      employeeId: employee.id,
      batchName: `Terminal Batch ${Date.now()}`,
      affiliateNetwork: "Network",
      geo: "DE",
      trafficSource: "Only Source",
      currentWorkspaceTrafficSourceId: sourceOne.id,
      batchTag: `terminal_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    })
    .returning({ id: testingBatchesTable.id });

  await db.insert(batchTrafficSourceRunsTable).values({
    workspaceId: workspace.id,
    batchId: batch.id,
    trafficSourceId: sourceOne.id,
    position: 1,
    status: "active",
    iosStatus: "active",
    androidStatus: "active",
    startedAt: new Date(),
  });

  const [iosCampaign] = await db
    .insert(campaignsTable)
    .values({
      workspaceId: workspace.id,
      batchId: batch.id,
      platform: "ios",
      campaignName: "iOS Only Source",
      trafficSourceId: sourceOne.id,
      status: "live",
    })
    .returning({ id: campaignsTable.id });
  const [androidCampaign] = await db
    .insert(campaignsTable)
    .values({
      workspaceId: workspace.id,
      batchId: batch.id,
      platform: "android",
      campaignName: "Android Only Source",
      trafficSourceId: sourceOne.id,
      status: "live",
    })
    .returning({ id: campaignsTable.id });

  return {
    workspaceId: workspace.id,
    employeeId: employee.id,
    batchId: batch.id,
    sourceOneId: sourceOne.id,
    iosCampaignId: iosCampaign.id,
    androidCampaignId: androidCampaign.id,
  };
}

async function getTerminalTasks(batchId: number) {
  return db
    .select()
    .from(todoTasksTable)
    .where(
      and(
        eq(todoTasksTable.relatedBatchId, batchId),
        eq(todoTasksTable.taskType, "all_traffic_sources_tested"),
      ),
    );
}

describe("batch traffic source run state machine", { concurrency: false }, () => {
  test("both success completes the run and activates the next source", async () => {
    const seed = await seedRunMachine();

    await completeFindWinners(seed, "ios", "success");
    await completeFindWinners(seed, "android", "success");

    const [current, next] = await getRuns(seed.batchId);
    assert.equal(current.status, "completed");
    assert.equal(current.iosStatus, "completed");
    assert.equal(current.androidStatus, "completed");
    assert.equal(current.iosCampaignId, seed.iosCampaignId);
    assert.equal(current.androidCampaignId, seed.androidCampaignId);
    assert.ok(current.iosCompletedAt);
    assert.ok(current.androidCompletedAt);
    assert.ok(current.completedAt);
    assert.equal(next.status, "active");
    assert.equal(next.iosStatus, "active");
    assert.equal(next.androidStatus, "active");
  });

  test("iOS success and Android fail still progresses", async () => {
    const seed = await seedRunMachine();

    await completeFindWinners(seed, "ios", "success");
    const { failureReason } = await completeFindWinners(seed, "android", "failed");

    const [current, next] = await getRuns(seed.batchId);
    assert.equal(current.status, "completed");
    assert.equal(current.iosStatus, "completed");
    assert.equal(current.androidStatus, "failed");
    assert.equal(current.androidFailureReason, failureReason);
    assert.equal(next.status, "active");
  });

  test("Android success and iOS fail still progresses", async () => {
    const seed = await seedRunMachine();

    await completeFindWinners(seed, "android", "success");
    const { failureReason } = await completeFindWinners(seed, "ios", "failed");

    const [current, next] = await getRuns(seed.batchId);
    assert.equal(current.status, "completed");
    assert.equal(current.iosStatus, "failed");
    assert.equal(current.androidStatus, "completed");
    assert.equal(current.iosFailureReason, failureReason);
    assert.equal(next.status, "active");
  });

  test("both fail on a non-last source advances with paired next-source tasks", async () => {
    const seed = await seedRunMachine();

    await completeFindWinners(seed, "ios", "failed");
    await completeFindWinners(seed, "android", "failed");

    const [current, next] = await getRuns(seed.batchId);
    assert.equal(current.status, "failed");
    assert.equal(current.iosStatus, "failed");
    assert.equal(current.androidStatus, "failed");
    assert.ok(current.completedAt);
    assert.equal(next.status, "active");
    assert.equal(next.iosStatus, "active");
    assert.equal(next.androidStatus, "active");

    const createTasks = await getCreateTasks(seed.batchId, seed.sourceTwoId);
    assert.equal(createTasks.length, 2);
    assert.deepEqual(
      createTasks.map((t) => t.taskType).sort(),
      ["create_voluum_campaign_android", "create_voluum_campaign_ios"],
    );
  });

  test("both fail on the last source creates all_traffic_sources_tested once", async () => {
    const seed = await seedSingleSourceRun();

    await completeFindWinners(seed, "ios", "failed");
    await completeFindWinners(seed, "android", "failed");

    const [current] = await getRuns(seed.batchId);
    assert.equal(current.status, "failed");
    assert.equal(current.iosStatus, "failed");
    assert.equal(current.androidStatus, "failed");

    const terminalTasks = await getTerminalTasks(seed.batchId);
    assert.equal(terminalTasks.length, 1);
    assert.equal(terminalTasks[0]?.taskType, "all_traffic_sources_tested");
  });

  test("one platform fails while sibling remains active does not advance", async () => {
    const seed = await seedRunMachine();

    await completeFindWinners(seed, "ios", "failed");
    let [current, next] = await getRuns(seed.batchId);
    assert.equal(current.status, "active");
    assert.equal(current.iosStatus, "failed");
    assert.equal(current.androidStatus, "active");
    assert.equal(next.status, "pending");

    const createTasks = await getCreateTasks(seed.batchId, seed.sourceTwoId);
    assert.equal(createTasks.length, 0);

    const terminalTasks = await getTerminalTasks(seed.batchId);
    assert.equal(terminalTasks.length, 0);
  });

  test("duplicate completion events after dual-fail do not create next-source tasks twice", async () => {
    const seed = await seedRunMachine();

    await completeFindWinners(seed, "ios", "failed");
    const { taskId } = await completeFindWinners(seed, "android", "failed");
    await emit({
      type: "TaskCompleted",
      workspaceId: seed.workspaceId,
      payload: {
        taskId,
        taskType: "find_winners",
        relatedBatchId: seed.batchId,
        relatedCampaignId: seed.androidCampaignId,
      },
      dedupeKey: `test_duplicate_dual_fail:${taskId}`,
    });

    const [current, next] = await getRuns(seed.batchId);
    assert.equal(current.status, "failed");
    assert.equal(next.status, "active");

    const createTasks = await getCreateTasks(seed.batchId, seed.sourceTwoId);
    assert.equal(createTasks.length, 2);
  });

  test("duplicate completion events do not progress or create tasks twice", async () => {
    const seed = await seedRunMachine();

    await completeFindWinners(seed, "ios", "success");
    const { taskId } = await completeFindWinners(seed, "android", "success");
    await emit({
      type: "TaskCompleted",
      workspaceId: seed.workspaceId,
      payload: {
        taskId,
        taskType: "find_winners",
        relatedBatchId: seed.batchId,
        relatedCampaignId: seed.androidCampaignId,
      },
      dedupeKey: `test_duplicate_find_winners:${taskId}`,
    });

    const [current, next] = await getRuns(seed.batchId);
    assert.equal(current.status, "completed");
    assert.equal(next.status, "active");

    const createTasks = await getCreateTasks(seed.batchId, seed.sourceTwoId);
    assert.equal(createTasks.length, 2);
  });

  test("next-source progression starts iOS and Android together", async () => {
    const seed = await seedRunMachine();

    await completeFindWinners(seed, "ios", "success");
    let [, next] = await getRuns(seed.batchId);
    assert.equal(next.status, "pending");

    await completeFindWinners(seed, "android", "failed");
    [, next] = await getRuns(seed.batchId);

    const [batch] = await db
      .select({
        currentWorkspaceTrafficSourceId: testingBatchesTable.currentWorkspaceTrafficSourceId,
        trafficSourceStep: testingBatchesTable.trafficSourceStep,
      })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, seed.batchId));
    const createTasks = await getCreateTasks(seed.batchId, seed.sourceTwoId);

    assert.equal(next.status, "active");
    assert.equal(next.iosStatus, "active");
    assert.equal(next.androidStatus, "active");
    assert.equal(batch.currentWorkspaceTrafficSourceId, seed.sourceTwoId);
    assert.equal(batch.trafficSourceStep, 1);
    assert.deepEqual(
      createTasks.map((t) => t.taskType).sort(),
      ["create_voluum_campaign_android", "create_voluum_campaign_ios"],
    );
  });
});
