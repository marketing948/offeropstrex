-- Slice 7A: human-only todo tasks (no CampaignOps automation).
DO $$
BEGIN
  ALTER TYPE task_type ADD VALUE 'MANUAL';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
