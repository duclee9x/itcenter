CREATE TABLE identity.correlation_principals (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  principal_type text NOT NULL DEFAULT 'SYSTEM_CORRELATION'
    CHECK (principal_type='SYSTEM_CORRELATION'),
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

CREATE INDEX correlation_principals_active
  ON identity.correlation_principals(tenant_id,service_identity)
  WHERE active=true;

ALTER TABLE identity.role_bindings
  ADD CONSTRAINT correlation_role_binding_scope_guard CHECK (
    principal_type <> 'SYSTEM_CORRELATION'
    OR (scope_type <> 'GLOBAL' AND scope_id <> '*'
        AND (scope_type <> 'TENANT' OR scope_id=tenant_id))
  );
