import { Router, type IRouter } from "express";
import { asc, eq, and, count, inArray, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  db,
  batchTrafficSourceRunsTable,
  testingBatchesTable,
  employeesTable,
  employeeWorkspaceAssignmentsTable,
  affiliateNetworksTable,
  geosTable,
  workspaceTrafficSourcesTable,
  workerAffiliateNetworksTable,
  offersTable,
  campaignsTable,
  campaignDailyMetricsTable,
  campaignWinnersTable,
  performanceTable,
  batchResultsTable,
  trackerCampaignsTable,
  voluumCampaignMappingsTable,
  todoTasksTable,
  notificationsTable,
  importedOffersTable,
  voluumOffersTable,
} from "@workspace/db";
import { z } from "zod/v4";
import {
  CreateTestingBatchBody,
  UpdateTestingBatchBody,
  GetTestingBatchParams,
  UpdateTestingBatchParams,
  DeleteTestingBatchParams,
  ListTestingBatchesQueryParams,
} from "@workspace/api-zod";
import { requireWorkspaceFromQuery, requireWorkspaceAccess, requireAdmin } from "../lib/workspace-access";
import { recordOperationalEvent } from "../lib/operational-events.ts";
import {
  enforceEmployeeIdAccess,
  networkNameAllowed,
  requireWorkspaceWithNetworkScope,
} from "../lib/worker-network-access";
import { recordBatchCreatedOperationalEvent } from "../lib/campaignops-operational-events.ts";
import { emit } from "../engine/event-bus.ts";
import {
  executeDeleteBatch,
  executeUpdateBatchFields,
} from "../engine/executor.ts";
import type { BatchStatus } from "../engine/types.ts";

const router: IRouter = Router();

/**
 * Verify the worker exists, is active, and is allowed in `workspaceId`
 * (admin users have access to every workspace; others must be in
 * employee_workspace_assignments). Returns null on success, otherwise an
 * { status, error } payload the caller should send back to the client.
 *
 * This mirrors the membership rule used by GET /employees?workspace_id=...
 * so the manual-batch flow cannot assign a batch to someone outside the
 * workspace (Pivot Phase 3 / Task #26 acceptance).
 */
async function validateAssignedWorkerInWorkspace(
  employeeId: number,
  workspaceId: number,
): Promise<{ status: number; error: string } | null> {
  const [emp] = await db
    .select({ id: employeesTable.id, role: employeesTable.role, status: employeesTable.status })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId));
  if (!emp) return { status: 400, error: "assignedWorkerId not found" };
  if (emp.status !== "active") return { status: 400, error: "assignedWorkerId is not an active employee" };
  if (emp.role === "admin") return null;
  const [assignment] = await db
    .select({ id: employeeWorkspaceAssignmentsTable.id })
    .from(employeeWorkspaceAssignmentsTable)
    .where(and(
      eq(employeeWorkspaceAssignmentsTable.employeeId, employeeId),
      eq(employeeWorkspaceAssignmentsTable.workspaceId, workspaceId),
    ));
  if (!assignment) return { status: 400, error: "assignedWorkerId is not a member of this workspace" };
  return null;
}

type EnrichmentMaps = {
  employeeNames: Map<number, string>;
  affiliateNetworkNames: Map<number, string>;
  geos: Map<number, { code: string; name: string | null }>;
};

const GET_BATCH_INCLUDE_TRAFFIC_SOURCE_RUNS = "traffic_source_runs";

type GetBatchIncludeFlags = {
  trafficSourceRuns: boolean;
  error?: string;
};

function parseGetBatchInclude(query: Record<string, unknown>): GetBatchIncludeFlags {
  const raw = query["include"];
  if (raw == null || raw === "") return { trafficSourceRuns: false };
  const tokens = String(raw)
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (tokens.length === 0) return { trafficSourceRuns: false };
  const unknown = tokens.filter((token) => token !== GET_BATCH_INCLUDE_TRAFFIC_SOURCE_RUNS);
  if (unknown.length > 0) {
    return {
      trafficSourceRuns: false,
      error: `Unknown include value(s): ${unknown.join(", ")}`,
    };
  }
  return { trafficSourceRuns: tokens.includes(GET_BATCH_INCLUDE_TRAFFIC_SOURCE_RUNS) };
}

type TrafficSourceRunRow = {
  id: number;
  position: number;
  status: string;
  trafficSourceId: number;
  trafficSourceName: string | null;
  iosStatus: string;
  androidStatus: string;
  iosCampaignId: number | null;
  androidCampaignId: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};

function serializeTrafficSourceRun(run: TrafficSourceRunRow) {
  return {
    id: run.id,
    position: run.position,
    status: run.status,
    trafficSourceId: run.trafficSourceId,
    trafficSourceName: run.trafficSourceName,
    iosStatus: run.iosStatus,
    androidStatus: run.androidStatus,
    iosCampaignId: run.iosCampaignId,
    androidCampaignId: run.androidCampaignId,
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    createdAt: run.createdAt.toISOString(),
  };
}

