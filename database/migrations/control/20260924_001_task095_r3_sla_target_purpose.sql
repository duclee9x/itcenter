ALTER TABLE control.sla_policies
  ADD CONSTRAINT sla_policies_tenant_identity UNIQUE (tenant_id,id);

ALTER TABLE control.sla_targets
  ADD COLUMN target_purpose text,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD CONSTRAINT sla_targets_tenant_identity UNIQUE (tenant_id,id);

-- Legacy target purpose is deliberately unknown; names and condition text are
-- not classification evidence.
UPDATE control.sla_targets SET target_purpose='UNKNOWN';
ALTER TABLE control.sla_targets
  ALTER COLUMN target_purpose SET NOT NULL,
  ADD CONSTRAINT sla_targets_target_purpose_check
    CHECK (target_purpose IN ('RESPONSE','ACKNOWLEDGE','RESOLUTION','RESTORE','OTHER','UNKNOWN')),
  ADD CONSTRAINT sla_targets_policy_tenant_fk
    FOREIGN KEY (tenant_id,sla_policy_id) REFERENCES control.sla_policies(tenant_id,id);
CREATE INDEX sla_targets_reporting_purpose
  ON control.sla_targets(tenant_id,target_purpose,sla_policy_id);

ALTER TABLE control.sla_instances
  ADD CONSTRAINT sla_instances_tenant_identity UNIQUE (tenant_id,id),
  ADD CONSTRAINT sla_instances_target_tenant_fk
    FOREIGN KEY (tenant_id,target_id) REFERENCES control.sla_targets(tenant_id,id);

CREATE TABLE control.sla_target_purpose_changes (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  sla_target_id uuid NOT NULL,
  from_purpose text NOT NULL CHECK(from_purpose='UNKNOWN'),
  to_purpose text NOT NULL CHECK(to_purpose IN ('RESPONSE','ACKNOWLEDGE','RESOLUTION','RESTORE','OTHER')),
  target_version integer NOT NULL CHECK(target_version > 1),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL CHECK(length(trim(reason)) > 0),
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,actor_id,idempotency_key),
  FOREIGN KEY(tenant_id,sla_target_id) REFERENCES control.sla_targets(tenant_id,id)
);
CREATE INDEX sla_target_purpose_changes_history
  ON control.sla_target_purpose_changes(tenant_id,sla_target_id,changed_at,id);

CREATE FUNCTION control.reject_sla_purpose_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SLA target-purpose classification history is append-only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER sla_target_purpose_history_immutable
  BEFORE UPDATE OR DELETE ON control.sla_target_purpose_changes
  FOR EACH ROW EXECUTE FUNCTION control.reject_sla_purpose_history_mutation();

CREATE FUNCTION control.guard_sla_policy_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.tenant_id,NEW.code,NEW.object_type,NEW.version)
     IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.code,OLD.object_type,OLD.version) THEN
    RAISE EXCEPTION 'SLA policy versions are immutable; create a new version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sla_policy_version_identity_guard
  BEFORE UPDATE ON control.sla_policies
  FOR EACH ROW EXECUTE FUNCTION control.guard_sla_policy_identity();

CREATE FUNCTION control.guard_sla_target_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  audited boolean;
BEGIN
  IF ROW(NEW.id,NEW.tenant_id,NEW.sla_policy_id,NEW.name,NEW.duration_minutes,NEW.start_condition,NEW.stop_condition)
     IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.sla_policy_id,OLD.name,OLD.duration_minutes,OLD.start_condition,OLD.stop_condition) THEN
    RAISE EXCEPTION 'SLA target definition is immutable; create a target under a new policy version' USING ERRCODE='23514';
  END IF;
  IF NEW.target_purpose IS DISTINCT FROM OLD.target_purpose THEN
    IF OLD.target_purpose <> 'UNKNOWN' OR NEW.target_purpose = 'UNKNOWN' OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'SLA target purpose can only be classified once from UNKNOWN with a version increment' USING ERRCODE='23514';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM control.sla_target_purpose_changes c
       WHERE c.tenant_id=OLD.tenant_id AND c.sla_target_id=OLD.id
         AND c.from_purpose=OLD.target_purpose AND c.to_purpose=NEW.target_purpose
         AND c.target_version=NEW.version
    ) INTO audited;
    IF NOT audited THEN
      RAISE EXCEPTION 'SLA target purpose change requires immutable classification evidence' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'SLA target version advances only with purpose classification' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sla_target_version_identity_guard
  BEFORE UPDATE ON control.sla_targets
  FOR EACH ROW EXECUTE FUNCTION control.guard_sla_target_identity();

CREATE FUNCTION control.guard_sla_instance_policy_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_policy_version integer;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.tenant_id,NEW.target_id,NEW.policy_version)
     IS DISTINCT FROM ROW(OLD.tenant_id,OLD.target_id,OLD.policy_version) THEN
    RAISE EXCEPTION 'SLA instance target and policy version are immutable' USING ERRCODE='23514';
  END IF;
  SELECT p.version INTO target_policy_version
    FROM control.sla_targets t JOIN control.sla_policies p
      ON p.tenant_id=t.tenant_id AND p.id=t.sla_policy_id
   WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.target_id;
  IF target_policy_version IS NULL OR target_policy_version <> NEW.policy_version THEN
    RAISE EXCEPTION 'SLA instance policy version does not match its canonical target' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sla_instance_policy_version_guard
  BEFORE INSERT OR UPDATE ON control.sla_instances
  FOR EACH ROW EXECUTE FUNCTION control.guard_sla_instance_policy_version();

INSERT INTO identity.permissions(id,code,resource_type,action)
VALUES('a0950000-0000-4000-8000-000000000007','sla.target_purpose.manage','sla_target','purpose.manage')
ON CONFLICT(code) DO UPDATE SET resource_type=EXCLUDED.resource_type,action=EXCLUDED.action;
