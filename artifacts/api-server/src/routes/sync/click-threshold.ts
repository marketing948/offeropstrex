// Phase 5d (Task #15): stats-refresh signal. After report ingestion
// the sync loop calls this with the list of batches whose performance
// rows changed; we emit one `BatchStatsUpdated` per batch and the
// engine's R5 rule (`engine/rules/batch-stats-updated.ts`) decides
// whether the click threshold has been crossed. If so the rule
// chain-emits `BatchTested` (which in turn chain-emits
// `BatchStatusChanged`), so the producer stays a thin signal and all
// thresholding logic lives inside the engine.
//
// Idempotency: the BatchStatsUpdated event itself is NOT deduped at
// this level (we want to retrigger evaluation when stats actually
// change). The downstream `BatchTested` emit dedupes on
// `clicks_threshold:<batchId>` so the threshold-crossed transition
// fires exactly once per batch. The downstream `BatchStatusChanged`
// dedupes on `auto_to_tested:<batchId>`.

import { emit } from "../../engine/event-bus.ts";
import type { logger } from "../../lib/logger";

export async function checkClickThresholds(
  workspaceId: number,
  mappedBatchIds: number[],
  log: typeof logger,
): Promise<void> {
  if (mappedBatchIds.length === 0) return;

  for (const batchId of mappedBatchIds) {
    try {
      await emit({
        type: "BatchStatsUpdated",
        workspaceId,
        payload: { batchId },
      });
    } catch (err) {
      // The rule itself opens DB reads inside its handler; if any of
      // those fail we log + continue so a single bad batch does not
      // poison the rest of the sync loop.
      log.error(
        { err, workspaceId, batchId },
        "[checkClickThresholds] BatchStatsUpdated emit failed",
      );
    }
  }
}
