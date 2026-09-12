ALTER TABLE identity.role_bindings
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE TABLE identity.user_lifecycle_history (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, user_id uuid NOT NULL,
  from_state text NOT NULL, to_state text NOT NULL, actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  correlation_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,user_id) REFERENCES identity.users(tenant_id,id)
);
CREATE TABLE identity.offboarding_cases (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, user_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('INITIATED','IN_PROGRESS','BLOCKED','READY_TO_CLOSE','CANCELLATION_PENDING','COMPLETED','CANCELLED')),
  pre_offboarding_user_state text NOT NULL CHECK (pre_offboarding_user_state IN ('ACTIVE','SUSPENDED','LEAVE')),
  termination_request_id text NOT NULL,
  termination_request_withdrawn_at timestamptz,
  termination_request_withdrawal_reference text,
  cancellation_requested_at timestamptz,
  reconciliation_token uuid,
  reconciliation_lease_until timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz, cancelled_at timestamptz,
  FOREIGN KEY (tenant_id,user_id) REFERENCES identity.users(tenant_id,id),
  UNIQUE (tenant_id,id),
  CHECK ((state='COMPLETED') = (completed_at IS NOT NULL)),
  CHECK ((state='CANCELLED') = (cancelled_at IS NOT NULL)),
  CHECK ((reconciliation_token IS NULL) = (reconciliation_lease_until IS NULL))
);
CREATE UNIQUE INDEX offboarding_one_open_case_per_user
  ON identity.offboarding_cases(tenant_id,user_id)
  WHERE state NOT IN ('COMPLETED','CANCELLED');
CREATE TABLE identity.offboarding_case_history (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, offboarding_case_id uuid NOT NULL,
  case_version integer NOT NULL CHECK (case_version > 0), from_state text, to_state text NOT NULL,
  command_type text NOT NULL, actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  correlation_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,offboarding_case_id,case_version),
  FOREIGN KEY (tenant_id,offboarding_case_id) REFERENCES identity.offboarding_cases(tenant_id,id)
);
CREATE TABLE identity.offboarding_clearance_tasks (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, offboarding_case_id uuid NOT NULL,
  clearance_type text NOT NULL CHECK (clearance_type IN ('ACCESS','ASSET_RETURN','LICENSE')),
  resource_id uuid, state text NOT NULL CHECK (state IN ('PENDING','SUCCEEDED','BLOCKED','WAIVED','ACCEPTED_EXCEPTION')),
  detail text NOT NULL, evidence_reference text, authorized_by text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,offboarding_case_id,clearance_type,resource_id),
  FOREIGN KEY (tenant_id,offboarding_case_id) REFERENCES identity.offboarding_cases(tenant_id,id)
);
CREATE TABLE identity.offboarding_recovery_actions (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, offboarding_case_id uuid NOT NULL,
  source_action_id text NOT NULL, action_type text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('PENDING','SUCCEEDED','WAIVED','ACCEPTED_EXCEPTION')),
  evidence_reference text, authorized_by text, reason text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,offboarding_case_id,source_action_id,action_type),
  FOREIGN KEY (tenant_id,offboarding_case_id) REFERENCES identity.offboarding_cases(tenant_id,id)
);
CREATE TABLE identity.offboarding_recovery_action_history (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, recovery_action_id uuid NOT NULL,
  action_version integer NOT NULL CHECK (action_version > 0), from_disposition text, to_disposition text NOT NULL,
  actor_id text NOT NULL, reason text NOT NULL, evidence_reference text, occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,recovery_action_id,action_version),
  FOREIGN KEY (tenant_id,recovery_action_id) REFERENCES identity.offboarding_recovery_actions(tenant_id,id)
);
CREATE FUNCTION identity.reject_offboarding_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'offboarding history is append-only'; END; $$;
CREATE TRIGGER offboarding_case_history_append_only BEFORE UPDATE OR DELETE ON identity.offboarding_case_history
  FOR EACH ROW EXECUTE FUNCTION identity.reject_offboarding_history_mutation();
CREATE TRIGGER offboarding_recovery_history_append_only BEFORE UPDATE OR DELETE ON identity.offboarding_recovery_action_history
  FOR EACH ROW EXECUTE FUNCTION identity.reject_offboarding_history_mutation();
CREATE TRIGGER user_lifecycle_history_append_only BEFORE UPDATE OR DELETE ON identity.user_lifecycle_history
  FOR EACH ROW EXECUTE FUNCTION identity.reject_offboarding_history_mutation();
CREATE FUNCTION identity.guard_offboarding_case_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.pre_offboarding_user_state IS DISTINCT FROM NEW.pre_offboarding_user_state THEN
    RAISE EXCEPTION 'pre-offboarding user state is immutable';
  END IF;
  IF OLD.state=NEW.state THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.state='INITIATED' AND NEW.state IN ('IN_PROGRESS','CANCELLED')) OR
    (OLD.state='IN_PROGRESS' AND NEW.state IN ('BLOCKED','READY_TO_CLOSE','CANCELLATION_PENDING')) OR
    (OLD.state='BLOCKED' AND NEW.state IN ('IN_PROGRESS','CANCELLATION_PENDING')) OR
    (OLD.state='READY_TO_CLOSE' AND NEW.state IN ('COMPLETED','CANCELLATION_PENDING')) OR
    (OLD.state='CANCELLATION_PENDING' AND NEW.state='CANCELLED')
  ) THEN RAISE EXCEPTION 'invalid offboarding case transition'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER offboarding_case_transition_guard BEFORE UPDATE OF state,pre_offboarding_user_state
  ON identity.offboarding_cases FOR EACH ROW EXECUTE FUNCTION identity.guard_offboarding_case_transition();
