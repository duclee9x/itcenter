CREATE TABLE identity.temporary_grants (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, principal_id uuid NOT NULL,
 permission_id uuid NOT NULL REFERENCES identity.permissions(id), scope_type text NOT NULL, scope_id text NOT NULL,
 valid_from timestamptz NOT NULL, valid_until timestamptz NOT NULL, reason text NOT NULL,
 UNIQUE (tenant_id,id), CHECK (valid_until > valid_from),
 FOREIGN KEY (tenant_id,principal_id) REFERENCES identity.users(tenant_id,id)
);
CREATE INDEX temporary_grants_active ON identity.temporary_grants(tenant_id,principal_id,valid_until);
