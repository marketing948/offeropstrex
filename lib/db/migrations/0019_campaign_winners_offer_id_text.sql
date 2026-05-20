-- Voluum external offer identifiers are hyphenated UUID strings, not integers.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'campaign_winners'
      AND c.column_name = 'offer_id'
      AND c.data_type = 'integer'
  ) THEN
    EXECUTE '
      ALTER TABLE campaign_winners
        ALTER COLUMN offer_id TYPE text
        USING offer_id::text
    ';
  END IF;
END $$;
