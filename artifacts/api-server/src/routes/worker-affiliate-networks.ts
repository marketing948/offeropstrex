// CampaignOps redesign — admin-only worker ↔ affiliate network assignments.
//
// Workers are restricted to the affiliate networks an admin has assigned
// them. The batch creation form filters its affiliate-network dropdown
// using these assignments. Traffic sources remain shared across all
// workers (no per-worker gating).

import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  workerAffiliateNetworksTable,
  affiliateNetworksTable,
  employeesTable,
} from "@workspace/db";
import { requireWorkspaceFromQuery, requireWorkspaceAccess } from "../lib/workspace-access";
import { getEmployeeFromToken } from "./auth";

const router: IRouter = Router();

async function requireAdmin(req: Parameters<typeof getEmployeeFromToken>[0]): Promise<{ id: number; role: string } | null> {
  const emp = await getEmployeeFromToken(req);
  if (!emp || emp.role !== "admin") return null;
  return emp;
}

// GET /api/worker-affiliate-networks?workspace_id=N
// Returns rows of { employeeId, affiliateNetworkId } for the workspace.
router.get("/worker-affiliate-networks", async (req, res): Promise<void> => {
  const wsId = await requireWorkspaceFromQuery(req, res);
  if (wsId === null) return;

  const employeeIdRaw = req.query["employee_id"];
  const conditions = [eq(workerAffiliateNetworksTable.workspaceId, wsId)];
  if (employeeIdRaw != null && employeeIdRaw !== "") {
    const n = Number(employeeIdRaw);
    if (!Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: "employee_id must be a positive integer" });
      return;
    }
    conditions.push(eq(workerAffiliateNetworksTable.employeeId, n));
  }

  const rows = await db
    .select({
      id: workerAffiliateNetworksTable.id,
      employeeId: workerAffiliateNetworksTable.employeeId,
      affiliateNetworkId: workerAffiliateNetworksTable.affiliateNetworkId,
      employeeName: employeesTable.name,
      affiliateNetworkName: affiliateNetworksTable.name,
    })
    .from(workerAffiliateNetworksTable)
    .leftJoin(employeesTable, eq(workerAffiliateNetworksTable.employeeId, employeesTable.id))
    .leftJoin(affiliateNetworksTable, eq(workerAffiliateNetworksTable.affiliateNetworkId, affiliateNetworksTable.id))
    .where(and(...conditions));

  res.json(rows);
});

// PUT /api/worker-affiliate-networks
// Admin-only. Body: { workspaceId, employeeId, affiliateNetworkIds: number[] }
// Replaces the assignment set for the (workspace, employee).
const putBodySchema = z.object({
  workspaceId: z.number().int().positive(),
  employeeId: z.number().int().positive(),
  affiliateNetworkIds: z.array(z.number().int().positive()),
});

router.put("/worker-affiliate-networks", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req);
  if (!admin) {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const parsed = putBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { workspaceId: wsId, employeeId, affiliateNetworkIds } = parsed.data;
  if ((await requireWorkspaceAccess(req, res, wsId)) === null) return;

  // Validate the employee exists and the supplied networks belong to this workspace.
  const [emp] = await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) {
    res.status(400).json({ error: "Employee not found" });
    return;
  }
  if (affiliateNetworkIds.length > 0) {
    const networks = await db
      .select({ id: affiliateNetworksTable.id, workspaceId: affiliateNetworksTable.workspaceId })
      .from(affiliateNetworksTable)
      .where(inArray(affiliateNetworksTable.id, affiliateNetworkIds));
    const bad = networks.find((n) => n.workspaceId !== wsId);
    if (bad || networks.length !== affiliateNetworkIds.length) {
      res.status(400).json({ error: "One or more affiliateNetworkIds do not belong to this workspace" });
      return;
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(workerAffiliateNetworksTable)
      .where(
        and(
          eq(workerAffiliateNetworksTable.workspaceId, wsId),
          eq(workerAffiliateNetworksTable.employeeId, employeeId),
        ),
      );
    if (affiliateNetworkIds.length > 0) {
      await tx
        .insert(workerAffiliateNetworksTable)
        .values(
          affiliateNetworkIds.map((nid) => ({
            workspaceId: wsId,
            employeeId,
            affiliateNetworkId: nid,
          })),
        );
    }
  });

  res.json({ success: true, count: affiliateNetworkIds.length });
});

export default router;
