import type { QueryClient } from "@tanstack/react-query";
import { currentMonthKey } from "@/lib/performance-engine/api";

/** Invalidate all Performance Engine goal surfaces after plan or actuals change. */
export function invalidateGoalSurfaces(
  qc: QueryClient,
  workspaceId: number,
  monthKey: string = currentMonthKey(),
): void {
  void qc.invalidateQueries({ queryKey: ["monthly-goals", workspaceId, monthKey] });
  void qc.invalidateQueries({ queryKey: ["worker-monthly-goals", workspaceId, monthKey] });
  void qc.invalidateQueries({ queryKey: ["goal-allocation", workspaceId, monthKey] });
  void qc.invalidateQueries({ queryKey: ["metric-breakdown", workspaceId, monthKey] });
  void qc.invalidateQueries({ queryKey: ["ops-metric-breakdown", workspaceId] });
  void qc.invalidateQueries({ queryKey: ["reports-metric-breakdown", workspaceId, monthKey] });
}
