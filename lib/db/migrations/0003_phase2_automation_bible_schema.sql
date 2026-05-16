-- Phase 2 (Task #12): Replace the legacy schema with the Automation
-- Bible canonical entities so the Phase 3+ engine has a real foundation.
--
-- Convention: this repo manages schema with `drizzle-kit push`
-- (`pnpm --filter @workspace/db run push --force`). This file documents
-- the equivalent SQL so other environments (including production) can be
-- migrated deterministically. In dev the canonical apply path is
-- `drizzle-kit push --force` against a wiped database — the user has
-- explicitly authorized destructive data loss for this phase.
--
-- DESTRUCTIVE: replaces 5 enums (`batch_status`, `task_type`,
-- `task_status`, `notification_type`, `offer_status`) with new value sets,
-- drops the `traffic_source_device_plans` table entirely, and adds three
-- new tables (`tracker_campaigns`, `workspace_traffic_sources`, `events`).
-- Existing data CANNOT be losslessly mapped through this migration —
-- it is a clean cutover.
--
-- Order of operations:
--   1. DROP `traffic_source_device_plans` (legacy plan model).
--   2. DROP rows referencing legacy enum members in any of the 5 enums.
--      (In dev this is "delete from <table>" because the user wiped data;
--      in prod a separate task will write the projection rules.)
--   3. DROP and recreate each affected enum with the spec values, then
--      re-attach it to its column with a sensible default.
--   4. CREATE the new `tracker_campaign_device` and
--      `notification_severity` enums.
--   5. ALTER `testing_batches` + `todo_tasks` to add the new columns.
--   6. CREATE `tracker_campaigns`, `workspace_traffic_sources`, `events`
--      with NOT NULL workspace_id FK CASCADE from day one.

BEGIN;

-- 1. Drop legacy traffic_source_device_plans + plan-style FIXED_DEVICES.
DROP TABLE IF EXISTS traffic_source_device_plans;

-- 2. Wipe rows that depend on legacy enum members. In dev the affected
--    tables have already been wiped; these are safety net DELETEs so the
--    enum drop/recreate below cannot fail on lingering rows.
DELETE FROM notifications;
DELETE FROM todo_tasks;
DELETE FROM offers;
DELETE FROM voluum_campaign_mappings;
DELETE FROM testing_batches;

-- 3. Replace the 5 legacy enums. Drizzle's `pgEnum` cannot drop members
--    in place, so the canonical migration is: drop the column default,
--    drop the column type binding, drop the type, recreate with new
--    members, re-bind the column, restore the default.

-- 3a. batch_status: 12 legacy → 6 spec.
ALTER TABLE testing_batches ALTER COLUMN status DROP DEFAULT;
ALTER TABLE testing_batches ALTER COLUMN status TYPE text USING status::text;
DROP TYPE IF EXISTS batch_status;
CREATE TYPE batch_status AS ENUM (
  'NEW_BATCH',
  'WAITING_FOR_TRACKER_CAMPAIGNS',
  'OFFER_READY_FOR_LIVE_TESTING',
  'LIVE_TESTS',
  'TESTED',
  'COMPLETED'
);
ALTER TABLE testing_batches
  ALTER COLUMN status TYPE batch_status USING status::batch_status;
ALTER TABLE testing_batches ALTER COLUMN status SET DEFAULT 'NEW_BATCH';
ALTER TABLE testing_batches ALTER COLUMN status SET NOT NULL;

-- 3b. task_status: 4 legacy → 4 spec.
ALTER TABLE todo_tasks ALTER COLUMN status DROP DEFAULT;
ALTER TABLE todo_tasks ALTER COLUMN status TYPE text USING status::text;
DROP TYPE IF EXISTS task_status;
CREATE TYPE task_status AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE');
ALTER TABLE todo_tasks
  ALTER COLUMN status TYPE task_status USING status::task_status;
ALTER TABLE todo_tasks ALTER COLUMN status SET DEFAULT 'TODO';
ALTER TABLE todo_tasks ALTER COLUMN status SET NOT NULL;

-- 3c. task_type: 7 legacy → 4 spec.
ALTER TABLE todo_tasks ALTER COLUMN task_type TYPE text USING task_type::text;
DROP TYPE IF EXISTS task_type;
CREATE TYPE task_type AS ENUM (
  'CREATE_IOS_TRACKER_CAMPAIGN',
  'CREATE_ANDROID_TRACKER_CAMPAIGN',
  'FIND_WINNERS',
  'PAUSE_TRAFFIC_SOURCE_CAMPAIGNS'
);
ALTER TABLE todo_tasks
  ALTER COLUMN task_type TYPE task_type USING task_type::task_type;
ALTER TABLE todo_tasks ALTER COLUMN task_type SET NOT NULL;

-- 3d. notification_type: 6 legacy → 7 spec (different members).
ALTER TABLE notifications ALTER COLUMN type TYPE text USING type::text;
DROP TYPE IF EXISTS notification_type;
CREATE TYPE notification_type AS ENUM (
  'NEW_BATCH_CREATED',
  'TRACKER_CAMPAIGN_MISSING',
  'INVALID_TAG',
  'DUPLICATE_TRACKER_CAMPAIGN',
  'SUSPICIOUS_BATCH_UPDATE',
  'API_SYNC_FAILURE',
  'TASK_OVERDUE'
);
ALTER TABLE notifications
  ALTER COLUMN type TYPE notification_type USING type::notification_type;
ALTER TABLE notifications ALTER COLUMN type SET NOT NULL;

-- 3e. offer_status: 9 legacy → 4 spec.
ALTER TABLE offers ALTER COLUMN status DROP DEFAULT;
ALTER TABLE offers ALTER COLUMN status TYPE text USING status::text;
DROP TYPE IF EXISTS offer_status;
CREATE TYPE offer_status AS ENUM ('imported', 'tested', 'winner', 'loser');
ALTER TABLE offers
  ALTER COLUMN status TYPE offer_status USING status::offer_status;
ALTER TABLE offers ALTER COLUMN status SET DEFAULT 'imported';
ALTER TABLE offers ALTER COLUMN status SET NOT NULL;

-- 4. New enums for Phase 2 entities.
CREATE TYPE notification_severity AS ENUM ('info', 'warning', 'high', 'critical');
CREATE TYPE tracker_campaign_device AS ENUM ('ios', 'android');

-- 5. Notification severity column.
ALTER TABLE notifications
  ADD COLUMN severity notification_severity NOT NULL DEFAULT 'info';

-- 6. testing_batches: traffic-source rotation + single-affiliate-network FK.
ALTER TABLE testing_batches
  ADD COLUMN current_traffic_source_id integer
    REFERENCES voluum_traffic_sources(id) ON DELETE SET NULL,
  ADD COLUMN traffic_source_step integer NOT NULL DEFAULT 0,
  ADD COLUMN traffic_source_order_snapshot jsonb,
  ADD COLUMN affiliate_network_id integer
    REFERENCES voluum_affiliate_networks(id) ON DELETE RESTRICT;
-- affiliate_network_id is nullable for now (Phase 2): the legacy
-- POST /api/testing-batches route does not yet populate it. Phase 5
-- rewrites the route to always set the FK; a follow-on task will then
-- ALTER ... SET NOT NULL once all writers are migrated.
-- current_traffic_source_id has FK -> voluum_traffic_sources(id)
-- ON DELETE SET NULL: when the underlying traffic source is removed
-- the batch's current pointer goes to NULL rather than leaving a
-- dangling id behind. Phase 3 added this FK after originally shipping
-- without one — drizzle schema and SQL are kept parity-locked here.

-- 7. todo_tasks: engine-driven flags + dimensions.
ALTER TABLE todo_tasks
  ADD COLUMN flashing boolean NOT NULL DEFAULT false,
  ADD COLUMN escalated_at timestamptz,
  ADD COLUMN tracker_campaign_device tracker_campaign_device,
  ADD COLUMN traffic_source_id integer
    REFERENCES voluum_traffic_sources(id) ON DELETE SET NULL;
-- The legacy partial unique index on
-- (related_batch_id, traffic_source_name, device) WHERE
-- task_type='create_test_campaign' targeted a task_type that no longer
-- exists; it was dropped by the task_type recreate above (Postgres drops
-- partial indexes whose WHERE clause references a missing enum value
-- when the type is recreated). Phase 5 will add the spec-canonical
-- uniqueness constraint on (related_batch_id, traffic_source_id,
-- tracker_campaign_device) WHERE task_type IN ('CREATE_IOS_TRACKER_CAMPAIGN',
-- 'CREATE_ANDROID_TRACKER_CAMPAIGN') alongside the engine that owns it.

-- 8. tracker_campaigns: worker-created Voluum campaign per (batch, source, device).
CREATE TABLE tracker_campaigns (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_id integer NOT NULL REFERENCES testing_batches(id) ON DELETE CASCADE,
  traffic_source_id integer NOT NULL REFERENCES voluum_traffic_sources(id) ON DELETE RESTRICT,
  device tracker_campaign_device NOT NULL,
  voluum_campaign_id text NOT NULL,
  tag text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tracker_campaigns_workspace_voluum_campaign_unique
    UNIQUE (workspace_id, voluum_campaign_id),
  CONSTRAINT tracker_campaigns_batch_source_device_unique
    UNIQUE (batch_id, traffic_source_id, device)
);

-- 9. workspace_traffic_sources: per-workspace ordered traffic-source list.
CREATE TABLE workspace_traffic_sources (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  voluum_traffic_source_id text,
  position integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT workspace_traffic_sources_workspace_position_unique
    UNIQUE (workspace_id, position),
  CONSTRAINT workspace_traffic_sources_workspace_name_unique
    UNIQUE (workspace_id, name)
);

-- 10. events: append-only event log feeding the Phase 3 engine.
CREATE TABLE events (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text
);
CREATE INDEX events_workspace_pending_idx
  ON events (workspace_id, processed_at, id);

COMMIT;