async function loadTrafficSourceRunsForBatch(
  workspaceId: number,
  batchId: number,
): Promise<TrafficSourceRunRow[]> {
  return db
    .select({
      id: batchTrafficSourceRunsTable.id,
      position: batchTrafficSourceRunsTable.position,
      status: batchTrafficSourceRunsTable.status,
      trafficSourceId: batchTrafficSourceRunsTable.trafficSourceId,
      trafficSourceName: workspaceTrafficSourcesTable.name,
      iosStatus: batchTrafficSourceRunsTable.iosStatus,
      androidStatus: batchTrafficSourceRunsTable.androidStatus,
      iosCampaignId: batchTrafficSourceRunsTable.iosCampaignId,
      androidCampaignId: batchTrafficSourceRunsTable.androidCampaignId,
      startedAt: batchTrafficSourceRunsTable.startedAt,
      completedAt: batchTrafficSourceRunsTable.completedAt,
      createdAt: batchTrafficSourceRunsTable.createdAt,
    })
    .from(batchTrafficSourceRunsTable)
    .innerJoin(
      workspaceTrafficSourcesTable,
      and(
        eq(workspaceTrafficSourcesTable.id, batchTrafficSourceRunsTable.trafficSourceId),
        eq(workspaceTrafficSourcesTable.workspaceId, workspaceId),
      ),
    )
    .where(
      and(
        eq(batchTrafficSourceRunsTable.workspaceId, workspaceId),
        eq(batchTrafficSourceRunsTable.batchId, batchId),
      ),
    )
    .orderBy(asc(batchTrafficSourceRunsTable.position));
}

function serializeBatch(
  batch: typeof testingBatchesTable.$inferSelect,
  enrich?: EnrichmentMaps,
) {
  const affNetId = batch.affiliateNetworkId;
  const geoId = batch.geoId;
  const empId = batch.employeeId;
  const geoLookup = geoId != null ? enrich?.geos.get(geoId) : undefined;
  return {
    ...batch,
    testBudget: batch.testBudget != null ? Number(batch.testBudget) : null,
    spendThreshold: batch.spendThreshold != null ? Number(batch.spendThreshold) : null,
    createdAt: batch.createdAt.toISOString(),
    liveAt: batch.liveAt ? batch.liveAt.toISOString() : null,
    conditionsMetAt: batch.conditionsMetAt ? batch.conditionsMetAt.toISOString() : null,
    lastSyncAt: batch.lastSyncAt ? batch.lastSyncAt.toISOString() : null,
    lastOptimizationRunAt: batch.lastOptimizationRunAt ? batch.lastOptimizationRunAt.toISOString() : null,
    employeeName: empId != null ? enrich?.employeeNames.get(empId) ?? null : null,
    affiliateNetworkName: affNetId != null ? enrich?.affiliateNetworkNames.get(affNetId) ?? null : null,
    geoCode: geoLookup?.code ?? null,
    geoName: geoLookup?.name ?? null,
    // Pivot Phase 3 (Task #26): trafficSourceName is the text column
    // captured at create time from the workspace_traffic_sources lookup.
    // We deliberately do NOT enrich from current_traffic_source_id, whose
    // FK targets the legacy voluum_traffic_sources table — the manual
    // batch flow stores the chosen source as a name only and does not
    // touch that legacy column.
    trafficSourceName: batch.trafficSource ?? null,
  };
}

async function buildEnrichment(
  batches: ReadonlyArray<typeof testingBatchesTable.$inferSelect>,
): Promise<EnrichmentMaps> {
  const empIds = Array.from(new Set(batches.map(b => b.employeeId).filter((v): v is number => v != null)));
  const affIds = Array.from(new Set(batches.map(b => b.affiliateNetworkId).filter((v): v is number => v != null)));
  const geoIds = Array.from(new Set(batches.map(b => b.geoId).filter((v): v is number => v != null)));

  const [emps, affs, geos] = await Promise.all([
    empIds.length
      ? db.select({ id: employeesTable.id, name: employeesTable.name }).from(employeesTable).where(inArray(employeesTable.id, empIds))
      : Promise.resolve([] as { id: number; name: string }[]),
    affIds.length
      ? db.select({ id: affiliateNetworksTable.id, name: affiliateNetworksTable.name }).from(affiliateNetworksTable).where(inArray(affiliateNetworksTable.id, affIds))
      : Promise.resolve([] as { id: number; name: string }[]),
    geoIds.length
      ? db.select({ id: geosTable.id, code: geosTable.code, name: geosTable.name }).from(geosTable).where(inArray(geosTable.id, geoIds))
      : Promise.resolve([] as { id: number; code: string; name: string | null }[]),
  ]);

  return {
    employeeNames: new Map(emps.map(e => [e.id, e.name])),
    affiliateNetworkNames: new Map(affs.map(a => [a.id, a.name])),
    geos: new Map(geos.map(g => [g.id, { code: g.code, name: g.name }])),
  };
}

// Phase 11 (post-spec) — testing_batches row writes go through
// executeUpdateBatchFields / executeDeleteBatch. Lifecycle transitions
// emit BatchStatusChanged or BatchCampaignsGoLiveRequested (engine-owned).

