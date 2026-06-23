import { useQueries } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth";
import {
  fetchMetricBreakdown,
  type MetricBreakdownKind,
  type MetricBreakdownResult,
} from "@/lib/performance-engine/api";
import { useMonthlyGoalsScope } from "@/lib/performance-engine/use-monthly-goals-scope";

const METRICS: MetricBreakdownKind[] = ["revenue", "testing", "working"];

export function useReportsPeGoalDashboard(scopeEmployeeId?: number | "" | null) {
  const { activeWorkspaceId } = useWorkspace();
  const { currentEmployee } = useAuth();
  const goalsScope = useMonthlyGoalsScope(scopeEmployeeId);
  const { monthKey, peGoals, effectiveEmployeeId, isLoading: goalsLoading } = goalsScope;

  const breakdownQueries = useQueries({
    queries: METRICS.map((metric) => ({
      queryKey: [
        "reports-metric-breakdown",
        activeWorkspaceId,
        monthKey,
        metric,
        effectiveEmployeeId ?? "team",
      ],
      enabled: !!activeWorkspaceId && !!currentEmployee && !!peGoals,
      staleTime: 60_000,
      queryFn: () =>
        fetchMetricBreakdown(
          activeWorkspaceId!,
          monthKey,
          metric,
          effectiveEmployeeId,
        ),
    })),
  });

  const breakdownByMetric: Partial<Record<MetricBreakdownKind, MetricBreakdownResult>> = {};
  METRICS.forEach((metric, i) => {
    const data = breakdownQueries[i]?.data;
    if (data) breakdownByMetric[metric] = data;
  });

  const breakdownLoading = breakdownQueries.some((q) => q.isLoading);

  return {
    ...goalsScope,
    peGoals,
    breakdownByMetric,
    isLoading: goalsLoading || breakdownLoading,
  };
}

export type ReportsPeGoalDashboard = ReturnType<typeof useReportsPeGoalDashboard>;
