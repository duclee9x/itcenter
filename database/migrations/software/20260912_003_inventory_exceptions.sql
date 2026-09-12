CREATE TABLE software.inventory_reports (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  agent_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  observed_at timestamptz NOT NULL,
  inventory_complete boolean NOT NULL,
  item_count integer NOT NULL CHECK (item_count BETWEEN 0 AND 10000),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (agent_id) REFERENCES agent.agents(id),
  FOREIGN KEY (tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id)
);

CREATE TABLE software.product_aliases (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  product_id uuid NOT NULL,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  created_by text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,normalized_alias),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,product_id)
    REFERENCES software.software_products(tenant_id,id)
);

CREATE TABLE software.inventory_installations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  asset_id uuid NOT NULL,
  product_id uuid,
  normalized_key text NOT NULL,
  normalized_name text NOT NULL,
  publisher text NOT NULL DEFAULT '',
  version_label text NOT NULL DEFAULT '',
  installed_at timestamptz,
  install_scope text NOT NULL,
  package_identifier text NOT NULL DEFAULT '',
  detection_generation integer NOT NULL DEFAULT 1 CHECK (detection_generation > 0),
  classification text NOT NULL
    CHECK (classification IN ('APPROVED','RESTRICTED','PROHIBITED','UNKNOWN','DEPRECATED','RETIRED')),
  state text NOT NULL DEFAULT 'PRESENT'
    CHECK (state IN ('PRESENT','REMOVED')),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  last_report_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,asset_id,normalized_key),
  FOREIGN KEY (tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id),
  FOREIGN KEY (tenant_id,product_id) REFERENCES software.software_products(tenant_id,id),
  FOREIGN KEY (tenant_id,last_report_id) REFERENCES software.inventory_reports(tenant_id,id)
);

CREATE TABLE software.inventory_observations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  report_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  observed_name text NOT NULL,
  observed_version text NOT NULL DEFAULT '',
  classification text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,report_id,installation_id),
  FOREIGN KEY (tenant_id,report_id) REFERENCES software.inventory_reports(tenant_id,id),
  FOREIGN KEY (tenant_id,installation_id) REFERENCES software.inventory_installations(tenant_id,id)
);

CREATE TABLE software.software_exceptions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  installation_id uuid NOT NULL,
  installation_generation integer NOT NULL CHECK (installation_generation > 0),
  state text NOT NULL DEFAULT 'OPEN'
    CHECK (state IN ('OPEN','WAITING_APPROVAL','APPROVED_TEMPORARY','REMOVAL_PENDING','RESOLVED','FALSE_POSITIVE')),
  owner_id text NOT NULL,
  reason text NOT NULL,
  risk text NOT NULL CHECK (risk IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  approval_request_id uuid REFERENCES control.approval_requests(id),
  approved_until timestamptz,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,installation_id)
    REFERENCES software.inventory_installations(tenant_id,id),
  CHECK ((state='APPROVED_TEMPORARY') = (approved_until IS NOT NULL)),
  CHECK (approved_until IS NULL OR approval_request_id IS NOT NULL)
);
CREATE UNIQUE INDEX software_active_exception_installation_uq
  ON software.software_exceptions(tenant_id,installation_id,installation_generation)
  WHERE state NOT IN ('RESOLVED','FALSE_POSITIVE');

CREATE TABLE software.software_exception_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  exception_id uuid NOT NULL,
  from_state text,
  to_state text NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,exception_id,version),
  FOREIGN KEY (tenant_id,exception_id)
    REFERENCES software.software_exceptions(tenant_id,id)
);

CREATE TABLE software.uninstall_profiles (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  product_id uuid NOT NULL,
  symbolic_method text NOT NULL
    CHECK (symbolic_method IN ('MSI_PRODUCT_CODE','PACKAGE_IDENTIFIER','MANAGED_PACKAGE')),
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','APPROVED','REVOKED')),
  auto_removal_allowed boolean NOT NULL DEFAULT false,
  no_business_dependency_attested boolean NOT NULL DEFAULT false,
  approval_request_id uuid REFERENCES control.approval_requests(id),
  owner_id text NOT NULL,
  reason text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,product_id),
  FOREIGN KEY (tenant_id,product_id)
    REFERENCES software.software_products(tenant_id,id),
  CHECK (state <> 'APPROVED' OR approval_request_id IS NOT NULL),
  CHECK (NOT auto_removal_allowed OR no_business_dependency_attested)
);

