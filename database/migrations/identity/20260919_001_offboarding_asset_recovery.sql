ALTER TABLE identity.offboarding_clearance_tasks
  ADD COLUMN asset_recovery_state text;

ALTER TABLE identity.offboarding_clearance_tasks
  ADD CONSTRAINT offboarding_clearance_tenant_id_key UNIQUE (tenant_id,id);

ALTER TABLE identity.offboarding_clearance_tasks
  ADD CONSTRAINT offboarding_asset_recovery_state_check
  CHECK (
    asset_recovery_state IS NULL OR
    (clearance_type='ASSET_RETURN' AND asset_recovery_state IN
      ('PENDING_RETURN','RETURNED','UNRETURNED','MISSING'))
  );

CREATE TABLE identity.offboarding_asset_recovery_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  clearance_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  from_state text,
  to_state text NOT NULL CHECK (to_state IN ('PENDING_RETURN','RETURNED','UNRETURNED','MISSING')),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,clearance_id,version),
  FOREIGN KEY (tenant_id,clearance_id)
    REFERENCES identity.offboarding_clearance_tasks(tenant_id,id)
);

CREATE TRIGGER offboarding_asset_recovery_history_append_only
  BEFORE UPDATE OR DELETE ON identity.offboarding_asset_recovery_history
  FOR EACH ROW EXECUTE FUNCTION identity.reject_offboarding_history_mutation();
