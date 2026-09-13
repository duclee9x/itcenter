INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
  ('98f26009-5ca0-468c-aed5-b2092b7ebd01','incident.correlation.read','incident_correlation','read'),
  ('98f26009-5ca0-468c-aed5-b2092b7ebd02','incident.correlation.link','incident','correlation.link'),
  ('98f26009-5ca0-468c-aed5-b2092b7ebd03','incident.correlation.review','incident','correlation.review'),
  ('98f26009-5ca0-468c-aed5-b2092b7ebd04','incident.correlation.detach','incident','correlation.detach')
ON CONFLICT(code) DO UPDATE SET resource_type=EXCLUDED.resource_type,action=EXCLUDED.action;
