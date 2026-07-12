import type { QueryClient } from "@tanstack/react-query";
import { getListCampaignsQueryKey } from "@workspace/api-client-react";
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
  void qc.invalidateQueries({ queryKey: ["ops-focus-breakdown", workspaceId] });
  void qc.invalidateQueries({ queryKey: ["reports-metric-breakdown", workspaceId, monthKey] });
  void qc.invalidateQueries({ queryKey: ["reports-pe-goal-dashboard", workspaceId, monthKey] });
  void qc.invalidateQueries({ queryKey: ["live-campaigns", workspaceId] });
  void qc.invalidateQueries({ queryKey: ["reports-live-campaigns", workspaceId] });
  void qc.invalidateQueries({ queryKey: ["testing-batches", workspaceId] });
  void qc.invalidateQueries({ queryKey: ["listTestingBatches", workspaceId] });
  void qc.invalidateQueries({
    queryKey: getListCampaignsQueryKey({ workspace_id: workspaceId }),
  });
}
