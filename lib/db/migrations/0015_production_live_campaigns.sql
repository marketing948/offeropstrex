-- Slice 8E — production live campaigns (working / scaling) outside CampaignOps batches.

DO $$
BEGIN
  CREATE TYPE campaign_purpose AS ENUM ('testing', 'working', 'scaling');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE campaigns
  ALTER COLUMN batch_id DROP NOT NULL;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS campaign_purpose campaign_purpose NOT NULL DEFAULT 'testing',
  ADD COLUMN IF NOT EXISTS parent_campaign_id integer REFERENCES campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS affiliate_network_id integer REFERENCES affiliate_networks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS geo text;

-- Testing-only uniqueness (batch-bound CampaignOps cycles).
ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_batch_platform_traffic_source_unique;

DROP INDEX IF EXISTS campaigns_batch_platform_traffic_source_unique;

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_batch_platform_traffic_source_unique
  ON campaigns (batch_id, platform, traffic_source_id)
  WHERE batch_id IS NOT NULL AND campaign_purpose = 'testing';
