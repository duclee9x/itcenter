CREATE TABLE automation.action_capabilities (
  id uuid PRIMARY KEY,
  action_type text NOT NULL,
  target_type text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  required_permission text NOT NULL,
  safety_class text NOT NULL CHECK (safety_class IN ('SAFE_AUTOMATION','CONTROLLED','HIGH_RISK','PROHIBITED')),
  automatic_execution_supported boolean NOT NULL,
  approval_supported boolean NOT NULL,
  approval_required boolean NOT NULL DEFAULT false,
  conflict_group text NOT NULL,
  parameter_schema_json jsonb NOT NULL,
  executor_type text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_type,target_type,version),
  UNIQUE (id,version),
  CHECK (length(btrim(action_type)) > 0),
  CHECK (length(btrim(target_type)) > 0),
  CHECK (length(btrim(required_permission)) > 0),
  CHECK (length(btrim(conflict_group)) > 0),
  CHECK (length(btrim(executor_type)) > 0),
  CHECK (NOT approval_required OR approval_supported),
  CHECK (jsonb_typeof(parameter_schema_json)='object')
);

CREATE TABLE automation.action_policies (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  action_type text NOT NULL,
  target_type text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('DRAFT','ACTIVE','INACTIVE')),
  mode text NOT NULL CHECK (mode IN ('DENY','ALLOW','REQUIRE_APPROVAL')),
  resource_scope_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  parameter_constraints_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_required boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  content_hash text NOT NULL,
  created_by uuid NOT NULL,
  changed_by uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  audit_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  deactivated_at timestamptz,
  deactivated_by uuid,
  deactivation_reason text,
  entity_version integer NOT NULL DEFAULT 1 CHECK (entity_version > 0),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,id,version),
  UNIQUE (tenant_id,action_type,target_type,version),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (jsonb_typeof(resource_scope_json)='object'),
  CHECK (jsonb_typeof(parameter_constraints_json)='object'),
  CHECK ((state='ACTIVE') = (activated_at IS NOT NULL AND deactivated_at IS NULL)),
  CHECK ((state='INACTIVE') = (deactivated_at IS NOT NULL))
);

CREATE UNIQUE INDEX action_policy_one_active_per_tenant_action
  ON automation.action_policies(tenant_id,action_type,target_type)
  WHERE state='ACTIVE';
CREATE INDEX action_policy_effective_lookup
  ON automation.action_policies(tenant_id,action_type,target_type,effective_from)
  WHERE state='ACTIVE';

CREATE FUNCTION automation.guard_action_capability_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'automation action capability catalog entries are immutable';
END;
$$;
CREATE TRIGGER action_capabilities_immutable
  BEFORE UPDATE OR DELETE ON automation.action_capabilities
  FOR EACH ROW EXECUTE FUNCTION automation.guard_action_capability_immutable();

CREATE FUNCTION automation.guard_action_policy_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'automation action policy history is immutable';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR
     OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
     OLD.version IS DISTINCT FROM NEW.version OR
     OLD.action_type IS DISTINCT FROM NEW.action_type OR
     OLD.target_type IS DISTINCT FROM NEW.target_type OR
     OLD.created_by IS DISTINCT FROM NEW.created_by OR
     OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'automation action policy identity is immutable';
  END IF;
  IF (OLD.state <> 'DRAFT' OR NEW.state <> 'DRAFT') AND (
    OLD.action_type IS DISTINCT FROM NEW.action_type OR
    OLD.target_type IS DISTINCT FROM NEW.target_type OR
    OLD.mode IS DISTINCT FROM NEW.mode OR
    OLD.resource_scope_json IS DISTINCT FROM NEW.resource_scope_json OR
    OLD.parameter_constraints_json IS DISTINCT FROM NEW.parameter_constraints_json OR
    OLD.approval_required IS DISTINCT FROM NEW.approval_required OR
    OLD.effective_from IS DISTINCT FROM NEW.effective_from OR
    OLD.effective_to IS DISTINCT FROM NEW.effective_to OR
    OLD.content_hash IS DISTINCT FROM NEW.content_hash OR
    OLD.changed_by IS DISTINCT FROM NEW.changed_by OR
    OLD.reason IS DISTINCT FROM NEW.reason OR
    OLD.audit_reference IS DISTINCT FROM NEW.audit_reference
  ) THEN
    RAISE EXCEPTION 'published automation action policy content is immutable';
  END IF;
  IF NOT (
    (OLD.state='DRAFT' AND NEW.state IN ('DRAFT','ACTIVE')) OR
    (OLD.state='ACTIVE' AND NEW.state='INACTIVE') OR
    (OLD.state=NEW.state AND OLD.state='DRAFT')
  ) THEN
    RAISE EXCEPTION 'invalid automation action policy version transition';
  END IF;
  IF OLD.state='DRAFT' AND NEW.state='DRAFT' AND
     (NEW.activated_at IS DISTINCT FROM OLD.activated_at OR
      NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at OR
      NEW.deactivated_by IS DISTINCT FROM OLD.deactivated_by OR
      NEW.deactivation_reason IS DISTINCT FROM OLD.deactivation_reason OR
      NEW.entity_version <> OLD.entity_version+1) THEN
    RAISE EXCEPTION 'draft policy updates must only change draft content and version';
  END IF;
  IF OLD.state='DRAFT' AND NEW.state='ACTIVE' AND
     (NEW.activated_at IS NULL OR NEW.deactivated_at IS NOT NULL OR
      NEW.deactivated_by IS NOT NULL OR NEW.deactivation_reason IS NOT NULL OR
      NEW.entity_version <> OLD.entity_version+1) THEN
    RAISE EXCEPTION 'policy activation metadata is invalid';
  END IF;
  IF OLD.state='ACTIVE' AND NEW.state='INACTIVE' AND
     (NEW.deactivated_by IS NULL OR NEW.deactivation_reason IS NULL OR
      length(btrim(NEW.deactivation_reason))=0 OR
      NEW.activated_at IS DISTINCT FROM OLD.activated_at OR
      NEW.entity_version <> OLD.entity_version+1) THEN
    RAISE EXCEPTION 'policy deactivation requires actor and reason';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER action_policy_immutable_version
  BEFORE UPDATE OR DELETE ON automation.action_policies
  FOR EACH ROW EXECUTE FUNCTION automation.guard_action_policy_version();

