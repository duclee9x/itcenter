CREATE TABLE identity.automation_principals (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  principal_type text NOT NULL DEFAULT 'SYSTEM_AUTOMATION'
    CHECK (principal_type='SYSTEM_AUTOMATION'),
  service_identity text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_by uuid,
  deactivated_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,service_identity),
  CHECK ((active AND deactivated_at IS NULL AND deactivated_by IS NULL) OR
         (NOT active AND deactivated_at IS NOT NULL AND deactivated_by IS NOT NULL))
);

CREATE INDEX automation_principals_active
  ON identity.automation_principals(tenant_id,service_identity)
  WHERE active=true;

-- Role bindings remain the canonical grant mechanism. This partial index
-- prevents an Automation Principal from receiving wildcard/global grants.
ALTER TABLE identity.role_bindings
  ADD CONSTRAINT automation_role_binding_scope_guard CHECK (
    principal_type <> 'SYSTEM_AUTOMATION'
    OR (scope_type NOT IN ('GLOBAL','TENANT') AND scope_id <> '*')
  );
