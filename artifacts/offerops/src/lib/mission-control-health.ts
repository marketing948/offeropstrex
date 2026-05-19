import type {
  BatchHealthRecommendation,
  BatchHealthRecommendationCode,
  BatchHealthResponse,
} from "@/lib/batch-health-api";

export type MissionControlHealthState = "healthy" | "warning" | "critical";

export const RECOMMENDATION_LABELS: Record<BatchHealthRecommendationCode, string> = {
  NO_ACTIVE_RUN: "No active run",
  ACTIVE_RUN_MISSING_CREATE_TASKS: "Missing create tasks",
  WAITING_FOR_SIBLING_PLATFORM: "Waiting on platform",
  TERMINAL_RUN_NOT_ADVANCED: "Run not advanced",
  RECENT_RECONCILIATION_VIOLATION: "Reconciliation issue",
  HEALTHY: "Healthy",
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
