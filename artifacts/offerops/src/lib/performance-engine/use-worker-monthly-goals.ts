import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace-context";
import {
  currentMonthKey,
  fetchMonthlyGoalsDashboard,
  type MonthlyGoalsDashboard,
  type WorkerMonthlyRow,
} from "@/lib/performance-engine/api";

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
  void qc.invalidateQueries({ queryKey: ["monthly-goals", workspaceId, monthKey] });
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
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const isWorker = currentEmployee?.role !== "admin";
  const monthKey = currentMonthKey();

  const query = useQuery({
    queryKey: workerMonthlyGoalsQueryKey(activeWorkspaceId, monthKey, currentEmployee?.id),
    enabled: enabled && !!activeWorkspaceId && !!currentEmployee,
    queryFn: () =>
      isWorker
        ? fetchMonthlyGoalsDashboard(activeWorkspaceId!, monthKey, currentEmployee!.id)
        : fetchMonthlyGoalsDashboard(activeWorkspaceId!, monthKey),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const workerRow: WorkerMonthlyRow | undefined = query.data?.workers.find(
    (w) => w.employeeId === currentEmployee?.id,
  );

  return { ...query, isWorker, workerRow, dashboard: query.data as MonthlyGoalsDashboard | undefined };
}
