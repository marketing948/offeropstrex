// Pivot Phase 4 (Task #27) — minimal manual `campaigns` write surface.
//
// Phase 5 will replace this with a fully-fledged UI-driven CRUD; for
// now the engine needs a way to create / transition campaign rows so
// the auto-task rules can be exercised end-to-end (the rules read
// the `campaigns` table to decide whether BOTH ios + android have
// reached `ready` / `live`).
//
// `campaigns` is NOT in the engine's FORBIDDEN_TABLES allowlist, so
// the routes are allowed to write the row directly. Engine-owned
// follow-on side effects (CREATE_*_CAMPAIGN, GO_LIVE,
// OPTIMIZATION_FOLLOWUP tasks) flow through emit() →
// CampaignStatusChanged → rule → executor.

import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  campaignsTable,
  testingBatchesTable,
  workspaceTrafficSourcesTable,
  employeesTable,
} from "@workspace/db";
import { z } from "zod/v4";
import { requireWorkspaceAccess } from "../lib/workspace-access";
import { emit } from "../engine/event-bus";

const router: IRouter = Router();

const VALID_STATUSES = ["draft", "ready", "voluum_created", "live", "tested", "closed"] as const;
type CampaignStatus = (typeof VALID_STATUSES)[number];

// Pivot Phase 4 (Task #27): Zod-validated request bodies. Phase 5 will
// replace these with the generated `insertCampaignSchema` once the
// full UI contract exists.
const createBodySchema = z.object({
  workspaceId: z.number().int().positive(),
  batchId: z.number().int().positive(),
  platform: z.enum(["ios", "android"]),
  campaignName: z.string().trim().min(1),
  trafficSourceId: z.number().int().positive().nullable().optional(),
  campaignUrl: z.string().nullable().optional(),
  status: z.enum(VALID_STATUSES).optional(),
});

const patchBodySchema = z.object({
  campaignName: z.string().trim().min(1).optional(),
  trafficSourceId: z.number().int().positive().nullable().optional(),
  campaignUrl: z.string().nullable().optional(),
  status: z.enum(VALID_STATUSES).optional(),
});

function serialize(row: typeof campaignsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.post("/campaigns", async (req, res): Promise<void> => {
  const parsed = createBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid body",
      issues: parsed.error.issues,
    });
    return;
  }
  const {
    workspaceId: wsId,
    batchId: bId,
    platform,
    campaignName,
    trafficSourceId,
    campaignUrl,
    status,
  } = parsed.data;
  const initialStatus: CampaignStatus = status ?? "draft";

  if ((await requireWorkspaceAccess(req, res, wsId)) === null) return;

  // Verify the batch belongs to the same workspace before linking.
  const [batch] = await db
    .select({ id: testingBatchesTable.id })
    .from(testingBatchesTable)
    .where(
      and(
        eq(testingBatchesTable.id, bId),
        eq(testingBatchesTable.workspaceId, wsId),
      ),
    );
  if (!batch) {
    res.status(404).json({ error: "Batch not found in workspace" });
    return;
  }

  let row: typeof campaignsTable.$inferSelect;
  try {
    [row] = await db
      .insert(campaignsTable)
      .values({
        workspaceId: wsId,
        batchId: bId,
        platform,
        campaignName,
        trafficSourceId: trafficSourceId ?? null,
        campaignUrl: campaignUrl ?? null,
        status: initialStatus,
      })
      .returning();
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } })?.code
      ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      res.status(409).json({
        error: "A campaign for this batch + platform already exists",
      });
      return;
    }
    throw err;
  }

  // Emit on every create — `from: null` so the rule still fires when a
  // campaign is created already in `ready`/`live`. Idempotency comes
  // from the dedupe key (campaignId + status); a retry of the same
  // POST cannot create the row anyway (unique batch+platform above).
  try {
    await emit({
      type: "CampaignStatusChanged",
      workspaceId: wsId,
      payload: {
        campaignId: row.id,
        batchId: bId,
        platform: row.platform,
        from: null,
        to: row.status,
      },
      dedupeKey: `campaign_status:${row.id}:${row.status}`,
    });
  } catch (err) {
    req.log.warn(
      { err, campaignId: row.id },
      "[campaigns] CampaignStatusChanged emit failed — tombstoned",
    );
  }

  res.status(201).json(serialize(row));
});

