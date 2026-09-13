ALTER TABLE monitoring.events
  ADD COLUMN source_correlation_key text;

ALTER TABLE monitoring.events
  ADD CONSTRAINT monitoring_source_correlation_key_length
  CHECK (source_correlation_key IS NULL OR length(source_correlation_key) BETWEEN 1 AND 256);

CREATE INDEX monitoring_events_correlation_key
  ON monitoring.events(tenant_id, source, source_correlation_key)
  WHERE source_correlation_key IS NOT NULL;
