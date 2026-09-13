CREATE TABLE automation.action_executions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  intent_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  attempt_kind text NOT NULL CHECK (attempt_kind IN ('AUTOMATIC','MANUAL')),
  previous_execution_id uuid,
  command_id uuid NOT NULL,
  target_agent_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type='RESTART_AGENT'),
  state text NOT NULL CHECK (state IN ('PENDING','CLAIMED','DISPATCHED','ACCEPTED','VERIFYING','SUCCEEDED','FAILED','UNKNOWN','CANCELLED')),
  reason_code text,
  entity_version integer NOT NULL DEFAULT 1 CHECK (entity_version > 0),
  claimed_by text,
  lease_expires_at timestamptz,
  idempotency_key text,
  command_snapshot_json jsonb NOT NULL,
  preflight_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  baseline_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL,
  issued_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  accepted_at timestamptz,
  verification_deadline timestamptz,
  completed_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,command_id),
  UNIQUE (tenant_id,intent_id,attempt_number),
  FOREIGN KEY (tenant_id,intent_id) REFERENCES automation.action_intents(tenant_id,id),
  FOREIGN KEY (tenant_id,previous_execution_id) REFERENCES automation.action_executions(tenant_id,id),
  CHECK ((attempt_kind='AUTOMATIC' AND attempt_number=1 AND previous_execution_id IS NULL AND idempotency_key IS NULL) OR attempt_kind='MANUAL'),
  CHECK (jsonb_typeof(command_snapshot_json)='object' AND jsonb_typeof(preflight_evidence_json)='object' AND jsonb_typeof(baseline_json)='object' AND jsonb_typeof(result_evidence_json)='object'),
  CHECK ((state IN ('DISPATCHED','ACCEPTED','VERIFYING','SUCCEEDED','UNKNOWN') AND dispatched_at IS NOT NULL) OR state IN ('PENDING','CLAIMED','CANCELLED','FAILED')),
  CHECK ((state IN ('ACCEPTED','VERIFYING','SUCCEEDED') AND accepted_at IS NOT NULL) OR state NOT IN ('ACCEPTED','VERIFYING','SUCCEEDED'))
);
CREATE UNIQUE INDEX automation_one_automatic_action_execution
  ON automation.action_executions(tenant_id,intent_id)
  WHERE attempt_kind='AUTOMATIC';
CREATE UNIQUE INDEX automation_execution_idempotency
  ON automation.action_executions(tenant_id,created_by,idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX automation_execution_pending_agent
  ON automation.action_executions(tenant_id,target_agent_id,created_at)
  WHERE state='PENDING';
CREATE INDEX automation_execution_verification_deadline
  ON automation.action_executions(verification_deadline)
  WHERE state IN ('ACCEPTED','VERIFYING');

CREATE FUNCTION automation.guard_action_execution_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'automation execution history is append-only';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
     OLD.intent_id IS DISTINCT FROM NEW.intent_id OR OLD.attempt_number IS DISTINCT FROM NEW.attempt_number OR
     OLD.attempt_kind IS DISTINCT FROM NEW.attempt_kind OR OLD.previous_execution_id IS DISTINCT FROM NEW.previous_execution_id OR
     OLD.command_id IS DISTINCT FROM NEW.command_id OR OLD.target_agent_id IS DISTINCT FROM NEW.target_agent_id OR
     OLD.action_type IS DISTINCT FROM NEW.action_type OR OLD.command_snapshot_json IS DISTINCT FROM NEW.command_snapshot_json OR
     OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.created_by IS DISTINCT FROM NEW.created_by OR
     NOT ((OLD.state='PENDING' AND NEW.state IN ('PENDING','CLAIMED','DISPATCHED','FAILED','CANCELLED')) OR
          (OLD.state='CLAIMED' AND NEW.state IN ('CLAIMED','DISPATCHED','FAILED','CANCELLED')) OR
          (OLD.state='DISPATCHED' AND NEW.state IN ('DISPATCHED','ACCEPTED','FAILED','UNKNOWN')) OR
          (OLD.state='ACCEPTED' AND NEW.state IN ('ACCEPTED','VERIFYING','SUCCEEDED','FAILED','UNKNOWN')) OR
          (OLD.state='VERIFYING' AND NEW.state IN ('VERIFYING','SUCCEEDED','FAILED','UNKNOWN')) OR OLD.state=NEW.state) THEN
    RAISE EXCEPTION 'invalid action execution history mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER action_execution_history_guard
  BEFORE UPDATE OR DELETE ON automation.action_executions
  FOR EACH ROW EXECUTE FUNCTION automation.guard_action_execution_history();

CREATE TABLE automation.action_execution_audit (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  execution_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  reason_code text NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,execution_id) REFERENCES automation.action_executions(tenant_id,id),
  CHECK (jsonb_typeof(evidence_json)='object')
);
CREATE FUNCTION automation.reject_action_execution_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'automation execution audit is append-only';
END;
$$;
CREATE TRIGGER action_execution_audit_immutable
  BEFORE UPDATE OR DELETE ON automation.action_execution_audit
  FOR EACH ROW EXECUTE FUNCTION automation.reject_action_execution_audit_mutation();
