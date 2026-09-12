CREATE SCHEMA IF NOT EXISTS contract;

CREATE TABLE contract.contracts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  contract_code text NOT NULL,
  supplier_id uuid NOT NULL,
  supplier_display_snapshot text NOT NULL,
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('DRAFT','PENDING_SIGNATURE','EXECUTED','ACTIVE','EXPIRED','TERMINATED','CANCELLED')),
  usage_status text NOT NULL DEFAULT 'ENABLED' CHECK (usage_status IN ('ENABLED','ON_HOLD')),
  effective_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  current_version_id uuid,
  current_version_number integer NOT NULL DEFAULT 1 CHECK (current_version_number > 0),
  submitted_version_id uuid,
  renewed_from_contract_id uuid,
  auto_renew_clause jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,contract_code),
  FOREIGN KEY (tenant_id,renewed_from_contract_id) REFERENCES contract.contracts(tenant_id,id) ON DELETE RESTRICT,
  CHECK (effective_at < end_at)
);

CREATE TABLE contract.contract_versions (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, contract_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  commercial_snapshot jsonb NOT NULL CHECK (jsonb_typeof(commercial_snapshot)='object'),
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  source text NOT NULL CHECK (source IN ('CREATE','DRAFT_UPDATE','AMENDMENT','RENEWAL')),
  reason text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  evidence_document_id uuid, evidence_document_version_id uuid,
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,contract_id,id), UNIQUE (tenant_id,contract_id,version_number),
  FOREIGN KEY (tenant_id,contract_id) REFERENCES contract.contracts(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE contract.contracts ADD CONSTRAINT contracts_current_version_fk FOREIGN KEY (tenant_id,current_version_id) REFERENCES contract.contract_versions(tenant_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE contract.contracts ADD CONSTRAINT contracts_submitted_version_fk FOREIGN KEY (tenant_id,submitted_version_id) REFERENCES contract.contract_versions(tenant_id,id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE contract.execution_evidence (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, contract_id uuid NOT NULL,
  contract_version_id uuid NOT NULL, evidence_type text NOT NULL CHECK (evidence_type IN ('FINAL_DOCUMENT','EXTERNAL_REFERENCE')),
  document_id uuid, document_version_id uuid, external_reference text,
  recorded_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,contract_id) REFERENCES contract.contracts(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,contract_id,contract_version_id) REFERENCES contract.contract_versions(tenant_id,contract_id,id) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((evidence_type='FINAL_DOCUMENT' AND document_id IS NOT NULL AND document_version_id IS NOT NULL AND external_reference IS NULL) OR (evidence_type='EXTERNAL_REFERENCE' AND external_reference IS NOT NULL AND document_id IS NULL AND document_version_id IS NULL))
);

CREATE TABLE contract.renewal_cases (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, predecessor_contract_id uuid NOT NULL,
  successor_contract_id uuid, lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('OPEN','COMPLETED','NOT_RENEWED','CANCELLED')),
  proposal_snapshot jsonb NOT NULL CHECK (jsonb_typeof(proposal_snapshot)='object'),
  proposal_fingerprint char(64) NOT NULL CHECK (proposal_fingerprint ~ '^[0-9a-f]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_by text NOT NULL,
  reason text, correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,successor_contract_id),
  FOREIGN KEY (tenant_id,predecessor_contract_id) REFERENCES contract.contracts(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,successor_contract_id) REFERENCES contract.contracts(tenant_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX renewal_one_open_per_predecessor ON contract.renewal_cases(tenant_id,predecessor_contract_id) WHERE lifecycle_state='OPEN';
CREATE INDEX contracts_tenant_state_idx ON contract.contracts(tenant_id,lifecycle_state,end_at);

CREATE TABLE contract.history (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, contract_id uuid NOT NULL, event_type text NOT NULL,
  before_state jsonb, after_state jsonb NOT NULL, actor_id text NOT NULL, reason text,
  correlation_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,contract_id) REFERENCES contract.contracts(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE contract.amendment_changes (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, contract_id uuid NOT NULL,
  base_version integer NOT NULL, amended_version integer NOT NULL,
  changed_fields jsonb NOT NULL CHECK (jsonb_typeof(changed_fields)='array'),
  proposal_fingerprint char(64) NOT NULL CHECK (proposal_fingerprint ~ '^[0-9a-f]{64}$'),
  reason text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,contract_id) REFERENCES contract.contracts(tenant_id,id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,contract_id,amended_version)
);
CREATE TABLE contract.renewal_history (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, renewal_case_id uuid NOT NULL, event_type text NOT NULL,
  before_state jsonb, after_state jsonb NOT NULL, actor_id text NOT NULL, reason text,
  correlation_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,renewal_case_id) REFERENCES contract.renewal_cases(tenant_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION contract.reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only history'; END $$;
CREATE TRIGGER contract_history_append_only BEFORE UPDATE OR DELETE ON contract.history FOR EACH ROW EXECUTE FUNCTION contract.reject_history_mutation();
CREATE TRIGGER renewal_history_append_only BEFORE UPDATE OR DELETE ON contract.renewal_history FOR EACH ROW EXECUTE FUNCTION contract.reject_history_mutation();
CREATE FUNCTION contract.reject_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable contract version'; END $$;
CREATE TRIGGER contract_versions_immutable BEFORE UPDATE OR DELETE ON contract.contract_versions FOR EACH ROW EXECUTE FUNCTION contract.reject_version_mutation();
