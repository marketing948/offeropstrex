-- Manual daily metrics per live campaign (operator-entered; analytics-ready).

CREATE TABLE IF NOT EXISTS campaign_daily_metrics (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  date date NOT NULL,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  cost numeric NOT NULL DEFAULT 0 CHECK (cost >= 0),
  revenue numeric NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  conversions integer NOT NULL DEFAULT 0 CHECK (conversions >= 0),
  visits integer NOT NULL DEFAULT 0 CHECK (visits >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT campaign_daily_metrics_workspace_campaign_date_unique
    UNIQUE (campaign_id, date)
);

CREATE INDEX IF NOT EXISTS campaign_daily_metrics_workspace_date_idx
  ON campaign_daily_metrics (workspace_id, date);
