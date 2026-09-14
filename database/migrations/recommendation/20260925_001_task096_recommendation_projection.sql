CREATE SCHEMA recommendation;

CREATE TABLE recommendation.recommendations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  family text NOT NULL CHECK (family IN (
    'INCIDENT_CORRELATION_REVIEW',
    'KNOWLEDGE_GUIDANCE',
    'ASSET_REPLACEMENT_REVIEW'
  )),
  source_domain text NOT NULL CHECK (source_domain IN ('INCIDENT','KNOWLEDGE','ASSET')),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  contexts jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_type text CHECK (context_type IN (
    'INCIDENT','TICKET','RECOMMENDATION_SESSION','ASSET'
  )),
  context_id uuid,
  current_state text NOT NULL CHECK (current_state IN (
    'ACTIVE','SUPERSEDED','RESOLVED_BY_SOURCE','EXPIRED'
  )),
  source_generation_key text NOT NULL,
  latest_revision integer NOT NULL CHECK (latest_revision > 0),
  initial_provenance text NOT NULL CHECK (initial_provenance IN (
    'INITIAL_RECONCILIATION','SOURCE_EVENT','RECONCILIATION'
  )),
  created_at timestamptz NOT NULL,
  refreshed_at timestamptz NOT NULL,
  source_valid_until timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,family,source_type,source_id)
);
CREATE INDEX recommendation_feed_order
  ON recommendation.recommendations(tenant_id,current_state,family,created_at DESC,id);
CREATE INDEX recommendation_context_lookup
  ON recommendation.recommendations(tenant_id,context_type,context_id,current_state);

CREATE TABLE recommendation.recommendation_revisions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  recommendation_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  source_generation_key text NOT NULL,
  source_generation jsonb NOT NULL,
  source_version jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_profile_id text,
  source_profile_version text,
  recommendation_profile_id text NOT NULL DEFAULT 'TASK-096-EXPLAINABLE',
  recommendation_profile_version integer NOT NULL DEFAULT 1 CHECK (recommendation_profile_version > 0),
  source_rank integer,
  source_score integer,
  source_band text,
  reason_codes text[] NOT NULL DEFAULT '{}',
  evidence_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  freshness jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_valid_until timestamptz,
  generated_at timestamptz NOT NULL,
  supersedes_revision integer,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,recommendation_id,revision),
  UNIQUE (tenant_id,recommendation_id,source_generation_key),
  FOREIGN KEY (tenant_id,recommendation_id)
    REFERENCES recommendation.recommendations(tenant_id,id),
  FOREIGN KEY (tenant_id,recommendation_id,supersedes_revision)
    REFERENCES recommendation.recommendation_revisions(tenant_id,recommendation_id,revision)
);
CREATE INDEX recommendation_revision_history
  ON recommendation.recommendation_revisions(tenant_id,recommendation_id,revision DESC);

CREATE FUNCTION recommendation.reject_revision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Recommendation revisions are immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER recommendation_revision_immutable
  BEFORE UPDATE OR DELETE ON recommendation.recommendation_revisions
  FOR EACH ROW EXECUTE FUNCTION recommendation.reject_revision_mutation();
CREATE TRIGGER recommendation_revision_no_truncate
  BEFORE TRUNCATE ON recommendation.recommendation_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION recommendation.reject_revision_mutation();

CREATE TABLE recommendation.recommendation_interactions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  recommendation_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  revision integer NOT NULL,
  source_generation_key text NOT NULL,
  actor_id text NOT NULL,
  interaction_type text NOT NULL CHECK (interaction_type IN (
    'VIEWED','DISMISSED','OPENED_SOURCE'
  )),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  correlation_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,actor_id,idempotency_key),
  FOREIGN KEY (tenant_id,recommendation_id,revision)
    REFERENCES recommendation.recommendation_revisions(tenant_id,recommendation_id,revision),
  FOREIGN KEY (tenant_id,revision_id)
    REFERENCES recommendation.recommendation_revisions(tenant_id,id)
);
CREATE INDEX recommendation_actor_interactions
  ON recommendation.recommendation_interactions(
    tenant_id,actor_id,recommendation_id,revision,interaction_type
  );

CREATE FUNCTION recommendation.reject_interaction_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Recommendation interactions are append-only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER recommendation_interaction_immutable
  BEFORE UPDATE OR DELETE ON recommendation.recommendation_interactions
  FOR EACH ROW EXECUTE FUNCTION recommendation.reject_interaction_mutation();
CREATE TRIGGER recommendation_interaction_no_truncate
  BEFORE TRUNCATE ON recommendation.recommendation_interactions
  FOR EACH STATEMENT EXECUTE FUNCTION recommendation.reject_interaction_mutation();

CREATE TABLE recommendation.source_watermarks (
  tenant_id text NOT NULL,
  source_family text NOT NULL CHECK (source_family IN (
    'INCIDENT_CORRELATION_REVIEW','KNOWLEDGE_GUIDANCE','ASSET_REPLACEMENT_REVIEW'
  )),
  last_success_at timestamptz,
  last_error_code text,
  source_generation text,
  available_count integer CHECK (available_count IS NULL OR available_count >= 0),
  last_duration_ms integer CHECK (last_duration_ms IS NULL OR last_duration_ms >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,source_family)
);
