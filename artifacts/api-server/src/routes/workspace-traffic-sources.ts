import { Router, type IRouter } from "express";
import { eq, and, asc, sql, type SQL } from "drizzle-orm";
import {
  db,
  workspaceTrafficSourcesTable,
  testingBatchesTable,
} from "@workspace/db";
import {
  requireAdmin,
  requireWorkspaceAccess,
  requireWorkspaceFromQuery,
} from "../lib/workspace-access";

const router: IRouter = Router();

const PATH = "/admin/workspace-traffic-sources";

router.get(PATH, async (req, res): Promise<void> => {
  // Pivot Phase 3 (Task #26): manual batch creation needs workers to
  // see the workspace's traffic source rotation. Read access is now
  // open to any workspace member; writes (POST/PATCH/DELETE/reorder)
  // remain admin-only below.
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const rows = await db
    .select()
    .from(workspaceTrafficSourcesTable)
    .where(eq(workspaceTrafficSourcesTable.workspaceId, workspaceId))
    .orderBy(asc(workspaceTrafficSourcesTable.position));

  res.json(rows);
});

router.post(PATH, async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const { workspaceId, name, voluumTrafficSourceId, isActive } = req.body ?? {};
  if ((await requireWorkspaceAccess(req, res, workspaceId ?? null)) === null) return;
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  // next position = max+1 (or 1 if empty)
  const [{ maxPos }] = await db
    .select({ maxPos: sql<number | null>`MAX(${workspaceTrafficSourcesTable.position})` })
    .from(workspaceTrafficSourcesTable)
    .where(eq(workspaceTrafficSourcesTable.workspaceId, workspaceId));
  const position = (maxPos ?? 0) + 1;

  try {
    const [row] = await db
      .insert(workspaceTrafficSourcesTable)
      .values({
        workspaceId,
        name: trimmed,
        voluumTrafficSourceId: voluumTrafficSourceId ?? null,
        position,
        isActive: typeof isActive === "boolean" ? isActive : true,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("workspace_traffic_sources_workspace_name_unique")) {
      res.status(409).json({ error: "A traffic source with this name already exists in the workspace" });
      return;
    }
    throw err;
  }
});

router.patch(`${PATH}/reorder`, async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const { workspaceId, orderedIds } = req.body ?? {};
  if ((await requireWorkspaceAccess(req, res, workspaceId ?? null)) === null) return;
  if (!Array.isArray(orderedIds) || orderedIds.some((x) => !Number.isInteger(x))) {
    res.status(400).json({ error: "orderedIds must be an array of integers" });
    return;
  }

  const existing = await db
    .select({ id: workspaceTrafficSourcesTable.id })
    .from(workspaceTrafficSourcesTable)
    .where(eq(workspaceTrafficSourcesTable.workspaceId, workspaceId));
  const existingIds = new Set(existing.map((r) => r.id));
  const incomingIds = new Set<number>(orderedIds);
  if (existingIds.size !== incomingIds.size || [...existingIds].some((id) => !incomingIds.has(id))) {
    res.status(400).json({
      error: "orderedIds must contain exactly the workspace's existing traffic source ids",
    });
    return;
  }

  // Two-phase reorder to avoid (workspace_id, position) unique conflicts:
  // shift to negative offset, then write final positions.
  await db.transaction(async (tx) => {
    await tx
      .update(workspaceTrafficSourcesTable)
      .set({ position: sql`-${workspaceTrafficSourcesTable.position} - 1000000` })
      .where(eq(workspaceTrafficSourcesTable.workspaceId, workspaceId));

    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(workspaceTrafficSourcesTable)
        .set({ position: i + 1 })
        .where(and(
          eq(workspaceTrafficSourcesTable.id, orderedIds[i]),
          eq(workspaceTrafficSourcesTable.workspaceId, workspaceId),
        ));
    }
  });

  const rows = await db
    .select()
    .from(workspaceTrafficSourcesTable)
    .where(eq(workspaceTrafficSourcesTable.workspaceId, workspaceId))
    .orderBy(asc(workspaceTrafficSourcesTable.position));
  res.json(rows);
});

router.patch(`${PATH}/:id`, async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select({ workspaceId: workspaceTrafficSourcesTable.workspaceId })
    .from(workspaceTrafficSourcesTable)
    .where(eq(workspaceTrafficSourcesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Workspace traffic source not found" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  const { name, voluumTrafficSourceId, isActive } = req.body ?? {};
  const patch: Partial<typeof workspaceTrafficSourcesTable.$inferInsert> = {};
  if (typeof name === "string") {
    const trimmed = name.trim();
    if (!trimmed) {
      res.status(400).json({ error: "name cannot be empty" });
      return;
    }
    patch.name = trimmed;
  }
  if (voluumTrafficSourceId !== undefined) patch.voluumTrafficSourceId = voluumTrafficSourceId;
  if (typeof isActive === "boolean") patch.isActive = isActive;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No updatable fields supplied" });
    return;
  }

  try {
    const [row] = await db
      .update(workspaceTrafficSourcesTable)
      .set(patch)
      .where(eq(workspaceTrafficSourcesTable.id, id))
      .returning();
    res.json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("workspace_traffic_sources_workspace_name_unique")) {
      res.status(409).json({ error: "A traffic source with this name already exists in the workspace" });
      return;
    }
    throw err;
  }
});

router.delete(`${PATH}/:id`, async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select({
      workspaceId: workspaceTrafficSourcesTable.workspaceId,
    })
    .from(workspaceTrafficSourcesTable)
    .where(eq(workspaceTrafficSourcesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Workspace traffic source not found" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  // Phase 8 guard: refuse if any in-flight batch's snapshot references this id.
  const inFlight: SQL = and(
    eq(testingBatchesTable.workspaceId, existing.workspaceId),
    sql`${testingBatchesTable.status} NOT IN ('completed','scaling','closed')`,
    sql`${testingBatchesTable.trafficSourceOrderSnapshot} @> ${JSON.stringify([{ id }])}::jsonb`,
  )!;
  const refs = await db
    .select({ id: testingBatchesTable.id })
    .from(testingBatchesTable)
    .where(inFlight)
    .limit(1);
  if (refs.length > 0) {
    res.status(409).json({
      error: "Cannot delete: referenced by an in-flight batch's rotation snapshot",
      blockingBatchId: refs[0].id,
    });
    return;
  }

  await db
    .delete(workspaceTrafficSourcesTable)
    .where(eq(workspaceTrafficSourcesTable.id, id));
  res.status(204).end();
});

export default router;