router.get("/testing-batches", async (req, res): Promise<void> => {
  const workspaceId = await requireWorkspaceFromQuery(req, res);
  if (workspaceId === null) return;

  const scoped = await requireWorkspaceWithNetworkScope(req, res, workspaceId);
  if (scoped === null) return;

  const params = ListTestingBatchesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (
    !enforceEmployeeIdAccess(res, scoped.scope, params.data.employee_id ?? undefined)
  ) {
    return;
  }

  const conditions = [eq(testingBatchesTable.workspaceId, workspaceId)];

  if (!scoped.scope.isAdmin) {
    conditions.push(eq(testingBatchesTable.employeeId, scoped.scope.employeeId));
    const allowed = scoped.scope.allowedNetworkNames ?? [];
    if (allowed.length === 0) {
      res.json([]);
      return;
    }
    conditions.push(inArray(testingBatchesTable.affiliateNetwork, allowed));
    if (
      params.data.affiliate_network &&
      !networkNameAllowed(scoped.scope, params.data.affiliate_network)
    ) {
      res.status(403).json({ error: "Affiliate network not assigned to you" });
      return;
    }
  } else if (params.data.employee_id) {
    conditions.push(eq(testingBatchesTable.employeeId, params.data.employee_id));
  }

  if (params.data.status) {
    conditions.push(eq(testingBatchesTable.status, params.data.status as (typeof testingBatchesTable.$inferSelect)["status"]));
  }
  if (params.data.geo) {
    conditions.push(eq(testingBatchesTable.geo, params.data.geo));
  }
  if (params.data.affiliate_network) {
    conditions.push(eq(testingBatchesTable.affiliateNetwork, params.data.affiliate_network));
  }
  if (params.data.traffic_source) {
    conditions.push(eq(testingBatchesTable.trafficSource, params.data.traffic_source));
  }

  const rows = await db
    .select()
    .from(testingBatchesTable)
    .where(and(...conditions))
    .orderBy(testingBatchesTable.createdAt);

  const enrich = await buildEnrichment(rows);
  res.json(rows.map(b => serializeBatch(b, enrich)));
});

