// Spec-correction (post Phase 10) — OfferImported rule (no longer a no-op).
//
// Spec (Automation Bible §6.1): when a Voluum offer with a valid
// canonical OfferOps tag is imported, the engine must
//   1. find or upsert the testing_batch for that workspace+tag,
//   2. attach the offer (voluum_offers.batchId) to that batch,
//   3. recompute testing_batches.numberOfOffers,
//   4. on FIRST creation of the batch, chain-emit BatchCreated so the
//      Phase-4 cascade (snapshot + tasks + notification) runs.
//
// Producer (sync.ts) emits one OfferImported per newly-inserted
// voluum_offers row. Idempotency: dedupeKey
// `voluum_offer:<voluumOfferId>` makes the handler run exactly once
// per offer over its lifetime.
//
// voluum_offers is NOT engine-owned (not in FORBIDDEN_TABLES) so the
// handler may mutate it directly. testing_batches mutations route
// through the executor via CreateBatch / RecomputeBatchOfferCount.

import { and, eq } from "drizzle-orm";
import {
  employeesTable,
  testingBatchesTable,
  voluumOffersTable,
} from "@workspace/db";
import type { Action, EventInput, Tx } from "../types.ts";
import { emitWithinTx } from "../event-bus.ts";
import { executeCreateBatch } from "../executor.ts";

type OfferImportedEvent = Extract<EventInput, { type: "OfferImported" }>;

export async function handleOfferImported(
  event: OfferImportedEvent,
  tx: Tx,
): Promise<Action[]> {
  const { workspaceId, payload } = event;
  const tag = payload.tag;
  if (!tag) return [];

  // 1. Existing batch with this canonical tag in this workspace?
  const [existing] = await tx
    .select({
      id: testingBatchesTable.id,
      employeeId: testingBatchesTable.employeeId,
    })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.workspaceId, workspaceId),
        eq(testingBatchesTable.batchTag, tag),
      ),
    )
    .limit(1);

  let batchId: number;
  let isNewBatch = false;

  if (existing) {
    batchId = existing.id;
  } else {
    // Resolve a default employee owner (first admin in the system).
    const [defaultEmployee] = await tx
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.role, "admin"))
      .limit(1);
    const ownerEmployeeId = defaultEmployee?.id ?? 1;

    // Derive display fields from the canonical lowercase batch tag.
    const batchName = `${payload.affiliateNetworkName} / ${payload.geo} / ${tag}`;

    const upsert = await executeCreateBatch(
      {
        type: "CreateBatch",
        workspaceId,
        data: {
          employeeId: ownerEmployeeId,
          batchName,
          affiliateNetwork: payload.affiliateNetworkName,
          geo: payload.geo,
          trafficSource: "",
          batchTag: tag,
          // numberOfOffers is recomputed below from voluum_offers.
          lastSyncAt: new Date(),
        },
      },
      tx,
    );
    batchId = upsert.id;
    isNewBatch = upsert.isNew;
  }

  // 2. Attach this offer to the batch (voluum_offers is not
  //    engine-owned, direct mutation is allowed).
  await tx
    .update(voluumOffersTable)
    .set({ batchId })
    .where(
      and(
        eq(voluumOffersTable.workspaceId, workspaceId),
        eq(voluumOffersTable.offerId, payload.voluumOfferId),
      ),
    );

  // 3. Chain-emit BatchCreated only when the batch is brand new — its
  //    handler snapshots the rotation, seeds tracker tasks, notifies.
  if (isNewBatch) {
    await emitWithinTx(tx, {
      type: "BatchCreated",
      workspaceId,
      payload: {
        batchId,
        tag,
        affiliateNetworkName: payload.affiliateNetworkName,
        geo: payload.geo,
      },
      dedupeKey: `voluum_tag:${tag}`,
    });
  }

  // 4. Keep numberOfOffers in sync via an engine-owned recompute.
  return [
    {
      type: "RecomputeBatchOfferCount",
      workspaceId,
      batchId,
    },
  ];
}
