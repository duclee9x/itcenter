CREATE SCHEMA identity;
CREATE TABLE identity.users (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, display_code text NOT NULL,
 username text NOT NULL, primary_email text, display_name text NOT NULL,
 employment_status text NOT NULL CHECK (employment_status IN ('PRE_HIRE','ACTIVE','SUSPENDED','LEAVE','TERMINATING','TERMINATED','ARCHIVED')), manager_user_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 UNIQUE (tenant_id,id), UNIQUE (tenant_id,display_code),
 FOREIGN KEY (tenant_id,manager_user_id) REFERENCES identity.users(tenant_id,id)
);
CREATE INDEX users_email ON identity.users(tenant_id,primary_email);
CREATE TABLE identity.external_identities (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, user_id uuid NOT NULL,
 provider_id text NOT NULL, provider_type text NOT NULL, external_subject text NOT NULL,
 external_tenant text, username text, email text, last_synced_at timestamptz, is_authoritative boolean NOT NULL DEFAULT false,
 UNIQUE (provider_id,external_subject),
 FOREIGN KEY (tenant_id,user_id) REFERENCES identity.users(tenant_id,id)
);
CREATE TABLE identity.roles (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, code text NOT NULL, name text NOT NULL,
 type text NOT NULL, description text, status text NOT NULL,
 UNIQUE (tenant_id,id), UNIQUE (tenant_id,code)
);
CREATE TABLE identity.permissions (
 id uuid PRIMARY KEY, code text NOT NULL UNIQUE, resource_type text NOT NULL, action text NOT NULL
);
CREATE TABLE identity.role_permissions (
 tenant_id text NOT NULL, role_id uuid NOT NULL, permission_id uuid NOT NULL REFERENCES identity.permissions(id),
 PRIMARY KEY (tenant_id,role_id,permission_id), FOREIGN KEY (tenant_id,role_id) REFERENCES identity.roles(tenant_id,id)
);
CREATE TABLE identity.role_bindings (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, principal_type text NOT NULL, principal_id uuid NOT NULL,
 role_id uuid NOT NULL, scope_type text NOT NULL, scope_id text NOT NULL, source text NOT NULL,
 valid_from timestamptz NOT NULL, valid_until timestamptz, reason text NOT NULL, created_by uuid NOT NULL,
 FOREIGN KEY (tenant_id,role_id) REFERENCES identity.roles(tenant_id,id), CHECK (valid_until IS NULL OR valid_until > valid_from)
);
