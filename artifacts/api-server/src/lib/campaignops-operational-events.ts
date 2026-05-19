import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "@workspace/db";
import { recordOperationalEvent } from "./operational-events.ts";

export const BATCH_CREATED_PAYLOAD_KEYS = [
  "batchId",
  "workspaceId",
  "employeeId",
  "initialTrafficSourceId",
  "trafficSourceStep",
  "offerCount",
] as const;

export const TRAFFIC_SOURCE_RUN_ACTIVATED_PAYLOAD_KEYS = [
  "batchId",
  "workspaceId",
  "runId",
  "trafficSourceId",
  "position",
] as const;

export const RECONCILIATION_VIOLATION_INVARIANTS = [
  "invariant2",
  "invariant3",
  "invariant4",
  "invariant5",
] as const;

export type ReconciliationViolationInvariant =
  (typeof RECONCILIATION_VIOLATION_INVARIANTS)[number];

export const RECONCILIATION_VIOLATION_PAYLOAD_KEYS = [
  "workspaceId",
  "invariant",
  "violationCount",
  "affectedBatchIds",
  "reconciliationPassAt",
] as const;

export const TRAFFIC_SOURCE_RUN_TERMINAL_PAYLOAD_KEYS = [
  "batchId",
  "workspaceId",
  "runId",
  "trafficSourceId",
  "status",
  "iosStatus",
  "androidStatus",
] as const;

type OperationalEventsDb = Pick<NodePgDatabase, "insert">;

export type RecordBatchCreatedOperationalEventInput = {
  workspaceId: number;
  batchId: number;
  employeeId: number | null;
  initialTrafficSourceId: number | null;
  trafficSourceStep: number;
  offerCount: number | null;
  source: string;
};

export async function recordBatchCreatedOperationalEvent(
  input: RecordBatchCreatedOperationalEventInput,
  client: OperationalEventsDb = db,
): Promise<void> {
  const payload: Record<string, number> = {
    batchId: input.batchId,
    workspaceId: input.workspaceId,
    trafficSourceStep: input.trafficSourceStep,
  };
  if (input.employeeId != null) payload.employeeId = input.employeeId;
  if (input.initialTrafficSourceId != null) {
    payload.initialTrafficSourceId = input.initialTrafficSourceId;
  }
  if (input.offerCount != null) payload.offerCount = input.offerCount;

  await recordOperationalEvent(
    {
      workspaceId: input.workspaceId,
      entityType: "batch",
      entityId: input.batchId,
      eventType: "BATCH_CREATED",
      actorType: "system",
      source: input.source,
      payloadJson: payload,
    },
    client,
  );
}

export async function recordTrafficSourceRunActivatedOperationalEvent(
  input: {
    workspaceId: number;
    batchId: number;
    runId: number;
    trafficSourceId: number;
    position: number;
  },
  client: OperationalEventsDb = db,
): Promise<void> {
  await recordOperationalEvent(
    {
      workspaceId: input.workspaceId,
      entityType: "traffic_source_run",
      entityId: input.runId,
      eventType: "TRAFFIC_SOURCE_RUN_ACTIVATED",
      actorType: "system",
      source: "engine",
      payloadJson: {
        batchId: input.batchId,
        workspaceId: input.workspaceId,
        runId: input.runId,
        trafficSourceId: input.trafficSourceId,
        position: input.position,
      },
    },
    client,
  );
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "skipped"]);

export function isTerminalTrafficSourceRunStatus(
  status: string,
): status is "completed" | "failed" | "skipped" {
  return TERMINAL_RUN_STATUSES.has(status);
}

export type ReconciliationViolationOperationalInput = {
  workspaceId: number;
  invariant: ReconciliationViolationInvariant;
  violationCount: number;
  affectedBatchIds?: number[];
  reconciliationPassAt: Date;
};

export async function recordReconciliationViolationOperationalEvent(
  input: ReconciliationViolationOperationalInput,
  client: OperationalEventsDb = db,
): Promise<void> {
  const payload: Record<string, number | string | number[]> = {
    workspaceId: input.workspaceId,
    invariant: input.invariant,
    violationCount: input.violationCount,
    reconciliationPassAt: input.reconciliationPassAt.toISOString(),
  };
  if (input.affectedBatchIds != null && input.affectedBatchIds.length > 0) {
    payload.affectedBatchIds = input.affectedBatchIds;
  }

  await recordOperationalEvent(
    {
      workspaceId: input.workspaceId,
      entityType: "workspace",
      entityId: input.workspaceId,
      eventType: "RECONCILIATION_VIOLATION",
      actorType: "system",
      source: "engine.reconciliation",
      payloadJson: payload,
    },
    client,
  );
}

/** Best-effort telemetry; must not fail reconciliation passes. */
export async function recordReconciliationViolationOperationalEvents(
  violations: ReconciliationViolationOperationalInput[],
): Promise<void> {
  for (const violation of violations) {
    if (violation.violationCount <= 0) continue;
    try {
      await recordReconciliationViolationOperationalEvent(violation);
    } catch {
      // Swallow — reconciliation remains log-only for repair; telemetry is optional.
    }
  }
}

export async function recordTrafficSourceRunTerminalOperationalEvent(
  input: {
    workspaceId: number;
    batchId: number;
    runId: number;
    trafficSourceId: number;
    status: string;
    iosStatus: string;
    androidStatus: string;
  },
  client: OperationalEventsDb = db,
): Promise<void> {
  await recordOperationalEvent(
    {
      workspaceId: input.workspaceId,
      entityType: "traffic_source_run",
      entityId: input.runId,
      eventType: "TRAFFIC_SOURCE_RUN_TERMINAL",
      actorType: "system",
      source: "engine",
      payloadJson: {
        batchId: input.batchId,
        workspaceId: input.workspaceId,
        runId: input.runId,
        trafficSourceId: input.trafficSourceId,
        status: input.status,
        iosStatus: input.iosStatus,
        androidStatus: input.androidStatus,
      },
    },
    client,
  );
}
