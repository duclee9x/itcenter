CREATE SCHEMA incident;
CREATE TABLE incident.incidents (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  incident_code text NOT NULL,
  title text NOT NULL,
  source text NOT NULL,
  monitoring_event_id uuid,
  state text NOT NULL DEFAULT 'DETECTED',
  priority text NOT NULL,
  service_id uuid,
  is_major boolean NOT NULL DEFAULT false,
  restoration_verification text,
  resolution_summary text,
  post_resolution_checks text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, incident_code),
  UNIQUE (tenant_id, monitoring_event_id),
  CHECK (state IN ('DETECTED','INVESTIGATING','IDENTIFIED','MITIGATING','MONITORING_RECOVERY','RESTORED','RESOLVED','CLOSED','CANCELLED')),
  CHECK (priority IN ('P1','P2','P3','P4'))
);
CREATE INDEX incident_lookup ON incident.incidents(tenant_id, state, priority, created_at DESC);
