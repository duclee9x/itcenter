ALTER TABLE agent.agents
  ADD COLUMN registration_status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN registration_provenance text NOT NULL DEFAULT 'LEGACY_CANONICAL_AGENT_ROW',
  ADD COLUMN registration_version integer NOT NULL DEFAULT 1,
  ADD COLUMN provisioned_by text,
  ADD COLUMN disabled_at timestamptz,
  ADD COLUMN retired_at timestamptz,
  ADD CONSTRAINT agent_registration_status_check
    CHECK (registration_status IN ('ACTIVE','DISABLED','RETIRED')),
  ADD CONSTRAINT agent_registration_version_check CHECK (registration_version > 0);
ALTER TABLE agent.agents ALTER COLUMN agent_version DROP NOT NULL;

ALTER TABLE agent.agents
  DROP CONSTRAINT IF EXISTS agents_tenant_id_asset_id_key;
CREATE UNIQUE INDEX agent_one_active_registration_per_asset
  ON agent.agents(tenant_id,asset_id)
  WHERE registration_status='ACTIVE';

CREATE TABLE agent.agent_credentials (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  agent_id uuid NOT NULL,
  serial_number text NOT NULL,
  fingerprint_sha256 text NOT NULL,
  spki_sha256 text NOT NULL,
  issuer_fingerprint_sha256 text NOT NULL,
  certificate_pem text NOT NULL,
  not_before timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  revoked_at timestamptz,
  revocation_reason text,
  replaced_by uuid,
  overlap_until timestamptz,
  provenance text NOT NULL,
  entity_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,agent_id,id),
  UNIQUE (issuer_fingerprint_sha256,serial_number),
  UNIQUE (fingerprint_sha256),
  FOREIGN KEY (tenant_id,agent_id) REFERENCES agent.agents(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,replaced_by) REFERENCES agent.agent_credentials(tenant_id,id) ON DELETE RESTRICT,
  CHECK (status IN ('ACTIVE','REVOKED','EXPIRED','REPLACED')),
  CHECK (length(serial_number) BETWEEN 1 AND 80),
  CHECK (fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (spki_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (issuer_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > not_before),
  CHECK (entity_version > 0),
  CHECK ((status='REVOKED') = (revoked_at IS NOT NULL)),
  CHECK ((status='REVOKED') = (revocation_reason IS NOT NULL)),
  CHECK (status <> 'REPLACED' OR replaced_by IS NOT NULL),
  CHECK (overlap_until IS NULL OR status='ACTIVE'),
  CHECK (expires_at <= issued_at + interval '30 days')
);
CREATE INDEX agent_credentials_by_registration
  ON agent.agent_credentials(tenant_id,agent_id,status,expires_at);
CREATE TABLE agent.enrollment_tokens (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  agent_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  verifier_sha256 text NOT NULL UNIQUE,
  idempotency_key text NOT NULL,
  request_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'ISSUED',
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  issued_by text NOT NULL,
  reason text NOT NULL,
  entity_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,agent_id,idempotency_key),
  FOREIGN KEY (tenant_id,agent_id) REFERENCES agent.agents(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id) ON DELETE RESTRICT,
  CHECK (verifier_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '10 minutes'),
  CHECK (entity_version > 0),
  CHECK (status IN ('ISSUED','CONSUMED','REVOKED')),
  CHECK ((status='CONSUMED') = (consumed_at IS NOT NULL)),
  CHECK ((status='REVOKED') = (revoked_at IS NOT NULL))
);
CREATE INDEX enrollment_tokens_by_registration
  ON agent.enrollment_tokens(tenant_id,agent_id,status,expires_at);

CREATE TABLE agent.certificate_issuance_attempts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  agent_id uuid NOT NULL,
  enrollment_token_id uuid,
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  request_sha256 text NOT NULL,
  csr_sha256 text NOT NULL,
  csr_pem text NOT NULL,
  serial_number text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  credential_id uuid,
  certificate_pem text,
  lease_until timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id,agent_id,operation_type,idempotency_key),
  FOREIGN KEY (tenant_id,agent_id) REFERENCES agent.agents(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,enrollment_token_id) REFERENCES agent.enrollment_tokens(tenant_id,id) ON DELETE RESTRICT,
  CHECK (operation_type IN ('ENROLL','ROTATE')),
  CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (csr_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (serial_number ~ '^[0-9a-f]{1,40}$'),
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '30 days'),
  CHECK (state IN ('PENDING','ISSUING','ISSUED','FAILED')),
  CHECK ((state='ISSUED') = (credential_id IS NOT NULL AND certificate_pem IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX certificate_issuance_pending
  ON agent.certificate_issuance_attempts(state,created_at)
  WHERE state IN ('PENDING','ISSUING');

CREATE TABLE agent.agent_sessions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  agent_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  established_at timestamptz NOT NULL,
  ended_at timestamptz,
  UNIQUE (tenant_id,agent_id,id),
  FOREIGN KEY (tenant_id,agent_id) REFERENCES agent.agents(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,credential_id) REFERENCES agent.agent_credentials(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,agent_id,credential_id) REFERENCES agent.agent_credentials(tenant_id,agent_id,id) ON DELETE RESTRICT
);
CREATE INDEX agent_sessions_current
  ON agent.agent_sessions(tenant_id,agent_id,ended_at,established_at DESC);

ALTER TABLE agent.automation_action_receipts
  ADD COLUMN agent_transport_session_id uuid,
  ADD CONSTRAINT automation_receipt_transport_session_fk
    FOREIGN KEY (tenant_id,agent_id,agent_transport_session_id)
    REFERENCES agent.agent_sessions(tenant_id,agent_id,id) ON DELETE RESTRICT;
CREATE INDEX automation_receipts_by_transport_session
  ON agent.automation_action_receipts(tenant_id,agent_id,agent_transport_session_id,state);

CREATE TABLE agent.agent_message_receipts (
  tenant_id text NOT NULL,
  agent_id uuid NOT NULL,
  agent_session_id uuid NOT NULL,
  message_id text NOT NULL,
  execution_attempt_id uuid,
  request_sha256 text NOT NULL,
  state text NOT NULL DEFAULT 'PROCESSING',
  response_status integer,
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id,agent_id,agent_session_id,message_id),
  FOREIGN KEY (tenant_id,agent_id) REFERENCES agent.agents(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,agent_id,agent_session_id) REFERENCES agent.agent_sessions(tenant_id,agent_id,id) ON DELETE RESTRICT,
  CHECK (length(message_id) BETWEEN 1 AND 200),
  CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (state IN ('PROCESSING','COMPLETED','FAILED')),
  CHECK (jsonb_typeof(response_json)='object' OR response_json IS NULL),
  CHECK ((state='COMPLETED') = (response_status IS NOT NULL AND response_json IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX agent_message_receipts_by_attempt
  ON agent.agent_message_receipts(tenant_id,execution_attempt_id)
  WHERE execution_attempt_id IS NOT NULL;

INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
 ('a0020001-0000-4000-8000-000000000001','agent.registration.manage','agent_registration','manage'),
 ('a0020001-0000-4000-8000-000000000002','agent.enrollment_token.issue','agent_enrollment_token','issue'),
 ('a0020001-0000-4000-8000-000000000003','agent.credential.revoke','agent_credential','revoke'),
 ('a0020001-0000-4000-8000-000000000004','agent.credential.force_rotate','agent_credential','force_rotate')
ON CONFLICT(code) DO NOTHING;
