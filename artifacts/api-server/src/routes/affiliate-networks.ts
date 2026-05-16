import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, affiliateNetworksTable } from "@workspace/db";
import { requireWorkspaceFromQuery, requireAdmin, requireWorkspaceAccess } from "../lib/workspace-access";

// Pivot Phase 2 (Task #25) — manual workspace-scoped CRUD for the
// admin-managed list of affiliate networks. Mirrors the geos route.
// Reads: any workspace member. Writes: admin only.

const router: IRouter = Router();

function serialize(row: typeof affiliateNetworksTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/affiliate-networks", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;
  const rows = await db
    .select()
    .from(affiliateNetworksTable)
    .where(eq(affiliateNetworksTable.workspaceId, workspaceId))
    .orderBy(affiliateNetworksTable.name);
  res.json(rows.map(serialize));
});

router.post("/affiliate-networks", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;
  const { workspaceId, name, isActive } = req.body ?? {};
  const wsId = Number(workspaceId);
  if (!Number.isInteger(wsId) || wsId <= 0) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const access = await requireWorkspaceAccess(req, res, wsId);
  if (!access) return;
  try {
    const [row] = await db
      .insert(affiliateNetworksTable)
      .values({ workspaceId: wsId, name: name.trim(), isActive: isActive !== false })
      .returning();
    res.status(201).json(serialize(row));
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      res.status(409).json({ error: "An affiliate network with this name already exists in this workspace" });
      return;
    }
    throw err;
  }
});

router.patch("/affiliate-networks/:id", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(affiliateNetworksTable).where(eq(affiliateNetworksTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const access = await requireWorkspaceAccess(req, res, existing.workspaceId);
  if (!access) return;
  const { name, isActive } = req.body ?? {};
  const updates: Partial<typeof affiliateNetworksTable.$inferInsert> = { updatedAt: new Date() };
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof isActive === "boolean") updates.isActive = isActive;
  try {
    const [row] = await db
      .update(affiliateNetworksTable)
      .set(updates)
      .where(eq(affiliateNetworksTable.id, id))
      .returning();
    res.json(serialize(row));
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      res.status(409).json({ error: "An affiliate network with this name already exists in this workspace" });
      return;
    }
    throw err;
  }
});

router.delete("/affiliate-networks/:id", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(affiliateNetworksTable).where(eq(affiliateNetworksTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const access = await requireWorkspaceAccess(req, res, existing.workspaceId);
  if (!access) return;
  try {
    await db.delete(affiliateNetworksTable).where(eq(affiliateNetworksTable.id, id));
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === "23503" || err?.cause?.code === "23503") {
      res.status(409).json({ error: "Cannot delete: this affiliate network is in use by one or more batches" });
      return;
    }
    throw err;
  }
});

export default router;
