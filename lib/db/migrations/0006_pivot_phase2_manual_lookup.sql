-- Pivot Phase 2 (Task #25) — manual workflow foundations.
--
-- Convention: this repo manages schema with `drizzle-kit push`
-- (`pnpm --filter @workspace/db run push`). This file documents the
-- equivalent SQL so non-dev environments can be migrated
-- deterministically. The whole script is idempotent so replays
-- against partially-migrated environments are safe.
--
-- Adds:
--   1. affiliate_networks  — admin-managed lookup (replaces Voluum
--      affiliate networks as the source of truth for batches).
--   2. geos                — admin-managed country lookup.
--   3. campaigns           — manual ios/android campaign rows
--      created per testing batch.
--   4. batch_results       — manual end-of-test results entry
--      attached to a testing batch.
--   5. New columns on testing_batches: geo_id, test_round,
--      start_date, test_duration_hours.
--   6. Re-points testing_batches.affiliate_network_id from the
--      legacy voluum_affiliate_networks FK to the new
--      affiliate_networks table.
--   7. task_type enum: 4 new values for the manual workflow
--      (CREATE_IOS_CAMPAIGN, CREATE_ANDROID_CAMPAIGN, GO_LIVE,
--      OPTIMIZATION_FOLLOWUP).
--
-- Column types and FK targets mirror the Drizzle schema in
-- `lib/db/src/schema/{affiliate-networks,geos,campaigns,batch-results,
-- testing-batches}.ts`. Timestamps are `timestamptz` to match
-- `timestamp({ withTimezone: true })`.

-- ─── 1. affiliate_networks ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_networks (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_networks_workspace_name_unique UNIQUE (workspace_id, name)
);

-- ─── 2. geos ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geos (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geos_workspace_code_unique UNIQUE (workspace_id, code)
);

-- ─── 5. testing_batches new columns ─────────────────────────────
ALTER TABLE testing_batches
  ADD COLUMN IF NOT EXISTS geo_id              integer REFERENCES geos(id),
  ADD COLUMN IF NOT EXISTS test_round          integer,
  ADD COLUMN IF NOT EXISTS start_date          date,
  ADD COLUMN IF NOT EXISTS test_duration_hours integer NOT NULL DEFAULT 48;

-- ─── 6. Re-point affiliate_network_id FK ────────────────────────
-- The old FK pointed at voluum_affiliate_networks. In every existing
-- environment the column is fully NULL (verified at migration time:
-- only 2 testing_batches rows total, both NULL). Drop the legacy
-- constraint (any name) and recreate against the new table.
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT tc.constraint_name INTO v_constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON rc.unique_constraint_name = ccu.constraint_name
  WHERE tc.table_name = 'testing_batches'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'affiliate_network_id'
    AND ccu.table_name = 'voluum_affiliate_networks'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE testing_batches DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.table_name = 'testing_batches'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'affiliate_network_id'
      AND ccu.table_name = 'affiliate_networks'
  ) THEN
    ALTER TABLE testing_batches
      ADD CONSTRAINT testing_batches_affiliate_network_id_affiliate_networks_id_fk
      FOREIGN KEY (affiliate_network_id) REFERENCES affiliate_networks(id);
  END IF;
END $$;

-- ─── 3. campaigns ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'campaign_platform') THEN
    CREATE TYPE campaign_platform AS ENUM ('ios', 'android');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'campaign_status') THEN
    CREATE TYPE campaign_status AS ENUM ('draft', 'ready', 'live', 'tested', 'closed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS campaigns (
  id                serial PRIMARY KEY,
  workspace_id      integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_id          integer NOT NULL REFERENCES testing_batches(id) ON DELETE CASCADE,
  platform          campaign_platform NOT NULL,
  campaign_name     text NOT NULL,
  traffic_source_id integer REFERENCES workspace_traffic_sources(id) ON DELETE SET NULL,
  campaign_url      text,
  status            campaign_status NOT NULL DEFAULT 'draft',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_batch_platform_unique UNIQUE (batch_id, platform)
);

-- ─── 4. batch_results ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batch_results (
  id             serial PRIMARY KEY,
  workspace_id   integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_id       integer NOT NULL REFERENCES testing_batches(id) ON DELETE CASCADE,
  clicks         integer NOT NULL DEFAULT 0,
  cost           numeric NOT NULL DEFAULT 0,
  revenue        numeric NOT NULL DEFAULT 0,
  conversions    integer NOT NULL DEFAULT 0,
  roi            numeric,
  winners_count  integer NOT NULL DEFAULT 0,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT batch_results_batch_unique UNIQUE (batch_id)
);

-- ─── 7. task_type enum extensions ───────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='task_type'::regtype AND enumlabel='CREATE_IOS_CAMPAIGN') THEN
    ALTER TYPE task_type ADD VALUE 'CREATE_IOS_CAMPAIGN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='task_type'::regtype AND enumlabel='CREATE_ANDROID_CAMPAIGN') THEN
    ALTER TYPE task_type ADD VALUE 'CREATE_ANDROID_CAMPAIGN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='task_type'::regtype AND enumlabel='GO_LIVE') THEN
    ALTER TYPE task_type ADD VALUE 'GO_LIVE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='task_type'::regtype AND enumlabel='OPTIMIZATION_FOLLOWUP') THEN
    ALTER TYPE task_type ADD VALUE 'OPTIMIZATION_FOLLOWUP';
  END IF;
END $$;
