INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
  ('a0940300-0000-4000-8000-000000000001','incident.asset_link','incident','asset_link'),
  ('a0940300-0000-4000-8000-000000000004','incident.asset_history.read','incident_asset_history','read'),
  ('a0940300-0000-4000-8000-000000000002','monitoring.asset_reliability.read','monitoring_asset','reliability.read'),
  ('a0940300-0000-4000-8000-000000000003','warranty.read','warranty','read')
ON CONFLICT(code) DO UPDATE
  SET resource_type=EXCLUDED.resource_type,action=EXCLUDED.action;
