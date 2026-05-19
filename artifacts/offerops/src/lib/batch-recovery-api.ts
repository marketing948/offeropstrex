import { authedJson } from "@/lib/api-fetch";

export type BatchRecoveryAction =
  | "recreate-create-tasks"
  | "replay-find-winners"
  | "mark-run-reviewed";

export type BatchRecoveryResponse = {
  action: BatchRecoveryAction;
  batchId: number;
  workspaceId: number;
  idempotent?: boolean;
  runId?: number;
  trafficSourceId?: number;
  createdTasks?: unknown[];
  replayedTaskIds?: number[];
  note?: string | null;
};

function apiBase(): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
}

export async function postBatchRecovery(
  batchId: number,
  action: BatchRecoveryAction,
  body?: { note?: string },
): Promise<BatchRecoveryResponse> {
  return authedJson<BatchRecoveryResponse>(
    `${apiBase()}/admin/batches/${batchId}/recovery/${action}`,
    {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    },
  );
}
