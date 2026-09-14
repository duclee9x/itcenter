CREATE TABLE identity.recommendation_principals (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  principal_type text NOT NULL DEFAULT 'SYSTEM_RECOMMENDATION'
    CHECK (principal_type='SYSTEM_RECOMMENDATION'),
  service_identity text NOT NULL CHECK (service_identity='recommendation'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,service_identity),
  CHECK ((active AND deactivated_at IS NULL) OR
         (NOT active AND deactivated_at IS NOT NULL))
);
CREATE INDEX recommendation_principals_active
  ON identity.recommendation_principals(tenant_id,service_identity)
  WHERE active=true;

ALTER TABLE identity.role_bindings
  ADD CONSTRAINT recommendation_role_binding_scope_guard CHECK (
    principal_type <> 'SYSTEM_RECOMMENDATION'
    OR (scope_type <> 'GLOBAL' AND scope_id <> '*'
        AND (scope_type <> 'TENANT' OR scope_id=tenant_id))
  );

INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
  ('a0960000-0000-4000-8000-000000000001','recommendation.read','recommendation','read'),
  ('a0960000-0000-4000-8000-000000000002','recommendation.interact','recommendation','interact'),
  ('a0960000-0000-4000-8000-000000000003','recommendation.projection.reconcile','recommendation_projection','reconcile')
ON CONFLICT(code) DO UPDATE SET resource_type=EXCLUDED.resource_type,action=EXCLUDED.action;
