ALTER TABLE automation.action_executions
  ADD COLUMN acceptance_deadline_at timestamptz;

UPDATE automation.action_executions
   SET acceptance_deadline_at=dispatched_at + interval '30 seconds'
 WHERE dispatched_at IS NOT NULL;

ALTER TABLE automation.action_executions
  ADD CONSTRAINT automation_execution_acceptance_deadline_check
  CHECK (
    (dispatched_at IS NULL AND acceptance_deadline_at IS NULL)
    OR
    (dispatched_at IS NOT NULL AND acceptance_deadline_at=dispatched_at + interval '30 seconds')
  );

CREATE INDEX automation_execution_acceptance_deadline
  ON automation.action_executions(acceptance_deadline_at)
  WHERE state='DISPATCHED';

CREATE FUNCTION automation.guard_action_execution_acceptance_deadline()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.dispatched_at IS NOT NULL AND OLD.dispatched_at IS DISTINCT FROM NEW.dispatched_at THEN
    RAISE EXCEPTION 'action execution dispatch timestamp is immutable';
  END IF;
  IF OLD.acceptance_deadline_at IS NOT NULL AND OLD.acceptance_deadline_at IS DISTINCT FROM NEW.acceptance_deadline_at THEN
    RAISE EXCEPTION 'action execution acceptance deadline is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER action_execution_acceptance_deadline_immutable
  BEFORE UPDATE ON automation.action_executions
  FOR EACH ROW EXECUTE FUNCTION automation.guard_action_execution_acceptance_deadline();

CREATE TABLE automation.action_execution_reconciliation_evidence (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  execution_id uuid NOT NULL,
  evidence_type text NOT NULL CHECK (evidence_type IN ('LATE_AGENT_ACCEPTED','LATE_RESTART_RUNTIME')),
  evidence_key text NOT NULL,
  source_event_id uuid NOT NULL,
  evidence_json jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,execution_id,evidence_type,evidence_key),
  UNIQUE (tenant_id,execution_id,source_event_id),
  FOREIGN KEY (tenant_id,execution_id) REFERENCES automation.action_executions(tenant_id,id),
  CHECK (jsonb_typeof(evidence_json)='object')
);

CREATE FUNCTION automation.reject_action_execution_reconciliation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'action execution reconciliation evidence is append-only';
END;
$$;
CREATE TRIGGER action_execution_reconciliation_immutable
  BEFORE UPDATE OR DELETE ON automation.action_execution_reconciliation_evidence
  FOR EACH ROW EXECUTE FUNCTION automation.reject_action_execution_reconciliation_mutation();
CREATE TRIGGER action_execution_reconciliation_no_truncate
  BEFORE TRUNCATE ON automation.action_execution_reconciliation_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION automation.reject_action_execution_reconciliation_mutation();
