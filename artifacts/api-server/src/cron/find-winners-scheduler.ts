// CampaignOps redesign — 7-day Find Winners scheduler.
//
// Scans live Campaigns whose liveStartedAt is at least 7 days ago and
// which do not yet have an open or completed find_winners task. For each
// such campaign, emit a TaskCompleted-chain seed via direct CreateTask
// (through the engine) so the worker is asked to record performance
// and decide on winners.
//
// TODO: switch the 7-day window to BUSINESS DAYS (skip weekends &
// configured holidays) once the holidays table lands.

import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db, campaignsTable, todoTasksTable, testingBatchesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { emit } from "../engine/event-bus";
import {
  formatFindWinnersTitle,
  resolveCampaignDisplayName,
} from "../lib/campaign-display-name.ts";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 min

let pollTimer: NodeJS.Timeout | null = null;
let bootTimer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);
    const due = await db
      .select({
        id: campaignsTable.id,
        workspaceId: campaignsTable.workspaceId,
        batchId: campaignsTable.batchId,
        platform: campaignsTable.platform,
        campaignName: campaignsTable.campaignName,
      })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.status, "live"),
          isNotNull(campaignsTable.batchId),
          isNotNull(campaignsTable.liveStartedAt),
          lte(campaignsTable.liveStartedAt, cutoff),
        ),
      );

    for (const c of due) {
      if (c.batchId == null) continue;
      // Skip if a find_winners task already exists for this campaign.
      const [existing] = await db
        .select({ id: todoTasksTable.id })
        .from(todoTasksTable)
        .where(
          and(
            eq(todoTasksTable.workspaceId, c.workspaceId),
            eq(todoTasksTable.relatedCampaignId, c.id),
            eq(todoTasksTable.taskType, "find_winners"),
          ),
        )
        .limit(1);
      if (existing) continue;

      const [batch] = await db
        .select({
          employeeId: testingBatchesTable.employeeId,
          batchName: testingBatchesTable.batchName,
        })
        .from(testingBatchesTable)
        .where(eq(testingBatchesTable.id, c.batchId))
        .limit(1);
      if (!batch || batch.employeeId == null) continue;

      const displayName = resolveCampaignDisplayName({
        campaignName: c.campaignName,
        batchName: batch.batchName,
        platform: c.platform,
      });

      // Emit a synthetic event so the engine creates the task through the
      // normal action plane. We piggy-back on the existing TrafficSourceAdvanced
      // pattern by inserting via CreateTask through a one-shot rule? Simpler:
      // call into the engine via a manual emit + the executor's CreateTask.
      // Easiest: just insert directly via emit() chain — but todoTasksTable
      // is engine-owned. So we issue a fresh action through the bus by
      // emitting a CampaignStatusChanged-shaped event isn't right either.
      //
      // The cleanest approach is to write a synthetic TaskCompleted with a
      // dummy upstream task — but that complicates accounting. Instead,
      // create the task via the action plane by emitting a custom event
      // would require a new event type. Avoid the churn: route it through
      // a dedicated insert below using the emit() bus' chained executor.
      //
      // We piggy-back on the take_campaign_live → find_winners semantics:
      // emit a TaskCompleted with no upstream taskId and have the
      // task-completed rule generate find_winners. But the rule reads the
      // task by id. Simplest pragmatic path: do it via a direct DB insert
      // here. todoTasksTable IS in FORBIDDEN_TABLES, so this file is
      // exempted via PHASE5_LEGACY_EXEMPTIONS in the lint check.
      //
      // To stay within the engine boundary, we use emit() with a new
      // synthetic event type. We add `FindWinnersDue` to the union below.
      try {
        await emit({
          type: "FindWinnersDue",
          workspaceId: c.workspaceId,
          payload: {
            batchId: c.batchId,
            campaignId: c.id,
            employeeId: batch.employeeId,
            campaignName: displayName,
            taskTitle: formatFindWinnersTitle(displayName),
          },
          dedupeKey: `find_winners:${c.id}`,
        });
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), campaignId: c.id },
          "[find-winners-scheduler] emit failed",
        );
      }
    }

    if (due.length > 0) {
      logger.info({ candidates: due.length }, "[find-winners-scheduler] processed");
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[find-winners-scheduler] tick failed",
    );
  }
}

export function startFindWinnersScheduler(): () => void {
  if (pollTimer || bootTimer) {
    return () => {
      stopFindWinnersSchedulerTimers();
    };
  }

  bootTimer = setTimeout(() => {
    bootTimer = null;
    void tick();
  }, 30_000);

  pollTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  if (typeof pollTimer.unref === "function") pollTimer.unref();

  logger.info("[find-winners-scheduler] started (7-day scan, 15 min poll)");

  return stopFindWinnersSchedulerTimers;
}

function stopFindWinnersSchedulerTimers(): void {
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function stopFindWinnersScheduler(): void {
  stopFindWinnersSchedulerTimers();
}
