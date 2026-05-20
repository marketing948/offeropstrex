// Phase 3: closed event/action unions for the OfferOps automation engine.
//
// Adding a new event or action is a deliberate cross-cutting change:
// you must update this union, register a handler in `handlers.ts`, and
// teach the executor in `executor.ts` how to apply the new action. The
// compiler enforces this — the engine bus and executor switch on the
// `type` discriminator and TypeScript will reject any unhandled case
// because the `assertNever` helper at the end of each switch demands
// exhaustiveness.

import type { db, batchStatusEnum } from "@workspace/db";

/** A Drizzle transaction handle as produced by `db.transaction(...)`. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Spec-canonical batch status values (Automation Bible §6). */
export type BatchStatus = (typeof batchStatusEnum.enumValues)[number];

export type TaskCompletionDetails =
  | {
      /** Human MANUAL tasks: close without TaskCompleted / CampaignOps. */
      kind: "manual";
    }
  | {
      kind: "generic";
      completionPayload?: Record<string, unknown>;
    }
  | {
      kind: "create_voluum_campaign";
      platform: "ios" | "android";
      trafficSourceId: number;
      voluumCampaignId: string;
      voluumCampaignName: string;
      campaignName: string;
      campaignUrl: string;
    }
  | {
      kind: "take_campaign_live";
      trafficSourceCampaignId: string;
    }
  | {
      kind: "find_winners";
      outcome?: "success";
      winnersCount: number;
      revenue: number;
      cost: number;
      clicks?: number | null;
      conversions?: number | null;
      notes?: string | null;
    }
  | {
      kind: "find_winners";
      outcome: "failed";
      failureReason: string;
      notes?: string | null;
    }
  | {
      kind: "all_traffic_sources_tested";
    };

// ── Events ────────────────────────────────────────────────────────────
// The 7 canonical events from the Automation Bible. Producers (sync
// routes, route handlers, scheduled jobs) emit one of these via
// `emit()`; the engine writes the row + invokes registered handlers.
//
// Every event carries `workspaceId` so handlers can scope their reads
// to the originating workspace. There is no global event — cross-
// workspace effects are forbidden by design.