// ── POST /testing-batches ───────────────────────────────────────────
// Pivot Phase 3 (Task #26): manual batch creation. Accepts the new
// spec payload (affiliate_network_id / geo_id / traffic_source_id /
// assigned_worker_id / test_round / start_date / test_duration_hours)
// AND the legacy text payload (affiliateNetwork / geo / trafficSource
// / employeeId) with a deprecation log so old admin scripts still
// work during the cutover. Workers + admins both allowed.
router.post("/testing-batches", async (req, res): Promise<void> => {
  const parsed = CreateTestingBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;

  const rawBody = (req.body ?? {}) as { workspace_id?: unknown };
  const wsRaw = body.workspaceId ?? rawBody.workspace_id;
  const wsId = await requireWorkspaceAccess(req, res, typeof wsRaw === "number" ? wsRaw : Number(wsRaw));
  if (wsId === null) return;

  // Resolve the worker: prefer `assignedWorkerId` (new spec name), fall
  // back to `employeeId` (legacy + the actual storage column).
  const rawEmployeeId = body.assignedWorkerId ?? body.employeeId;
  if (rawEmployeeId == null || !Number.isInteger(rawEmployeeId) || rawEmployeeId <= 0) {
    res.status(400).json({ error: "assignedWorkerId (or legacy employeeId) is required" });
    return;
  }
  const employeeId: number = rawEmployeeId;

  if (!body.batchTag || body.batchTag.trim().length === 0) {
    res.status(400).json({ error: "batchTag is required" });
    return;
  }
  if (body.trafficSourceId == null || !Number.isInteger(body.trafficSourceId) || body.trafficSourceId <= 0) {
    res.status(400).json({ error: "trafficSourceId is required" });
    return;
  }

  // Look up the new lookups so we can also populate the legacy NOT NULL
  // text columns (affiliate_network / geo / traffic_source) from a
  // single source of truth. If the caller used the legacy text
  // payload we keep their values verbatim and log the deprecation.
  const usedLegacyPayload =
    body.affiliateNetworkId == null &&
    body.geoId == null &&
    body.trafficSourceId == null &&
    (body.affiliateNetwork || body.geo || body.trafficSource);

  if (usedLegacyPayload) {
    req.log.warn(
      { wsId, employeeId, batchName: body.batchName },
      "[testing-batches] DEPRECATED: legacy text payload (affiliateNetwork/geo/trafficSource) — switch to *_id fields",
    );
  }

  // Validate the assignee is a member of this workspace (admin or assigned).
  const workerErr = await validateAssignedWorkerInWorkspace(employeeId, wsId);
  if (workerErr) {
    res.status(workerErr.status).json({ error: workerErr.error });
    return;
  }

  let affiliateNetworkText: string | undefined = body.affiliateNetwork;
  let geoText: string | undefined = body.geo;
  let trafficSourceText: string | undefined = body.trafficSource;

  if (body.affiliateNetworkId != null) {
    const [row] = await db.select({ name: affiliateNetworksTable.name, workspaceId: affiliateNetworksTable.workspaceId })
      .from(affiliateNetworksTable).where(eq(affiliateNetworksTable.id, body.affiliateNetworkId));
    if (!row || row.workspaceId !== wsId) {
      res.status(400).json({ error: "affiliateNetworkId not found in this workspace" });
      return;
    }
    affiliateNetworkText = row.name;
  }
  if (body.geoId != null) {
    const [row] = await db.select({ code: geosTable.code, workspaceId: geosTable.workspaceId })
      .from(geosTable).where(eq(geosTable.id, body.geoId));
    if (!row || row.workspaceId !== wsId) {
      res.status(400).json({ error: "geoId not found in this workspace" });
      return;
    }
    geoText = row.code;
  }
  if (body.trafficSourceId != null) {
    const [row] = await db.select({
      name: workspaceTrafficSourcesTable.name,
      workspaceId: workspaceTrafficSourcesTable.workspaceId,
      isActive: workspaceTrafficSourcesTable.isActive,
    })
      .from(workspaceTrafficSourcesTable).where(eq(workspaceTrafficSourcesTable.id, body.trafficSourceId));
    if (!row || row.workspaceId !== wsId) {
      res.status(400).json({ error: "trafficSourceId not found in this workspace" });
      return;
    }
    if (!row.isActive) {
      res.status(400).json({ error: "trafficSourceId is not active" });
      return;
    }
    trafficSourceText = row.name;
  }

  if (!body.batchName || !affiliateNetworkText || !geoText || !trafficSourceText) {
    res.status(400).json({
      error:
        "batchName plus a network, GEO, and traffic source are required " +
        "(supply *_id fields or the legacy text fields).",
    });
    return;
  }

  // CampaignOps redesign — workers can only create batches against
  // affiliate networks an admin has assigned to them. Admins bypass.
  // Resolved network id required for this check; the legacy text
  // payload is admin-only territory and skips the assignment guard.
  if (body.affiliateNetworkId != null) {
    const [emp] = await db
      .select({ role: employeesTable.role })
      .from(employeesTable)
      .where(eq(employeesTable.id, employeeId));
    if (emp && emp.role !== "admin") {
      const [assigned] = await db
        .select({ id: workerAffiliateNetworksTable.id })
        .from(workerAffiliateNetworksTable)
        .where(
          and(
            eq(workerAffiliateNetworksTable.workspaceId, wsId),
            eq(workerAffiliateNetworksTable.employeeId, employeeId),
            eq(workerAffiliateNetworksTable.affiliateNetworkId, body.affiliateNetworkId),
          ),
        )
        .limit(1);
      if (!assigned) {
        res.status(403).json({
          error: "Worker is not assigned to this affiliate network. Ask an admin to assign it in Settings → Worker Networks.",
        });
        return;
      }
    }
  }

  const insertValues: typeof testingBatchesTable.$inferInsert = {
    workspaceId: wsId,
    employeeId,
    batchName: body.batchName,
    affiliateNetwork: affiliateNetworkText,
    geo: geoText,
    trafficSource: trafficSourceText,
    affiliateNetworkId: body.affiliateNetworkId ?? null,
    geoId: body.geoId ?? null,
    // NOTE: currentTrafficSourceId intentionally NOT set here. Its FK
    // targets the legacy voluum_traffic_sources table; the manual flow
    // resolves trafficSourceId against workspace_traffic_sources and
    // persists only the resolved name (`trafficSource` text col).
    numberOfOffers: body.numberOfOffers ?? null,
    testRound: body.testRound ?? null,
    startDate: body.startDate ?? null,
    testDurationHours: body.testDurationHours ?? 48,
    status: (body.status as BatchStatus | undefined) ?? "NEW_BATCH",
    notes: body.notes ?? null,
    clicksThreshold: body.clicksThreshold ?? null,
    testBudget: body.testBudget != null ? String(body.testBudget) : null,
    daysThreshold: body.daysThreshold ?? null,
    testStartDate: body.testStartDate ?? null,
    testEndDate: body.testEndDate ?? null,
    batchTag: body.batchTag,
    vertical: body.vertical ?? null,
  };

  const trafficSourceRuns = await db
    .select({
      id: workspaceTrafficSourcesTable.id,
      position: workspaceTrafficSourcesTable.position,
    })
    .from(workspaceTrafficSourcesTable)
    .where(
      and(
        eq(workspaceTrafficSourcesTable.workspaceId, wsId),
        eq(workspaceTrafficSourcesTable.isActive, true),
      ),
    )
    .orderBy(asc(workspaceTrafficSourcesTable.position));

  // Re-spread workspaceId explicitly so the workspace-isolation lint
  // (scripts/src/check-workspace-isolation.ts) finds the literal
  // `workspaceId:` token inside the .values(...) block.
  const batch = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(testingBatchesTable)
      .values({
        ...insertValues,
        workspaceId: wsId,
        currentWorkspaceTrafficSourceId: body.trafficSourceId,
      })
      .returning();

    if (trafficSourceRuns.length > 0) {
      const now = new Date();
      await tx.insert(batchTrafficSourceRunsTable).values(
        trafficSourceRuns.map((source) => {
          const isSelectedSource = source.id === body.trafficSourceId;
          return {
            workspaceId: wsId,
            batchId: inserted.id,
            trafficSourceId: source.id,
            position: source.position,
            status: isSelectedSource ? ("active" as const) : ("pending" as const),
            iosStatus: isSelectedSource ? ("active" as const) : ("pending" as const),
            androidStatus: isSelectedSource ? ("active" as const) : ("pending" as const),
            startedAt: isSelectedSource ? now : null,
            targetAvgVisitsPerOffer: inserted.averageVisitsThresholdPerOffer,
            offerCount: inserted.numberOfOffers,
          };
        }),
      );
    }

    await recordBatchCreatedOperationalEvent(
      {
        workspaceId: wsId,
        batchId: inserted.id,
        employeeId: inserted.employeeId,
        initialTrafficSourceId: body.trafficSourceId,
        trafficSourceStep: inserted.trafficSourceStep,
        offerCount: body.numberOfOffers ?? null,
        source: "routes.testing-batches",
      },
      tx,
    );

    return inserted;
  });

  // Pivot Phase 3: BatchCreated still emits for audit; the rule
  // (batch-created.ts) is a no-op in this phase. Phase 4 will rebuild
  // auto-task generation off the new manual lookups.
  try {
    await emit({
      type: "BatchCreated",
      workspaceId: wsId,
      payload: {
        batchId: batch.id,
        tag: batch.batchTag ?? `manual_${batch.id}`,
        affiliateNetworkName: batch.affiliateNetwork ?? "",
        geo: batch.geo ?? "",
      },
      dedupeKey: `batch_created:${batch.id}`,
    });
  } catch (err) {
    req.log.warn({ err, batchId: batch.id }, "[testing-batches] BatchCreated emit failed for manual batch");
  }

  const enrich = await buildEnrichment([batch]);
  res.status(201).json(serializeBatch(batch, enrich));
});

