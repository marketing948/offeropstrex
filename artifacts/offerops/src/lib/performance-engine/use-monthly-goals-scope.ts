import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace-context";
import {
  currentMonthKey,
  fetchMonthlyGoalsDashboard,
  type MonthlyGoalsDashboard,
  type WorkerMonthlyRow,
} from "@/lib/performance-engine/api";
import { peGoalsFromDashboard, type PeGoalsTriple } from "@/lib/performance-engine/pe-goals";
import { workerMonthlyGoalsQueryKey } from "@/lib/performance-engine/use-worker-monthly-goals";

/**
 * Performance Engine monthly goals for the current month.
 * Workers are always scoped to self. Admins may pass scopeEmployeeId for one worker, or omit for team aggregate.
 */
export function useMonthlyGoalsScope(scopeEmployeeId?: number | "" | null, enabled = true) {
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const isAdmin = currentEmployee?.role === "admin";
  const isWorker = !isAdmin;
  const monthKey = currentMonthKey();

  const effectiveEmployeeId: number | undefined = isWorker
    ? currentEmployee?.id
    : scopeEmployeeId !== "" && scopeEmployeeId != null
      ? scopeEmployeeId
      : undefined;

  const query = useQuery({
    queryKey: workerMonthlyGoalsQueryKey(
      activeWorkspaceId,
      monthKey,
      effectiveEmployeeId ?? (isWorker ? currentEmployee?.id : null),
    ),
    enabled: enabled && !!activeWorkspaceId && !!currentEmployee,
    queryFn: () =>
      effectiveEmployeeId != null
        ? fetchMonthlyGoalsDashboard(activeWorkspaceId!, monthKey, effectiveEmployeeId)
        : fetchMonthlyGoalsDashboard(activeWorkspaceId!, monthKey),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const dashboard = query.data as MonthlyGoalsDashboard | undefined;

  const peGoals: PeGoalsTriple | null = useMemo(() => {
    if (!dashboard) return null;
    return peGoalsFromDashboard(dashboard, effectiveEmployeeId);
  }, [dashboard, effectiveEmployeeId]);

  const scopedWorkerRow: WorkerMonthlyRow | undefined = useMemo(() => {
    if (!dashboard) return undefined;
    if (effectiveEmployeeId != null) {
      return dashboard.workers.find((w) => w.employeeId === effectiveEmployeeId);
    }
    return undefined;
  }, [dashboard, effectiveEmployeeId]);

  return {
    ...query,
    monthKey,
    isAdmin,
    isWorker,
    effectiveEmployeeId,
    dashboard,
    peGoals,
    scopedWorkerRow,
    /** @deprecated use scopedWorkerRow — kept for existing worker-only call sites */
    workerRow: isWorker ? scopedWorkerRow ?? dashboard?.workers.find((w) => w.employeeId === currentEmployee?.id) : scopedWorkerRow,
  };
}
