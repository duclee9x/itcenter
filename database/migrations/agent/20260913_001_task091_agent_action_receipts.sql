ALTER TABLE agent.agents
  ADD CONSTRAINT agent_agents_tenant_id_unique UNIQUE (tenant_id,id),
  ADD COLUMN agent_runtime_id uuid,
  ADD COLUMN agent_session_id text;

CREATE TABLE agent.automation_action_receipts (
  tenant_id text NOT NULL,
  agent_id uuid NOT NULL,
  command_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  command_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('DELIVERED','ACCEPTED','REJECTED')),
  accepted_at timestamptz,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,agent_id,command_id),
  UNIQUE (tenant_id,command_id),
  FOREIGN KEY (tenant_id,agent_id) REFERENCES agent.agents(tenant_id,id),
  CHECK ((state='ACCEPTED') = (accepted_at IS NOT NULL)),
  CHECK (jsonb_typeof(result_json)='object')
);

CREATE FUNCTION agent.guard_automation_action_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'agent automation command receipts are immutable';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
     OLD.agent_id IS DISTINCT FROM NEW.agent_id OR
     OLD.command_id IS DISTINCT FROM NEW.command_id OR
     OLD.execution_id IS DISTINCT FROM NEW.execution_id OR
     OLD.command_hash IS DISTINCT FROM NEW.command_hash OR
     OLD.created_at IS DISTINCT FROM NEW.created_at OR
     NOT ((OLD.state='DELIVERED' AND NEW.state IN ('DELIVERED','ACCEPTED','REJECTED')) OR OLD.state=NEW.state) THEN
    RAISE EXCEPTION 'invalid agent automation command receipt mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER automation_action_receipt_guard
  BEFORE UPDATE OR DELETE ON agent.automation_action_receipts
  FOR EACH ROW EXECUTE FUNCTION agent.guard_automation_action_receipt();
