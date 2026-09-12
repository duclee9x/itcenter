CREATE TABLE license.deployment_reservations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  entitlement_id uuid NOT NULL,
  deployment_target_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  state text NOT NULL DEFAULT 'RESERVED'
    CHECK (state IN ('RESERVED','ASSIGNED','RELEASED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, deployment_target_id),
  FOREIGN KEY (tenant_id, entitlement_id)
    REFERENCES license.license_entitlements(tenant_id, id)
);

CREATE TABLE license.assignments (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  entitlement_id uuid NOT NULL,
  reservation_id uuid,
  principal_type text NOT NULL CHECK (principal_type IN ('USER','ASSET')),
  principal_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  state text NOT NULL
    CHECK (state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING','RECLAIMED','EXPIRED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  reclaimed_at timestamptz,
  reclaim_verification_reference text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, entitlement_id)
    REFERENCES license.license_entitlements(tenant_id, id),
  FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES license.deployment_reservations(tenant_id, id),
  CHECK ((state='ACTIVE') = (activated_at IS NOT NULL) OR state IN ('SUSPENDED','RECLAIM_PENDING','RECLAIMED','EXPIRED'))
);

CREATE UNIQUE INDEX license_assignments_one_live_principal_idx
  ON license.assignments(tenant_id,entitlement_id,principal_type,principal_id)
  WHERE state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING');
CREATE UNIQUE INDEX license_assignments_reservation_idx
  ON license.assignments(tenant_id,reservation_id)
  WHERE reservation_id IS NOT NULL;
CREATE INDEX license_assignments_entitlement_state_idx
  ON license.assignments(tenant_id,entitlement_id,state);
CREATE INDEX license_assignments_principal_idx
  ON license.assignments(tenant_id,principal_type,principal_id,state);
CREATE INDEX license_reservations_capacity_idx
  ON license.deployment_reservations(tenant_id,entitlement_id,state);

CREATE TABLE license.assignment_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  assignment_id uuid NOT NULL,
  entity_version integer NOT NULL CHECK (entity_version > 0),
  action text NOT NULL
    CHECK (action IN ('ASSIGNED','ACTIVATED','SUSPENDED','RECLAIM_PENDING','RECLAIMED')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,assignment_id,entity_version),
  FOREIGN KEY (tenant_id,assignment_id)
    REFERENCES license.assignments(tenant_id,id)
);

CREATE TABLE license.reservation_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  reservation_id uuid NOT NULL,
  entity_version integer NOT NULL CHECK (entity_version > 0),
  action text NOT NULL CHECK (action IN ('RESERVED','RELEASED','ASSIGNED')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,reservation_id,entity_version),
  FOREIGN KEY (tenant_id,reservation_id)
    REFERENCES license.deployment_reservations(tenant_id,id)
);

CREATE TABLE license.usage_observations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  entitlement_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('PROVIDER_SYNC','MANUAL_ATTESTATION')),
  active_usage integer NOT NULL CHECK (active_usage >= 0),
  observed_at timestamptz NOT NULL,
  inactivity_threshold_days integer CHECK (inactivity_threshold_days IS NULL OR inactivity_threshold_days BETWEEN 1 AND 3650),
  evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 256),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,entitlement_id)
    REFERENCES license.license_entitlements(tenant_id,id)
);
CREATE INDEX license_usage_latest_idx
  ON license.usage_observations(tenant_id,entitlement_id,observed_at DESC);

CREATE TABLE license.compliance_facts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  entitlement_id uuid NOT NULL,
  compliance_state text NOT NULL CHECK (compliance_state IN ('OVERUSED','UNDERUSED')),
  evidence_key text NOT NULL CHECK (length(btrim(evidence_key)) BETWEEN 1 AND 256),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,entitlement_id,compliance_state,evidence_key),
  FOREIGN KEY (tenant_id,entitlement_id)
    REFERENCES license.license_entitlements(tenant_id,id)
);

CREATE TRIGGER assignment_history_append_only
  BEFORE UPDATE OR DELETE ON license.assignment_history
  FOR EACH ROW EXECUTE FUNCTION license.reject_entitlement_history_mutation();
CREATE TRIGGER reservation_history_append_only
  BEFORE UPDATE OR DELETE ON license.reservation_history
  FOR EACH ROW EXECUTE FUNCTION license.reject_entitlement_history_mutation();
CREATE TRIGGER usage_observations_append_only
  BEFORE UPDATE OR DELETE ON license.usage_observations
  FOR EACH ROW EXECUTE FUNCTION license.reject_entitlement_history_mutation();
CREATE TRIGGER compliance_facts_append_only
  BEFORE UPDATE OR DELETE ON license.compliance_facts
  FOR EACH ROW EXECUTE FUNCTION license.reject_entitlement_history_mutation();
