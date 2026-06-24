import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { currentMonthKey } from "@/lib/performance-engine/api";
import { invalidateGoalSurfaces } from "@/lib/performance-engine/invalidate-goal-surfaces";
import { useMonthlyGoalsScope } from "@/lib/performance-engine/use-monthly-goals-scope";

export function workerMonthlyGoalsQueryKey(
  workspaceId: number | null | undefined,
  monthKey: string,
  employeeId: number | null | undefined,
) {
  return ["worker-monthly-goals", workspaceId, monthKey, employeeId] as const;
}

/** Invalidate rank/XP + monthly goals after real XP awards (tasks, goals, etc.). */
export function invalidateWorkerRankAndGoals(
  qc: QueryClient,
  workspaceId: number | null | undefined,
  employeeId: number | null | undefined,
) {
  const monthKey = currentMonthKey();
  void qc.invalidateQueries({ queryKey: workerMonthlyGoalsQueryKey(workspaceId, monthKey, employeeId) });
  void qc.invalidateQueries({ queryKey: ["pe-rank-xp", workspaceId, employeeId] });
  if (workspaceId) invalidateGoalSurfaces(qc, workspaceId, monthKey);
}

/** Await refetch so rank cards see xp_ledger changes immediately after task completion. */
export async function refetchWorkerRankAndGoals(
  qc: QueryClient,
  workspaceId: number | null | undefined,
  employeeId: number | null | undefined,
) {
  const monthKey = currentMonthKey();
  const rankKey = workerMonthlyGoalsQueryKey(workspaceId, monthKey, employeeId);
  invalidateWorkerRankAndGoals(qc, workspaceId, employeeId);
  await qc.refetchQueries({ queryKey: rankKey, type: "active" });
}

export function useWorkerMonthlyGoals(enabled = true) {
  const scope = useMonthlyGoalsScope(undefined, enabled);
  return {
    ...scope,
    isWorker: scope.isWorker,
    workerRow: scope.workerRow,
    dashboard: scope.dashboard,
  };
}
