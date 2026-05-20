-- Human-readable operational activity timeline (append-only, workspace scoped).

CREATE TABLE IF NOT EXISTS operational_activity_feed (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  actor_employee_id integer REFERENCES employees(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  metadata_json jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operational_activity_feed_workspace_created_at_idx
  ON operational_activity_feed (workspace_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS operational_activity_feed_workspace_event_type_idx
  ON operational_activity_feed (workspace_id, event_type, created_at DESC);
