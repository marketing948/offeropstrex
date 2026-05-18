-- Append-only operational event log foundation.
--
-- This table is separate from the engine `events` table. Engine events drive
-- workflow processing and dedupe; operational_events is a queryable audit
-- timeline for humans, future insights, and explicit automation boundaries.

CREATE TABLE IF NOT EXISTS operational_events (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL DEFAULT 'system',
  actor_id text,
  source text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_events_workspace_created_at_idx
  ON operational_events (workspace_id, created_at, id);

CREATE INDEX IF NOT EXISTS operational_events_workspace_entity_idx
  ON operational_events (workspace_id, entity_type, entity_id, created_at);

CREATE INDEX IF NOT EXISTS operational_events_workspace_event_type_idx
  ON operational_events (workspace_id, event_type, created_at);
