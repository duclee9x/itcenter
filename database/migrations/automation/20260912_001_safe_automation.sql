CREATE SCHEMA automation;
CREATE TABLE automation.rules (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  code text NOT NULL,
  version integer NOT NULL,
  owner_user_id uuid NOT NULL,
  safety_level text NOT NULL,
  requires_approval boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  kill_switched boolean NOT NULL DEFAULT false,
  timeout_seconds integer NOT NULL CHECK (timeout_seconds > 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  rollback_plan text,
  action_spec jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code, version),
  CHECK (safety_level IN ('LOW','MEDIUM','HIGH','CRITICAL'))
);
CREATE TABLE automation.executions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  rule_id uuid NOT NULL REFERENCES automation.rules(id),
  state text NOT NULL DEFAULT 'QUEUED',
  approval_id uuid,
  attempt_count integer NOT NULL DEFAULT 0,
  fallback_work_item_id uuid,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state IN ('QUEUED','WAITING_APPROVAL','RUNNING','RETRYING','SUCCEEDED','FAILED','COMPENSATED','CANCELLED'))
);
CREATE INDEX automation_execution_lookup ON automation.executions(tenant_id,state,created_at DESC);
