# OfferOps

OfferOps is a manual-first internal workflow system for affiliate media buyers. Workers run a structured pipeline — **draft batch → assigned campaigns (iOS + Android) → live → tested → results recorded → winners scaled** — and admins get a mission-control view of the queue, throughput, and per-worker performance.

The product was originally built around live Voluum sync. After the Phase 1–6 pivot, OfferOps no longer depends on Voluum at runtime: every workflow state transition is driven by manual actions and a small, deterministic auto-task engine. Voluum code remains in the repo as a dormant "future automation layer" (see below).

## Run & Operate

- `pnpm run typecheck` — Typecheck all packages
- `pnpm run build` — Typecheck and build all packages
- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — Push DB schema changes (**development only**)
- `pnpm run db:migrate` — Apply baseline + forward SQL migrations (**staging/production**)
- `pnpm run db:baseline-align` — One-time marker for databases created with `push` (records baseline without replaying legacy SQL)
- `pnpm --filter @workspace/api-server run dev` — Run API server locally

Required environment variables:
- `DATABASE_URL` — Postgres connection string (provided by Replit).
- `AUTH_TOKEN_SECRET` — JWT signing secret for API auth (required in production).

Optional environment variables:
- `ENABLE_VOLUUM` (default `false`) — gates the dormant Voluum integration. See "Dormant Voluum layer" below.
- `VITE_ENABLE_VOLUUM` (default `false`) — frontend mirror of the same flag for the React build.

## Stack

- **Monorepo**: pnpm workspaces
- **Runtime**: Node.js 24
- **Language**: TypeScript 5.9
- **Backend**: Express 5
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Validation**: Zod v4, `drizzle-zod`
- **API Codegen**: Orval (from `lib/api-spec/openapi.yaml`)
- **Build Tool**: esbuild
- **Frontend**: React, Vite, Tailwind, shadcn/ui, Recharts, React Query

## Where things live

- **DB Schema**: `artifacts/db/src/schema.ts`
- **API Contracts (OpenAPI)**: `lib/api-spec/openapi.yaml`
- **Routes**: `artifacts/api-server/src/routes/index.ts`
- **Goal Scoring Logic**: `artifacts/offerops/src/lib/goals-config.ts`
- **Auth Logic**: `artifacts/api-server/src/routes/auth.ts` (for `getEmployeeFromToken`)
- **Frontend Source**: `artifacts/offerops/src/`
- **Backend Source**: `artifacts/api-server/src/`
- **Engine Rules**: `artifacts/api-server/src/engine/rules/*.ts`
- **Reconciliation Cron**: `artifacts/api-server/src/cron/reconciliation.ts`

## Manual workflow (canonical) — CampaignOps redesign

1. **Draft batch** (`testing_batches`): admin/worker creates a batch (affiliate network + GEO + offers). The form no longer collects traffic source / target clicks / test duration — those are decided per-campaign downstream. Workers are restricted to the affiliate networks an admin has assigned them in **Settings → Worker Networks**.
2. **Auto-tasks** seeded on `BatchCreated`: one `create_voluum_campaign_ios` + one `create_voluum_campaign_android`, both assigned to the batch's worker.
3. Worker completes a `create_voluum_campaign_*` task with the Voluum campaign ID/name + traffic source. The engine creates a `campaigns` row in status `voluum_created` and spawns a `take_campaign_live` task for that single Campaign.
4. Worker completes `take_campaign_live` (optionally entering the traffic-source-side campaign id/url). The Campaign flips to `live`, `liveStartedAt = now()`.
5. After 7 days live, the **find-winners scheduler** (cron) emits one `find_winners` task per live campaign.
6. Worker completes `find_winners` with per-Campaign perf (revenue, cost, clicks, conversions, winners count). The Campaign flips to `tested`, the numbers are stored on the `campaigns` row, and the engine spawns the next-traffic-source `create_voluum_campaign_<platform>` task — or, if every active workspace traffic source has been tested for that batch+platform, an `all_traffic_sources_tested` summary task.
7. Per-Campaign perf on the `campaigns` row supersedes the old `batch_results` workflow. The `batch_results` table and its endpoints remain for legacy reports, but new flows do not write to it.

## Task type taxonomy (current)

Active task types (lowercase = CampaignOps redesign):

- `create_voluum_campaign_ios`, `create_voluum_campaign_android` — worker enters Voluum campaign metadata + traffic source; completion creates a `campaigns` row.
- `take_campaign_live` — worker confirms the campaign is now live on the traffic source; flips campaign to `live`.
- `find_winners` — emitted 7 days after `liveStartedAt`; worker enters per-Campaign perf.
- `all_traffic_sources_tested` — informational summary when every active traffic source has been tested for a batch+platform.

Legacy task types (`CREATE_IOS_CAMPAIGN`, `CREATE_ANDROID_CAMPAIGN`, `GO_LIVE`, `OPTIMIZATION_FOLLOWUP`, `MOVE_WINNERS_TO_SCALED_CAMPAIGN`) are still recognised by the drawer/labels for any rows surviving older flows; the engine no longer emits them. New batches go through the CampaignOps cycle exclusively.

## Architecture decisions

