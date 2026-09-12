CREATE TABLE procurement.cost_provenance (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('ASSET','LICENSE_ENTITLEMENT','LICENSE_POOL')),
  target_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('PURCHASE_ORDER','INVOICE','CREDIT_NOTE','CONTRACT','CONTRACT_VERSION')),
  source_document_id uuid NOT NULL,
  source_document_version_ref text NOT NULL CHECK (length(btrim(source_document_version_ref)) BETWEEN 1 AND 300),
  source_line_id uuid,
  cost_basis text NOT NULL CHECK (cost_basis IN ('COMMITTED','ACTUAL','ADJUSTMENT')),
  adjustment_direction text CHECK (adjustment_direction IN ('CREDIT','DEBIT')),
  source_amount numeric(20,6) NOT NULL CHECK (source_amount >= 0),
  source_currency char(3) NOT NULL CHECK (source_currency ~ '^[A-Z]{3}$'),
  quantity_basis numeric(20,6) NOT NULL CHECK (quantity_basis > 0),
  allocation_method text NOT NULL CHECK (length(btrim(allocation_method)) BETWEEN 1 AND 100),
  allocation_role text NOT NULL CHECK (length(btrim(allocation_role)) BETWEEN 1 AND 100),
  effective_from timestamptz,
  effective_to timestamptz,
  idempotency_identity char(64) NOT NULL CHECK (idempotency_identity ~ '^[0-9a-f]{64}$'),
  correlation_id text NOT NULL,
  audit_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,idempotency_identity),
  -- Source and target references are polymorphic; the owning-domain application
  -- command validates their canonical tenant-scoped identity before insertion.
  CHECK ((cost_basis='ADJUSTMENT' AND adjustment_direction IS NOT NULL) OR (cost_basis<>'ADJUSTMENT' AND adjustment_direction IS NULL)),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_from < effective_to)
);
CREATE INDEX cost_provenance_target_idx ON procurement.cost_provenance(tenant_id,target_type,target_id,created_at);
CREATE INDEX cost_provenance_source_idx ON procurement.cost_provenance(tenant_id,source_type,source_document_id,source_line_id);

CREATE TABLE procurement.cost_provenance_retries (
  tenant_id text NOT NULL,
  event_id uuid NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','FAILED')),
  failure_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,event_id)
);
CREATE INDEX cost_provenance_retry_due_idx ON procurement.cost_provenance_retries(status,next_attempt_at);

CREATE FUNCTION procurement.reject_cost_provenance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Cost provenance is immutable; append a correction or adjustment' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER cost_provenance_append_only BEFORE UPDATE OR DELETE ON procurement.cost_provenance FOR EACH ROW EXECUTE FUNCTION procurement.reject_cost_provenance_mutation();

CREATE FUNCTION procurement.reject_cost_provenance_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Cost provenance is immutable; append a correction or adjustment' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER cost_provenance_no_truncate BEFORE TRUNCATE ON procurement.cost_provenance FOR EACH STATEMENT EXECUTE FUNCTION procurement.reject_cost_provenance_truncate();

CREATE VIEW procurement.cost_provenance_summary AS
SELECT tenant_id,target_type,target_id,source_currency,
       sum(source_amount) FILTER (WHERE cost_basis='COMMITTED') AS committed_amount,
       sum(source_amount) FILTER (WHERE cost_basis='ACTUAL') AS actual_amount,
       sum(CASE WHEN adjustment_direction='CREDIT' THEN -source_amount
                WHEN adjustment_direction='DEBIT' THEN source_amount ELSE 0 END) AS adjustment_amount,
       CASE WHEN count(*) FILTER (WHERE cost_basis='ACTUAL')>0
            THEN sum(source_amount) FILTER (WHERE cost_basis='ACTUAL')
            ELSE sum(source_amount) FILTER (WHERE cost_basis='COMMITTED') END
         + sum(CASE WHEN adjustment_direction='CREDIT' THEN -source_amount
                    WHEN adjustment_direction='DEBIT' THEN source_amount ELSE 0 END) AS net_amount
  FROM procurement.cost_provenance
 GROUP BY tenant_id,target_type,target_id,source_currency;
