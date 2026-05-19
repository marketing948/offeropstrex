import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

let ensured = false;

/** Applies migration 0015 DDL for route tests (idempotent). */
export async function ensureProductionLiveCampaignSchema(): Promise<void> {
  if (ensured) return;

  await db.execute(sql`
    DO $$
    BEGIN
      CREATE TYPE campaign_purpose AS ENUM ('testing', 'working', 'scaling');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await db.execute(sql`
    ALTER TABLE campaigns
      ALTER COLUMN batch_id DROP NOT NULL
  `);
  await db.execute(sql`
    ALTER TABLE campaigns
      ADD COLUMN IF NOT EXISTS campaign_purpose campaign_purpose NOT NULL DEFAULT 'testing',
      ADD COLUMN IF NOT EXISTS parent_campaign_id integer REFERENCES campaigns(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS affiliate_network_id integer REFERENCES affiliate_networks(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS geo text
  `);
  await db.execute(sql`
    ALTER TABLE campaigns
      DROP CONSTRAINT IF EXISTS campaigns_batch_platform_traffic_source_unique
  `);
  await db.execute(sql`
    DROP INDEX IF EXISTS campaigns_batch_platform_traffic_source_unique
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS campaigns_batch_platform_traffic_source_unique
      ON campaigns (batch_id, platform, traffic_source_id)
      WHERE batch_id IS NOT NULL AND campaign_purpose = 'testing'
  `);
  await db.execute(sql`
    ALTER TABLE campaigns
      ADD COLUMN IF NOT EXISTS geo_id integer REFERENCES geos(id) ON DELETE SET NULL
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS campaigns_working_live_slot_unique
      ON campaigns (workspace_id, affiliate_network_id, geo_id, traffic_source_id, platform)
      WHERE campaign_purpose = 'working'
        AND status = 'live'
        AND affiliate_network_id IS NOT NULL
        AND geo_id IS NOT NULL
        AND traffic_source_id IS NOT NULL
  `);

  ensured = true;
}