- **Automation Engine**: Domain mutations on `testing_batches`, `todo_tasks`, `tracker_campaigns`, `notifications`, and `campaigns` flow through `engine/emit()` → registered rules in `engine/rules/*.ts` → `engine/executor.ts::applyAction()`. The lint check `scripts/check-no-direct-domain-mutations.ts` enforces this boundary AST-style. Events are deduped via `(workspace_id, type, dedupe_key)`.
- **Workspace Scoping**: All data tables include a `workspaceId` FK, and all list API routes filter by `workspace_id`. Frontend passes `workspace_id` from `WorkspaceContext` to all data queries.
- **Auth**: SHA-256 with salt for passwords; Bearer token (`base64({id}:{timestamp}:offerops_secret)`) stored in `localStorage`.
- **Post-Login Redirect**: All users land on the Operations Hub (`/ops`).
- **KPIs**: Dashboard KPIs are computed at query time (no materialized views) for real-time accuracy.
- **Performance shape**: The legacy `/performance` endpoint is derived at query time from `batch_results` (date = DATE(created_at), spend = cost, profit = revenue − cost, derived cpa/epc/cvr) so legacy reports keep working without a parallel ingest pipeline.

## Product

- **Manual Campaign Operations**: workers operate a deterministic batch → campaigns → results → winners pipeline.
- **Role-Based Access**: admin and employee roles with distinct functionality.
- **Operations Hub** (`/ops`): mission control — action items at the top, testing pipeline overview, performance snapshot.
- **Live Campaigns page** (`/live-campaigns`): every Campaign with rich filters (status, platform, traffic source, search) and per-Campaign perf columns.
- **Auto-Task Engine**: deterministic rules that seed `create_voluum_campaign_*` → `take_campaign_live` → `find_winners` → next-traffic-source / `all_traffic_sources_tested` tasks; idempotent (anti-dup via dedupe keys) and self-healing via reconciliation.
- **find-winners scheduler**: cron that emits one `find_winners` task per live campaign whose `liveStartedAt` is ≥ 7 days old. Anti-dup via `(workspaceId, type, dedupe_key=campaignId)`.
- **Goal & Bonus Scoring**: configurable system that rewards activity, winners found, optimization, and discipline.
- **Notifications**: in-app alerts for new batches, overdue tasks, and engine-detected anomalies.
- **Reporting**: historical reports across operations, batches, traffic sources, networks, GEOs, and employees, all derived from manual tables.

## Dormant Voluum layer

The original product synced Voluum every few minutes and drove the workflow off Voluum tags. The pivot moved that to manual entry. The Voluum code is **not deleted** — it is dormant:

- **DB tables** (`voluum_offers`, `voluum_campaigns`, `voluum_traffic_sources`, `voluum_affiliate_networks`, `voluum_campaign_mappings`) remain in the schema. They hold no rows in normal operation; they are populated only when `ENABLE_VOLUUM=true`.
- **Routes** under `/api/sync/voluum/*` and the legacy `/api/settings/voluum*` short-circuit when the flag is off.
- **Reconciliation cron** skips Voluum auto-grouping when the flag is off.
- **Engine events** considered Voluum-only — `OfferImported`, `TrackerCampaignImported`, `VoluumCampaignTagInvalid`, `TrafficSourceAdvanced` — are short-circuited inside `engine/emit()` (see `VOLUUM_ONLY_EVENT_TYPES`). Their handlers stay registered so re-enabling the flag is a single env change. (`BatchStatsUpdated` is not on the short-circuit list because the manual flow may also emit it; its rule no-ops cleanly when no Voluum-derived stats exist.)
- **Frontend** mirrors the flag via `VITE_ENABLE_VOLUUM`; the Tracker Campaigns page renders a static "paused" notice; every Voluum-namespaced React Query hook is disabled.
- **Tag parsers** (`pickValidVoluumTag`, `parseTrackerCampaignTag` in `artifacts/api-server/src/lib/voluum-tag.ts`) remain — they are pure and used by the dormant producer code.

A future "automation layer" task can re-enable Voluum end-to-end by setting `ENABLE_VOLUUM=true VITE_ENABLE_VOLUUM=true`. See `docs/SPEC.md` → "Future automation layer" appendix for the design intent of that layer.

## User preferences

- Action-driven UI: always show what needs attention first (action-required items at the top).
- Status badges with colored dots throughout (not just text labels).
- Auto-name batches from network + GEO + date + offer count.
- Operations Hub is the primary landing page — must feel like mission control.

## Gotchas

- **Development:** after Drizzle schema changes, run `pnpm --filter @workspace/db run push` before the API server.
- **Staging/production:** use `pnpm run db:migrate` (never replay legacy migrations `0001`–`0021`). Run `pnpm run db:baseline-align` once if the DB was originally created with `push`. Run bootstrap only **after** migrations complete.
- Ensure `workspace_id` is passed from `WorkspaceContext` for all frontend data queries to maintain correct data isolation.
- Voluum routes/UI are fully gated behind `ENABLE_VOLUUM` / `VITE_ENABLE_VOLUUM`. Do not call them from new manual-flow code.
- Engine handlers must NEVER mutate `testing_batches`, `todo_tasks`, `tracker_campaigns`, `notifications`, or `campaigns` directly — return Actions and let the executor apply them. The lint check enforces this.

## Pointers

- **React Query v5**: [TanStack Query Docs](https://tanstack.com/query/latest/docs/react/overview)
- **Drizzle ORM**: [Drizzle Docs](https://orm.drizzle.team/docs/overview)
- **Zod**: [Zod Docs](https://zod.dev/)
- **Orval**: [Orval Docs](https://orval.dev/)
