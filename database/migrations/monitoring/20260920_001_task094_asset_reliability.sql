ALTER TABLE monitoring.events
  ADD COLUMN asset_reference_validated boolean NOT NULL DEFAULT false;

-- Backfill only exact, same-tenant canonical Asset identity matches.
UPDATE monitoring.events m
   SET asset_reference_validated=true
  FROM asset.assets a
 WHERE m.asset_id IS NOT NULL
   AND a.tenant_id=m.tenant_id
   AND a.id=m.asset_id;

CREATE INDEX monitoring_asset_reliability_lookup
  ON monitoring.events(tenant_id,asset_id,observed_at)
  WHERE asset_id IS NOT NULL AND asset_reference_validated=true;
