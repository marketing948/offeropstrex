import type { QueryClient } from "@tanstack/react-query";
import { getListCampaignsQueryKey } from "@workspace/api-client-react";

/** Background sync interval for Operations Hub campaign-driven mission board. */
export const CAMPAIGNS_LIVE_REFETCH_MS = 15_000;

export type CampaignListRow = Record<string, unknown> & {
  id: number;
  workspaceId: number;
  batchId?: number | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  campaignPurpose?: string | null;
};

function upsertCampaignRow(
  list: CampaignListRow[],
  row: CampaignListRow,
): CampaignListRow[] {
  const idx = list.findIndex((c) => c.id === row.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = { ...next[idx], ...row };
    return next;
  }
  return [row, ...list];
}

function patchQueryList(
  qc: QueryClient,
  queryKey: readonly unknown[],
  mutator: (list: CampaignListRow[]) => CampaignListRow[],
): void {
  qc.setQueryData<CampaignListRow[]>(queryKey, (old = []) => mutator(old));
}

/** Optimistically prepend or merge a campaign into workspace (+ optional batch) caches. */
export function patchCampaignsListCache(
  qc: QueryClient,
  workspaceId: number,
  row: CampaignListRow,
  batchId?: number | null,
): void {
  patchQueryList(
    qc,
    getListCampaignsQueryKey({ workspace_id: workspaceId }),
    (old) => upsertCampaignRow(old, row),
  );
  const bid = batchId ?? row.batchId;
  if (bid != null) {
    patchQueryList(
      qc,
      getListCampaignsQueryKey({ workspace_id: workspaceId, batch_id: bid }),
      (old) => upsertCampaignRow(old, row),
    );
  }
}

/** Mark every campaign in a batch live (after go-live). */
export function markBatchCampaignsLiveInCache(
  qc: QueryClient,
  workspaceId: number,
  batchId: number,
  now = new Date(),
): void {
  const stamp = now.toISOString();
  const goLive = (c: CampaignListRow) =>
    c.batchId === batchId
      ? {
          ...c,
          status: "live",
          liveStartedAt:
            (c as { liveStartedAt?: string | null }).liveStartedAt ?? stamp,
          updatedAt: stamp,
        }
      : c;

  patchQueryList(
    qc,
    getListCampaignsQueryKey({ workspace_id: workspaceId }),
    (old) => old.map(goLive),
  );
  patchQueryList(
    qc,
    getListCampaignsQueryKey({ workspace_id: workspaceId, batch_id: batchId }),
    (old) => old.map(goLive),
  );
}

/** Invalidate all listCampaigns queries for a workspace (and optional batch). */
export function invalidateWorkspaceCampaigns(
  qc: QueryClient,
  workspaceId: number,
  batchId?: number | null,
): void {
  void qc.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      if (!Array.isArray(key) || key[0] !== "/api/campaigns") return false;
      const params = key[1] as { workspace_id?: number; batch_id?: number } | undefined;
      if (params?.workspace_id !== workspaceId) return false;
      if (batchId != null && params?.batch_id != null && params.batch_id !== batchId) {
        return false;
      }
      return true;
    },
  });
}

/** Instant UI update + background reconcile (Daily Mission board). */
export function syncCampaignsAfterMutation(
  qc: QueryClient,
  workspaceId: number,
  row: CampaignListRow,
  batchId?: number | null,
): void {
  patchCampaignsListCache(qc, workspaceId, row, batchId);
  invalidateWorkspaceCampaigns(qc, workspaceId, batchId ?? row.batchId);
}
