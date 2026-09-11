CREATE SCHEMA monitoring;
CREATE TABLE monitoring.events (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source text NOT NULL,
  provider_event_id text NOT NULL,
  asset_id uuid,
  service_id uuid,
  metric text NOT NULL,
  observed_value text NOT NULL,
  threshold text,
  severity text NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source, provider_event_id),
  CHECK (severity IN ('CRITICAL','WARNING','INFO','RECOVERED'))
);
CREATE INDEX monitoring_events_lookup ON monitoring.events(tenant_id, severity, observed_at DESC);
