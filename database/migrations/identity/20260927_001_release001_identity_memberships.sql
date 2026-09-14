CREATE TABLE identity.identity_links (
  id uuid PRIMARY KEY,
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  principal_type text NOT NULL CHECK (principal_type IN ('HUMAN','SERVICE')),
  identity_class text NOT NULL DEFAULT 'STANDARD' CHECK (identity_class IN ('STANDARD','EMERGENCY')),
  subject text,
  client_id text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  provenance text NOT NULL CHECK (length(provenance) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (id,principal_type),
  CHECK (
    (principal_type='HUMAN' AND subject IS NOT NULL AND length(subject)>0 AND client_id IS NULL)
    OR
    (principal_type='SERVICE' AND client_id IS NOT NULL AND length(client_id)>0 AND subject IS NULL)
  ),
  CHECK (identity_class='STANDARD' OR principal_type='HUMAN')
);
CREATE UNIQUE INDEX identity_links_human_subject
  ON identity.identity_links(issuer,subject)
  WHERE principal_type='HUMAN';
CREATE UNIQUE INDEX identity_links_service_client
  ON identity.identity_links(issuer,client_id)
  WHERE principal_type='SERVICE';

CREATE TABLE identity.tenant_memberships (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  identity_link_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('HUMAN','SERVICE')),
  local_user_id uuid,
  system_principal_type text,
  system_principal_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by text NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  provenance text NOT NULL CHECK (length(provenance) BETWEEN 1 AND 128),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (identity_link_id,principal_type) REFERENCES identity.identity_links(id,principal_type),
  FOREIGN KEY (tenant_id,local_user_id) REFERENCES identity.users(tenant_id,id),
  CHECK (
    (principal_type='HUMAN' AND local_user_id IS NOT NULL AND system_principal_type IS NULL AND system_principal_id IS NULL)
    OR
    (principal_type='SERVICE' AND local_user_id IS NULL AND system_principal_type IN ('SYSTEM_AUTOMATION','SYSTEM_CORRELATION','SYSTEM_ASSET_SCORING','SYSTEM_RECOMMENDATION','SYSTEM_REPORTING') AND system_principal_id IS NOT NULL)
  ),
  CHECK ((status='ACTIVE' AND revoked_at IS NULL AND revoked_by IS NULL) OR (status='REVOKED' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE UNIQUE INDEX tenant_memberships_active_identity
  ON identity.tenant_memberships(identity_link_id,tenant_id)
  WHERE status='ACTIVE';
CREATE INDEX tenant_memberships_active_principal
  ON identity.tenant_memberships(tenant_id,local_user_id)
  WHERE status='ACTIVE' AND principal_type='HUMAN';
CREATE INDEX tenant_memberships_active_service
  ON identity.tenant_memberships(tenant_id,system_principal_type,system_principal_id)
  WHERE status='ACTIVE' AND principal_type='SERVICE';

CREATE TABLE identity.initial_admin_bootstrap (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  identity_link_id uuid NOT NULL REFERENCES identity.identity_links(id),
  tenant_id text NOT NULL,
  tenant_membership_id uuid NOT NULL,
  local_user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  completed_by text NOT NULL,
  FOREIGN KEY (tenant_id,tenant_membership_id) REFERENCES identity.tenant_memberships(tenant_id,id),
  FOREIGN KEY (tenant_id,local_user_id) REFERENCES identity.users(tenant_id,id),
  FOREIGN KEY (tenant_id,role_id) REFERENCES identity.roles(tenant_id,id)
);

INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
  ('e0010001-0000-4000-8000-000000000001','identity.external_identity.manage','external_identity','manage'),
  ('e0010001-0000-4000-8000-000000000002','identity.tenant_membership.manage','tenant_membership','manage'),
  ('e0010001-0000-4000-8000-000000000003','identity.emergency_identity.manage','emergency_identity','manage')
ON CONFLICT (code) DO UPDATE SET resource_type=EXCLUDED.resource_type,action=EXCLUDED.action;
