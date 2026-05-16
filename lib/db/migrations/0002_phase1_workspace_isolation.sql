-- Phase 1 (Task #11): Enforce workspace isolation across all domain tables.
--
-- Convention: this repo manages schema with `drizzle-kit push`
-- (`pnpm --filter @workspace/db run push`), which has already been applied
-- in development. This file documents the equivalent SQL so other
-- environments (including production) can be migrated deterministically.
--
-- IMPORTANT — order of operations:
--   1. Delete legacy global voluum_* settings rows that have no owning
--      workspace and would otherwise violate the new NOT NULL constraint.
--   2. Backfill remaining NULL workspace_id rows to the default workspace
--      (id=1). Run scripts/src/audit-workspace-backfill.ts FIRST in any
--      environment with multiple historical workspaces to confirm there is
--      a single sensible target — never assume id=1 silently.
--   3. ALTER COLUMN ... SET NOT NULL.
--   4. Drop the legacy default(1) so future inserts that forget
--      workspaceId fail loudly instead of silently writing into workspace 1.
--   5. Add FK -> workspaces(id) ON DELETE CASCADE.
--   6. Replace settings UNIQUE(key) with composite UNIQUE(workspace_id, key).
--
-- Idempotent: every statement uses IF [NOT] EXISTS / DO blocks so it can
-- safely be re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Pre-flight guard: refuse to enforce constraints while there are still
--    cross-table workspace_id mismatches. These are almost certainly the
--    legacy default(1) misroutes the audit script flags. Operators MUST
--    correct them (assign each child row to the parent's workspace_id)
--    before re-running this migration. See scripts/src/audit-workspace-backfill.ts.
-- ---------------------------------------------------------------------------
DO $phase1_preflight$
DECLARE
  bad_offers   bigint;
  bad_tasks    bigint;
  bad_notifs   bigint;
  bad_maps     bigint;
  total        bigint;
BEGIN
  SELECT COUNT(*) INTO bad_offers
    FROM offers o JOIN testing_batches b ON o.batch_id = b.id
   WHERE o.workspace_id IS DISTINCT FROM b.workspace_id;
  SELECT COUNT(*) INTO bad_tasks
    FROM todo_tasks t JOIN testing_batches b ON t.related_batch_id = b.id
   WHERE t.workspace_id IS DISTINCT FROM b.workspace_id;
  SELECT COUNT(*) INTO bad_notifs
    FROM notifications n JOIN testing_batches b ON n.batch_id = b.id
   WHERE n.workspace_id IS DISTINCT FROM b.workspace_id;
  SELECT COUNT(*) INTO bad_maps
    FROM voluum_campaign_mappings m JOIN testing_batches b ON m.batch_id = b.id
   WHERE m.workspace_id IS DISTINCT FROM b.workspace_id;
  total := bad_offers + bad_tasks + bad_notifs + bad_maps;
  IF total > 0 THEN
    RAISE EXCEPTION
      'Phase 1 pre-flight FAILED: % cross-table workspace_id mismatch(es) ' ||
      '(offers=%, todo_tasks=%, notifications=%, voluum_campaign_mappings=%). ' ||
      'These are legacy default(1) misroutes. Run ' ||
      'pnpm --filter @workspace/scripts run audit:workspace-backfill, ' ||
      'reassign each child row to its parent batch.workspace_id, then re-run.',
      total, bad_offers, bad_tasks, bad_notifs, bad_maps;
  END IF;
END $phase1_preflight$;

-- ---------------------------------------------------------------------------
-- 1. Delete legacy global settings rows. These were the pre-Phase-1 unscoped
--    voluum credentials and mapping rows. Voluum credentials now live on
--    the workspaces row; voluum mappings live in voluum_campaign_mappings.
-- ---------------------------------------------------------------------------
-- Voluum credentials and base URL now live on `workspaces` (per-workspace).
-- Voluum campaign->batch mappings now live in `voluum_campaign_mappings`
-- (also per-workspace). The legacy global `voluum_mapping_*` settings rows
-- have ALREADY been migrated into voluum_campaign_mappings during Phase 0,
-- so deleting them here is intentional and non-destructive.
--
-- The voluum_last_sync_* rows that remain are *operational telemetry* and
-- intentionally per-workspace going forward (sync.ts writes them with the
-- triggering workspaceId). The backfill in step 2 attaches any pre-existing
-- unscoped row to the default workspace; no workspace-multiplexing is
-- attempted because the legacy rows were a single global value, so there
-- is no per-workspace history to recover.
DELETE FROM settings
WHERE key IN ('voluum_access_id', 'voluum_access_key', 'voluum_api_base_url')
   OR key LIKE 'voluum_mapping_%';

-- ---------------------------------------------------------------------------
-- 1b. Add workspace_id column where it does not yet exist. Pre-Phase-1
--     `settings` had no workspace_id at all; the 8 domain tables had it
--     since earlier phases but with `default(1)` and possibly nullable.
--     We add it as nullable first, then backfill, then SET NOT NULL below.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'settings',
    'testing_batches',
    'offers',
    'todo_tasks',
    'notifications',
    'traffic_source_plans',
    'daily_reports',
    'voluum_campaign_mappings',
    'imported_offers'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS workspace_id integer',
      tbl
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill any remaining NULL workspace_id rows to the default workspace.
--    Run scripts/src/audit-workspace-backfill.ts beforehand to verify this
--    is safe in your environment.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  default_ws integer;
BEGIN
  SELECT id INTO default_ws FROM workspaces ORDER BY id LIMIT 1;
  IF default_ws IS NULL THEN
    RAISE EXCEPTION 'No workspaces row found — cannot backfill workspace_id. '
      'Create a workspace first.';
  END IF;

  UPDATE settings                    SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE testing_batches             SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE offers                      SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE todo_tasks                  SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE notifications               SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE traffic_source_plans        SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE daily_reports               SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE voluum_campaign_mappings    SET workspace_id = default_ws WHERE workspace_id IS NULL;
  UPDATE imported_offers             SET workspace_id = default_ws WHERE workspace_id IS NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. & 4. SET NOT NULL + DROP DEFAULT on every domain table.
-- ---------------------------------------------------------------------------
ALTER TABLE settings                  ALTER COLUMN workspace_id SET NOT NULL,                                         ALTER COLUMN workspace_id DROP DEFAULT;
ALTER TABLE testing_batches           ALTER COLUMN workspace_id SET NOT NULL,                                         ALTER COLUMN workspace_id DROP DEFAULT;
ALTER TABLE offers                    ALTER COLUMN workspace_id SET NOT NULL,                                         ALTER COLUMN workspace_id DROP DEFAULT;
ALTER TABLE todo_tasks                ALTER COLUMN workspace_id SET NOT NULL,                                         ALTER COLUMN workspace_id DROP DEFAULT;
ALTER TABLE notifications             ALTER COLUMN workspace_id SET NOT NULL,                                         ALTER COLUMN workspace_id DROP DEFAULT;
ALTER TABLE traffic_source_plans      ALTER COLUMN workspace_id SET NOT NULL,                                         ALTER COLUMN workspace_id DROP DEFAULT;
ALTER TABLE daily_reports             ALTER COLUMN workspace_id SET NOT NULL,                                         ALTER COLUMN workspace_id DROP DEFAULT;
ALTER TABLE voluum_campaign_mappings  ALTER COLUMN workspace_id SET NOT NULL,                                         ALTER COLUMN workspace_id DROP DEFAULT;
ALTER TABLE imported_offers           ALTER COLUMN workspace_id SET NOT NULL,                                         ALTER COLUMN workspace_id DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 5. Add ON DELETE CASCADE FK for every domain table (idempotent).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  fk_name text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'settings',
    'testing_batches',
    'offers',
    'todo_tasks',
    'notifications',
    'traffic_source_plans',
    'daily_reports',
    'voluum_campaign_mappings',
    'imported_offers'
  ]
  LOOP
    fk_name := tbl || '_workspace_id_workspaces_id_fk';

    -- Drop any pre-existing FK with the same name (e.g. RESTRICT variant).
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      tbl, fk_name
    );

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (workspace_id) '
      'REFERENCES workspaces(id) ON DELETE CASCADE',
      tbl, fk_name
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Settings: replace UNIQUE(key) with composite UNIQUE(workspace_id, key).
--    Same setting key can now coexist across workspaces.
-- ---------------------------------------------------------------------------
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_unique;
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'settings_workspace_key_unique'
      AND conrelid = 'settings'::regclass
  ) THEN
    ALTER TABLE settings ADD CONSTRAINT settings_workspace_key_unique
      UNIQUE (workspace_id, key);
  END IF;
END $$;

COMMIT;
