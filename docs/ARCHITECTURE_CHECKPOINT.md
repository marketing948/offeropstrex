# Architecture Checkpoint

This checkpoint captures the current operational boundaries after the Manual Ops Alpha and Voluum dry-run slices. It is a working reference for future implementation, review, and automation planning.

## Ownership Boundaries

- Frontend UI lives under `artifacts/offerops/src/` and should remain responsible for presentation, user input, loading/error states, and passing the active `workspace_id` to backend routes.
- API routes live under `artifacts/api-server/src/routes/` and own request validation, workspace authorization, read models, and explicit user-initiated mutation entry points.
- Workflow automation lives under `artifacts/api-server/src/engine/` and owns domain side effects that follow from events.
- Database schema lives under `lib/db/src/schema/`; migrations live under `lib/db/migrations/`.
- Generated API clients live under `lib/api-zod/` and `lib/api-client-react/`; regenerate them only as a deliberate API-contract slice.

Routes must not own workflow progression. When a user action changes workflow state, the route validates and records the explicit action, then the event engine owns follow-on progression.

## Event Engine Responsibilities

The event engine is the owner of workflow side effects. Domain transitions that create tasks, update campaign lifecycle state, emit notifications, or advance workflow stages should flow through engine events and registered rules.

Current responsibilities include:

- Creating CampaignOps tasks from batch and campaign lifecycle events.
- Applying task-completion side effects atomically where required.
- Marking campaigns live when `take_campaign_live` completion succeeds.
- Preserving idempotency through event dedupe keys and guarded updates.
- Avoiding downstream scheduling unless the specific rule has been explicitly assigned.

The engine should not become a read-model service. Query shaping, filtering, pagination, and UI projections belong in route-level read models.

## Read-Model vs Mutation Boundaries

Read models are server-authoritative API routes that shape data for UI consumption without mutating state. For example, `GET /api/live-campaigns` reads from existing campaign, batch, employee, and traffic-source tables and returns paginated, workspace-scoped data.

UI is read-only against read models. Pages may display, filter, sort, and paginate read-model data, but they must not hide mutation behavior behind read-only dashboard or reporting views.

Mutation routes must be explicit and narrow. They should validate workspace access server-side, avoid hidden lifecycle side effects, and delegate workflow consequences to the event engine when the change affects tasks, campaigns, batches, or notifications.

Frontend pages must not assume permission filtering is sufficient. Client filters can improve usability, but backend routes must enforce workspace and role visibility.

## Sync Ownership Rules

OfferOps remains the source of truth for workflow state. Voluum is an external validation and metadata source, not the canonical owner of tasks, batches, or campaign lifecycle.

Current sync rules:

- Full Voluum mutation/sync remains gated off unless explicitly enabled.
- Dry-run discovery preview may authenticate and fetch limited metadata only.
- Metadata preview must not write DB rows, emit events, create tasks, create batches, or mutate campaigns.
- Sync routes must not unlock dormant mutating Voluum flows as a side effect of preview work.
- Sync cannot directly mutate lifecycle state. Any future sync-driven lifecycle change must be modeled as an explicit event/action boundary with reviewable rules.
- Raw provider responses, secrets, tokens, and headers must not be returned to the UI.

Future sync work should remain isolated from manual task and campaign lifecycle changes unless a slice explicitly defines the bridge.

## Workspace Isolation Invariants

Workspace isolation is a hard invariant across API, engine, sync, and UI work.

- Every domain query and mutation involving offers, batches, tasks, campaigns, tracker campaigns, traffic sources, reports, notifications, or goals must include workspace scoping.
- API routes must verify the authenticated employee can access the requested workspace before returning or mutating data.
- Admin visibility is scoped to the selected/allowed workspace, not global data.
- Worker visibility is limited to assigned workspaces and the batches/campaigns/tasks connected to that worker where applicable.
- Frontend `WorkspaceContext` is a request input only; the backend remains authoritative.
- Tests should cover cross-workspace denial for any new read model or mutation route.

## Forbidden Direct Mutation Patterns

Avoid these patterns unless a slice explicitly approves and tests them:

- Updating `todo_tasks`, `campaigns`, `testing_batches`, `notifications`, or tracker campaign state directly from unrelated routes.
- Marking a task `DONE` without required completion details for CampaignOps task types.
- Completing a task and applying its campaign lifecycle side effect in separate transaction boundaries when atomicity is required.
- Creating downstream tasks or advancing batch progression from a read model.
- Letting UI actions imply hidden backend mutations.
- Loading all workspace data into the client and relying on client-side filtering for authorization.
- Adding schema migrations as a convenience when existing state is sufficient.

The direct-domain-mutation check should stay part of pre-merge QA for backend lifecycle changes.

## Future AI and Automation Insertion Points

Future AI or automation should attach at explicit reviewable boundaries:

- Read-only analytics over existing read models, such as live campaigns, tasks, batches, and performance summaries.
- Recommendation services that propose actions without mutating workflow state.
- Admin-approved automation that emits typed engine events rather than writing domain tables directly.
- Voluum reconciliation agents that compare external metadata with OfferOps state and produce warnings or proposed repairs.
- QA agents that verify workspace isolation, idempotency, and mutation boundaries before merge.
- Audit agents that inspect event logs, task completion details, and campaign transitions for inconsistencies.

Future AI agents must operate through explicit action boundaries or typed engine events. Any AI-driven mutation path must be introduced as a dedicated slice with explicit permissions, audit trail, idempotency design, workspace-isolation tests, and rollback behavior.
