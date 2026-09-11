CREATE TABLE identity.sessions (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, user_id uuid NOT NULL,
 auth_method text NOT NULL CHECK (auth_method IN ('OIDC','SAML','LDAP')),
 created_at timestamptz NOT NULL, last_activity timestamptz NOT NULL,
 idle_expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL,
 revoked_at timestamptz, source_ip inet, device_context jsonb NOT NULL DEFAULT '{}'::jsonb,
 risk text NOT NULL DEFAULT 'NORMAL', version integer NOT NULL DEFAULT 1 CHECK(version>0),
 FOREIGN KEY (tenant_id,user_id) REFERENCES identity.users(tenant_id,id),
 CHECK(idle_expires_at > created_at), CHECK(absolute_expires_at >= idle_expires_at), UNIQUE(tenant_id,id)
);
CREATE INDEX sessions_active ON identity.sessions(tenant_id,user_id,idle_expires_at) WHERE revoked_at IS NULL;
