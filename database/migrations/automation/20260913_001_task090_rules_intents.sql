ALTER TABLE automation.rules
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Legacy automation rule',
  ADD COLUMN IF NOT EXISTS owner_team_id text NOT NULL DEFAULT 'UNASSIGNED',
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'Legacy rule',
  ADD COLUMN IF NOT EXISTS review_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS active_version_id uuid,
  ADD COLUMN IF NOT EXISTS draft_version_id uuid,
  ADD COLUMN IF NOT EXISTS entity_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS activation_approval_id uuid,
  ADD COLUMN IF NOT EXISTS activation_context_hash text,
  ADD CONSTRAINT automation_rules_tenant_id_unique UNIQUE (tenant_id,id);
ALTER TABLE automation.rules DROP CONSTRAINT rules_safety_level_check;
ALTER TABLE automation.rules ADD CONSTRAINT rules_safety_level_check
  CHECK (safety_level IN ('LOW','MEDIUM','HIGH','CRITICAL','SAFE','LOW_RISK','CONTROLLED','HIGH_RISK','PROHIBITED_AUTO'));

CREATE TABLE automation.rule_versions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  rule_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('DRAFT','PUBLISHED')),
  trigger_json jsonb NOT NULL,
  condition_json jsonb NOT NULL,
  action_json jsonb NOT NULL,
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN -1000 AND 1000),
  safety_level text NOT NULL CHECK (safety_level IN ('SAFE','LOW_RISK','CONTROLLED','HIGH_RISK','PROHIBITED_AUTO')),
  requires_approval boolean NOT NULL DEFAULT false,
  activation_approval_id uuid,
  activation_context_hash text,
  content_hash text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  published_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,rule_id,version),
  FOREIGN KEY (tenant_id,rule_id) REFERENCES automation.rules(tenant_id,id)
);
ALTER TABLE automation.rules
  ADD CONSTRAINT automation_rules_active_version_fk
    FOREIGN KEY (tenant_id,active_version_id) REFERENCES automation.rule_versions(tenant_id,id),
  ADD CONSTRAINT automation_rules_draft_version_fk
    FOREIGN KEY (tenant_id,draft_version_id) REFERENCES automation.rule_versions(tenant_id,id),
  ADD CONSTRAINT automation_rules_state_check CHECK (state IN ('DRAFT','ACTIVE','INACTIVE'));
CREATE UNIQUE INDEX automation_rule_one_draft_version
  ON automation.rule_versions(tenant_id,rule_id) WHERE state='DRAFT';

CREATE TABLE automation.kill_switches (
  tenant_id text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('GLOBAL','CATEGORY','RULE')),
  scope_key text NOT NULL,
  enabled boolean NOT NULL,
  changed_by uuid NOT NULL,
  reason text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,scope_type,scope_key),
  CHECK ((scope_type='GLOBAL' AND scope_key='*') OR (scope_type<>'GLOBAL' AND scope_key<>'*'))
);

CREATE TABLE automation.rule_evaluations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_event_id uuid NOT NULL,
  source_event_type text NOT NULL,
  rule_id uuid NOT NULL,
  rule_version integer NOT NULL,
  mode text NOT NULL CHECK (mode IN ('PRODUCTION','SIMULATION')),
  match_result boolean NOT NULL,
  condition_evidence_json jsonb NOT NULL,
  policy_decision text NOT NULL CHECK (policy_decision IN ('ALLOW','DENY','REQUIRE_APPROVAL')),
  policy_reason_code text NOT NULL,
  context_hash text NOT NULL,
  action_intent_ids uuid[] NOT NULL DEFAULT '{}',
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,source_event_id,rule_id,rule_version,mode),
  FOREIGN KEY (tenant_id,rule_id,rule_version) REFERENCES automation.rule_versions(tenant_id,rule_id,version)
);
CREATE INDEX automation_rule_evaluation_history ON automation.rule_evaluations(tenant_id,rule_id,created_at DESC);

CREATE TABLE automation.action_intents (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_event_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  action_domain text NOT NULL,
  action_type text NOT NULL,
  normalized_parameters_json jsonb NOT NULL,
  policy_decision text NOT NULL CHECK (policy_decision IN ('ALLOW','DENY','REQUIRE_APPROVAL')),
  approval_id uuid,
  approval_context_hash text NOT NULL,
  deduplication_key text NOT NULL,
  conflict_scope_key text NOT NULL,
  exclusivity_group text NOT NULL,
  desired_state text,
  state text NOT NULL CHECK (state IN ('READY','PENDING_APPROVAL','BLOCKED','CONFLICTED','CANCELLED')),
  reason_code text,
  correlation_id uuid NOT NULL,
  entity_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,deduplication_key)
);
CREATE INDEX automation_intent_eligibility ON automation.action_intents(tenant_id,state,created_at);
CREATE INDEX automation_intent_conflict_lookup ON automation.action_intents(tenant_id,conflict_scope_key,state);

CREATE TABLE automation.action_intent_contributors (
  tenant_id text NOT NULL,
  action_intent_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  rule_version integer NOT NULL,
  evaluation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,action_intent_id,rule_id,rule_version,evaluation_id),
  FOREIGN KEY (tenant_id,action_intent_id) REFERENCES automation.action_intents(tenant_id,id),
  FOREIGN KEY (tenant_id,evaluation_id) REFERENCES automation.rule_evaluations(tenant_id,id)
);

CREATE TABLE automation.intent_conflicts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  conflict_scope_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('OPEN','RESOLVED')),
  entity_version integer NOT NULL DEFAULT 1,
  resolution_json jsonb,
  resolved_by uuid,
  resolution_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (tenant_id,id)
);
CREATE UNIQUE INDEX automation_open_conflict_identity
  ON automation.intent_conflicts(tenant_id,conflict_scope_key) WHERE state='OPEN';
CREATE TABLE automation.intent_conflict_members (
  tenant_id text NOT NULL,
  conflict_id uuid NOT NULL,
  action_intent_id uuid NOT NULL,
  resolution_state text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,conflict_id,action_intent_id),
  FOREIGN KEY (tenant_id,conflict_id) REFERENCES automation.intent_conflicts(tenant_id,id),
  FOREIGN KEY (tenant_id,action_intent_id) REFERENCES automation.action_intents(tenant_id,id)
);

CREATE OR REPLACE FUNCTION automation.reject_published_rule_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='PUBLISHED' THEN
    RAISE EXCEPTION 'published automation rule versions are immutable';
  END IF;
  IF TG_OP='DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER automation_published_rule_version_immutable
  BEFORE UPDATE OR DELETE ON automation.rule_versions
  FOR EACH ROW EXECUTE FUNCTION automation.reject_published_rule_version_mutation();
