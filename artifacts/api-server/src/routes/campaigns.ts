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

import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  campaignsTable,
  testingBatchesTable,
  workspaceTrafficSourcesTable,
  employeesTable,
} from "@workspace/db";
import { z } from "zod/v4";
import { checkWorkspaceAccess, requireWorkspaceAccess } from "../lib/workspace-access";
import { applyAction } from "../engine/executor.ts";
import { emit } from "../engine/event-bus";

const router: IRouter = Router();

const VALID_STATUSES = ["draft", "ready", "voluum_created", "live", "tested", "closed"] as const;
type CampaignStatus = (typeof VALID_STATUSES)[number];
const LIVE_CAMPAIGN_STATUSES = ["live", "tested", "closed"] as const;
type LiveCampaignStatus = (typeof LIVE_CAMPAIGN_STATUSES)[number];

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

function parsePositiveIntegerQuery(
  raw: unknown,
  name: string,
  res: Response,
): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `${name} must be a positive integer` });
    return null;
  }
  return n;
}

function parseDateQuery(raw: unknown, name: string, res: Response): Date | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") {
    res.status(400).json({ error: `${name} must be a date string` });
    return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    res.status(400).json({ error: `${name} must be a valid date` });
    return null;
  }
  return date;
}

function parseLimit(raw: unknown, res: Response): number | null {
  if (raw == null || raw === "") return 50;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: "limit must be a positive integer" });
    return null;
  }
  return Math.min(n, 200);
}

function parseOffset(raw: unknown, res: Response): number | null {
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    res.status(400).json({ error: "offset must be a non-negative integer" });
    return null;
  }
  return n;
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
  const fieldUpdates: Partial<typeof campaignsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (campaignName !== undefined) fieldUpdates.campaignName = campaignName;
  if (trafficSourceId !== undefined) fieldUpdates.trafficSourceId = trafficSourceId;
  if (campaignUrl !== undefined) fieldUpdates.campaignUrl = campaignUrl;

  const hasFieldUpdates =
    campaignName !== undefined
    || trafficSourceId !== undefined
    || campaignUrl !== undefined;
  const statusChanging = status !== undefined && status !== existing.status;

  if (!statusChanging) {
    if (!hasFieldUpdates) {
      res.json(serialize(existing));
      return;
    }

    const [row] = await db
      .update(campaignsTable)
      .set(fieldUpdates)
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.workspaceId, existing.workspaceId)))
      .returning();
    res.json(serialize(row));
    return;
  }

  const nextStatus = status;

  try {
    const row = await db.transaction(async (tx) => {
      if (hasFieldUpdates) {
        await tx
          .update(campaignsTable)
          .set(fieldUpdates)
          .where(
            and(
              eq(campaignsTable.id, id),
              eq(campaignsTable.workspaceId, existing.workspaceId),
            ),
          );
      }

      await applyAction(
        {
          type: "UpdateCampaignStatus",
          workspaceId: existing.workspaceId,
          campaignId: id,
          from: existing.status,
          to: nextStatus,
        },
        tx,
      );

      const [current] = await tx
        .select()
        .from(campaignsTable)
        .where(
          and(
            eq(campaignsTable.id, id),
            eq(campaignsTable.workspaceId, existing.workspaceId),
          ),
        )
        .limit(1);

      if (!current || current.status !== nextStatus) {
        throw new Error("Invalid campaign status transition");
      }

      return current;
    });

    res.json(serialize(row));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Invalid campaign status transition") {
      res.status(409).json({
        error: message,
        detail:
          `Campaign is in status "${existing.status}"; cannot transition to "${nextStatus}" ` +
          "(concurrent update or invalid from-state).",
      });
      return;
    }
    throw err;
  }
});

