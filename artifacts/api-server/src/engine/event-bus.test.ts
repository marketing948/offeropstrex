// Phase 3: integration tests for the event bus. Runs against the live
// local Postgres (DATABASE_URL) using node's built-in test runner so
// the partial unique index, transaction rollback, and tombstone
// behaviour are exercised end-to-end.
//
// Pivot Phase 0 (Task #24): enable Voluum at the test boundary so the
// existing event-bus integration tests still exercise the full event
// surface. The product runtime defaults to ENABLE_VOLUUM=false; tests
// set it to true so Voluum-only events are not short-circuited by
// engine/event-bus.ts::emit. Phase 5 will rewrite the Voluum tests
// against the quarantined module.
process.env["ENABLE_VOLUUM"] = "true";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { db, eventsTable, workspacesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { emit } from "./event-bus.ts";
import { registerHandler, _resetRegistryForTests } from "./handlers.ts";
import type { Action } from "./types.ts";

let workspaceId: number;

before(async () => {
  const [ws] = await db
    .insert(workspacesTable)
    .values({ name: `engine-test-${Date.now()}` })
    .returning({ id: workspacesTable.id });
  workspaceId = ws.id;
});

after(async () => {
  if (workspaceId) {
    await db.delete(workspacesTable).where(eq(workspacesTable.id, workspaceId));
  }
});

beforeEach(() => {
  _resetRegistryForTests();
});

describe("event-bus", () => {
  test("emit writes a row, runs zero handlers, and sets processedAt", async () => {
    const result = await emit({
      type: "OfferImported",
      workspaceId,
      payload: {
        voluumOfferId: "vof-1",
        offerId: 1,
        tag: "MB_DE_BATCH01_IOS",
        affiliateNetworkName: "MyBookie",
        geo: "DE",
      },
    });

    assert.equal(result.deduped, false);
    assert.equal(result.handlerCount, 0);
    assert.equal(typeof result.eventId, "number");

    const [row] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, result.eventId!));
    assert.equal(row.type, "OfferImported");
    assert.notEqual(row.processedAt, null);
    assert.equal(row.processingError, null);
  });

  test("idempotency: same dedupeKey emits once", async () => {
    const event = {
      type: "OfferImported" as const,
      workspaceId,
      payload: {
        voluumOfferId: "vof-dup-1",
        offerId: 2,
        tag: "MB_DE_BATCH02_IOS",
        affiliateNetworkName: "MyBookie",
        geo: "DE",
      },
      dedupeKey: "voluum:vof-dup-1",
    };

    const a = await emit(event);
    const b = await emit(event);

    assert.equal(a.deduped, false);
    assert.equal(b.deduped, true);
    assert.equal(b.eventId, null);

    const rows = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.workspaceId, workspaceId),
          eq(eventsTable.type, "OfferImported"),
          eq(eventsTable.dedupeKey, "voluum:vof-dup-1"),
        ),
      );
    assert.equal(rows.length, 1);
  });

  test("handler error rolls back tx and writes a tombstone row", async () => {
    registerHandler("BatchCreated", async () => {
      throw new Error("boom");
    });

    const before = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.workspaceId, workspaceId),
          eq(eventsTable.type, "BatchCreated"),
        ),
      );

    await assert.rejects(
      () =>
        emit({
          type: "BatchCreated",
          workspaceId,
          payload: {
            batchId: 999_999,
            tag: "MB_DE_BATCH03_IOS",
            affiliateNetworkName: "MyBookie",
            geo: "DE",
          },
        }),
      /boom/,
    );

    const after = await db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.workspaceId, workspaceId),
          eq(eventsTable.type, "BatchCreated"),
        ),
      );

    assert.equal(after.length, before.length + 1);
    const tombstone = after.find((r) => r.processingError !== null);
    assert.ok(tombstone, "expected a tombstone row with processingError set");
    assert.match(tombstone.processingError ?? "", /boom/);
  });

  test("handler runs in same tx as event row write", async () => {
    let observedEventCount = -1;
    registerHandler("BatchTested", async (_event, tx): Promise<Action[]> => {
      const rows = await tx
        .select({ id: eventsTable.id })
        .from(eventsTable)
        .where(
          and(
            eq(eventsTable.workspaceId, workspaceId),
            eq(eventsTable.type, "BatchTested"),
          ),
        );
      observedEventCount = rows.length;
      return [];
    });

    await emit({
      type: "BatchTested",
      workspaceId,
      payload: { batchId: 1 },
    });

    assert.ok(observedEventCount >= 1);
  });
});
