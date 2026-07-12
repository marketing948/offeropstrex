import type { QueryClient } from "@tanstack/react-query";
import {
  getListCampaignsQueryKey,
  getListTestingBatchesQueryKey,
} from "@workspace/api-client-react";

/**
 * Refetch every data source the Daily Board (Operations Hub) reads so completion
 * + suggestions reflect reality without a page reload:
 *   - Operations Hub campaigns list (completion truth)
 *   - Monthly-Goal metric breakdown (`ops-focus-breakdown` prefix → testing/working)
 *   - Testing-batch attribution (owner fallback for CampaignOps rows)
 *
 * `invalidateQueries` resolves after active queries refetch, so awaiting this
 * guarantees the board has fresh data (manual Refresh + campaign-create success).
 * `employeeId`/`monthKey` are accepted for call-site clarity; the breakdown +
 * campaign keys are workspace-prefixed so both worker-self and admin-employee
 * scopes (and every month bucket) are covered by prefix invalidation.
 */
export async function invalidateDailyBoardData(
  qc: QueryClient,
  workspaceId: number,
  _employeeId?: number | null,
  _monthKey?: string,
): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({
      queryKey: getListCampaignsQueryKey({ workspace_id: workspaceId }),
    }),
    qc.invalidateQueries({
      queryKey: getListTestingBatchesQueryKey({ workspace_id: workspaceId }),
    }),
    // Prefix match → all metrics (testing/working/revenue) + team/employee scopes.
    qc.invalidateQueries({ queryKey: ["ops-focus-breakdown", workspaceId] }),
    qc.invalidateQueries({ queryKey: ["ops-metric-breakdown", workspaceId] }),
    qc.invalidateQueries({ queryKey: ["metric-breakdown", workspaceId] }),
  ]);
}
