-- Task #9: end-to-end Batch automation — manual SQL migration.
--
-- Convention: this repo manages schema with `drizzle-kit push`
-- (`pnpm --filter @workspace/db run push`), which has already been applied
-- in the development environment for this change set. This file documents
-- the equivalent SQL so other environments (including production) can be
-- migrated deterministically and auditably.
--
-- Idempotent: every statement uses IF [NOT] EXISTS / DO blocks so it can
-- safely be re-run.

BEGIN;

-- 1. Rename batch_status enum value `live` -> `live_testing` (and migrate
--    any existing rows that still have the old value before renaming, in
--    case the enum already has `live_testing` from a prior partial run).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'batch_status'::regtype AND enumlabel = 'live'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'batch_status'::regtype AND enumlabel = 'live_testing'
  ) THEN
    EXECUTE 'ALTER TYPE batch_status RENAME VALUE ''live'' TO ''live_testing''';
  ELSIF EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'batch_status'::regtype AND enumlabel = 'live'
  ) THEN
    -- Both labels exist (partial prior migration): backfill, then drop the
    -- legacy value via the standard "swap enum" workaround. Postgres has
    -- no native DROP VALUE, so we recreate the enum without `live`.
    UPDATE testing_batches SET status = 'live_testing'::batch_status WHERE status::text = 'live';
    ALTER TYPE batch_status RENAME TO batch_status_old;
    CREATE TYPE batch_status AS ENUM (
      'draft','ready','testing','tested','moved_to_next_source','main_campaign',
      'closed','ready_for_optimization','optimizing','completed','scaling','live_testing'
    );
    ALTER TABLE testing_batches
      ALTER COLUMN status TYPE batch_status
      USING status::text::batch_status;
    DROP TYPE batch_status_old;
  END IF;
END
$$;

-- Defensive backfill (no-op if already migrated):
UPDATE testing_batches
   SET status = 'live_testing'::batch_status
 WHERE status::text = 'live';

-- 2. voluum_campaigns: persist Voluum tags
ALTER TABLE voluum_campaigns ADD COLUMN IF NOT EXISTS primary_tag text;
ALTER TABLE voluum_campaigns ADD COLUMN IF NOT EXISTS all_tags text;

-- 3. todo_tasks: support create_test_campaign fan-out (source × device)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'task_type'::regtype AND enumlabel = 'create_test_campaign'
  ) THEN
    ALTER TYPE task_type ADD VALUE 'create_test_campaign';
  END IF;
END
$$;

ALTER TABLE todo_tasks ADD COLUMN IF NOT EXISTS traffic_source_name text;
ALTER TABLE todo_tasks ADD COLUMN IF NOT EXISTS device text;

-- Replace any legacy index with the new partial unique index that prevents
-- duplicate fan-out per (batch, source, device) for create_test_campaign.
DROP INDEX IF EXISTS todo_tasks_unique_per_batch_source;
DROP INDEX IF EXISTS todo_tasks_unique_add_to_live_campaign_per_batch;
CREATE UNIQUE INDEX IF NOT EXISTS todo_tasks_unique_create_test_campaign_per_batch_src_device
  ON todo_tasks (related_batch_id, traffic_source_name, device)
  WHERE task_type = 'create_test_campaign';

-- 4. New per-workspace traffic_source_device_plans table
CREATE TABLE IF NOT EXISTS traffic_source_device_plans (
  id                  serial PRIMARY KEY,
  workspace_id        integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  traffic_source_name text    NOT NULL,
  device              text    NOT NULL,
  enabled             boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT traffic_source_device_plans_ws_ts_device_unique
    UNIQUE (workspace_id, traffic_source_name, device)
);

COMMIT;
