import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

let ensured = false;
/** Serializes concurrent `ensureProductionLiveCampaignSchema()` calls (parallel test files). */
let ensureChain: Promise<void> = Promise.resolve();

/** Applies migration 0015 DDL for route tests (idempotent). */
export async function ensureProductionLiveCampaignSchema(): Promise<void> {
  ensureChain = ensureChain.then(() => runEnsureOnce());
  await ensureChain;
}

async function runEnsureOnce(): Promise<void> {
  if (ensured) return;
  await db.execute(sql`SELECT pg_advisory_lock(948273001)`);
  try {
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

  await db.execute(sql`
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
  `);
  await db.execute(sql`
    ALTER TABLE campaigns
      ADD COLUMN IF NOT EXISTS close_source text,
      ADD COLUMN IF NOT EXISTS manual_close_reason campaign_manual_close_reason,
      ADD COLUMN IF NOT EXISTS manual_close_note text,
      ADD COLUMN IF NOT EXISTS manual_closed_at timestamp with time zone,
      ADD COLUMN IF NOT EXISTS manual_closed_by_employee_id integer REFERENCES employees(id) ON DELETE SET NULL
  `);

  // Migration 0022 — manual production campaign ownership (idempotent for tests).
  await db.execute(sql`
    ALTER TABLE campaigns
      ADD COLUMN IF NOT EXISTS created_by_employee_id integer REFERENCES employees(id) ON DELETE SET NULL
  `);
  await db.execute(sql`
    ALTER TABLE campaigns
      ADD COLUMN IF NOT EXISTS offer_count integer
  `);

  // ── Beta metrics + winners (migration 0018) — idempotent for route tests ──
  await db.execute(sql`
    DO $$
    BEGIN
      ALTER TYPE campaign_status ADD VALUE 'ready_for_winner_review';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await db.execute(sql`
    DO $$
    BEGIN
      ALTER TYPE task_type ADD VALUE 'review_winners_target';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await db.execute(sql`
    ALTER TABLE batch_traffic_source_runs
      ADD COLUMN IF NOT EXISTS target_avg_visits_per_offer integer,
      ADD COLUMN IF NOT EXISTS offer_count integer
  `);
  await db.execute(sql`
    DO $$
    BEGIN
      CREATE TYPE campaign_winner_source AS ENUM ('manual_close', 'target_reached_review');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS campaign_winners (
      id serial PRIMARY KEY,
      workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      batch_id integer REFERENCES testing_batches(id) ON DELETE SET NULL,
      campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      traffic_source_id integer REFERENCES workspace_traffic_sources(id) ON DELETE SET NULL,
      platform campaign_platform NOT NULL,
      offer_id text NOT NULL,
      source campaign_winner_source NOT NULL,
      detected_by_employee_id integer REFERENCES employees(id) ON DELETE SET NULL,
      detected_at timestamp with time zone NOT NULL DEFAULT now(),
      notes text,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS campaign_winners_workspace_campaign_offer_unique
      ON campaign_winners (workspace_id, campaign_id, offer_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS campaign_winners_workspace_created_idx
      ON campaign_winners (workspace_id, created_at DESC)
  `);
  await db.execute(sql`
    DROP INDEX IF EXISTS todo_tasks_open_review_winners_target_unique
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS todo_tasks_open_review_winners_target_unique
      ON todo_tasks (workspace_id, related_batch_id, traffic_source_id, task_type)
      WHERE status IN ('TODO', 'IN_PROGRESS')
        AND task_type = 'review_winners_target'
        AND related_batch_id IS NOT NULL
        AND traffic_source_id IS NOT NULL
  `);

    ensured = true;
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(948273001)`);
  }
}
