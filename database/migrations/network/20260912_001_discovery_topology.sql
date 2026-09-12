CREATE SCHEMA network;

CREATE TABLE network.discovery_jobs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  state text NOT NULL DEFAULT 'QUEUED',
  source_type text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  freshness_threshold_seconds integer,
  started_at timestamptz,
  finished_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state IN ('QUEUED','RUNNING','PARTIAL','COMPLETED','FAILED','CANCELLED')),
  CHECK (freshness_threshold_seconds IS NULL OR freshness_threshold_seconds > 0)
);

CREATE INDEX discovery_jobs_tenant_state ON network.discovery_jobs(tenant_id,state,created_at DESC);

CREATE TABLE network.observations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  discovery_job_id uuid NOT NULL REFERENCES network.discovery_jobs(id),
  source_type text NOT NULL,
  source text NOT NULL,
  source_event_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  asset_id uuid,
  ip inet,
  mac macaddr,
  hostname text,
  vendor text,
  model text,
  operating_system text,
  vlan text,
  switch_name text,
  port_name text,
  confidence text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,source_type,source_event_id),
  CHECK (confidence IN ('HIGH','MEDIUM','LOW','UNKNOWN')),
  CHECK (ip IS NOT NULL OR mac IS NOT NULL)
);

CREATE INDEX network_observations_latest_mac ON network.observations(tenant_id,mac,observed_at DESC);
CREATE INDEX network_observations_latest_ip ON network.observations(tenant_id,ip,observed_at DESC);
