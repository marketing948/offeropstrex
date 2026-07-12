import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { getListCampaignsQueryKey } from "@workspace/api-client-react";
import {
  markBatchCampaignsLiveInCache,
  patchCampaignsListCache,
  syncCampaignsAfterMutation,
} from "./campaign-query-cache.ts";

describe("campaign-query-cache", () => {
  test("patchCampaignsListCache prepends new campaign to workspace list", () => {
    const qc = new QueryClient();
    const wsKey = getListCampaignsQueryKey({ workspace_id: 1 });
    qc.setQueryData(wsKey, [{ id: 9, workspaceId: 1, batchId: 2 }]);

    patchCampaignsListCache(qc, 1, {
      id: 10,
      workspaceId: 1,
      batchId: 2,
      campaignPurpose: "testing",
      createdAt: new Date().toISOString(),
    });

    const list = qc.getQueryData<{ id: number }[]>(wsKey);
    assert.equal(list?.[0]?.id, 10);
    assert.equal(list?.length, 2);
  });

  test("markBatchCampaignsLiveInCache sets live status on batch rows", () => {
    const qc = new QueryClient();
    const wsKey = getListCampaignsQueryKey({ workspace_id: 1 });
    qc.setQueryData(wsKey, [
      { id: 1, workspaceId: 1, batchId: 5, status: "ready" },
      { id: 2, workspaceId: 1, batchId: 6, status: "ready" },
    ]);

    markBatchCampaignsLiveInCache(qc, 1, 5);

    const list = qc.getQueryData<{ id: number; status: string }[]>(wsKey);
    assert.equal(list?.find((c) => c.id === 1)?.status, "live");
    assert.equal(list?.find((c) => c.id === 2)?.status, "ready");
  });

  test("syncCampaignsAfterMutation merges by id", () => {
    const qc = new QueryClient();
    const wsKey = getListCampaignsQueryKey({ workspace_id: 3 });
    qc.setQueryData(wsKey, [
      { id: 4, workspaceId: 3, batchId: 7, status: "draft", campaignPurpose: "testing" },
    ]);

    syncCampaignsAfterMutation(qc, 3, {
      id: 4,
      workspaceId: 3,
      batchId: 7,
      status: "live",
      campaignPurpose: "testing",
    });

    const list = qc.getQueryData<{ status: string }[]>(wsKey);
    assert.equal(list?.[0]?.status, "live");
    assert.equal(list?.length, 1);
  });
});
