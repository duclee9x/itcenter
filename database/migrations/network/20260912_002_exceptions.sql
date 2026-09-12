CREATE TABLE network.exceptions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  exception_type text NOT NULL,
  source_observation_id uuid NOT NULL REFERENCES network.observations(id),
  dedupe_key text NOT NULL,
  state text NOT NULL DEFAULT 'OPEN',
  expected jsonb,
  observed jsonb NOT NULL,
  resolution_action text,
  resolution_reason text,
  linked_asset_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (exception_type IN ('UNKNOWN_DEVICE','VLAN_MISMATCH','IP_CONFLICT')),
  CHECK (state IN ('OPEN','RESOLVED','ACCEPTED'))
);

CREATE UNIQUE INDEX network_open_exception_dedupe
  ON network.exceptions(tenant_id,exception_type,dedupe_key) WHERE state='OPEN';
CREATE INDEX network_exceptions_lookup
  ON network.exceptions(tenant_id,state,exception_type,created_at DESC);

CREATE TABLE network.device_dispositions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  mac macaddr NOT NULL,
  disposition text NOT NULL,
  linked_asset_id uuid,
  source_exception_id uuid NOT NULL REFERENCES network.exceptions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,mac),
  CHECK (disposition IN ('LINKED','GUEST','INFRASTRUCTURE','IGNORED'))
);
