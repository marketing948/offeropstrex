import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace-context";
import {
  currentMonthKey,
  fetchMonthlyGoalsDashboard,
  type MonthlyGoalsDashboard,
  type WorkerMonthlyRow,
} from "@/lib/performance-engine/api";

export function useWorkerMonthlyGoals(enabled = true) {
  const { currentEmployee } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const isWorker = currentEmployee?.role !== "admin";

  const query = useQuery({
    queryKey: ["worker-monthly-goals", activeWorkspaceId, currentMonthKey(), currentEmployee?.id],
    enabled: enabled && isWorker && !!activeWorkspaceId && !!currentEmployee,
    queryFn: () =>
      fetchMonthlyGoalsDashboard(activeWorkspaceId!, currentMonthKey(), currentEmployee!.id),
    staleTime: 60_000,
  });

  const workerRow: WorkerMonthlyRow | undefined = query.data?.workers.find(
    (w) => w.employeeId === currentEmployee?.id,
  );

  return { ...query, isWorker, workerRow, dashboard: query.data as MonthlyGoalsDashboard | undefined };
}
