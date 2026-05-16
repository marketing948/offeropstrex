// Phase 5d + spec-correction (post Phase 11) — BatchStatsUpdated rule.
//
// Spec (Automation Bible §6.5): a batch becomes TESTED when EVERY
// offer in the batch has visits >= 20000. clicksThreshold is an admin
// override only — when explicitly set on the batch, it is interpreted
// as the TOTAL required clicks for the batch and used in place of the
// per-offer derivation.
//
// Implementation: voluum_offers.visits is sourced from the Voluum
// offer-grouped report (see /sync/voluum/trigger). The gate counts
// how many active voluum_offers in the batch have visits >= 20000
// and requires that count to equal the batch's numberOfOffers. This
// enforces the spec literally — a single laggard offer keeps the
// batch in LIVE_TESTS regardless of total volume.

import { and, eq, sql } from "drizzle-orm";
import {
  performanceTable,
  testingBatchesTable,
  voluumOffersTable,
} from "@workspace/db";
import type { Action, EventInput, Tx } from "../types.ts";
import { emitWithinTx } from "../event-bus.ts";

type BatchStatsUpdatedEvent = Extract<
  EventInput,
  { type: "BatchStatsUpdated" }
>;

// Spec constant: per-offer visits gate from the Automation Bible.
const PER_OFFER_VISITS_THRESHOLD = 20000;

export async function handleBatchStatsUpdated(
  event: BatchStatsUpdatedEvent,
  tx: Tx,
): Promise<Action[]> {
  const { workspaceId, payload } = event;

  const [batch] = await tx
    .select({
      id: testingBatchesTable.id,
      status: testingBatchesTable.status,
      clicksThreshold: testingBatchesTable.clicksThreshold,
      numberOfOffers: testingBatchesTable.numberOfOffers,
    })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.id, payload.batchId),
        eq(testingBatchesTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!batch) return [];
  if (batch.status !== "LIVE_TESTS") return [];

  const offerCount = batch.numberOfOffers ?? 0;

  // Admin-override path: clicksThreshold is interpreted as TOTAL
  // batch-level clicks. Bypasses the per-offer rule entirely.
  if (batch.clicksThreshold != null) {
    if (batch.clicksThreshold <= 0) return [];
    const [agg] = await tx
      .select({
        total: sql<number>`coalesce(sum(${performanceTable.clicks}), 0)`,
      })
      .from(performanceTable)
      .where(eq(performanceTable.batchId, batch.id));
    const totalClicks = Number(agg?.total ?? 0);
    if (totalClicks < batch.clicksThreshold) return [];
  } else {
    // Spec path: every active offer in the batch must have
    // visits >= 20000. Cannot evaluate without offers attached.
    if (offerCount <= 0) return [];
    const [agg] = await tx
      .select({
        qualified: sql<number>`coalesce(sum(case when ${voluumOffersTable.visits} >= ${PER_OFFER_VISITS_THRESHOLD} then 1 else 0 end), 0)`,
        total: sql<number>`coalesce(count(*), 0)`,
      })
      .from(voluumOffersTable)
      .where(
        and(
          eq(voluumOffersTable.workspaceId, workspaceId),
          eq(voluumOffersTable.batchId, batch.id),
          eq(voluumOffersTable.isActive, true),
        ),
      );
    const qualified = Number(agg?.qualified ?? 0);
    const total = Number(agg?.total ?? 0);
    // Require at least one offer linked AND every linked offer over
    // the threshold. The numberOfOffers column is recomputed by the
    // RecomputeBatchOfferCount action so `total` and offerCount stay
    // aligned; we still gate on `qualified === total` so a
    // partially-resynced batch never satisfies the rule prematurely.
    if (total <= 0 || qualified < total || qualified < offerCount) return [];
  }

  // Chain BatchTested. Its rule will return ChangeBatchStatus(TESTED)
  // and chain-emit BatchStatusChanged so the notification fires.
  await emitWithinTx(tx, {
    type: "BatchTested",
    workspaceId,
    payload: { batchId: batch.id },
    dedupeKey: `clicks_threshold:${batch.id}`,
  });

  return [];
}
