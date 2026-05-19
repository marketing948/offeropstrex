-- Slice 9A — explicit manual campaign close with reason.

DO $$
BEGIN
  CREATE TYPE campaign_manual_close_reason AS ENUM (
    'opened_by_mistake',
    'no_traffic_dead_campaign',
    'technical_issue',
    'winners_found'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS close_source text,
  ADD COLUMN IF NOT EXISTS manual_close_reason campaign_manual_close_reason,
  ADD COLUMN IF NOT EXISTS manual_close_note text,
  ADD COLUMN IF NOT EXISTS manual_closed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS manual_closed_by_employee_id integer REFERENCES employees(id) ON DELETE SET NULL;
