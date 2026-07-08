-- 0023_campaigns_offer_count.sql
--
-- Adds campaign-level offer_count for manual/live campaign monitoring.
-- Nullable for backward compatibility with legacy campaigns.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS offer_count integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'campaigns_offer_count_positive_chk'
      AND conrelid = 'campaigns'::regclass
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_offer_count_positive_chk
      CHECK (offer_count IS NULL OR offer_count > 0);
  END IF;
END $$;
