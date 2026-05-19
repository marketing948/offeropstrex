// Batch health API — not yet in the OpenAPI-generated client (Slice 7B/7C).

import { authedJson } from "@/lib/api-fetch";

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

export type BatchHealthResponse = {
  batch: {
    id: number;
    workspaceId: number;
    status: string;
    batchName: string;
    currentWorkspaceTrafficSourceId: number | null;
    trafficSourceStep: number;
  };
  activeRun: BatchHealthActiveRun | null;
  openTasks: BatchHealthOpenTask[];
  recentEvents: BatchHealthOperationalEvent[];
  flags: BatchHealthFlags;
  recommendations: BatchHealthRecommendation[];
};

function apiBase(): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
}

export function getBatchHealthQueryKey(batchId: number): readonly [string, number] {
  return ["batch-health", batchId] as const;
}

export async function fetchBatchHealth(batchId: number): Promise<BatchHealthResponse> {
  return authedJson<BatchHealthResponse>(`${apiBase()}/admin/batches/${batchId}/health`);
}
