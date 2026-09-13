CREATE TABLE incident.state_transitions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  incident_id uuid NOT NULL,
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
  UNIQUE (tenant_id,incident_id,transition_sequence),
  FOREIGN KEY (tenant_id,incident_id) REFERENCES incident.incidents(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX incident_state_transition_at ON incident.state_transitions(tenant_id,incident_id,effective_at DESC,transition_sequence DESC);
CREATE FUNCTION incident.record_state_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO incident.state_transitions(id,tenant_id,incident_id,from_state,to_state,effective_at,actor_type,actor_id,source_reference,transition_sequence,coverage_kind)
    VALUES(gen_random_uuid(),NEW.tenant_id,NEW.id,NULL,NEW.state,NEW.created_at,'SYSTEM','incident-state-history','INCIDENT.CREATE',NEW.version,'CREATE');
  ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO incident.state_transitions(id,tenant_id,incident_id,from_state,to_state,effective_at,actor_type,actor_id,source_reference,transition_sequence,coverage_kind)
    VALUES(gen_random_uuid(),NEW.tenant_id,NEW.id,OLD.state,NEW.state,NEW.updated_at,'SYSTEM','incident-state-history','INCIDENT.STATE_TRANSITION',NEW.version,'TRANSITION');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER incident_state_transition_history
  AFTER INSERT OR UPDATE OF state ON incident.incidents
  FOR EACH ROW EXECUTE FUNCTION incident.record_state_transition();

-- A baseline is coverage from this migration forward only; it never claims an
-- invented lifecycle before this timestamp.
INSERT INTO incident.state_transitions(id,tenant_id,incident_id,from_state,to_state,effective_at,actor_type,actor_id,source_reference,transition_sequence,coverage_kind)
SELECT gen_random_uuid(),tenant_id,id,NULL,state,now(),'SYSTEM','task-095-r2','TASK-095-R2.BASELINE',version,'LEGACY_BASELINE'
FROM incident.incidents
ON CONFLICT (tenant_id,incident_id,transition_sequence) DO NOTHING;

CREATE FUNCTION incident.reject_state_transition_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Incident state history is append-only' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER incident_state_transition_immutable BEFORE UPDATE OR DELETE ON incident.state_transitions
FOR EACH ROW EXECUTE FUNCTION incident.reject_state_transition_mutation();
