CREATE TABLE identity.asset_scoring_principals (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  principal_type text NOT NULL DEFAULT 'SYSTEM_ASSET_SCORING'
    CHECK (principal_type='SYSTEM_ASSET_SCORING'),
  service_identity text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,service_identity),
  CHECK ((active AND deactivated_at IS NULL) OR
         (NOT active AND deactivated_at IS NOT NULL))
);
CREATE INDEX asset_scoring_principals_active
  ON identity.asset_scoring_principals(tenant_id,service_identity)
  WHERE active=true;

ALTER TABLE identity.role_bindings
  ADD CONSTRAINT asset_scoring_role_binding_scope_guard CHECK (
    principal_type <> 'SYSTEM_ASSET_SCORING'
    OR (scope_type NOT IN ('GLOBAL','TENANT') AND scope_id <> '*')
  );
