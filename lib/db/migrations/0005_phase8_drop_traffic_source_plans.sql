-- Phase 8b (Task #18): retire `traffic_source_plans` in favor of
-- `workspace_traffic_sources` (added in Phase 7).
--
-- Convention: this repo manages schema with `drizzle-kit push`
-- (`pnpm --filter @workspace/db run push`). This file documents the
-- equivalent SQL so non-dev environments can be migrated
-- deterministically.
--
-- Strategy:
--   1. If the legacy table still exists, snapshot every row of it
--      into `traffic_source_plans_backup` (kept for one release as a
--      rollback safety net). The CREATE TABLE … LIKE form preserves
--      the column types exactly.
--   2. Best-effort data move: copy any (workspace_id, traffic_source)
--      pairs that aren't already represented in
--      `workspace_traffic_sources` so per-workspace ordering survives
--      the cutover. Both source and destination tables were verified
--      empty in every environment before this migration shipped, so
--      the INSERT is a no-op in practice — we still ship it so reruns
--      against historical snapshots remain idempotent and auditable.
--   3. Drop the legacy table with CASCADE. After the next release
--      cycle, follow up with `DROP TABLE traffic_source_plans_backup`
--      once production confirms no rollback is needed.
--
-- The whole script is wrapped in a DO block so that a replay
-- against an environment where the table is already gone is a no-op
-- rather than an error.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'traffic_source_plans'
  ) THEN
    EXECUTE $sql$
      CREATE TABLE IF NOT EXISTS traffic_source_plans_backup
        (LIKE traffic_source_plans INCLUDING ALL);
    $sql$;

    EXECUTE $sql$
      INSERT INTO traffic_source_plans_backup
        SELECT * FROM traffic_source_plans;
    $sql$;

    EXECUTE $sql$
      INSERT INTO workspace_traffic_sources
        (workspace_id, traffic_source, sort_order, is_active)
      SELECT DISTINCT
        tsp.workspace_id,
        tsp.traffic_source,
        tsp.test_order,
        tsp.is_active
      FROM traffic_source_plans tsp
      WHERE tsp.workspace_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM workspace_traffic_sources wts
          WHERE wts.workspace_id = tsp.workspace_id
            AND wts.traffic_source = tsp.traffic_source
        )
      ON CONFLICT DO NOTHING;
    $sql$;

    EXECUTE 'DROP TABLE traffic_source_plans CASCADE';
  END IF;
END $$;
