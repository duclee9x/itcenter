ALTER TABLE operations.work_items ADD CONSTRAINT work_items_tenant_id_unique UNIQUE (tenant_id,id);
CREATE TABLE operations.work_item_state_transitions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  work_item_id uuid NOT NULL,
  from_state text,
  to_state text NOT NULL,
  effective_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  reason text,
  correlation_id text,
  source_reference text NOT NULL,
  transition_sequence integer NOT NULL CHECK (transition_sequence > 0),
  coverage_kind text NOT NULL CHECK (coverage_kind IN ('CREATE','TRANSITION','LEGACY_BASELINE')),
  UNIQUE (tenant_id,work_item_id,transition_sequence),
  FOREIGN KEY (tenant_id,work_item_id) REFERENCES operations.work_items(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX work_item_state_transition_at ON operations.work_item_state_transitions(tenant_id,work_item_id,effective_at DESC,transition_sequence DESC);
CREATE FUNCTION operations.record_work_item_state_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO operations.work_item_state_transitions(id,tenant_id,work_item_id,from_state,to_state,effective_at,actor_type,actor_id,source_reference,transition_sequence,coverage_kind)
    VALUES(gen_random_uuid(),NEW.tenant_id,NEW.id,NULL,NEW.state,NEW.created_at,'SYSTEM','work-item-state-history','WORK_ITEM.CREATE',NEW.version,'CREATE');
  ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO operations.work_item_state_transitions(id,tenant_id,work_item_id,from_state,to_state,effective_at,actor_type,actor_id,source_reference,transition_sequence,coverage_kind)
    VALUES(gen_random_uuid(),NEW.tenant_id,NEW.id,OLD.state,NEW.state,NEW.last_action_at,'SYSTEM','work-item-state-history','WORK_ITEM.STATE_TRANSITION',NEW.version,'TRANSITION');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER work_item_state_transition_history
  AFTER INSERT OR UPDATE OF state ON operations.work_items
  FOR EACH ROW EXECUTE FUNCTION operations.record_work_item_state_transition();
INSERT INTO operations.work_item_state_transitions(id,tenant_id,work_item_id,from_state,to_state,effective_at,actor_type,actor_id,source_reference,transition_sequence,coverage_kind)
SELECT gen_random_uuid(),tenant_id,id,NULL,state,now(),'SYSTEM','task-095-r2','TASK-095-R2.BASELINE',version,'LEGACY_BASELINE'
FROM operations.work_items
ON CONFLICT (tenant_id,work_item_id,transition_sequence) DO NOTHING;
CREATE FUNCTION operations.reject_work_item_state_transition_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Work Item state history is append-only' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER work_item_state_transition_immutable BEFORE UPDATE OR DELETE ON operations.work_item_state_transitions
FOR EACH ROW EXECUTE FUNCTION operations.reject_work_item_state_transition_mutation();
