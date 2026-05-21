import type { TodoTask } from "@workspace/api-client-react";
import { DEFAULT_CONFIG, getActionPoints, type GoalsConfig } from "@/lib/goals-config";

export type TaskCompletionExpOptions = {
  /** Award winner-discovery points (e.g. find_winners / review_winners with winners). */
  winnerAward?: boolean;
};

function mapTaskTypeToActionId(taskType: string): string {
  switch (taskType) {
    case "GO_LIVE":
    case "take_campaign_live":
      return "campaignLive";
    case "OPTIMIZATION_FOLLOWUP":
      return "optimizationCompleted";
    case "MOVE_WINNERS_TO_SCALED_CAMPAIGN":
      return "scaleTaskCompleted";
    case "FIND_WINNERS":
    case "find_winners":
    case "review_winners_target":
      return "taskCompleted";
    default:
      return "taskCompleted";
  }
}

/**
 * Incremental EXP for a single successful completion, using the same point
 * actions as monthly goals scoring (not a full recompute).
 */
export function resolveTaskCompletionExp(
  task: Pick<TodoTask, "taskType">,
  cfg: GoalsConfig = DEFAULT_CONFIG,
  opts?: TaskCompletionExpOptions,
): { points: number; actionId: string } {
  const actionId = opts?.winnerAward ? "winnerFound" : mapTaskTypeToActionId(String(task.taskType));
  const points = getActionPoints(cfg, actionId);
  return { points, actionId };
}
