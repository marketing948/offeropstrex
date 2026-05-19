export const BATCH_RECOVERY_ACTIONS = [
  "recreate-create-tasks",
  "replay-find-winners",
  "mark-run-reviewed",
] as const;

export type BatchRecoveryAction = (typeof BATCH_RECOVERY_ACTIONS)[number];

export const BATCH_RECOVERY_ACTION_PAYLOAD_KEYS = [
  "batchId",
  "workspaceId",
  "action",
  "actorId",
  "createdTaskIds",
  "replayedTaskIds",
  "note",
  "idempotent",
] as const;

export function isBatchRecoveryAction(value: string): value is BatchRecoveryAction {
  return (BATCH_RECOVERY_ACTIONS as readonly string[]).includes(value);
}
