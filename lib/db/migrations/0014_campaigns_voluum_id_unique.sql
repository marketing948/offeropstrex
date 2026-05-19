-- Slice 8D — Voluum campaign ID is the permanent workspace-scoped link key.
-- Partial unique index: only non-null IDs participate (legacy rows may be null).

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_workspace_voluum_campaign_id_unique
  ON campaigns (workspace_id, voluum_campaign_id)
  WHERE voluum_campaign_id IS NOT NULL;
