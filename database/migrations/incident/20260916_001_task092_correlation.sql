ALTER TABLE incident.incidents
  ADD CONSTRAINT incident_tenant_id_unique UNIQUE (tenant_id,id);

CREATE TABLE incident.correlation_decisions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_incident_id uuid NOT NULL,
  source_event_id uuid NOT NULL REFERENCES platform.outbox_events(event_id),
  evaluation_identity text NOT NULL,
  profile_id text NOT NULL,
  profile_version integer NOT NULL CHECK (profile_version > 0),
  evidence_fingerprint text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('AUTO_LINK','REVIEW_REQUIRED','NO_LINK')),
  selected_root_incident_id uuid,
  confidence smallint NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  reason_code text NOT NULL,
  candidate_count integer NOT NULL CHECK (candidate_count >= 0),
  decision_evidence jsonb NOT NULL CHECK (jsonb_typeof(decision_evidence)='object'),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,evaluation_identity),
  FOREIGN KEY (tenant_id,subject_incident_id)
    REFERENCES incident.incidents(tenant_id,id),
  FOREIGN KEY (tenant_id,selected_root_incident_id)
    REFERENCES incident.incidents(tenant_id,id),
  CHECK ((outcome='AUTO_LINK') = (selected_root_incident_id IS NOT NULL))
);

CREATE INDEX correlation_decisions_subject_history
  ON incident.correlation_decisions(tenant_id,subject_incident_id,created_at DESC);

CREATE TABLE incident.correlation_decision_candidates (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  decision_id uuid NOT NULL,
  candidate_root_incident_id uuid NOT NULL,
  raw_score integer NOT NULL CHECK (raw_score >= 0),
  confidence smallint NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  strong_signals jsonb NOT NULL CHECK (jsonb_typeof(strong_signals)='array'),
  eligible boolean NOT NULL,
  exclusion_reason text,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,decision_id)
    REFERENCES incident.correlation_decisions(tenant_id,id),
  FOREIGN KEY (tenant_id,candidate_root_incident_id)
    REFERENCES incident.incidents(tenant_id,id),
  UNIQUE (tenant_id,decision_id,candidate_root_incident_id)
);

CREATE TABLE incident.root_relations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  child_incident_id uuid NOT NULL,
  root_incident_id uuid NOT NULL,
  relation_state text NOT NULL CHECK (relation_state IN ('ACTIVE','DETACHED','RESOLVED_BY_ROOT')),
  origin text NOT NULL CHECK (origin IN ('AUTOMATIC','HUMAN')),
  decision_id uuid,
  reason text NOT NULL,
  confidence smallint CHECK (confidence BETWEEN 0 AND 100),
  linked_by_type text NOT NULL,
  linked_by_id text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  detached_by_type text,
  detached_by_id text,
  detached_at timestamptz,
  detach_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (tenant_id,child_incident_id)
    REFERENCES incident.incidents(tenant_id,id),
  FOREIGN KEY (tenant_id,root_incident_id)
    REFERENCES incident.incidents(tenant_id,id),
  FOREIGN KEY (tenant_id,decision_id)
    REFERENCES incident.correlation_decisions(tenant_id,id),
  CHECK (child_incident_id <> root_incident_id),
  CHECK ((relation_state='ACTIVE' AND detached_at IS NULL AND detach_reason IS NULL)
      OR (relation_state<>'ACTIVE' AND detached_at IS NOT NULL AND detach_reason IS NOT NULL))
);

CREATE UNIQUE INDEX incident_one_active_root_per_child
  ON incident.root_relations(tenant_id,child_incident_id)
  WHERE relation_state='ACTIVE';
CREATE INDEX incident_root_relations_by_root
  ON incident.root_relations(tenant_id,root_incident_id,relation_state,linked_at DESC);

-- Preserve the existing TASK-033 current Root links as explicit history before
-- the new relation projection becomes authoritative.
INSERT INTO incident.root_relations(
  id,tenant_id,child_incident_id,root_incident_id,relation_state,origin,reason,
  linked_by_type,linked_by_id,linked_at
)
SELECT gen_random_uuid(),child.tenant_id,child.id,child.root_incident_id,'ACTIVE','HUMAN',
       COALESCE(legacy.relation_reason,'Migrated TASK-033 Root relationship'),
       'LEGACY','TASK-033',COALESCE(legacy.created_at,child.updated_at)
  FROM incident.incidents child
  LEFT JOIN incident.relations legacy ON legacy.tenant_id=child.tenant_id
    AND legacy.root_incident_id=child.root_incident_id
    AND legacy.related_entity_type='INCIDENT' AND legacy.related_entity_id=child.id
 WHERE child.root_incident_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM incident.root_relations current
     WHERE current.tenant_id=child.tenant_id AND current.child_incident_id=child.id
       AND current.relation_state='ACTIVE');