router.get("/testing-batches/:id", async (req, res): Promise<void> => {
  const params = GetTestingBatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [batch] = await db
    .select()
    .from(testingBatchesTable)
    .where(eq(testingBatchesTable.id, params.data.id));

  if (!batch) {
    res.status(404).json({ error: "Testing batch not found" });
    return;
  }

  if ((await requireWorkspaceAccess(req, res, batch.workspaceId)) === null) return;

  const includes = parseGetBatchInclude(req.query as Record<string, unknown>);
  if (includes.error) {
    res.status(400).json({ error: includes.error });
    return;
  }

  const enrich = await buildEnrichment([batch]);
  const payload = serializeBatch(batch, enrich);
  if (!includes.trafficSourceRuns) {
    res.json(payload);
    return;
  }

  const runs = await loadTrafficSourceRunsForBatch(batch.workspaceId, batch.id);
  res.json({
    ...payload,
    trafficSourceRuns: runs.map(serializeTrafficSourceRun),
  });
});

router.patch("/testing-batches/:id", async (req, res): Promise<void> => {
  const params = UpdateTestingBatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTestingBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existingBatch] = await db.select().from(testingBatchesTable).where(eq(testingBatchesTable.id, params.data.id));
  if (!existingBatch) {
    res.status(404).json({ error: "Testing batch not found" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, existingBatch.workspaceId)) === null) return;

  if (parsed.data.status !== undefined) {
    res.status(400).json({
      error: "Batch status cannot be changed via PATCH",
      detail:
        "Use POST /testing-batches/:id/go-live for OFFER_READY_FOR_LIVE_TESTING → LIVE_TESTS. " +
        "Other batch status transitions are engine-driven.",
    });
    return;
  }

  // Pivot Phase 3 (Task #26): translate the new payload field names
  // to their storage columns before passing to the executor:
  //   - assignedWorkerId  -> employeeId
  //   - trafficSourceId   -> trafficSource (text)  *only*; we do NOT
  //     write currentTrafficSourceId because that legacy FK targets
  //     voluum_traffic_sources, while the manual flow validates
  //     against workspace_traffic_sources.
  // Strip workspaceId — records cannot move workspaces. Lifecycle status
  // changes must use POST /testing-batches/:id/go-live or engine events.
  const data = parsed.data;
  const {
    workspaceId: _ignoredWs,
    status: _ignoredStatus,
    assignedWorkerId,
    trafficSourceId,
    testBudget: bodyTestBudget,
    spendThreshold: bodySpendThreshold,
    daysThreshold: bodyDaysThreshold,
    testDurationHours: bodyTestDurationHours,
    liveAt: bodyLiveAt,
    ...rest
  } = data;

  const updates: Partial<typeof testingBatchesTable.$inferInsert> = { ...rest };
  // liveAt is `string|null` over the wire (ISO timestamp), but a Date
  // column in the DB. Coerce here; null is allowed (clears the field).
  if (bodyLiveAt !== undefined) {
    updates.liveAt = bodyLiveAt == null ? null : new Date(bodyLiveAt);
  }
  // testDurationHours column is NOT NULL with a default; explicit null
  // is treated as "no change" rather than a clear (the column has no
  // nullable semantics to map "cleared" onto).
  if (bodyTestDurationHours !== undefined && bodyTestDurationHours !== null) {
    updates.testDurationHours = bodyTestDurationHours;
  }
  // testBudget / spendThreshold are `number` in the API contract but
  // `numeric` (string) in the DB; coerce here so the executor sees the
  // correct shape.
  if (bodyTestBudget !== undefined) {
    updates.testBudget = bodyTestBudget == null ? null : String(bodyTestBudget);
  }
  if (bodySpendThreshold !== undefined) {
    updates.spendThreshold = bodySpendThreshold == null ? null : String(bodySpendThreshold);
  }
  // daysThreshold is nullable in the DB; pass through nulls so callers
  // can clear the field, while still distinguishing "not provided"
  // (undefined) from "explicit clear" (null).
  if (bodyDaysThreshold !== undefined) {
    updates.daysThreshold = bodyDaysThreshold;
  }
  if (assignedWorkerId !== undefined && assignedWorkerId !== null) {
    updates.employeeId = assignedWorkerId;
  }
  // Pivot Phase 3 (Task #26): trafficSourceId resolves against
  // workspace_traffic_sources; we only update the text column
  // (`trafficSource`) — not currentTrafficSourceId, whose FK targets
  // the legacy voluum_traffic_sources table.
  let resolvedTrafficSourceId: number | undefined;
  if (trafficSourceId !== undefined && trafficSourceId !== null) {
    resolvedTrafficSourceId = trafficSourceId;
  }

  // Validate the assignee (if changed) is a member of this workspace.
  if (updates.employeeId !== undefined && updates.employeeId !== existingBatch.employeeId) {
    const workerErr = await validateAssignedWorkerInWorkspace(updates.employeeId, existingBatch.workspaceId);
    if (workerErr) {
      res.status(workerErr.status).json({ error: workerErr.error });
      return;
    }
  }

  const nonStatusUpdates = updates;

  // If new lookup IDs are provided, resync the legacy text columns
  // from the lookup rows so list/detail UIs stay consistent.
  if (nonStatusUpdates.affiliateNetworkId != null) {
    const [row] = await db.select({ name: affiliateNetworksTable.name, workspaceId: affiliateNetworksTable.workspaceId })
      .from(affiliateNetworksTable).where(eq(affiliateNetworksTable.id, nonStatusUpdates.affiliateNetworkId));
    if (!row || row.workspaceId !== existingBatch.workspaceId) {
      res.status(400).json({ error: "affiliateNetworkId not found in this workspace" }); return;
    }
    nonStatusUpdates.affiliateNetwork = row.name;
  }
  if (nonStatusUpdates.geoId != null) {
    const [row] = await db.select({ code: geosTable.code, workspaceId: geosTable.workspaceId })
      .from(geosTable).where(eq(geosTable.id, nonStatusUpdates.geoId));
    if (!row || row.workspaceId !== existingBatch.workspaceId) {
      res.status(400).json({ error: "geoId not found in this workspace" }); return;
    }
    nonStatusUpdates.geo = row.code;
  }
  if (resolvedTrafficSourceId !== undefined) {
    const [row] = await db.select({ name: workspaceTrafficSourcesTable.name, workspaceId: workspaceTrafficSourcesTable.workspaceId })
      .from(workspaceTrafficSourcesTable).where(eq(workspaceTrafficSourcesTable.id, resolvedTrafficSourceId));
    if (!row || row.workspaceId !== existingBatch.workspaceId) {
      res.status(400).json({ error: "trafficSourceId not found in this workspace" }); return;
    }
    nonStatusUpdates.trafficSource = row.name;
  }

  let batch: typeof testingBatchesTable.$inferSelect | null = existingBatch;
  if (Object.keys(nonStatusUpdates).length > 0) {
    batch = await executeUpdateBatchFields(
      existingBatch.workspaceId,
      params.data.id,
      nonStatusUpdates,
    );
    if (!batch) {
      res.status(404).json({ error: "Testing batch not found" });
      return;
    }
  }

  const enrich = await buildEnrichment([batch]);
  res.json(serializeBatch(batch, enrich));
});

