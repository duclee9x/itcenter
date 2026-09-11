CREATE TABLE asset.assignments (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, asset_id uuid NOT NULL,
  user_id uuid NOT NULL, assignment_type text NOT NULL DEFAULT 'PRIMARY',
  status text NOT NULL DEFAULT 'ACTIVE', reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, asset_id) REFERENCES asset.assets(tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES identity.users(tenant_id, id),
  CHECK (assignment_type IN ('PRIMARY','SECONDARY','TEMPORARY')),
  CHECK (status IN ('ACTIVE','ENDED')),
  CHECK ((status='ACTIVE' AND ended_at IS NULL) OR (status='ENDED' AND ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX asset_one_active_primary_assignment
  ON asset.assignments(tenant_id, asset_id) WHERE status='ACTIVE' AND assignment_type='PRIMARY';
CREATE INDEX asset_assignments_user_lookup ON asset.assignments(tenant_id, user_id, status);