router.get("/live-campaigns", async (req, res): Promise<void> => {
  const wsId = Number(req.query["workspace_id"]);
  if (!Number.isInteger(wsId) || wsId <= 0) {
    res.status(400).json({ error: "workspace_id is required" });
    return;
  }

  const access = await checkWorkspaceAccess(req, wsId);
  if (!access.allowed) {
    res.status(access.status).json({ error: access.reason });
    return;
  }

  const statusRaw = req.query["status"];
  const status = statusRaw == null || statusRaw === "" ? "live" : statusRaw;
  if (typeof status !== "string" || !LIVE_CAMPAIGN_STATUSES.includes(status as LiveCampaignStatus)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  const platformRaw = req.query["platform"];
  if (platformRaw != null && platformRaw !== "" && platformRaw !== "ios" && platformRaw !== "android") {
    res.status(400).json({ error: "Invalid platform" });
    return;
  }

  const trafficSourceId = parsePositiveIntegerQuery(req.query["traffic_source_id"], "traffic_source_id", res);
  if (res.headersSent) return;
  const batchId = parsePositiveIntegerQuery(req.query["batch_id"], "batch_id", res);
  if (res.headersSent) return;
  const employeeId = parsePositiveIntegerQuery(req.query["employee_id"], "employee_id", res);
  if (res.headersSent) return;
  const workerId = parsePositiveIntegerQuery(req.query["worker_id"], "worker_id", res);
  if (res.headersSent) return;
  if (employeeId !== null && workerId !== null && employeeId !== workerId) {
    res.status(400).json({ error: "employee_id and worker_id must match when both are provided" });
    return;
  }
  const requestedWorkerId = employeeId ?? workerId;

  const dateFrom = parseDateQuery(req.query["date_from"], "date_from", res);
  if (res.headersSent) return;
  const dateTo = parseDateQuery(req.query["date_to"], "date_to", res);
  if (res.headersSent) return;
  const limit = parseLimit(req.query["limit"], res);
  if (limit === null) return;
  const offset = parseOffset(req.query["offset"], res);
  if (offset === null) return;

  const conditions = [
    eq(campaignsTable.workspaceId, wsId),
    eq(testingBatchesTable.workspaceId, wsId),
    eq(campaignsTable.status, status as LiveCampaignStatus),
  ];

  if (platformRaw === "ios" || platformRaw === "android") {
    conditions.push(eq(campaignsTable.platform, platformRaw));
  }
  if (trafficSourceId !== null) conditions.push(eq(campaignsTable.trafficSourceId, trafficSourceId));
  if (batchId !== null) conditions.push(eq(campaignsTable.batchId, batchId));
  if (req.query["geo"] != null && req.query["geo"] !== "") {
    conditions.push(eq(testingBatchesTable.geo, String(req.query["geo"])));
  }
  if (req.query["affiliate_network"] != null && req.query["affiliate_network"] !== "") {
    conditions.push(eq(testingBatchesTable.affiliateNetwork, String(req.query["affiliate_network"])));
  }
  if (dateFrom !== null) conditions.push(gte(campaignsTable.liveStartedAt, dateFrom));
  if (dateTo !== null) conditions.push(lte(campaignsTable.liveStartedAt, dateTo));

  if (access.employee.role === "admin") {
    if (requestedWorkerId !== null) conditions.push(eq(testingBatchesTable.employeeId, requestedWorkerId));
  } else {
    conditions.push(eq(testingBatchesTable.employeeId, access.employee.id));
    if (requestedWorkerId !== null) conditions.push(eq(testingBatchesTable.employeeId, requestedWorkerId));
  }

  const where = and(...conditions);
  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(campaignsTable)
    .innerJoin(
      testingBatchesTable,
      and(
        eq(campaignsTable.batchId, testingBatchesTable.id),
        eq(testingBatchesTable.workspaceId, wsId),
      ),
    )
    .where(where);

  const rows = await db
    .select({
      campaign: campaignsTable,
      batchName: testingBatchesTable.batchName,
      batchGeo: testingBatchesTable.geo,
      batchAffiliateNetwork: testingBatchesTable.affiliateNetwork,
      employeeName: employeesTable.name,
      trafficSourceName: workspaceTrafficSourcesTable.name,
    })
    .from(campaignsTable)
    .innerJoin(
      testingBatchesTable,
      and(
        eq(campaignsTable.batchId, testingBatchesTable.id),
        eq(testingBatchesTable.workspaceId, wsId),
      ),
    )
    .leftJoin(
      employeesTable,
      eq(testingBatchesTable.employeeId, employeesTable.id),
    )
    .leftJoin(
      workspaceTrafficSourcesTable,
      and(
        eq(campaignsTable.trafficSourceId, workspaceTrafficSourcesTable.id),
        eq(workspaceTrafficSourcesTable.workspaceId, wsId),
      ),
    )
    .where(where)
    .orderBy(sql`${campaignsTable.liveStartedAt} desc nulls last`, desc(campaignsTable.id))
    .limit(limit)
    .offset(offset);

  res.json({
    items: rows.map((row) => ({
      ...serialize(row.campaign),
      batchName: row.batchName,
      batchGeo: row.batchGeo,
      batchAffiliateNetwork: row.batchAffiliateNetwork,
      employeeName: row.employeeName,
      trafficSourceName: row.trafficSourceName,
    })),
    pagination: {
      limit,
      offset,
      total: Number(totalRow?.total ?? 0),
    },
  });
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
