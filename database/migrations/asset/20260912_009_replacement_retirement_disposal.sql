CREATE TABLE asset.replacement_plans (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, asset_id uuid NOT NULL,
  new_asset_id uuid, state text NOT NULL, score numeric(8,3), reasons jsonb NOT NULL,
  assessment jsonb NOT NULL DEFAULT '{}', target_user_id uuid, target_model text,
  budget jsonb, target_date date, procurement_required boolean NOT NULL DEFAULT false,
  migration_required boolean NOT NULL DEFAULT true, review_date date,
  risk_acceptance text, reason text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id),
  FOREIGN KEY(tenant_id,new_asset_id) REFERENCES asset.assets(tenant_id,id),
  FOREIGN KEY(tenant_id,target_user_id) REFERENCES identity.users(tenant_id,id),
  CHECK(state IN ('UNDER_REVIEW','APPROVED','PLANNED','PROCUREMENT','NEW_ASSET_READY','MIGRATING','REPLACED','CANCELLED')),
  CHECK(jsonb_typeof(reasons)='array'), CHECK(jsonb_typeof(assessment)='object')
);
CREATE UNIQUE INDEX asset_one_active_replacement_plan ON asset.replacement_plans(tenant_id,asset_id)
 WHERE state NOT IN ('REPLACED','CANCELLED');
CREATE TABLE asset.replacement_history (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, plan_id uuid NOT NULL, entity_version integer NOT NULL CHECK(entity_version>0),
  action text NOT NULL, snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), actor_id text NOT NULL,
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,plan_id,entity_version),
  FOREIGN KEY(tenant_id,plan_id) REFERENCES asset.replacement_plans(tenant_id,id)
);
CREATE TABLE asset.retirement_records (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, asset_id uuid NOT NULL, state text NOT NULL DEFAULT 'CANDIDATE',
  approval_id uuid, clearances jsonb NOT NULL DEFAULT '{}', reason text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id),
  CHECK(state IN ('CANDIDATE','APPROVED','RETIRED','BLOCKED'))
);
CREATE UNIQUE INDEX asset_one_open_retirement ON asset.retirement_records(tenant_id,asset_id) WHERE state IN ('CANDIDATE','APPROVED','BLOCKED');
CREATE TABLE asset.data_wipe_jobs (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, asset_id uuid NOT NULL, retirement_id uuid NOT NULL,
  agent_id uuid NOT NULL, state text NOT NULL DEFAULT 'QUEUED', method text NOT NULL,
  generation integer NOT NULL DEFAULT 1 CHECK(generation>0), approval_id uuid NOT NULL,
  claimed_at timestamptz, completed_at timestamptz, result text, verification_result text,
  evidence_document_id text, evidence_storage_ref text, evidence_checksum text,
  report_key text, failure_code text, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,asset_id,generation), UNIQUE(tenant_id,agent_id,report_key),
  FOREIGN KEY(tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id),
  FOREIGN KEY(tenant_id,retirement_id) REFERENCES asset.retirement_records(tenant_id,id),
  CHECK(state IN ('QUEUED','CLAIMED','COMPLETED','FAILED')),
  CHECK(method IN ('CRYPTOGRAPHIC_ERASE','NIST_CLEAR','NIST_PURGE','PHYSICAL_DESTRUCTION')),
  CHECK(result IS NULL OR result IN ('PASS','FAIL','NOT_APPLICABLE','PHYSICAL_DESTRUCTION_REQUIRED')),
  CHECK(state <> 'COMPLETED' OR (result IN ('PASS','NOT_APPLICABLE','PHYSICAL_DESTRUCTION_REQUIRED') AND evidence_document_id IS NOT NULL AND evidence_checksum ~ '^[a-fA-F0-9]{64}$'))
);
CREATE INDEX asset_wipe_claim_idx ON asset.data_wipe_jobs(tenant_id,agent_id,state,created_at);
CREATE TABLE asset.disposal_records (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, asset_id uuid NOT NULL, retirement_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'PENDING', method text NOT NULL, approval_id uuid NOT NULL,
  cleanup_clearances jsonb NOT NULL DEFAULT '{}', physical_evidence_id text, physical_evidence_checksum text,
  confirmed_at timestamptz, reason text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id),
  FOREIGN KEY(tenant_id,retirement_id) REFERENCES asset.retirement_records(tenant_id,id),
  CHECK(state IN ('PENDING','COMPLETED')),
  CHECK(method IN ('REUSE_INTERNAL','SELL','RECYCLE','RETURN_VENDOR','DONATE','DESTROY')),
  CHECK(method='REUSE_INTERNAL' OR (physical_evidence_id IS NOT NULL AND physical_evidence_checksum ~ '^[a-fA-F0-9]{64}$'))
);
CREATE UNIQUE INDEX asset_one_open_disposal ON asset.disposal_records(tenant_id,asset_id) WHERE state='PENDING';
CREATE TABLE asset.lifecycle_evidence_history (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, asset_id uuid NOT NULL, related_id uuid NOT NULL,
  evidence_type text NOT NULL, payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  actor_id text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id)
);
CREATE FUNCTION asset.reject_lifecycle_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Asset workflow history is append-only' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER replacement_history_immutable BEFORE UPDATE OR DELETE ON asset.replacement_history FOR EACH ROW EXECUTE FUNCTION asset.reject_lifecycle_history_mutation();
CREATE TRIGGER lifecycle_evidence_immutable BEFORE UPDATE OR DELETE ON asset.lifecycle_evidence_history FOR EACH ROW EXECUTE FUNCTION asset.reject_lifecycle_history_mutation();
CREATE TRIGGER disposal_records_immutable BEFORE UPDATE OR DELETE ON asset.disposal_records FOR EACH ROW EXECUTE FUNCTION asset.reject_lifecycle_history_mutation();
INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
 (gen_random_uuid(),'replacement.create_candidate','replacement','create_candidate'),(gen_random_uuid(),'replacement.review','replacement','review'),
 (gen_random_uuid(),'asset.dispose','asset','dispose'),(gen_random_uuid(),'asset.reactivate','asset','reactivate'),(gen_random_uuid(),'data_wipe.execute','data_wipe','execute')
ON CONFLICT(code) DO NOTHING;
