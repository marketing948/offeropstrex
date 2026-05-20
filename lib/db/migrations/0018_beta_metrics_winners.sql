-- Beta metrics + winners foundation (pre-Voluum automation).

DO $$
BEGIN
  ALTER TYPE campaign_status ADD VALUE 'ready_for_winner_review';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE task_type ADD VALUE 'review_winners_target';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE batch_traffic_source_runs
  ADD COLUMN IF NOT EXISTS target_avg_visits_per_offer integer,
  ADD COLUMN IF NOT EXISTS offer_count integer;

DO $$
BEGIN
  CREATE TYPE campaign_winner_source AS ENUM ('manual_close', 'target_reached_review');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS campaign_winners (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_id integer REFERENCES testing_batches(id) ON DELETE SET NULL,
  campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  traffic_source_id integer REFERENCES workspace_traffic_sources(id) ON DELETE SET NULL,
  platform campaign_platform NOT NULL,
  offer_id integer NOT NULL,
  source campaign_winner_source NOT NULL,
  detected_by_employee_id integer REFERENCES employees(id) ON DELETE SET NULL,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_winners_workspace_campaign_offer_unique
  ON campaign_winners (workspace_id, campaign_id, offer_id);

CREATE INDEX IF NOT EXISTS campaign_winners_workspace_created_idx
  ON campaign_winners (workspace_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS todo_tasks_open_review_winners_target_unique
  ON todo_tasks (workspace_id, related_batch_id, traffic_source_id, task_type)
  WHERE status IN ('TODO', 'IN_PROGRESS')
    AND task_type = 'review_winners_target'
    AND related_batch_id IS NOT NULL
    AND traffic_source_id IS NOT NULL;