router.delete("/testing-batches/:id", async (req, res): Promise<void> => {
  const params = DeleteTestingBatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select({ workspaceId: testingBatchesTable.workspaceId })
    .from(testingBatchesTable)
    .where(eq(testingBatchesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Testing batch not found" }); return; }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  const batch = await executeDeleteBatch(existing.workspaceId, params.data.id);
  if (!batch) {
    res.status(404).json({ error: "Testing batch not found" });
    return;
  }

  res.json({ success: true });
});

// ── Lifecycle actions ─────────────────────────────────────────────────
// The 6-state lifecycle has exactly one worker-driven transition:
// OFFER_READY_FOR_LIVE_TESTING → LIVE_TESTS. Every other transition is
// engine-driven from concrete signals. mark-ready /
// start-optimization / complete-optimization belonged to the retired
// 12-state machine and stay 410 Gone.

router.post("/testing-batches/:id/go-live", async (req, res): Promise<void> => {
  const params = GetTestingBatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select({
      id: testingBatchesTable.id,
      workspaceId: testingBatchesTable.workspaceId,
      status: testingBatchesTable.status,
    })
    .from(testingBatchesTable)
    .where(eq(testingBatchesTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Testing batch not found" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;

  if (existing.status !== "OFFER_READY_FOR_LIVE_TESTING") {
    res.status(409).json({
      error: "Invalid transition",
      detail: `Batch is in status "${existing.status}"; "go-live" is only valid from "OFFER_READY_FOR_LIVE_TESTING".`,
    });
    return;
  }

  await emit({
    type: "BatchStatusChanged",
    workspaceId: existing.workspaceId,
    payload: {
      batchId: existing.id,
      from: "OFFER_READY_FOR_LIVE_TESTING",
      to: "LIVE_TESTS",
    },
    dedupeKey: `manual_go_live:${existing.id}`,
  });

  const [batch] = await db
    .select()
    .from(testingBatchesTable)
    .where(and(eq(testingBatchesTable.id, existing.id), eq(testingBatchesTable.workspaceId, existing.workspaceId)));
  const enrich = await buildEnrichment([batch]);
  res.json(serializeBatch(batch, enrich));
});

// Pivot Phase 5 (Task #28): atomic Phase-5 go-live. Stamps liveAt
// AND flips both batch campaigns ready->live in a single transaction
// so the worker never sees an inconsistency window. Idempotent: a
// campaign already `live` is left as-is (no error); a campaign in
// any other state is also left as-is so the caller can retry after
// fixing it. Workspace-scoped via the existing batch row.
router.post("/testing-batches/:id/campaigns-go-live", async (req, res): Promise<void> => {
  const params = GetTestingBatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select({
      id: testingBatchesTable.id,
      workspaceId: testingBatchesTable.workspaceId,
      liveAt: testingBatchesTable.liveAt,
      numberOfOffers: testingBatchesTable.numberOfOffers,
    })
    .from(testingBatchesTable)
    .where(eq(testingBatchesTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Testing batch not found" });
    return;
  }
  if ((await requireWorkspaceAccess(req, res, existing.workspaceId)) === null) return;
  if (existing.numberOfOffers == null || existing.numberOfOffers <= 0) {
    res.status(400).json({
      error: "numberOfOffers is required before campaigns can go live",
      detail:
        "Set a positive numberOfOffers on the batch before moving campaigns to live.",
    });
    return;
  }

  try {
    await emit({
      type: "BatchCampaignsGoLiveRequested",
      workspaceId: existing.workspaceId,
      payload: { batchId: existing.id },
      dedupeKey: `batch_campaigns_go_live:${existing.id}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message === "Batch has no campaigns yet" ||
      message === "All batch campaigns must be ready before going live"
    ) {
      res.status(409).json({ error: message });
      return;
    }
    throw err;
  }

  const [batch] = await db
    .select()
    .from(testingBatchesTable)
    .where(and(eq(testingBatchesTable.id, existing.id), eq(testingBatchesTable.workspaceId, existing.workspaceId)));
  const enrich = await buildEnrichment([batch]);
  res.json(serializeBatch(batch, enrich));
});

function legacyLifecycle410(_req: import("express").Request, res: import("express").Response): void {
  res.status(410).json({
    error: "Endpoint removed",
    detail:
      "This lifecycle action belonged to the retired 12-state batch " +
      "machine and has no counterpart in the 6-state spec. The remaining " +
      "transitions are engine-driven (tracker import, click threshold, " +
      "all-offers classified). The only manual transition is " +
      "POST /testing-batches/:id/go-live (OFFER_READY_FOR_LIVE_TESTING " +
      "→ LIVE_TESTS).",
  });
}

router.post("/testing-batches/:id/mark-ready", legacyLifecycle410);
router.post("/testing-batches/:id/start-optimization", legacyLifecycle410);
router.post("/testing-batches/:id/complete-optimization", legacyLifecycle410);

// ── Admin: hard-delete a testing batch + its dependent data ────────────
//
// SAFETY MODEL:
//  * Admin-only (role enforced server-side via requireAdmin) AND the admin
//    must have access to the batch's workspace.
//  * Scope is always a single (workspaceId, batchId). Nothing else is
//    touched: employees, workspaces, affiliate networks, geos, traffic
//    sources, and global settings are never deleted.
//  * Destructive + irreversible, so it is gated by a separate preview
//    endpoint, an explicit confirmationText, a transaction, and an audit
//    event.
//
// CASCADE MAP (verified against lib/db/src/schema):
//   Deleted with the batch (ON DELETE CASCADE):
//     offers, performance, batch_results, tracker_campaigns,
//     voluum_campaign_mappings, batch_traffic_source_runs, campaigns
//       → campaign_daily_metrics (via campaign), campaign_winners (via campaign)
//   Preserved but unlinked (ON DELETE SET NULL):
//     todo_tasks.related_batch_id, notifications.batch_id,
//     imported_offers.batch_id
//   No FK (cleaned explicitly here): voluum_offers.batch_id
//   Audit (preserved): operational_events / operational_activity_feed

const DELETE_BATCH_CONFIRMATION_TEXT = "DELETE BATCH";

const adminBatchDeleteSchema = z.object({
  workspaceId: z.number().int().positive(),
  batchId: z.number().int().positive(),
});

const adminBatchDeleteConfirmSchema = adminBatchDeleteSchema.extend({
  confirmationText: z.string(),
});

type SelectClient = Pick<NodePgDatabase, "select">;

async function countWhere(
  client: SelectClient,
  table: PgTable,
  whereClause: SQL | null | undefined,
): Promise<number> {
  // A null/undefined clause means "nothing to match" here (e.g. no campaigns
  // in the batch), so report 0 rather than counting the whole table.
  if (!whereClause) return 0;
  const rows = await client.select({ value: count() }).from(table).where(whereClause);
  return Number(rows[0]?.value ?? 0);
}

type BatchDeletionScope = {
  batch: typeof testingBatchesTable.$inferSelect;
  campaignIds: number[];
  counts: {
    campaigns: number;
    offers: number;
    campaignDailyMetrics: number;
    campaignWinners: number;
    performance: number;
    batchResults: number;
    trackerCampaigns: number;
    voluumCampaignMappings: number;
    trafficSourceRuns: number;
    voluumOffers: number;
    // Preserved-but-unlinked:
    todoTasksUnlinked: number;
    notificationsUnlinked: number;
    importedOffersUnlinked: number;
  };
};

/**
 * Gather the batch row, its campaign ids, and counts of every dependent
 * record. Used by both the preview and the delete (inside its transaction)
 * so the reported numbers exactly match what the delete will affect.
 * Returns null when the batch is not in the workspace.
 */
async function loadBatchDeletionScope(
  client: SelectClient,
  workspaceId: number,
  batchId: number,
): Promise<BatchDeletionScope | null> {
  const [batch] = await client
    .select()
    .from(testingBatchesTable)
    .where(and(eq(testingBatchesTable.id, batchId), eq(testingBatchesTable.workspaceId, workspaceId)));
  if (!batch) return null;

  const campaignRows = await client
    .select({ id: campaignsTable.id })
    .from(campaignsTable)
    .where(and(eq(campaignsTable.batchId, batchId), eq(campaignsTable.workspaceId, workspaceId)));
  const campaignIds = campaignRows.map((c) => c.id);

  const metricsWhere = campaignIds.length
    ? and(
        eq(campaignDailyMetricsTable.workspaceId, workspaceId),
        inArray(campaignDailyMetricsTable.campaignId, campaignIds),
      )
    : null;
  const winnersWhere = campaignIds.length
    ? inArray(campaignWinnersTable.campaignId, campaignIds)
    : null;

  const [
    offers,
    campaignDailyMetrics,
    campaignWinners,
    performance,
    batchResults,
    trackerCampaigns,
    voluumCampaignMappings,
    trafficSourceRuns,
    voluumOffers,
    todoTasksUnlinked,
    notificationsUnlinked,
    importedOffersUnlinked,
  ] = await Promise.all([
    countWhere(client, offersTable, eq(offersTable.batchId, batchId)),
    metricsWhere ? countWhere(client, campaignDailyMetricsTable, metricsWhere) : Promise.resolve(0),
    winnersWhere ? countWhere(client, campaignWinnersTable, winnersWhere) : Promise.resolve(0),
    countWhere(client, performanceTable, eq(performanceTable.batchId, batchId)),
    countWhere(client, batchResultsTable, eq(batchResultsTable.batchId, batchId)),
    countWhere(client, trackerCampaignsTable, eq(trackerCampaignsTable.batchId, batchId)),
    countWhere(client, voluumCampaignMappingsTable, eq(voluumCampaignMappingsTable.batchId, batchId)),
    countWhere(client, batchTrafficSourceRunsTable, eq(batchTrafficSourceRunsTable.batchId, batchId)),
    countWhere(
      client,
      voluumOffersTable,
      and(eq(voluumOffersTable.workspaceId, workspaceId), eq(voluumOffersTable.batchId, batchId)),
    ),
    countWhere(client, todoTasksTable, eq(todoTasksTable.relatedBatchId, batchId)),
    countWhere(client, notificationsTable, eq(notificationsTable.batchId, batchId)),
    countWhere(client, importedOffersTable, eq(importedOffersTable.batchId, batchId)),
  ]);

  return {
    batch,
    campaignIds,
    counts: {
      campaigns: campaignIds.length,
      offers,
      campaignDailyMetrics,
      campaignWinners,
      performance,
      batchResults,
      trackerCampaigns,
      voluumCampaignMappings,
      trafficSourceRuns,
      voluumOffers,
      todoTasksUnlinked,
      notificationsUnlinked,
      importedOffersUnlinked,
    },
  };
}

function serializeDeletionScope(scope: BatchDeletionScope) {
  const { batch, counts } = scope;
  return {
    batch: {
      id: batch.id,
      batchName: batch.batchName,
      batchTag: batch.batchTag,
      status: batch.status,
      workspaceId: batch.workspaceId,
    },
    counts,
    deletes: {
      campaigns: counts.campaigns,
      offers: counts.offers,
      campaignDailyMetrics: counts.campaignDailyMetrics,
      campaignWinners: counts.campaignWinners,
      performance: counts.performance,
      batchResults: counts.batchResults,
      trackerCampaigns: counts.trackerCampaigns,
      voluumCampaignMappings: counts.voluumCampaignMappings,
      trafficSourceRuns: counts.trafficSourceRuns,
      voluumOffers: counts.voluumOffers,
    },
    unlinks: {
      todoTasks: counts.todoTasksUnlinked,
      notifications: counts.notificationsUnlinked,
      importedOffers: counts.importedOffersUnlinked,
    },
    warning:
      "This permanently deletes the batch and all dependent campaigns, offers, " +
      "performance, results, tracker campaigns, traffic-source runs, and daily " +
      "metrics. Related to-do tasks, notifications, and imported offers are kept " +
      "but unlinked. This cannot be undone.",
    confirmationRequired: DELETE_BATCH_CONFIRMATION_TEXT,
  };
}

router.post("/testing-batches/admin/delete-preview", async (req, res): Promise<void> => {
  const parsed = adminBatchDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { workspaceId, batchId } = parsed.data;

  if ((await requireAdmin(req, res)) === null) return;
  if ((await requireWorkspaceAccess(req, res, workspaceId)) === null) return;

  const scope = await loadBatchDeletionScope(db, workspaceId, batchId);
  if (!scope) {
    res.status(404).json({ error: "Testing batch not found in this workspace" });
    return;
  }

  res.json(serializeDeletionScope(scope));
});

router.post("/testing-batches/admin/delete", async (req, res): Promise<void> => {
  const parsed = adminBatchDeleteConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { workspaceId, batchId, confirmationText } = parsed.data;

  if (confirmationText !== DELETE_BATCH_CONFIRMATION_TEXT) {
    res.status(400).json({
      error: `confirmationText must be exactly "${DELETE_BATCH_CONFIRMATION_TEXT}" to confirm deletion`,
    });
    return;
  }

  const admin = await requireAdmin(req, res);
  if (admin === null) return;
  if ((await requireWorkspaceAccess(req, res, workspaceId)) === null) return;

  let serialized: ReturnType<typeof serializeDeletionScope> | null = null;
  const ok = await db.transaction(async (tx) => {
    const scope = await loadBatchDeletionScope(tx, workspaceId, batchId);
    if (!scope) return false;
    serialized = serializeDeletionScope(scope);

    // voluum_offers has no FK to testing_batches, so cascade won't remove
    // these batch-scoped rows — delete them explicitly within the same tx.
    await tx
      .delete(voluumOffersTable)
      .where(and(eq(voluumOffersTable.workspaceId, workspaceId), eq(voluumOffersTable.batchId, batchId)));

    // Deleting the batch cascades to campaigns/offers/performance/results/
    // tracker_campaigns/traffic-source runs/voluum mappings, and through
    // campaigns to campaign_daily_metrics + campaign_winners.
    await tx
      .delete(testingBatchesTable)
      .where(and(eq(testingBatchesTable.id, batchId), eq(testingBatchesTable.workspaceId, workspaceId)));
    return true;
  });

  if (!ok || serialized === null) {
    res.status(404).json({ error: "Testing batch not found in this workspace" });
    return;
  }

  const summary: ReturnType<typeof serializeDeletionScope> = serialized;
  await recordOperationalEvent({
    workspaceId,
    entityType: "batch",
    entityId: batchId,
    eventType: "TESTING_BATCH_DELETED",
    actorType: "employee",
    actorId: admin.id,
    source: "routes.testing-batches",
    payloadJson: {
      batchName: summary.batch.batchName,
      batchTag: summary.batch.batchTag,
      status: summary.batch.status,
      deletes: summary.deletes,
      unlinks: summary.unlinks,
    },
  });

  res.json({ deleted: true, ...summary });
});

export default router;
