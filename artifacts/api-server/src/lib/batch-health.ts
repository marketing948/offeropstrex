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

export type BatchHealthRecommendationSeverity = "info" | "warning" | "critical";

export type BatchHealthRecommendationCode =
  | "NO_ACTIVE_RUN"
  | "ACTIVE_RUN_MISSING_CREATE_TASKS"
  | "WAITING_FOR_SIBLING_PLATFORM"
  | "TERMINAL_RUN_NOT_ADVANCED"
  | "RECENT_RECONCILIATION_VIOLATION"
  | "HEALTHY";

export type BatchHealthRecommendation = {
  code: BatchHealthRecommendationCode;
  severity: BatchHealthRecommendationSeverity;
  message: string;
  relatedRunId?: number;
  relatedTaskIds?: number[];
  relatedCampaignIds?: number[];
  suggestedActionType?: string;
};

const SEVERITY_ORDER: Record<BatchHealthRecommendationSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
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

function campaignIdsForRun(run: BatchHealthActiveRun): number[] {
  return [run.iosCampaignId, run.androidCampaignId].filter(
    (id): id is number => id != null,
  );
}

function openCreateTaskIdsForRun(
  openTasks: BatchHealthOpenTask[],
  trafficSourceId: number,
): number[] {
  return openTasks
    .filter(
      (task) =>
        task.trafficSourceId === trafficSourceId &&
        (task.taskType === CREATE_VOLUUM_IOS ||
          task.taskType === CREATE_VOLUUM_ANDROID),
    )
    .map((task) => task.id);
}

/** Read-only operator guidance derived from flags and batch context. */
export function deriveBatchHealthRecommendations(
  flags: BatchHealthFlags,
  activeRun: BatchHealthActiveRun | null,
  openTasks: BatchHealthOpenTask[],
): BatchHealthRecommendation[] {
  const recommendations: BatchHealthRecommendation[] = [];

  if (flags.hasRecentReconciliationViolation) {
    recommendations.push({
      code: "RECENT_RECONCILIATION_VIOLATION",
      severity: "warning",
      message:
        "A recent reconciliation pass reported violations affecting this batch.",
      suggestedActionType: "review_reconciliation",
    });
  }

  if (!flags.hasActiveRun) {
    recommendations.push({
      code: "NO_ACTIVE_RUN",
      severity: "info",
      message: "No traffic source run is currently active for this batch.",
      suggestedActionType: "activate_traffic_source_run",
    });
  }

  if (activeRun != null) {
    const relatedCampaignIds = campaignIdsForRun(activeRun);
    const campaignIdsField =
      relatedCampaignIds.length > 0 ? relatedCampaignIds : undefined;

    if (flags.activeRunFullyTerminalButNotAdvanced) {
      recommendations.push({
        code: "TERMINAL_RUN_NOT_ADVANCED",
        severity: "critical",
        message: `Active run for "${activeRun.trafficSourceName}" has both platforms terminal but the run has not advanced.`,
        relatedRunId: activeRun.runId,
        relatedCampaignIds: campaignIdsField,
        suggestedActionType: "advance_traffic_source_run",
      });
    } else if (flags.activeRunPartiallyTerminal) {
      const waitingPlatform = isPlatformTerminal(activeRun.iosStatus)
        ? "android"
        : "ios";
      recommendations.push({
        code: "WAITING_FOR_SIBLING_PLATFORM",
        severity: "info",
        message: `Waiting for the ${waitingPlatform} platform to finish on run "${activeRun.trafficSourceName}".`,
        relatedRunId: activeRun.runId,
        relatedCampaignIds: campaignIdsField,
        suggestedActionType: "complete_platform_run",
      });
    }

    if (flags.activeRunMissingCreateTasks) {
      const relatedTaskIds = openCreateTaskIdsForRun(
        openTasks,
        activeRun.trafficSourceId,
      );
      recommendations.push({
        code: "ACTIVE_RUN_MISSING_CREATE_TASKS",
        severity: "warning",
        message: `Active run for "${activeRun.trafficSourceName}" is missing open create Voluum campaign tasks for one or more platforms.`,
        relatedRunId: activeRun.runId,
        relatedTaskIds:
          relatedTaskIds.length > 0 ? relatedTaskIds : undefined,
        suggestedActionType: "seed_create_voluum_tasks",
      });
    }
  }

  if (recommendations.length === 0) {
    recommendations.push({
      code: "HEALTHY",
      severity: "info",
      message: "Batch operational health looks normal; no issues detected.",
    });
  }

  recommendations.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return recommendations;
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
