-- CampaignOps task-completion schema parity.
--
-- Adds the enum values and columns used by the CampaignOps manual flow. The
-- partial unique indexes that reference the new enum labels live in the next
-- migration so PostgreSQL can commit the ALTER TYPE statements first.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='task_type'::regtype AND enumlabel='create_voluum_campaign_ios') THEN
    ALTER TYPE task_type ADD VALUE 'create_voluum_campaign_ios';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='task_type'::regtype AND enumlabel='create_voluum_campaign_android') THEN
    ALTER TYPE task_type ADD VALUE 'create_voluum_campaign_android';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='task_type'::regtype AND enumlabel='take_campaign_live') THEN
    ALTER TYPE task_type ADD VALUE 'take_campaign_live';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='task_type'::regtype AND enumlabel='find_winners') THEN
    ALTER TYPE task_type ADD VALUE 'find_winners';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='task_type'::regtype AND enumlabel='all_traffic_sources_tested') THEN
    ALTER TYPE task_type ADD VALUE 'all_traffic_sources_tested';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='campaign_status'::regtype AND enumlabel='voluum_created') THEN
    ALTER TYPE campaign_status ADD VALUE 'voluum_created' BEFORE 'live';
  END IF;
END $$;

ALTER TABLE todo_tasks
  ADD COLUMN IF NOT EXISTS related_campaign_id integer,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by_employee_id integer REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completion_payload jsonb,
  ADD COLUMN IF NOT EXISTS blocked_reason text;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS voluum_campaign_id text,
  ADD COLUMN IF NOT EXISTS voluum_campaign_name text,
  ADD COLUMN IF NOT EXISTS traffic_source_campaign_id text,
  ADD COLUMN IF NOT EXISTS traffic_source_campaign_url text,
  ADD COLUMN IF NOT EXISTS live_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS winners_count integer,
  ADD COLUMN IF NOT EXISTS revenue numeric,
  ADD COLUMN IF NOT EXISTS cost numeric,
  ADD COLUMN IF NOT EXISTS clicks integer,
  ADD COLUMN IF NOT EXISTS conversions integer,
  ADD COLUMN IF NOT EXISTS roi numeric,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_batch_platform_unique;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'campaigns_batch_platform_traffic_source_unique'
      AND conrelid = 'campaigns'::regclass
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_batch_platform_traffic_source_unique
      UNIQUE (batch_id, platform, traffic_source_id);
  END IF;
END $$;
