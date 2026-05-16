import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, geosTable } from "@workspace/db";
import { requireWorkspaceFromQuery, requireAdmin, requireWorkspaceAccess } from "../lib/workspace-access";

// Pivot Phase 2 (Task #25) — manual workspace-scoped CRUD for the
// admin-managed list of GEOs. Reads: any workspace member.
// Writes: admin only.

const router: IRouter = Router();

function serialize(row: typeof geosTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normCode(s: string): string {
  return s.trim().toUpperCase();
}

router.get("/geos", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;
  const rows = await db
    .select()
    .from(geosTable)
    .where(eq(geosTable.workspaceId, workspaceId))
    .orderBy(geosTable.code);
  res.json(rows.map(serialize));
});

router.post("/geos", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;
  const { workspaceId, code, name, isActive } = req.body ?? {};
  const wsId = Number(workspaceId);
  if (!Number.isInteger(wsId) || wsId <= 0) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  if (typeof code !== "string" || !code.trim()) {
    res.status(400).json({ error: "code is required" });
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
      .insert(geosTable)
      .values({ workspaceId: wsId, code: normCode(code), name: name.trim(), isActive: isActive !== false })
      .returning();
    res.status(201).json(serialize(row));
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      res.status(409).json({ error: "A GEO with this code already exists in this workspace" });
      return;
    }
    throw err;
  }
});

router.patch("/geos/:id", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(geosTable).where(eq(geosTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const access = await requireWorkspaceAccess(req, res, existing.workspaceId);
  if (!access) return;
  const { code, name, isActive } = req.body ?? {};
  const updates: Partial<typeof geosTable.$inferInsert> = { updatedAt: new Date() };
  if (typeof code === "string" && code.trim()) updates.code = normCode(code);
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof isActive === "boolean") updates.isActive = isActive;
  try {
    const [row] = await db
      .update(geosTable)
      .set(updates)
      .where(eq(geosTable.id, id))
      .returning();
    res.json(serialize(row));
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      res.status(409).json({ error: "A GEO with this code already exists in this workspace" });
      return;
    }
    throw err;
  }
});

router.delete("/geos/:id", async (req, res): Promise<void> => {
  if ((await requireAdmin(req, res)) === null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(geosTable).where(eq(geosTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const access = await requireWorkspaceAccess(req, res, existing.workspaceId);
  if (!access) return;
  try {
    await db.delete(geosTable).where(eq(geosTable.id, id));
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === "23503" || err?.cause?.code === "23503") {
      res.status(409).json({ error: "Cannot delete: this GEO is in use by one or more batches" });
      return;
    }
    throw err;
  }
});

export default router;
