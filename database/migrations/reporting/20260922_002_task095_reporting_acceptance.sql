ALTER TABLE reporting.source_watermarks
  ADD COLUMN source_generation text,
  ADD COLUMN snapshot_lag_seconds bigint,
  ADD COLUMN last_duration_ms integer;

CREATE TABLE identity.reporting_principals (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  principal_type text NOT NULL DEFAULT 'SYSTEM_REPORTING'
    CHECK(principal_type='SYSTEM_REPORTING'),
  service_identity text NOT NULL CHECK(service_identity='reporting'),
  granted_capabilities text[] NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,service_identity),
  CHECK((active AND deactivated_at IS NULL) OR (NOT active AND deactivated_at IS NOT NULL)),
  CHECK(granted_capabilities <@ ARRAY[
    'reporting.snapshot.materialize',
    'ticket.reporting.read',
    'incident.reporting.read',
    'work_queue.reporting.read',
    'sla.reporting.read',
    'knowledge.reporting.read',
    'asset.scoring.read',
    'procurement.cost.read'
  ]::text[])
);
CREATE INDEX reporting_principals_active
  ON identity.reporting_principals(tenant_id,service_identity)
  WHERE active=true;

ALTER TABLE problem.knowledge_recommendation_sessions
  ADD COLUMN started_pre_ticket boolean;

-- A legacy session with no Ticket link is provably still pre-Ticket. A linked
-- session may have started in either flow, so NULL preserves that ambiguity.
UPDATE problem.knowledge_recommendation_sessions
   SET started_pre_ticket = CASE WHEN ticket_id IS NULL THEN TRUE ELSE NULL END;

CREATE FUNCTION reporting.reject_snapshot_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'KPI snapshots are immutable; create a new revision' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER reporting_kpi_snapshot_immutable
  BEFORE UPDATE OR DELETE ON reporting.kpi_result_snapshots
  FOR EACH ROW EXECUTE FUNCTION reporting.reject_snapshot_mutation();

CREATE FUNCTION reporting.reject_definition_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'KPI definitions are immutable; publish a new version' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER reporting_kpi_definition_immutable
  BEFORE UPDATE OR DELETE ON reporting.kpi_definitions
  FOR EACH ROW EXECUTE FUNCTION reporting.reject_definition_mutation();

CREATE FUNCTION problem.guard_started_pre_ticket() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.started_pre_ticket IS DISTINCT FROM OLD.started_pre_ticket THEN
    RAISE EXCEPTION 'recommendation source context is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER knowledge_recommendation_started_pre_ticket_immutable
  BEFORE UPDATE ON problem.knowledge_recommendation_sessions
  FOR EACH ROW EXECUTE FUNCTION problem.guard_started_pre_ticket();
