import type { operationalEventsTable } from "@workspace/db";

export const BATCH_HEALTH_EVENT_TYPES = [
  "BATCH_CREATED",
  "TRAFFIC_SOURCE_RUN_ACTIVATED",
  "TRAFFIC_SOURCE_RUN_TERMINAL",
  "TASK_CREATED",
  "TASK_COMPLETED",
  "CAMPAIGN_LINKED",
  "RECONCILIATION_VIOLATION",
] as const;

const TERMINAL_PLATFORM_STATUSES = new Set(["completed", "failed", "skipped"]);

const CREATE_VOLUUM_IOS = "create_voluum_campaign_ios";
const CREATE_VOLUUM_ANDROID = "create_voluum_campaign_android";

export type BatchHealthActiveRun = {
  runId: number;
  trafficSourceId: number;
  trafficSourceName: string;
  position: number;
  status: string;
  iosStatus: string;
  androidStatus: string;
  iosCampaignId: number | null;
  androidCampaignId: number | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type BatchHealthOpenTask = {
  id: number;
  taskType: string;
  status: string;
  title: string;
  assignedEmployeeId: number;
  relatedCampaignId: number | null;
  trafficSourceId: number | null;
  dueDate: string | null;
};

export type BatchHealthOperationalEvent = {
  id: number;
  eventType: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId: string | null;
  source: string;
  payloadJson: Record<string, unknown>;
  createdAt: string;
};

export type BatchHealthFlags = {
  hasActiveRun: boolean;
  activeRunMissingCreateTasks: boolean;
  activeRunPartiallyTerminal: boolean;
  activeRunFullyTerminalButNotAdvanced: boolean;
  hasRecentReconciliationViolation: boolean;
  openTaskCount: number;
};

function isPlatformTerminal(status: string): boolean {
  return TERMINAL_PLATFORM_STATUSES.has(status);
}

function hasOpenCreateTask(
  openTasks: BatchHealthOpenTask[],
  trafficSourceId: number,
  taskType: typeof CREATE_VOLUUM_IOS | typeof CREATE_VOLUUM_ANDROID,
): boolean {
  return openTasks.some(
    (task) =>
      task.trafficSourceId === trafficSourceId && task.taskType === taskType,
  );
}

export function deriveBatchHealthFlags(
  activeRun: BatchHealthActiveRun | null,
  openTasks: BatchHealthOpenTask[],
  recentEvents: BatchHealthOperationalEvent[],
): BatchHealthFlags {
  const openTaskCount = openTasks.length;
  const hasActiveRun = activeRun !== null;

  let activeRunMissingCreateTasks = false;
  let activeRunPartiallyTerminal = false;
  let activeRunFullyTerminalButNotAdvanced = false;

  if (activeRun != null && activeRun.status === "active") {
    const iosTerminal = isPlatformTerminal(activeRun.iosStatus);
    const androidTerminal = isPlatformTerminal(activeRun.androidStatus);
    activeRunPartiallyTerminal =
      (iosTerminal && !androidTerminal) || (!iosTerminal && androidTerminal);
    activeRunFullyTerminalButNotAdvanced = iosTerminal && androidTerminal;

    const needsIos = activeRun.iosCampaignId == null;
    const needsAndroid = activeRun.androidCampaignId == null;
    activeRunMissingCreateTasks =
      (needsIos &&
        !hasOpenCreateTask(
          openTasks,
          activeRun.trafficSourceId,
          CREATE_VOLUUM_IOS,
        )) ||
      (needsAndroid &&
        !hasOpenCreateTask(
          openTasks,
          activeRun.trafficSourceId,
          CREATE_VOLUUM_ANDROID,
        ));
  }

  const hasRecentReconciliationViolation = recentEvents.some(
    (event) => event.eventType === "RECONCILIATION_VIOLATION",
  );

  return {
    hasActiveRun,
    activeRunMissingCreateTasks,
    activeRunPartiallyTerminal,
    activeRunFullyTerminalButNotAdvanced,
    hasRecentReconciliationViolation,
    openTaskCount,
  };
}

/** True when the event clearly belongs to this batch (workspace already scoped). */
export function operationalEventReferencesBatch(
  event: Pick<
    typeof operationalEventsTable.$inferSelect,
    "eventType" | "entityType" | "entityId" | "payloadJson"
  >,
  batchId: number,
): boolean {
  const payload = (event.payloadJson ?? {}) as Record<string, unknown>;

  switch (event.eventType) {
    case "BATCH_CREATED":
      return event.entityType === "batch" && event.entityId === String(batchId);
    case "TRAFFIC_SOURCE_RUN_ACTIVATED":
    case "TRAFFIC_SOURCE_RUN_TERMINAL":
      return payload.batchId === batchId;
    case "TASK_CREATED":
    case "TASK_COMPLETED":
      return payload.relatedBatchId === batchId;
    case "CAMPAIGN_LINKED":
      return payload.batchId === batchId;
    case "RECONCILIATION_VIOLATION": {
      const affected = payload.affectedBatchIds;
      if (!Array.isArray(affected)) return false;
      return affected.some((id) => id === batchId);
    }
    default:
      return false;
  }
}
