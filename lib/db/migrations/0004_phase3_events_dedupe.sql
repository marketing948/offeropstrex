-- Phase 3 (Task #13): add the dedupe-key column + partial unique index
-- on `events` so producers can opt into idempotent emit().
--
-- Convention: this repo manages schema with `drizzle-kit push`
-- (`pnpm --filter @workspace/db run push`). This file documents the
-- equivalent SQL so other environments (including production) can be
-- migrated deterministically.
--
-- NULL semantics: Postgres treats multiple NULLs in a unique index as
-- distinct, so this acts as a partial unique constraint without an
-- explicit WHERE clause — events without a dedupe key are still
-- allowed to repeat freely.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS events_workspace_type_dedupe_idx
  ON events (workspace_id, type, dedupe_key);
