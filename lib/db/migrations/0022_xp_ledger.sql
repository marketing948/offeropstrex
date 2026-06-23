-- XP ledger — persisted, idempotent awards from goal completion and reward rules.

CREATE TABLE IF NOT EXISTS xp_ledger (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month_key text NOT NULL,
  amount integer NOT NULL,
  source_type text NOT NULL,
  idempotency_key text NOT NULL,
  goal_id text,
  metric_key text,
  reward_rule_id text,
  action_type text,
  entity_id text,
  metadata_json jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS xp_ledger_idempotency_key_unique
  ON xp_ledger (idempotency_key);

CREATE INDEX IF NOT EXISTS xp_ledger_workspace_month_employee_idx
  ON xp_ledger (workspace_id, month_key, employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS xp_ledger_workspace_month_idx
  ON xp_ledger (workspace_id, month_key, created_at DESC);
