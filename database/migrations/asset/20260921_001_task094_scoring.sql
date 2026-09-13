CREATE TABLE asset.replacement_policies (
  id uuid NOT NULL,
  tenant_id text NOT NULL,
  category_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  expected_life_months integer NOT NULL CHECK (expected_life_months > 0),
  created_by_type text NOT NULL,
  created_by_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,category_id,version),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,category_id) REFERENCES asset.categories(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX replacement_policy_latest_idx
  ON asset.replacement_policies(tenant_id,category_id,version DESC);

CREATE TABLE asset.acquisition_evidence (
  id uuid NOT NULL,
  tenant_id text NOT NULL,
  asset_id uuid NOT NULL,
  acquired_on date NOT NULL,
  provenance_type text NOT NULL CHECK (provenance_type IN ('IMPORT_VERIFIED','MANUAL_VERIFIED')),
  source_reference text NOT NULL CHECK (length(btrim(source_reference)) > 0),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX acquisition_evidence_latest_idx
  ON asset.acquisition_evidence(tenant_id,asset_id,created_at DESC,id DESC);

CREATE TABLE asset.risk_assessments (
  id uuid NOT NULL,
  tenant_id text NOT NULL,
  asset_id uuid NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  band text NOT NULL CHECK (band IN ('LOW','MEDIUM','HIGH','CRITICAL','UNKNOWN')),
  completeness integer NOT NULL CHECK (completeness BETWEEN 0 AND 100),
  profile_id text NOT NULL,
  profile_version text NOT NULL,
  contributions jsonb NOT NULL CHECK (jsonb_typeof(contributions)='object'),
  missing_evidence jsonb NOT NULL CHECK (jsonb_typeof(missing_evidence)='array'),
  evidence_references jsonb NOT NULL CHECK (jsonb_typeof(evidence_references)='object'),
  evidence_identity char(64) NOT NULL CHECK (evidence_identity ~ '^[0-9a-f]{64}$'),
  trigger text NOT NULL,
  calculated_at timestamptz NOT NULL,
  as_of timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  correlation_id text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,asset_id,evidence_identity),
  FOREIGN KEY (tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id) ON DELETE RESTRICT,
  CHECK (valid_until=calculated_at + interval '24 hours')
);
CREATE INDEX risk_assessments_history_idx
  ON asset.risk_assessments(tenant_id,asset_id,calculated_at DESC,id DESC);

CREATE TABLE asset.replacement_assessments (
  id uuid NOT NULL,
  tenant_id text NOT NULL,
  asset_id uuid NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  band text NOT NULL CHECK (band IN ('MONITOR','REVIEW','PLAN','PRIORITY','UNKNOWN')),
  completeness integer NOT NULL CHECK (completeness BETWEEN 0 AND 100),
  profile_id text NOT NULL,
  profile_version text NOT NULL,
  risk_assessment_id uuid,
  policy_id uuid,
  policy_version integer,
  contributions jsonb NOT NULL CHECK (jsonb_typeof(contributions)='object'),
  missing_evidence jsonb NOT NULL CHECK (jsonb_typeof(missing_evidence)='array'),
  evidence_references jsonb NOT NULL CHECK (jsonb_typeof(evidence_references)='object'),
  evidence_identity char(64) NOT NULL CHECK (evidence_identity ~ '^[0-9a-f]{64}$'),
  trigger text NOT NULL,
  calculated_at timestamptz NOT NULL,
  as_of timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  correlation_id text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,asset_id,evidence_identity),
  FOREIGN KEY (tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,risk_assessment_id) REFERENCES asset.risk_assessments(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,policy_id) REFERENCES asset.replacement_policies(tenant_id,id) ON DELETE RESTRICT,
  CHECK ((policy_id IS NULL) = (policy_version IS NULL)),
  CHECK (valid_until=calculated_at + interval '24 hours')
);
CREATE INDEX replacement_assessments_history_idx
  ON asset.replacement_assessments(tenant_id,asset_id,calculated_at DESC,id DESC);

CREATE TABLE asset.scoring_latest (
  tenant_id text NOT NULL,
  asset_id uuid NOT NULL,
  risk_assessment_id uuid,
  replacement_assessment_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,asset_id),
  FOREIGN KEY (tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,risk_assessment_id) REFERENCES asset.risk_assessments(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,replacement_assessment_id) REFERENCES asset.replacement_assessments(tenant_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION asset.reject_scoring_assessment_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Scoring assessment history is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER risk_assessment_append_only BEFORE UPDATE OR DELETE ON asset.risk_assessments FOR EACH ROW EXECUTE FUNCTION asset.reject_scoring_assessment_mutation();
CREATE TRIGGER replacement_assessment_append_only BEFORE UPDATE OR DELETE ON asset.replacement_assessments FOR EACH ROW EXECUTE FUNCTION asset.reject_scoring_assessment_mutation();
CREATE FUNCTION asset.reject_scoring_policy_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Replacement policy versions are immutable' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER replacement_policy_append_only BEFORE UPDATE OR DELETE ON asset.replacement_policies FOR EACH ROW EXECUTE FUNCTION asset.reject_scoring_policy_mutation();
CREATE FUNCTION asset.reject_acquisition_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Verified acquisition evidence is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER acquisition_evidence_append_only BEFORE UPDATE OR DELETE ON asset.acquisition_evidence FOR EACH ROW EXECUTE FUNCTION asset.reject_acquisition_evidence_mutation();

ALTER TABLE asset.assets
  ADD COLUMN risk_assessment_id uuid,
  ADD COLUMN risk_assessment_valid_until timestamptz;
ALTER TABLE asset.assets
  ADD CONSTRAINT asset_risk_assessment_reference
  FOREIGN KEY (tenant_id,risk_assessment_id) REFERENCES asset.risk_assessments(tenant_id,id) ON DELETE RESTRICT;

INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
 ('a0940400-0000-4000-8000-000000000001','asset.scoring.read','asset','scoring.read'),
 ('a0940400-0000-4000-8000-000000000002','asset.scoring.recalculate','asset','scoring.recalculate'),
 ('a0940400-0000-4000-8000-000000000003','asset.scoring.manage_policy','asset_replacement_policy','manage'),
 ('a0940400-0000-4000-8000-000000000004','asset.acquisition.verify','asset','acquisition.verify'),
 ('a0940400-0000-4000-8000-000000000005','asset.cost_evidence.read','asset_cost_evidence','read')
 ,('a0940400-0000-4000-8000-000000000006','goods_receipt.asset_provenance.read','goods_receipt_asset_provenance','read')
ON CONFLICT(code) DO UPDATE SET resource_type=EXCLUDED.resource_type,action=EXCLUDED.action;