router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) {
    return;
  }

  const parsed = patchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid body",
      issues: parsed.error.issues,
    });
    return;
  }
  const { campaignName, trafficSourceId, campaignUrl, status } = parsed.data;
  const updates: Partial<typeof campaignsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (campaignName !== undefined) updates.campaignName = campaignName;
  if (trafficSourceId !== undefined) updates.trafficSourceId = trafficSourceId;
  if (campaignUrl !== undefined) updates.campaignUrl = campaignUrl;
  let nextStatus: CampaignStatus = existing.status;
  let statusChanged = false;
  if (status !== undefined && status !== existing.status) {
    nextStatus = status;
    updates.status = nextStatus;
    statusChanged = true;
  }

  const [row] = await db
    .update(campaignsTable)
    .set(updates)
    .where(eq(campaignsTable.id, id))
    .returning();

  if (statusChanged) {
    try {
      await emit({
        type: "CampaignStatusChanged",
        workspaceId: row.workspaceId,
        payload: {
          campaignId: row.id,
          batchId: row.batchId,
          platform: row.platform,
          from: existing.status,
          to: nextStatus,
        },
        dedupeKey: `campaign_status:${row.id}:${nextStatus}`,
      });
    } catch (err) {
      req.log.warn(
        { err, campaignId: row.id },
        "[campaigns] CampaignStatusChanged emit failed — tombstoned",
      );
    }
  }

  res.json(serialize(row));
});

router.get("/campaigns", async (req, res): Promise<void> => {
  const wsId = Number(req.query["workspace_id"]);
  if (!Number.isInteger(wsId) || wsId <= 0) {
    res.status(400).json({ error: "workspace_id is required" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, wsId)) === null) return;

  const conditions = [eq(campaignsTable.workspaceId, wsId)];

  const batchIdRaw = req.query["batch_id"];
  if (batchIdRaw != null && batchIdRaw !== "") {
    const n = Number(batchIdRaw);
    if (!Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: "batch_id must be a positive integer" });
      return;
    }
    conditions.push(eq(campaignsTable.batchId, n));
  }

  const statusRaw = req.query["status"];
  if (statusRaw != null && statusRaw !== "") {
    if (typeof statusRaw !== "string" || !VALID_STATUSES.includes(statusRaw as CampaignStatus)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    conditions.push(eq(campaignsTable.status, statusRaw as CampaignStatus));
  }

  const platformRaw = req.query["platform"];
  if (platformRaw === "ios" || platformRaw === "android") {
    conditions.push(eq(campaignsTable.platform, platformRaw));
  }

  const trafficSourceIdRaw = req.query["traffic_source_id"];
  if (trafficSourceIdRaw != null && trafficSourceIdRaw !== "") {
    const n = Number(trafficSourceIdRaw);
    if (!Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: "traffic_source_id must be a positive integer" });
      return;
    }
    conditions.push(eq(campaignsTable.trafficSourceId, n));
  }

  const rows = await db
    .select()
    .from(campaignsTable)
    .where(and(...conditions));

  // Enrich with batch + traffic source + employee names for the
  // Live Campaigns page.
  const batchIds = Array.from(new Set(rows.map((r) => r.batchId)));
  const tsIds = Array.from(new Set(rows.map((r) => r.trafficSourceId).filter((v): v is number => v != null)));

  const [batches, tsources] = await Promise.all([
    batchIds.length
      ? db
          .select({
            id: testingBatchesTable.id,
            batchName: testingBatchesTable.batchName,
            employeeId: testingBatchesTable.employeeId,
            geo: testingBatchesTable.geo,
            affiliateNetwork: testingBatchesTable.affiliateNetwork,
          })
          .from(testingBatchesTable)
          .where(inArray(testingBatchesTable.id, batchIds))
      : Promise.resolve([] as { id: number; batchName: string; employeeId: number | null; geo: string | null; affiliateNetwork: string | null }[]),
    tsIds.length
      ? db
          .select({ id: workspaceTrafficSourcesTable.id, name: workspaceTrafficSourcesTable.name })
          .from(workspaceTrafficSourcesTable)
          .where(inArray(workspaceTrafficSourcesTable.id, tsIds))
      : Promise.resolve([] as { id: number; name: string }[]),
  ]);
  const empIds = Array.from(
    new Set(batches.map((b) => b.employeeId).filter((v): v is number => v != null)),
  );
  const emps = empIds.length
    ? await db
        .select({ id: employeesTable.id, name: employeesTable.name })
        .from(employeesTable)
        .where(inArray(employeesTable.id, empIds))
    : ([] as { id: number; name: string }[]);

  const batchMap = new Map(batches.map((b) => [b.id, b]));
  const tsMap = new Map(tsources.map((t) => [t.id, t.name]));
  const empMap = new Map(emps.map((e) => [e.id, e.name]));

  res.json(
    rows.map((r) => {
      const b = batchMap.get(r.batchId);
      return {
        ...serialize(r),
        batchName: b?.batchName ?? null,
        batchGeo: b?.geo ?? null,
        batchAffiliateNetwork: b?.affiliateNetwork ?? null,
        employeeName: b?.employeeId != null ? empMap.get(b.employeeId) ?? null : null,
        trafficSourceName: r.trafficSourceId != null ? tsMap.get(r.trafficSourceId) ?? null : null,
      };
    }),
  );
});

export default router;
