-- Existing values have no canonical owner or deterministic mapping. Preserve
-- them as observational legacy context; the new service_id is canonical only.
ALTER TABLE incident.incidents RENAME COLUMN service_id TO legacy_service_id;
ALTER TABLE incident.incidents ADD COLUMN service_id uuid;
ALTER TABLE incident.incidents
  ADD CONSTRAINT incident_service_tenant_fk
  FOREIGN KEY (tenant_id,service_id) REFERENCES service.services(tenant_id,id);
CREATE INDEX incident_canonical_service_lookup
  ON incident.incidents(tenant_id,service_id) WHERE service_id IS NOT NULL;
