ALTER TABLE asset.assets
  ALTER COLUMN lifecycle_state SET DEFAULT 'PLANNED',
  ADD CONSTRAINT assets_lifecycle_state_check CHECK (lifecycle_state IN ('PLANNED','PURCHASED','RECEIVED','AVAILABLE','RESERVED','ASSIGNED','IN_USE','REPAIR','RETURNED','RETIRED','DISPOSED')),
  ADD CONSTRAINT assets_operational_state_check CHECK (operational_state IN ('UNKNOWN','ONLINE','OFFLINE')),
  ADD CONSTRAINT assets_assignment_state_check CHECK (assignment_state IN ('UNASSIGNED','RESERVED','ASSIGNED','PENDING_RETURN','IN_TRANSIT','TEMPORARY_LOAN'));

CREATE TABLE asset.lifecycle_transitions (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, asset_id uuid NOT NULL,
  from_state text, to_state text NOT NULL, command_type text NOT NULL,
  actor_type text NOT NULL, actor_id text NOT NULL, reason text NOT NULL,
  correlation_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, asset_id) REFERENCES asset.assets(tenant_id, id)
);
CREATE INDEX asset_lifecycle_transitions_lookup ON asset.lifecycle_transitions(tenant_id, asset_id, occurred_at);
