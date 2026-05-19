import type { TestingBatch } from "@workspace/api-client-react";
import type {
  BatchHealthOpenTask,
  BatchHealthRecommendation,
  BatchHealthRecommendationCode,
  BatchHealthRecommendationSeverity,
  BatchHealthResponse,
} from "@/lib/batch-health-api";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";

export type MissionControlHealthState = "healthy" | "warning" | "critical";

export type MissionControlFilter =
  | "all"
  | "attention"
  | "healthy"
  | "critical"
  | "openTasks"
  | "needsRecovery"
  | "recentlyUpdated";

/** Batches with activity in the last 2 hours (batch sync/create or latest health event). */
export const RECENTLY_UPDATED_MS = 2 * 60 * 60 * 1000;

export const RECOMMENDATION_LABELS: Record<BatchHealthRecommendationCode, string> = {
  NO_ACTIVE_RUN: "No active run",
  ACTIVE_RUN_MISSING_CREATE_TASKS: "Missing create tasks",
  WAITING_FOR_SIBLING_PLATFORM: "Waiting on platform",
  TERMINAL_RUN_NOT_ADVANCED: "Run not advanced",
  RECENT_RECONCILIATION_VIOLATION: "Reconciliation issue",
  HEALTHY: "All clear",
};

export const RECOMMENDATION_TOOLTIPS: Record<BatchHealthRecommendationCode, string> = {
  NO_ACTIVE_RUN:
    "No traffic source run is active. The batch may be between sources or not yet activated.",
  ACTIVE_RUN_MISSING_CREATE_TASKS:
    "The active run needs Voluum create-campaign work but no open iOS/Android create tasks exist.",
  WAITING_FOR_SIBLING_PLATFORM:
    "One platform finished; the other is still in progress on this traffic source.",
  TERMINAL_RUN_NOT_ADVANCED:
    "Both platforms are terminal but the batch has not advanced to the next traffic source.",
  RECENT_RECONCILIATION_VIOLATION:
    "A recent reconciliation pass flagged this batch. Review before taking action.",
  HEALTHY: "No operational issues detected for this batch.",
};

export const SEVERITY_META: Record<
  BatchHealthRecommendationSeverity,
  { icon: LucideIcon; badgeClass: string; iconClass: string }
> = {
  critical: {
    icon: AlertCircle,
    badgeClass: "border-red-200 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100",
    iconClass: "text-red-600",
  },
  warning: {
    icon: AlertTriangle,
    badgeClass: "border-amber-200 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
    iconClass: "text-amber-600",
  },
  info: {
    icon: Info,
    badgeClass: "border-slate-200 bg-slate-50 text-slate-800 dark:bg-slate-900/40 dark:text-slate-200",
    iconClass: "text-slate-600",
  },
};

export const HEALTH_SEVERITY_ICON: Record<MissionControlHealthState, LucideIcon> = {
  healthy: CheckCircle2,
  warning: AlertTriangle,
  critical: AlertCircle,
};

const HEALTH_STATE_RANK: Record<MissionControlHealthState, number> = {
  critical: 0,
  warning: 1,
  healthy: 2,
};

export function deriveMissionControlHealthState(
  recommendations: BatchHealthRecommendation[],
): MissionControlHealthState {
  if (recommendations.some((r) => r.severity === "critical")) return "critical";
  if (recommendations.some((r) => r.code !== "HEALTHY" && r.severity !== "info")) {
    return "warning";
  }
  if (recommendations.some((r) => r.code !== "HEALTHY")) return "warning";
  return "healthy";
}

export function recommendationSummary(
  recommendations: BatchHealthRecommendation[],
): string {
  const actionable = recommendations.filter((r) => r.code !== "HEALTHY");
  if (actionable.length === 0) return "All clear";
  if (actionable.length === 1) return RECOMMENDATION_LABELS[actionable[0]!.code];
  return `${RECOMMENDATION_LABELS[actionable[0]!.code]} +${actionable.length - 1}`;
}

export function badgeRecommendations(
  recommendations: BatchHealthRecommendation[],
): BatchHealthRecommendation[] {
  return recommendations.filter((r) => r.code !== "HEALTHY").slice(0, 3);
}

export function compareHealthStates(a: MissionControlHealthState, b: MissionControlHealthState): number {
  return HEALTH_STATE_RANK[a] - HEALTH_STATE_RANK[b];
}