CREATE TABLE software.removal_jobs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  exception_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  uninstall_profile_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'QUEUED'
    CHECK (state IN ('QUEUED','CLAIMED','SUCCEEDED','FAILED','CANCELLED')),
  lease_id uuid,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,exception_id),
  FOREIGN KEY (tenant_id,exception_id) REFERENCES software.software_exceptions(tenant_id,id),
  FOREIGN KEY (tenant_id,installation_id) REFERENCES software.inventory_installations(tenant_id,id),
  FOREIGN KEY (tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id),
  FOREIGN KEY (agent_id) REFERENCES agent.agents(id),
  FOREIGN KEY (tenant_id,uninstall_profile_id) REFERENCES software.uninstall_profiles(tenant_id,id),
  CHECK ((state='CLAIMED') = (lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state='CLAIMED' OR lease_id IS NULL)
);

CREATE TABLE software.removal_attempts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  job_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  lease_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('CLAIMED','REMOVAL_REPORTED','FAILED','STALE')),
  retryable boolean NOT NULL DEFAULT false,
  error_code text,
  summary text NOT NULL DEFAULT '' CHECK (length(summary)<=500),
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,job_id) REFERENCES software.removal_jobs(tenant_id,id)
);
CREATE INDEX software_removal_attempt_job_idx
  ON software.removal_attempts(tenant_id,job_id,attempt_number,created_at);

CREATE FUNCTION software.reject_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'software inventory and exception evidence is append-only';
END;
$$;
CREATE TRIGGER inventory_reports_append_only
  BEFORE UPDATE OR DELETE ON software.inventory_reports
  FOR EACH ROW EXECUTE FUNCTION software.reject_evidence_mutation();
CREATE TRIGGER inventory_observations_append_only
  BEFORE UPDATE OR DELETE ON software.inventory_observations
  FOR EACH ROW EXECUTE FUNCTION software.reject_evidence_mutation();
CREATE TRIGGER software_exception_history_append_only
  BEFORE UPDATE OR DELETE ON software.software_exception_history
  FOR EACH ROW EXECUTE FUNCTION software.reject_evidence_mutation();
CREATE TRIGGER removal_attempts_append_only
  BEFORE UPDATE OR DELETE ON software.removal_attempts
  FOR EACH ROW EXECUTE FUNCTION software.reject_evidence_mutation();
CREATE TRIGGER product_aliases_immutable
  BEFORE UPDATE OR DELETE ON software.product_aliases
  FOR EACH ROW EXECUTE FUNCTION software.reject_evidence_mutation();
CREATE TRIGGER inventory_reports_no_truncate
  BEFORE TRUNCATE ON software.inventory_reports
  FOR EACH STATEMENT EXECUTE FUNCTION software.reject_evidence_mutation();
CREATE TRIGGER inventory_observations_no_truncate
  BEFORE TRUNCATE ON software.inventory_observations
  FOR EACH STATEMENT EXECUTE FUNCTION software.reject_evidence_mutation();
CREATE TRIGGER software_exception_history_no_truncate
  BEFORE TRUNCATE ON software.software_exception_history
  FOR EACH STATEMENT EXECUTE FUNCTION software.reject_evidence_mutation();
CREATE TRIGGER removal_attempts_no_truncate
  BEFORE TRUNCATE ON software.removal_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION software.reject_evidence_mutation();
CREATE TRIGGER product_aliases_no_truncate
  BEFORE TRUNCATE ON software.product_aliases
  FOR EACH STATEMENT EXECUTE FUNCTION software.reject_evidence_mutation();

CREATE FUNCTION software.guard_exception_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state IN ('RESOLVED','FALSE_POSITIVE') THEN
    RAISE EXCEPTION 'terminal software exception records are immutable';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
    OR NEW.installation_generation IS DISTINCT FROM OLD.installation_generation
    OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'software exception identity is immutable and version must advance once';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
    (OLD.state='OPEN' AND NEW.state IN ('WAITING_APPROVAL','REMOVAL_PENDING','FALSE_POSITIVE','RESOLVED'))
    OR (OLD.state='WAITING_APPROVAL' AND NEW.state IN ('OPEN','APPROVED_TEMPORARY','REMOVAL_PENDING','FALSE_POSITIVE','RESOLVED'))
    OR (OLD.state='APPROVED_TEMPORARY' AND NEW.state IN ('OPEN','RESOLVED'))
    OR (OLD.state='REMOVAL_PENDING' AND NEW.state IN ('OPEN','RESOLVED'))
  ) THEN
    RAISE EXCEPTION 'invalid software exception state transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER software_exception_transition_guard
  BEFORE UPDATE ON software.software_exceptions
  FOR EACH ROW EXECUTE FUNCTION software.guard_exception_transition();

CREATE INDEX software_inventory_asset_idx
  ON software.inventory_installations(tenant_id,asset_id,state,last_seen_at DESC);
CREATE INDEX software_exception_queue_idx
  ON software.software_exceptions(tenant_id,state,last_detected_at DESC);
CREATE INDEX software_removal_dispatch_idx
  ON software.removal_jobs(tenant_id,state,created_at)
  WHERE state IN ('QUEUED','CLAIMED');
