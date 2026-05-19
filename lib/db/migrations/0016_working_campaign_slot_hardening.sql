-- Slice 8F-1 — working campaign slot identity (geo FK + live-slot uniqueness).

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS geo_id integer REFERENCES geos(id) ON DELETE SET NULL;

-- One live working campaign per (workspace, network, geo, traffic source, platform).
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_working_live_slot_unique
  ON campaigns (workspace_id, affiliate_network_id, geo_id, traffic_source_id, platform)
  WHERE campaign_purpose = 'working'
    AND status = 'live'
    AND affiliate_network_id IS NOT NULL
    AND geo_id IS NOT NULL
    AND traffic_source_id IS NOT NULL;
