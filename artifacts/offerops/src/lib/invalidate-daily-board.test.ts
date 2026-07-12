import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { QueryClient } from "@tanstack/react-query";
import { getListCampaignsQueryKey } from "@workspace/api-client-react";
import { invalidateDailyBoardData } from "./invalidate-daily-board.ts";

/** Records every invalidated queryKey and resolves like the real client. */
function fakeQueryClient() {
  const keys: unknown[][] = [];
  let resolvedAll = false;
  const qc = {
    invalidateQueries: (opts: { queryKey: unknown[] }) => {
      keys.push(opts.queryKey);
      return new Promise<void>((r) => {
        setTimeout(() => {
          resolvedAll = true;
          r();
        }, 0);
      });
    },
  } as unknown as QueryClient;
  return { qc, keys, wasAwaited: () => resolvedAll };
}

describe("invalidateDailyBoardData (cache wiring)", () => {
  test("19) invalidates the exact Operations Hub campaigns query key", async () => {
    const { qc, keys } = fakeQueryClient();
    await invalidateDailyBoardData(qc, 45, 42);
    const campaignsKey = JSON.stringify(getListCampaignsQueryKey({ workspace_id: 45 }));
    assert.ok(
      keys.some((k) => JSON.stringify(k) === campaignsKey),
      "campaigns list key must be invalidated",
    );
  });

  test("also invalidates the goal metric-breakdown consumed by the board", async () => {
    const { qc, keys } = fakeQueryClient();
    await invalidateDailyBoardData(qc, 45);
    assert.ok(
      keys.some((k) => Array.isArray(k) && k[0] === "ops-focus-breakdown" && k[1] === 45),
      "ops-focus-breakdown prefix must be invalidated",
    );
  });

  test("20) resolves only after all invalidations complete (awaitable refresh)", async () => {
    const { qc, wasAwaited } = fakeQueryClient();
    await invalidateDailyBoardData(qc, 45);
    assert.equal(wasAwaited(), true);
  });
});