// Pivot Phase 7 — legacy/Voluum-only events:
//   OfferImported, TrackerCampaignImported, VoluumCampaignTagInvalid,
//   TrafficSourceAdvanced
// Their producers run only when `ENABLE_VOLUUM=true` and `engine/emit()`
// short-circuits these types when the flag is off (see
// `VOLUUM_ONLY_EVENT_TYPES` in `lib/feature-flags.ts`). Handlers stay
// registered so flipping the flag re-enables the legacy automation
// layer with no code change. See `docs/SPEC.md` → "Future automation
// layer" appendix.
// NOTE: `BatchStatsUpdated` is intentionally NOT on the short-circuit
// list — the manual flow may also emit it; its rule no-ops cleanly
// when no Voluum-derived stats exist.
export type EventInput =
  | {
      // LEGACY (Voluum-only). See note above.
      type: "OfferImported";
      workspaceId: number;
      payload: {
        voluumOfferId: string;
        offerId: number;
        tag: string;
        affiliateNetworkName: string;
        geo: string;
      };
    }
  | {
      type: "BatchCreated";
      workspaceId: number;
      payload: {
        batchId: number;
        tag: string;
        affiliateNetworkName: string;
        geo: string;
      };
    }
  | {
      type: "TrackerCampaignImported";
      workspaceId: number;
      payload: {
        // Phase 5c: descriptors only — the row in tracker_campaigns is
        // created by the rule via a RecordTrackerCampaign action so the
        // producer (Voluum sync) does not need to pre-insert. Idempotency
        // is provided by (workspaceId, type, dedupeKey) on the events
        // table; the producer sets dedupeKey=`voluum_campaign:<id>`.
        batchId: number;
        trafficSourceId: number;
        device: "ios" | "android";
        voluumCampaignId: string;
        tag: string;
      };
    }
  | {
      type: "BatchStatusChanged";
      workspaceId: number;
      payload: {
        batchId: number;
        from: BatchStatus;
        to: BatchStatus;
      };
    }
  | {
      type: "BatchTested";
      workspaceId: number;
      payload: {
        batchId: number;
      };
    }
  | {
      // Phase 5d: stats refresh signal. Producers (sync report
      // ingestion) emit one BatchStatsUpdated per batch whose
      // performance rows changed. The rule reads aggregated clicks
      // and chain-emits BatchTested via emitWithinTx if the
      // configured clicksThreshold is crossed. NOT deduped at this
      // level — BatchTested carries its own `clicks_threshold:<id>`
      // dedupe key, so re-firing the stats signal on the next sync
      // tick is a cheap no-op once the threshold has been crossed.
      type: "BatchStatsUpdated";
      workspaceId: number;
      payload: {
        batchId: number;
      };
    }
  | {
      type: "BatchCampaignsGoLiveRequested";
      workspaceId: number;
      payload: {
        batchId: number;
      };
    }
  | {
      // Route-level completion is only a request. The engine owns the
      // task/campaign mutations and chain-emits TaskCompleted atomically.
      type: "TaskCompletionRequested";
      workspaceId: number;
      payload: {
        taskId: number;
        completedByEmployeeId: number;
        completion: TaskCompletionDetails;
      };
    }
  | {
      type: "TaskCompleted";
      workspaceId: number;
      payload: {
        taskId: number;
        taskType:
          | "CREATE_IOS_TRACKER_CAMPAIGN"
          | "CREATE_ANDROID_TRACKER_CAMPAIGN"
          | "GO_LIVE_TRAFFIC_SOURCE_CAMPAIGN"
          | "MOVE_WINNERS_TO_SCALED_CAMPAIGN"
          | "FIND_WINNERS"
          | "PAUSE_TRAFFIC_SOURCE_CAMPAIGNS"
          | "CREATE_IOS_CAMPAIGN"
          | "CREATE_ANDROID_CAMPAIGN"
          | "GO_LIVE"
          | "OPTIMIZATION_FOLLOWUP"
          // CampaignOps redesign — new manual flow task types.
          | "create_voluum_campaign_ios"
          | "create_voluum_campaign_android"
          | "take_campaign_live"
          | "find_winners"
          | "all_traffic_sources_tested"
          | "MANUAL";
        relatedBatchId: number | null;
        // CampaignOps redesign — set when the completed task references
        // a Campaign (take_campaign_live, find_winners, and the
        // create_voluum_campaign_* tasks once their Campaign row has
        // been inserted by the route handler).
        relatedCampaignId?: number | null;
      };
    }
  | {
      type: "TrafficSourceAdvanced";
      workspaceId: number;
      payload: {
        batchId: number;
        previousTrafficSourceId: number | null;
        nextTrafficSourceId: number;
        nextTrafficSourceName: string;
      };
    }
  | {
      // Phase 7: emitted by the overdue-tasks cron when a TODO/IN_PROGRESS
      // task crosses its SLA. Payload carries everything the rule needs
      // to compose the notification without re-reading the task. The
      // producer dedupes on `task_overdue:<taskId>` so a task escalates
      // exactly once over its lifetime.
      type: "TaskOverdue";
      workspaceId: number;
      payload: {
        taskId: number;
        employeeId: number;
        taskType:
          | "CREATE_IOS_TRACKER_CAMPAIGN"
          | "CREATE_ANDROID_TRACKER_CAMPAIGN"
          | "GO_LIVE_TRAFFIC_SOURCE_CAMPAIGN"
          | "MOVE_WINNERS_TO_SCALED_CAMPAIGN"
          | "FIND_WINNERS"
          | "PAUSE_TRAFFIC_SOURCE_CAMPAIGNS"
          | "CREATE_IOS_CAMPAIGN"
          | "CREATE_ANDROID_CAMPAIGN"
          | "GO_LIVE"
          | "OPTIMIZATION_FOLLOWUP"
          // CampaignOps redesign — new manual flow task types.
          | "create_voluum_campaign_ios"
          | "create_voluum_campaign_android"
          | "take_campaign_live"
          | "find_winners"
          | "all_traffic_sources_tested"
          | "MANUAL";
        relatedBatchId: number | null;
        title: string;
        ageHours: number;
      };
    }
  | {
      // Pivot Phase 4 (Task #27): a manual `campaigns` row transitioned
      // to a new status. Producers (POST/PATCH /api/campaigns) emit one
      // per transition. The rule reads the batch's other campaign and
      // emits GO_LIVE / OPTIMIZATION_FOLLOWUP follow-ups when both
      // campaigns reach `ready` / `live`. `from` is null on initial
      // create so the rule still fires on a campaign that is created
      // already in `ready`.
      // Dedupe key: `campaign_status:<campaignId>:<to>`.
      type: "CampaignStatusChanged";
      workspaceId: number;
      payload: {
        campaignId: number;
        batchId: number;
        platform: "ios" | "android";
        from: "draft" | "ready" | "voluum_created" | "live" | "tested" | "closed" | null;
        to: "draft" | "ready" | "voluum_created" | "live" | "tested" | "closed";
      };
    }
  | {
      // Pivot Phase 4 (Task #27): a `batch_results` row was created or
      // updated for a batch. The rule fires the
      // MOVE_WINNERS_TO_SCALED_CAMPAIGN task when winnersCount > 0 OR
      // roi > 0. Dedupe key: `batch_results:<batchId>` so re-recording
      // results on the same batch only ever produces one task.
      type: "BatchResultsRecorded";
      workspaceId: number;
      payload: {
        batchId: number;
        winnersCount: number;
        // Numeric column in the DB; serialize as string here so the
        // rule can decide whether to treat null/empty as zero.
        roi: string | null;
      };
    }
  | {
      // Pivot Phase 4 (Task #27): the optimization-followup cron
      // detected a batch whose live_at + test_duration_hours has
      // passed and which still has no OPTIMIZATION_FOLLOWUP task.
      // Belt-and-braces against the rule that creates the task on
      // both-campaigns-live being missed (e.g. an earlier crash
      // between live status flip and event emit).
      // Dedupe key: `optimization:<batchId>`.
      type: "OptimizationDue";
      workspaceId: number;
      payload: {
        batchId: number;
      };
    }
  | {
      // Phase 6b / SPEC §1+§4: producer (Voluum sync) detected a Voluum
      // campaign whose tags do not satisfy the tracker-campaign tag
      // contract (`<initials>_<geo>_batch<n>_<platform>`). The rule fans
      // out one INVALID_TAG notification to every workspace admin so
      // the bad tag can be fixed in Voluum. Idempotency: producer sets
      // `dedupeKey` = `invalid_tag:<voluumCampaignId>:<reason>` so
      // re-sync of the same broken campaign is a no-op until the
      // diagnosis changes (e.g. operator switches from
      // `invalid_geo` to `invalid_batch_number`).
      type: "VoluumCampaignTagInvalid";
      workspaceId: number;
      payload: {
        voluumCampaignId: string;
        voluumCampaignName: string;
        offendingTag: string | null;
        reason:
          | "missing_tag"
          | "invalid_tag_format"
          | "unknown_affiliate_initials"
          | "invalid_geo"
          | "invalid_batch_number";
      };
    }
  | {
      // CampaignOps redesign — 7-day scheduler emits this once per Campaign
      // whose liveStartedAt is ≥ 7 days ago (TODO: business days). Handler
      // creates the find_winners task. Dedupe key: `find_winners:<campaignId>`.
      type: "FindWinnersDue";
      workspaceId: number;
      payload: {
        batchId: number;
        campaignId: number;
        employeeId: number;
        campaignName: string;
        /** Pre-resolved operator-facing title (avoids legacy polluted campaignName). */
        taskTitle?: string;
      };
    };

