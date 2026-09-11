ALTER TABLE audit.audit_events
  ADD COLUMN checksum text,
  ADD COLUMN previous_hash text,
  ADD COLUMN audit_sequence bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX audit_events_tenant_time ON audit.audit_events(tenant_id, recorded_at, id);