ALTER TABLE automation.rule_evaluations
  ADD COLUMN decision_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE automation.action_intents
  ADD COLUMN capability_id uuid,
  ADD COLUMN capability_version integer,
  ADD COLUMN policy_id uuid,
  ADD COLUMN policy_version integer,
  ADD COLUMN principal_id uuid,
  ADD COLUMN required_permission text,
  ADD COLUMN authorization_scope_reference text,
  ADD COLUMN authorization_decision text CHECK (authorization_decision IN ('ALLOW','DENY')),
  ADD COLUMN approval_requirement text CHECK (approval_requirement IN ('NOT_REQUIRED','REQUIRED')),
  ADD COLUMN approval_result text CHECK (approval_result IN ('NOT_REQUIRED','PENDING','APPROVED','STALE','DENIED')),
  ADD COLUMN kill_switch_result text CHECK (kill_switch_result IN ('ALLOW','DENY')),
  ADD COLUMN conflict_result text CHECK (conflict_result IN ('CLEAR','CONFLICTED')),
  ADD COLUMN decision_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT action_intent_capability_fk
    FOREIGN KEY (capability_id,capability_version)
    REFERENCES automation.action_capabilities(id,version),
  ADD CONSTRAINT action_intent_policy_fk
    FOREIGN KEY (tenant_id,policy_id,policy_version)
    REFERENCES automation.action_policies(tenant_id,id,version),
  ADD CONSTRAINT action_intent_principal_fk
    FOREIGN KEY (tenant_id,principal_id)
    REFERENCES identity.automation_principals(tenant_id,id),
  ADD CONSTRAINT action_intent_ready_evidence CHECK (
    state <> 'READY' OR (
      capability_id IS NOT NULL AND capability_version IS NOT NULL AND
      policy_id IS NOT NULL AND policy_version IS NOT NULL AND
      principal_id IS NOT NULL AND required_permission IS NOT NULL AND
      authorization_decision='ALLOW' AND
      approval_result IN ('NOT_REQUIRED','APPROVED') AND
      kill_switch_result='ALLOW' AND conflict_result='CLEAR'
    )
  );

-- Built-in safe capability. TASK-090 records eligible intents only; the
-- TASK-091 Agent Command executor remains separate and is not invoked here.
INSERT INTO automation.action_capabilities(
  id,action_type,target_type,version,required_permission,safety_class,
  automatic_execution_supported,approval_supported,approval_required,
  conflict_group,parameter_schema_json,executor_type,content_hash
) VALUES (
  '09000000-0000-4000-8000-000000000001','RESTART_AGENT','AGENT',1,
  'agent.restart','SAFE_AUTOMATION',true,true,false,'AGENT_SERVICE_CONTROL',
  '{"type":"object","additionalProperties":false,"maxProperties":0}',
  'TASK091_AGENT_COMMAND',
  '3db6074ad235b8c8bb9d9f3b03b10f85c81058150e797f73c52e3ffb9ce58b6b'
);