CREATE TABLE incident.correlation_reviews (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  decision_id uuid NOT NULL,
  subject_incident_id uuid NOT NULL,
  selected_root_incident_id uuid,
  result text NOT NULL CHECK (result IN ('ATTACHED','REJECTED')),
  actor_id text NOT NULL,
  reason text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,decision_id)
    REFERENCES incident.correlation_decisions(tenant_id,id),
  FOREIGN KEY (tenant_id,subject_incident_id)
    REFERENCES incident.incidents(tenant_id,id),
  FOREIGN KEY (tenant_id,selected_root_incident_id)
    REFERENCES incident.incidents(tenant_id,id),
  CHECK ((result='ATTACHED') = (selected_root_incident_id IS NOT NULL))
);

CREATE TABLE incident.correlation_suppressions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  child_incident_id uuid NOT NULL,
  root_incident_id uuid NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,child_incident_id)
    REFERENCES incident.incidents(tenant_id,id),
  FOREIGN KEY (tenant_id,root_incident_id)
    REFERENCES incident.incidents(tenant_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,child_incident_id,root_incident_id,id)
);

CREATE TABLE incident.correlation_active_suppressions (
  tenant_id text NOT NULL,
  child_incident_id uuid NOT NULL,
  root_incident_id uuid NOT NULL,
  suppression_id uuid NOT NULL,
  PRIMARY KEY (tenant_id,child_incident_id,root_incident_id),
  UNIQUE (tenant_id,suppression_id),
  FOREIGN KEY (tenant_id,child_incident_id,root_incident_id,suppression_id)
    REFERENCES incident.correlation_suppressions(tenant_id,child_incident_id,root_incident_id,id)
);

CREATE TABLE incident.correlation_suppression_overrides (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  suppression_id uuid NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,suppression_id)
    REFERENCES incident.correlation_suppressions(tenant_id,id),
  UNIQUE (tenant_id,suppression_id)
);

CREATE TABLE incident.correlation_clusters (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_type text NOT NULL,
  source_correlation_key text NOT NULL,
  root_incident_id uuid,
  status text NOT NULL CHECK (status IN ('ACTIVE','ENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_reason text,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,root_incident_id)
    REFERENCES incident.incidents(tenant_id,id),
  CHECK ((status='ACTIVE' AND ended_at IS NULL) OR (status='ENDED' AND ended_at IS NOT NULL))
);

CREATE UNIQUE INDEX incident_active_source_correlation_cluster
  ON incident.correlation_clusters(tenant_id,source_type,source_correlation_key)
  WHERE status='ACTIVE';
CREATE INDEX incident_correlation_clusters_root
  ON incident.correlation_clusters(tenant_id,root_incident_id,status);

CREATE TABLE incident.correlation_processing_failures (
  tenant_id text NOT NULL,
  event_id uuid NOT NULL REFERENCES platform.outbox_events(event_id),
  incident_id uuid NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count > 0),
  state text NOT NULL CHECK (state IN ('RETRYING','EXHAUSTED','RESOLVED')),
  next_attempt_at timestamptz,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text NOT NULL,
  correlation_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,event_id),
  FOREIGN KEY (tenant_id,incident_id) REFERENCES incident.incidents(tenant_id,id),
  CHECK ((state='RETRYING') = (next_attempt_at IS NOT NULL))
);

CREATE INDEX incident_correlation_failures_due
  ON incident.correlation_processing_failures(tenant_id,next_attempt_at)
  WHERE state='RETRYING';

CREATE FUNCTION incident.reject_correlation_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Incident correlation evidence is append-only' USING ERRCODE='55000';
END $$;

CREATE TRIGGER correlation_decisions_append_only
  BEFORE UPDATE OR DELETE ON incident.correlation_decisions
  FOR EACH ROW EXECUTE FUNCTION incident.reject_correlation_evidence_mutation();
CREATE TRIGGER correlation_candidates_append_only
  BEFORE UPDATE OR DELETE ON incident.correlation_decision_candidates
  FOR EACH ROW EXECUTE FUNCTION incident.reject_correlation_evidence_mutation();
CREATE TRIGGER correlation_reviews_append_only
  BEFORE UPDATE OR DELETE ON incident.correlation_reviews
  FOR EACH ROW EXECUTE FUNCTION incident.reject_correlation_evidence_mutation();
CREATE TRIGGER correlation_suppressions_append_only
  BEFORE UPDATE OR DELETE ON incident.correlation_suppressions
  FOR EACH ROW EXECUTE FUNCTION incident.reject_correlation_evidence_mutation();
CREATE TRIGGER correlation_suppression_overrides_append_only
  BEFORE UPDATE OR DELETE ON incident.correlation_suppression_overrides
  FOR EACH ROW EXECUTE FUNCTION incident.reject_correlation_evidence_mutation();