export function activeRunStatusLabel(health: BatchHealthResponse | undefined): string {
  if (!health) return "—";
  if (!health.activeRun) return "No active run";
  const run = health.activeRun;
  return `${run.trafficSourceName} · ${run.status}`;
}

export function currentTrafficSourceLabel(
  batchTrafficSource: string | null | undefined,
  health: BatchHealthResponse | undefined,
): string {
  if (health?.activeRun?.trafficSourceName) return health.activeRun.trafficSourceName;
  return batchTrafficSource?.trim() || "—";
}

export function isOverdueOpenTask(task: BatchHealthOpenTask, now = new Date()): boolean {
  if (!task.dueDate?.trim()) return false;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}

export function hasOverdueOpenTasks(health: BatchHealthResponse | undefined): boolean {
  return (health?.openTasks ?? []).some((task) => isOverdueOpenTask(task));
}

export function isStuckTerminalRun(health: BatchHealthResponse | undefined): boolean {
  return health?.flags.activeRunFullyTerminalButNotAdvanced ?? false;
}

export function hasCriticalRecommendations(health: BatchHealthResponse | undefined): boolean {
  return (health?.recommendations ?? []).some((r) => r.severity === "critical" && r.code !== "HEALTHY");
}

export function rowNeedsRecovery(health: BatchHealthResponse | undefined): boolean {
  if (!health) return false;
  const f = health.flags;
  return (
    f.activeRunMissingCreateTasks ||
    f.activeRunFullyTerminalButNotAdvanced ||
    f.hasRecentReconciliationViolation
  );
}

export function rowRecentlyUpdated(
  batch: TestingBatch,
  health: BatchHealthResponse | undefined,
  now = Date.now(),
): boolean {
  const stamps: number[] = [];
  if (batch.lastSyncAt) {
    const t = new Date(batch.lastSyncAt).getTime();
    if (!Number.isNaN(t)) stamps.push(t);
  }
  if (batch.createdAt) {
    const t = new Date(batch.createdAt).getTime();
    if (!Number.isNaN(t)) stamps.push(t);
  }
  const latestEvent = health?.recentEvents[0]?.createdAt;
  if (latestEvent) {
    const t = new Date(latestEvent).getTime();
    if (!Number.isNaN(t)) stamps.push(t);
  }
  if (stamps.length === 0) return false;
  return now - Math.max(...stamps) < RECENTLY_UPDATED_MS;
}

export type MissionControlRowInput = {
  batch: TestingBatch;
  health: BatchHealthResponse | undefined;
  healthState: MissionControlHealthState;
  healthLoading: boolean;
  healthError: boolean;
};

export function buildMissionControlRows(
  batchList: TestingBatch[],
  healthByBatchId: Map<number, BatchHealthResponse | undefined>,
  healthMetaByBatchId: Map<number, { loading: boolean; error: boolean }>,
): MissionControlRowInput[] {
  return batchList.map((batch) => {
    const health = healthByBatchId.get(batch.id);
    const meta = healthMetaByBatchId.get(batch.id);
    const healthState = health
      ? deriveMissionControlHealthState(health.recommendations)
      : "healthy";
    return {
      batch,
      health,
      healthState,
      healthLoading: meta?.loading ?? false,
      healthError: meta?.error ?? false,
    };
  });
}

export function matchesMissionControlFilter(
  row: MissionControlRowInput,
  filter: MissionControlFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "attention":
      return row.healthState !== "healthy";
    case "healthy":
      return row.healthState === "healthy";
    case "critical":
      return row.healthState === "critical";
    case "openTasks":
      return (row.health?.flags.openTaskCount ?? 0) > 0;
    case "needsRecovery":
      return rowNeedsRecovery(row.health);
    case "recentlyUpdated":
      return rowRecentlyUpdated(row.batch, row.health);
    default:
      return true;
  }
}

export const HEALTH_STATE_STYLES: Record<
  MissionControlHealthState,
  { ring: string; dot: string; badge: string; label: string }
> = {
  healthy: {
    ring: "ring-emerald-500/30",
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
    label: "Healthy",
  },
  warning: {
    ring: "ring-amber-500/40",
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-900 border-amber-200",
    label: "Warning",
  },
  critical: {
    ring: "ring-red-500/40",
    dot: "bg-red-500",
    badge: "bg-red-50 text-red-800 border-red-200",
    label: "Critical",
  },
};
