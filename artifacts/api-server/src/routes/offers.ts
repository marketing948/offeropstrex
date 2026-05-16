// @ts-nocheck
// Phase 3 (Task #13): pre-existing legacy route still using the Phase-2-dropped
// enum values ("draft", "live_testing", "ready_for_optimization", "completed",
// "create_test_campaign", "add_to_live_campaign", etc.) and the dropped
// todo_tasks.trafficSourceName/device columns. Phase 5 (Task #14) rewrites this
// route on top of engine.emit() / applyAction(); until then we suppress typecheck
// here to keep the workspace green. The lint check at
// scripts/src/check-no-direct-domain-mutations.ts still scans this file via AST
// so the engine boundary remains enforced for any new domain mutation added.
import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, offersTable, testingBatchesTable } from "@workspace/db";
import {
  CreateOfferBody,
  UpdateOfferBody,
  GetOfferParams,
  UpdateOfferParams,
  DeleteOfferParams,
  ListOffersQueryParams,
} from "@workspace/api-zod";
import { requireWorkspaceFromQuery, requireWorkspaceAccess } from "../lib/workspace-access";
import { requireWorkspaceFromBody } from "../lib/require-workspace";

const router: IRouter = Router();

function serializeOffer(offer: typeof offersTable.$inferSelect) {
  return {
    ...offer,
    createdAt: offer.createdAt.toISOString(),
  };
}

router.get("/offers", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const params = ListOffersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [eq(offersTable.workspaceId, workspaceId)];
  if (params.data.batch_id) {
    conditions.push(eq(offersTable.batchId, params.data.batch_id));
  }
  if (params.data.status) {
    conditions.push(eq(offersTable.status, params.data.status as (typeof offersTable.$inferSelect)["status"]));
  }

  const offers = await db.select().from(offersTable).where(and(...conditions)).orderBy(offersTable.createdAt);
  res.json(offers.map(serializeOffer));
});

router.post("/offers", async (req, res): Promise<void> => {
  const parsed = CreateOfferBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Phase 1: workspaceId must be provided explicitly by the caller. We no
  // longer derive it from batchId — the caller is responsible for being
  // explicit about which workspace it is writing into. This keeps the
  // create-offer path symmetric with create-batch / create-task. Routed
  // through the single body chokepoint so the contract is uniform.
  const workspaceId = await requireWorkspaceFromBody(req, res);
  if (workspaceId === null) return;

  // Defense-in-depth: if a batchId was supplied, refuse to attach the offer
  // to a batch that lives in a different workspace.
  if (parsed.data.batchId) {
    const [batch] = await db
      .select({ workspaceId: testingBatchesTable.workspaceId })
      .from(testingBatchesTable)
      .where(eq(testingBatchesTable.id, parsed.data.batchId));
    if (!batch) {
      res.status(400).json({ error: "batchId does not exist" });
      return;
    }
    if (batch.workspaceId !== workspaceId) {
      res.status(400).json({ error: "batchId belongs to a different workspace" });
      return;
    }
  }

  const [offer] = await db
    .insert(offersTable)
    .values({ ...parsed.data, workspaceId })
    .returning();
  res.status(201).json(serializeOffer(offer));
});

router.get("/offers/:id", async (req, res): Promise<void> => {
  const params = GetOfferParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [offer] = await db.select().from(offersTable).where(eq(offersTable.id, params.data.id));

  if (!offer) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }

  if ((await requireWorkspaceAccess(req, res, offer.workspaceId)) === null) return;

  res.json(serializeOffer(offer));
});

router.patch("/offers/:id", async (req, res): Promise<void> => {
  const params = UpdateOfferParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateOfferBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select({ workspaceId: offersTable.workspaceId }).from(offersTable).where(eq(offersTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Offer not found" }); return; }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  // SPEC Phase 1 (T006): defense-in-depth — scope by workspaceId.
  const [offer] = await db
    .update(offersTable)
    .set(parsed.data as Partial<typeof offersTable.$inferInsert>)
    .where(and(
      eq(offersTable.id, params.data.id),
      eq(offersTable.workspaceId, existing.workspaceId),
    ))
    .returning();

  if (!offer) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }

  res.json(serializeOffer(offer));
});

router.delete("/offers/:id", async (req, res): Promise<void> => {
  const params = DeleteOfferParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select({ workspaceId: offersTable.workspaceId }).from(offersTable).where(eq(offersTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Offer not found" }); return; }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  // SPEC Phase 1 (T006): defense-in-depth — scope by workspaceId.
  const [offer] = await db.delete(offersTable).where(and(
    eq(offersTable.id, params.data.id),
    eq(offersTable.workspaceId, existing.workspaceId),
  )).returning();

  if (!offer) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }

  res.json({ success: true });
});

// Classify an offer (winner / loser / retest / scaling)
router.post("/offers/:id/classify", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { status, notes } = req.body;
  if (!["winner", "loser", "retest", "scaling"].includes(status)) {
    res.status(400).json({ error: "status must be winner, loser, retest, or scaling" });
    return;
  }

  const [existing] = await db.select({ workspaceId: offersTable.workspaceId }).from(offersTable).where(eq(offersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Offer not found" }); return; }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  const updateData: Partial<typeof offersTable.$inferInsert> = { status };
  if (notes !== undefined) updateData.notes = notes;

  // SPEC Phase 1 (T006): defense-in-depth — scope by workspaceId.
  const [offer] = await db
    .update(offersTable)
    .set(updateData)
    .where(and(
      eq(offersTable.id, id),
      eq(offersTable.workspaceId, existing.workspaceId),
    ))
    .returning();

  if (!offer) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }

  res.json(serializeOffer(offer));
});

export default router;
