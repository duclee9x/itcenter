CREATE TABLE software.deployments (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  product_id uuid NOT NULL,
  software_version_id uuid NOT NULL,
  artifact_version_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','ACTIVE','PAUSED','STOPPED','COMPLETED')),
  rollout_stage_percent integer NOT NULL DEFAULT 1
    CHECK (rollout_stage_percent IN (1,10,25,50,100)),
  failure_threshold_percent integer NOT NULL
    CHECK (failure_threshold_percent BETWEEN 1 AND 100),
  max_attempts integer NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 3),
  stop_on_security_failure boolean NOT NULL DEFAULT true,
  change_id uuid,
  reason text NOT NULL,
  created_by text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id)
    REFERENCES software.software_products(tenant_id, id),
  FOREIGN KEY (tenant_id, software_version_id)
    REFERENCES software.software_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, artifact_version_id)
    REFERENCES artifact.artifact_versions(tenant_id, id)
);

CREATE TABLE software.deployment_targets (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  campaign_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  cohort_order integer NOT NULL CHECK (cohort_order > 0),
  state text NOT NULL DEFAULT 'HELD'
    CHECK (state IN ('HELD','QUEUED','CLAIMED','WAITING_REBOOT','SUCCESS','FAILED','CANCELLED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  assigned_agent_id uuid,
  lease_id uuid,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  last_error_code text,
  security_failure boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campaign_id, asset_id),
  UNIQUE (tenant_id, campaign_id, cohort_order),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES software.deployments(tenant_id, id),
  FOREIGN KEY (tenant_id, asset_id)
    REFERENCES asset.assets(tenant_id, id),
  CHECK ((state = 'CLAIMED') = (lease_id IS NOT NULL AND lease_started_at IS NOT NULL AND lease_expires_at IS NOT NULL AND assigned_agent_id IS NOT NULL)),
  CHECK (state = 'CLAIMED' OR assigned_agent_id IS NULL)
);

CREATE TABLE software.deployment_attempts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  target_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  agent_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  outcome text NOT NULL
    CHECK (outcome IN ('PRECHECK_FAILED','ARTIFACT_REJECTED','INSTALL_FAILED','WAITING_REBOOT','VERIFICATION_FAILED','SUCCESS')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  retryable boolean NOT NULL DEFAULT false,
  precheck_passed boolean NOT NULL DEFAULT false,
  installer_exit_code integer,
  checksum_verified boolean NOT NULL DEFAULT false,
  signature_verified boolean NOT NULL DEFAULT false,
  observed_product text,
  observed_version text,
  reboot_required boolean NOT NULL DEFAULT false,
  error_code text,
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, target_id, attempt_number),
  FOREIGN KEY (tenant_id, target_id)
    REFERENCES software.deployment_targets(tenant_id, id)
);

CREATE TABLE software.software_installations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  asset_id uuid NOT NULL,
  product_id uuid NOT NULL,
  software_version_id uuid NOT NULL,
  source_target_id uuid NOT NULL,
  verified_by_agent_id uuid NOT NULL,
  artifact_checksum_sha256 text NOT NULL CHECK (artifact_checksum_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'INSTALLED' CHECK (state IN ('INSTALLED','REMOVED')),
  installed_at timestamptz NOT NULL,
  last_verified_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, asset_id, product_id, software_version_id),
  FOREIGN KEY (tenant_id, asset_id)
    REFERENCES asset.assets(tenant_id, id),
  FOREIGN KEY (tenant_id, product_id)
    REFERENCES software.software_products(tenant_id, id),
  FOREIGN KEY (tenant_id, software_version_id)
    REFERENCES software.software_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, source_target_id)
    REFERENCES software.deployment_targets(tenant_id, id)
);

CREATE INDEX deployments_tenant_state_idx
  ON software.deployments(tenant_id, state, created_at DESC);
CREATE INDEX deployment_targets_dispatch_idx
  ON software.deployment_targets(tenant_id, state, updated_at)
  WHERE state IN ('QUEUED','WAITING_REBOOT');
CREATE INDEX deployment_targets_campaign_state_idx
  ON software.deployment_targets(tenant_id, campaign_id, state);
CREATE INDEX deployment_attempts_target_idx
  ON software.deployment_attempts(tenant_id, target_id, attempt_number DESC);
CREATE INDEX software_installations_asset_idx
  ON software.software_installations(tenant_id, asset_id, state);

CREATE FUNCTION software.reject_deployment_attempt_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'software deployment attempt evidence is append-only';
END;
$$;
CREATE TRIGGER deployment_attempts_append_only
  BEFORE UPDATE OR DELETE ON software.deployment_attempts
  FOR EACH ROW EXECUTE FUNCTION software.reject_deployment_attempt_mutation();
