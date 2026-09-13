CREATE TABLE problem.knowledge_recommendation_sessions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_id text NOT NULL,
  ticket_id uuid,
  incident_id uuid,
  active_root_incident_id uuid,
  support_context jsonb NOT NULL,
  normalized_context_hash text NOT NULL,
  profile_id text NOT NULL,
  profile_version integer NOT NULL CHECK (profile_version > 0),
  outcome text NOT NULL,
  deflection_type text,
  request_key text NOT NULL,
  correlation_id text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  presented_at timestamptz,
  resolved_at timestamptz,
  escalated_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,actor_id,request_key),
  CHECK (jsonb_typeof(support_context)='object'),
  CHECK (outcome IN ('NO_RECOMMENDATION','PRESENTED','USER_RESOLVED','NOT_HELPFUL','ESCALATED')),
  CHECK (deflection_type IS NULL OR deflection_type IN ('KNOWLEDGE_RESOLUTION','KNOWN_INCIDENT_DEFLECTION')),
  CHECK ((outcome='USER_RESOLVED' AND resolved_at IS NOT NULL) OR (outcome<>'USER_RESOLVED' AND resolved_at IS NULL)),
  CHECK ((outcome='ESCALATED' AND escalated_at IS NOT NULL) OR (outcome<>'ESCALATED' AND escalated_at IS NULL)),
  CHECK (deflection_type IS NULL OR (outcome='USER_RESOLVED' AND ticket_id IS NULL))
);

CREATE INDEX knowledge_recommendation_sessions_ticket_lookup
  ON problem.knowledge_recommendation_sessions(tenant_id,ticket_id)
  WHERE ticket_id IS NOT NULL;
CREATE INDEX knowledge_recommendation_sessions_context_history
  ON problem.knowledge_recommendation_sessions(tenant_id,normalized_context_hash,outcome)
  WHERE outcome='USER_RESOLVED' AND ticket_id IS NULL;

CREATE FUNCTION problem.guard_knowledge_recommendation_session_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.tenant_id,NEW.actor_id,NEW.incident_id,NEW.active_root_incident_id,
         NEW.support_context,NEW.normalized_context_hash,NEW.profile_id,NEW.profile_version,
         NEW.request_key,NEW.correlation_id,NEW.created_at,NEW.presented_at)
     IS DISTINCT FROM
     ROW(OLD.id,OLD.tenant_id,OLD.actor_id,OLD.incident_id,OLD.active_root_incident_id,
         OLD.support_context,OLD.normalized_context_hash,OLD.profile_id,OLD.profile_version,
         OLD.request_key,OLD.correlation_id,OLD.created_at,OLD.presented_at) THEN
    RAISE EXCEPTION 'recommendation session evidence is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.ticket_id IS NOT NULL AND NEW.ticket_id IS DISTINCT FROM OLD.ticket_id THEN
    RAISE EXCEPTION 'recommendation Ticket reference is immutable once established' USING ERRCODE='23514';
  END IF;
  IF NEW.ticket_id IS DISTINCT FROM OLD.ticket_id AND NEW.outcome<>'ESCALATED' THEN
    RAISE EXCEPTION 'Ticket linkage is allowed only during escalation' USING ERRCODE='23514';
  END IF;
  IF (OLD.resolved_at IS NOT NULL AND NEW.resolved_at IS DISTINCT FROM OLD.resolved_at)
     OR (OLD.escalated_at IS NOT NULL AND NEW.escalated_at IS DISTINCT FROM OLD.escalated_at) THEN
    RAISE EXCEPTION 'recommendation outcome timestamps are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'recommendation session version must advance exactly once' USING ERRCODE='23514';
  END IF;
  IF NEW.outcome IS DISTINCT FROM OLD.outcome AND NOT (
       (OLD.outcome='PRESENTED' AND NEW.outcome IN ('NOT_HELPFUL','USER_RESOLVED','ESCALATED'))
       OR (OLD.outcome='NOT_HELPFUL' AND NEW.outcome IN ('USER_RESOLVED','ESCALATED'))
       OR (OLD.outcome='NO_RECOMMENDATION' AND NEW.outcome='ESCALATED')
     ) THEN
    RAISE EXCEPTION 'invalid recommendation session outcome transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_recommendation_session_guard
  BEFORE UPDATE ON problem.knowledge_recommendation_sessions
  FOR EACH ROW EXECUTE FUNCTION problem.guard_knowledge_recommendation_session_update();

CREATE TABLE problem.knowledge_recommendation_items (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  session_id uuid NOT NULL,
  knowledge_id uuid NOT NULL,
  knowledge_version integer NOT NULL CHECK (knowledge_version > 0),
  rank integer NOT NULL CHECK (rank BETWEEN 1 AND 3),
  score integer NOT NULL CHECK (score BETWEEN 70 AND 100),
  evidence jsonb NOT NULL,
  eligibility_reference uuid NOT NULL,
  eligibility_evidence jsonb NOT NULL,
  presented_at timestamptz NOT NULL,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,session_id,rank),
  UNIQUE (tenant_id,session_id,knowledge_id,knowledge_version),
  FOREIGN KEY (tenant_id,session_id)
    REFERENCES problem.knowledge_recommendation_sessions(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,knowledge_id)
    REFERENCES problem.knowledge_articles(tenant_id,id) ON DELETE RESTRICT,
  CHECK (jsonb_typeof(evidence)='array'),
  CHECK (jsonb_typeof(eligibility_evidence)='object')
);

CREATE INDEX knowledge_recommendation_items_session
  ON problem.knowledge_recommendation_items(tenant_id,session_id,rank);

CREATE TABLE problem.knowledge_recommendation_interactions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  session_id uuid NOT NULL,
  item_id uuid,
  actor_id text NOT NULL,
  interaction_type text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  correlation_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,actor_id,idempotency_key),
  FOREIGN KEY (tenant_id,session_id)
    REFERENCES problem.knowledge_recommendation_sessions(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,item_id)
    REFERENCES problem.knowledge_recommendation_items(tenant_id,id) ON DELETE RESTRICT,
  CHECK (interaction_type IN ('ARTICLE_SELECTED','HELPFUL','NOT_HELPFUL','ISSUE_RESOLVED','ESCALATED')),
  CHECK (jsonb_typeof(metadata)='object')
);

CREATE UNIQUE INDEX knowledge_recommendation_one_resolution
  ON problem.knowledge_recommendation_interactions(tenant_id,session_id)
  WHERE interaction_type='ISSUE_RESOLVED';

CREATE FUNCTION problem.reject_recommendation_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'recommendation evidence is append-only' USING ERRCODE='23514';
END;
$$;

CREATE TRIGGER recommendation_items_immutable
  BEFORE UPDATE OR DELETE ON problem.knowledge_recommendation_items
  FOR EACH ROW EXECUTE FUNCTION problem.reject_recommendation_evidence_mutation();

CREATE TRIGGER recommendation_interactions_immutable
  BEFORE UPDATE OR DELETE ON problem.knowledge_recommendation_interactions
  FOR EACH ROW EXECUTE FUNCTION problem.reject_recommendation_evidence_mutation();