export type EventType = EventInput["type"];

/**
 * Optional callable on the producer side: an event may carry a dedupe
 * key derived from its payload (e.g. the Voluum offer id for
 * `OfferImported`). The bus uses it to enforce
 * `(workspaceId, type, dedupeKey)` uniqueness via the partial unique
 * index on `events.dedupe_key`.
 */
export type EmittedEvent = EventInput & { dedupeKey?: string | null };

// ── Actions ───────────────────────────────────────────────────────────
// Handlers MUST NOT call `db.update(...)` on domain tables directly.
// Instead they return a list of `Action`s; the executor applies them
// inside the same transaction as the event row write. This is the
// single chokepoint enforced by the lint check in
// `scripts/src/check-no-direct-domain-mutations.ts`.

export type Action =
  | {
      type: "CreateBatch";
      workspaceId: number;
      data: {
        employeeId: number;
        batchName: string;
        affiliateNetwork: string;
        geo: string;
        trafficSource: string;
        batchTag: string;
        affiliateNetworkId?: number | null;
        // Phase 5e: idempotent upsert on (workspaceId, batchTag).
        // When provided, on-conflict updates these two fields so a
        // re-sync of the same tag refreshes counts/timestamps without
        // creating a duplicate batch row.
        numberOfOffers?: number;
        lastSyncAt?: Date;
      };
    }
  | {
      type: "CreateTask";
      workspaceId: number;
      data: {
        employeeId: number;
        relatedBatchId: number | null;
        title: string;
        description?: string;
        taskType:
          | "CREATE_IOS_TRACKER_CAMPAIGN"
          | "CREATE_ANDROID_TRACKER_CAMPAIGN"
          | "GO_LIVE_TRAFFIC_SOURCE_CAMPAIGN"
          | "MOVE_WINNERS_TO_SCALED_CAMPAIGN"
          | "FIND_WINNERS"
          | "PAUSE_TRAFFIC_SOURCE_CAMPAIGNS"
          | "CREATE_IOS_CAMPAIGN"
          | "CREATE_ANDROID_CAMPAIGN"
          | "GO_LIVE"
          | "OPTIMIZATION_FOLLOWUP"
          // CampaignOps redesign — new manual flow task types.
          | "create_voluum_campaign_ios"
          | "create_voluum_campaign_android"
          | "take_campaign_live"
          | "find_winners"
          | "all_traffic_sources_tested";
        priority?: "low" | "medium" | "high";
        trackerCampaignDevice?: "ios" | "android" | null;
        trafficSourceId?: number | null;
        // CampaignOps redesign — link a follow-up task (take_campaign_live,
        // find_winners) to the Campaign it advances.
        relatedCampaignId?: number | null;
        flashing?: boolean;
        // Pivot Phase 4 (Task #27): scheduled tasks (e.g.
        // OPTIMIZATION_FOLLOWUP at live_at + test_duration_hours)
        // carry an ISO timestamp here. Stored in todo_tasks.due_date
        // (text column) verbatim.
        dueDate?: string | null;
      };
    }
  | {
      type: "GoLiveBatchCampaigns";
      workspaceId: number;
      batchId: number;
    }
  | {
      type: "CompleteTask";
      taskId: number;
    }
  | {
      type: "CompleteTaskFromRequest";
      workspaceId: number;
      taskId: number;
      completedByEmployeeId: number;
      completion: TaskCompletionDetails;
    }
  // Pivot Phase 4 (Task #27): TaskCompleted advances the campaign
  // state machine. Engine-owned because `campaigns` will be added
  // to the forbidden table list in Phase 5 — keeping the executor
  // as the only writer keeps the audit trail one-source.
  | {
      type: "UpdateCampaignStatus";
      workspaceId: number;
      campaignId: number;
      from: "draft" | "ready" | "voluum_created" | "live" | "tested" | "closed";
      to: "draft" | "ready" | "voluum_created" | "live" | "tested" | "closed";
    }
  | {
      type: "ChangeBatchStatus";
      workspaceId: number;
      batchId: number;
      status: BatchStatus;
      liveAt?: Date | null;
    }
  | {
      type: "CreateNotification";
      workspaceId: number;
      data: {
        employeeId: number;
        batchId?: number | null;
        type:
          | "NEW_BATCH_CREATED"
          | "TRACKER_CAMPAIGN_MISSING"
          | "INVALID_TAG"
          | "DUPLICATE_TRACKER_CAMPAIGN"
          | "SUSPICIOUS_BATCH_UPDATE"
          | "API_SYNC_FAILURE"
          | "TASK_OVERDUE";
        severity?: "info" | "warning" | "high" | "critical";
        message: string;
      };
    }
  | {
      type: "RecordTrackerCampaign";
      workspaceId: number;
      data: {
        batchId: number;
        device: "ios" | "android";
        trafficSourceId: number;
        voluumCampaignId: string;
        tag: string;
      };
    }
  | {
      type: "AdvanceTrafficSource";
      workspaceId: number;
      batchId: number;
      nextTrafficSourceId: number;
    }
  | {
      type: "CompleteTrafficSourceRunPlatform";
      workspaceId: number;
      batchId: number;
      trafficSourceId: number;
      platform: "ios" | "android";
      campaignId: number;
      outcome: "completed" | "failed";
      failureReason?: string | null;
    }
  // Phase 7: engine-owned escalation. The overdue-tasks cron emits
  // TaskOverdue and the rule converts it to MarkTaskOverdue (which sets
  // flashing=true + escalatedAt=now) plus a TASK_OVERDUE notification.
  // Direct routes are NOT allowed to set escalatedAt; that's the whole
  // point of routing through the action plane.
  | {
      type: "MarkTaskOverdue";
      taskId: number;
    }
  // Spec-correction (post Phase 10): captures the workspace traffic
  // source rotation order on the batch row at creation time so later
  // admin reorderings do not mutate in-flight batches. Also seeds
  // currentTrafficSourceId. Snapshot is the ORDERED list of
  // voluum_traffic_sources.id values that were active at snapshot time.
  | {
      type: "SetBatchTrafficSourceSnapshot";
      batchId: number;
      snapshot: ReadonlyArray<{ id: number; name: string; position: number }>;
      currentTrafficSourceId: number;
    }
  // Pivot Phase 4 (Task #27): single action that the BatchCreated rule
  // returns to seed both CREATE_IOS_CAMPAIGN and CREATE_ANDROID_CAMPAIGN
  // tasks for the batch's assigned worker in one go. Implemented in
  // executor as two CreateTask inserts so the partial unique index on
  // `todo_tasks.uniqOpenTrackerTaskPerSlot` doesn't apply (these tasks
  // carry trackerCampaignDevice=null) and the at-most-one guarantee
  // comes from the BatchCreated event dedupe key (`batch_created:<id>`)
  // — re-emit of BatchCreated is a no-op so the rule never returns this
  // action twice for the same batch.
  | {
      type: "CreateCampaignTaskPair";
      workspaceId: number;
      data: {
        batchId: number;
        employeeId: number;
        batchName: string;
      };
    }
  // Spec-correction (post Phase 10): keeps testing_batches.numberOfOffers
  // consistent after per-offer attachment in OfferImported handler.
  // Counts the live voluum_offers rows currently linked to the batch.
  | {
      type: "RecomputeBatchOfferCount";
      workspaceId: number;
      batchId: number;
    };

export type ActionType = Action["type"];

/** A registered event handler. Receives the event + the same tx used to
 *  write the event row, returns the side-effect actions to apply. */
export type Handler<E extends EventInput = EventInput> = (
  event: E,
  tx: Tx,
) => Promise<Action[]> | Action[];

/** Helper for exhaustiveness checks in switch statements. */
export function assertNever(x: never): never {
  throw new Error(`engine: unhandled discriminant ${JSON.stringify(x)}`);
}
