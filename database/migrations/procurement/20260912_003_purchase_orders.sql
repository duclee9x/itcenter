CREATE TABLE procurement.purchase_orders (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  code text NOT NULL,
  procurement_request_id uuid,
  rfq_id uuid,
  supplier_id uuid NOT NULL,
  source_quotation_id uuid,
  issue_approval_request_id uuid,
  amendment_approval_request_id uuid,
  issued_at timestamptz,
  expected_delivery date,
  lifecycle_state text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_state IN ('DRAFT','ISSUED','ON_HOLD','CLOSED','CANCELLED')),
  receipt_state text NOT NULL DEFAULT 'NOT_RECEIVED' CHECK (receipt_state IN ('NOT_RECEIVED','PARTIALLY_RECEIVED','FULLY_RECEIVED')),
  -- TASK-073 increments this in the same transaction as its canonical receipt insert.
  committed_receipt_count integer NOT NULL DEFAULT 0 CHECK (committed_receipt_count >= 0),
  received_quantities jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(received_quantities)='object'),
  remaining_quantities jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(remaining_quantities)='object'),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  draft_snapshot jsonb NOT NULL CHECK (jsonb_typeof(draft_snapshot)='object'),
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  current_commercial_version integer CHECK (current_commercial_version IS NULL OR current_commercial_version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,code),
  FOREIGN KEY (tenant_id,procurement_request_id) REFERENCES procurement.procurement_requests(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,rfq_id) REFERENCES procurement.rfqs(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,supplier_id) REFERENCES procurement.suppliers(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,rfq_id,source_quotation_id,supplier_id) REFERENCES procurement.quotations(tenant_id,rfq_id,id,supplier_id) ON DELETE RESTRICT,
  CHECK ((rfq_id IS NULL) = (source_quotation_id IS NULL)),
  CHECK (
    (lifecycle_state='DRAFT' AND current_commercial_version IS NULL)
    OR (lifecycle_state IN ('ISSUED','ON_HOLD','CLOSED') AND current_commercial_version IS NOT NULL)
    OR (lifecycle_state='CANCELLED')
  ),
  CHECK ((receipt_state='NOT_RECEIVED') = (committed_receipt_count=0))
);
CREATE INDEX purchase_orders_tenant_state_created_idx ON procurement.purchase_orders(tenant_id,lifecycle_state,created_at DESC,id);

CREATE TABLE procurement.purchase_order_versions (
  tenant_id text NOT NULL,
  purchase_order_id uuid NOT NULL,
  commercial_version integer NOT NULL CHECK (commercial_version > 0),
  base_aggregate_version integer NOT NULL CHECK (base_aggregate_version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  snapshot_hash char(64) NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  approval_request_id uuid,
  actor_id text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,purchase_order_id,commercial_version),
  FOREIGN KEY (tenant_id,purchase_order_id) REFERENCES procurement.purchase_orders(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE procurement.purchase_order_lines (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  purchase_order_id uuid NOT NULL,
  commercial_version integer,
  line_no integer NOT NULL CHECK (line_no > 0),
  item_type text NOT NULL DEFAULT 'GOODS',
  item_reference_id text,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 1000),
  unit text,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(18,2) NOT NULL CHECK (unit_price >= 0),
  tax_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  discount_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total numeric(18,2) NOT NULL CHECK (total >= 0),
  expected_delivery date,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,purchase_order_id) REFERENCES procurement.purchase_orders(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,purchase_order_id,commercial_version)
    REFERENCES procurement.purchase_order_versions(tenant_id,purchase_order_id,commercial_version) ON DELETE RESTRICT,
  CHECK (commercial_version IS NULL OR commercial_version > 0)
);
CREATE UNIQUE INDEX purchase_order_lines_version_line_uq
  ON procurement.purchase_order_lines(tenant_id,purchase_order_id,COALESCE(commercial_version,0),line_no);
CREATE INDEX purchase_order_lines_receipt_reference_idx
  ON procurement.purchase_order_lines(tenant_id,purchase_order_id,commercial_version,line_no);

CREATE FUNCTION procurement.protect_issued_po_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP='DELETE' AND OLD.commercial_version IS NOT NULL)
     OR (TG_OP='UPDATE' AND (OLD.commercial_version IS NOT NULL OR NEW.commercial_version IS NOT NULL)) THEN
    RAISE EXCEPTION 'Committed PO commercial lines are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.commercial_version IS NULL AND NOT EXISTS (
    SELECT 1 FROM procurement.purchase_orders
     WHERE tenant_id=NEW.tenant_id AND id=NEW.purchase_order_id AND lifecycle_state='DRAFT'
  ) THEN
    RAISE EXCEPTION 'Draft PO lines cannot be added after issue' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' AND NOT EXISTS (
    SELECT 1 FROM procurement.purchase_orders
     WHERE tenant_id=OLD.tenant_id AND id=OLD.purchase_order_id AND lifecycle_state='DRAFT'
  ) THEN
    RAISE EXCEPTION 'Draft PO lines cannot be removed after issue' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_order_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON procurement.purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION procurement.protect_issued_po_lines();

CREATE TABLE procurement.purchase_order_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  purchase_order_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  action text NOT NULL,
  previous_lifecycle_state text,
  lifecycle_state text NOT NULL,
  previous_receipt_state text,
  receipt_state text NOT NULL,
  commercial_version integer,
  before_snapshot jsonb CHECK (before_snapshot IS NULL OR jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb NOT NULL CHECK (jsonb_typeof(after_snapshot)='object'),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,purchase_order_id,aggregate_version),
  FOREIGN KEY (tenant_id,purchase_order_id) REFERENCES procurement.purchase_orders(tenant_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION procurement.reject_po_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Purchase order history and commercial versions are append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER purchase_order_history_append_only BEFORE UPDATE OR DELETE ON procurement.purchase_order_history FOR EACH ROW EXECUTE FUNCTION procurement.reject_po_history_mutation();
CREATE TRIGGER purchase_order_versions_append_only BEFORE UPDATE OR DELETE ON procurement.purchase_order_versions FOR EACH ROW EXECUTE FUNCTION procurement.reject_po_history_mutation();
CREATE TRIGGER purchase_orders_no_hard_delete BEFORE DELETE ON procurement.purchase_orders FOR EACH ROW EXECUTE FUNCTION procurement.reject_po_history_mutation();

CREATE FUNCTION procurement.protect_issued_po_commercials() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lifecycle_state IN ('CLOSED','CANCELLED')
     AND NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    RAISE EXCEPTION 'Terminal PO lifecycle state cannot transition' USING ERRCODE='55000';
  END IF;
  IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state AND NOT (
    (OLD.lifecycle_state='DRAFT' AND NEW.lifecycle_state IN ('ISSUED','CANCELLED'))
    OR (OLD.lifecycle_state='ISSUED' AND NEW.lifecycle_state IN ('ON_HOLD','CANCELLED','CLOSED'))
    OR (OLD.lifecycle_state='ON_HOLD' AND NEW.lifecycle_state IN ('ISSUED','CANCELLED','CLOSED'))
  ) THEN
    RAISE EXCEPTION 'Invalid PO lifecycle transition' USING ERRCODE='23514';
  END IF;
  IF NEW.lifecycle_state='CANCELLED'
     AND (NEW.receipt_state<>'NOT_RECEIVED' OR NEW.committed_receipt_count<>0) THEN
    RAISE EXCEPTION 'A PO with a committed receipt cannot be cancelled' USING ERRCODE='23514';
  END IF;
  IF NEW.lifecycle_state='CLOSED'
     AND NEW.receipt_state NOT IN ('PARTIALLY_RECEIVED','FULLY_RECEIVED') THEN
    RAISE EXCEPTION 'A PO can close only after receipt progression' USING ERRCODE='23514';
  END IF;
  IF NEW.receipt_state IS DISTINCT FROM OLD.receipt_state THEN
    IF OLD.lifecycle_state <> 'ISSUED' THEN
      RAISE EXCEPTION 'Receipt progression is allowed only while PO is issued' USING ERRCODE='23514';
    END IF;
    IF (OLD.receipt_state='PARTIALLY_RECEIVED' AND NEW.receipt_state='NOT_RECEIVED')
       OR (OLD.receipt_state='FULLY_RECEIVED' AND NEW.receipt_state<>'FULLY_RECEIVED') THEN
      RAISE EXCEPTION 'PO receipt state cannot regress' USING ERRCODE='23514';
    END IF;
  END IF;
  IF OLD.lifecycle_state <> 'DRAFT' AND (NEW.supplier_id,NEW.rfq_id,NEW.source_quotation_id,NEW.currency,NEW.draft_snapshot)
      IS DISTINCT FROM (OLD.supplier_id,OLD.rfq_id,OLD.source_quotation_id,OLD.currency,OLD.draft_snapshot) THEN
    RAISE EXCEPTION 'Issued PO commercial terms are versioned and immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.lifecycle_state <> 'DRAFT' AND NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
    RAISE EXCEPTION 'Supplier is immutable after PO issue' USING ERRCODE='55000';
  END IF;
  IF NEW.committed_receipt_count < OLD.committed_receipt_count THEN
    RAISE EXCEPTION 'Committed receipt count cannot decrease' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_order_commercial_immutability BEFORE UPDATE ON procurement.purchase_orders FOR EACH ROW EXECUTE FUNCTION procurement.protect_issued_po_commercials();

CREATE FUNCTION procurement.assert_po_commercial_version_exists() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_commercial_version IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM procurement.purchase_order_versions
     WHERE tenant_id=NEW.tenant_id AND purchase_order_id=NEW.id
       AND commercial_version=NEW.current_commercial_version
  ) THEN
    RAISE EXCEPTION 'Current PO commercial version must exist' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER purchase_order_current_version_invariant
  AFTER INSERT OR UPDATE ON procurement.purchase_orders DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION procurement.assert_po_commercial_version_exists();

CREATE FUNCTION procurement.assert_po_approval_links() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.issue_approval_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM control.approval_requests
     WHERE tenant_id=NEW.tenant_id AND id=NEW.issue_approval_request_id
       AND source_type='PO_ISSUE' AND source_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'PO issue approval link must target this PO in this tenant' USING ERRCODE='23514';
  END IF;
  IF NEW.amendment_approval_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM control.approval_requests
     WHERE tenant_id=NEW.tenant_id AND id=NEW.amendment_approval_request_id
       AND source_type='PO_AMENDMENT' AND source_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'PO amendment approval link must target this PO in this tenant' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER purchase_order_approval_link_invariant
  AFTER INSERT OR UPDATE ON procurement.purchase_orders DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION procurement.assert_po_approval_links();

INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
 (gen_random_uuid(),'po.read','purchase_order','read'),(gen_random_uuid(),'po.create','purchase_order','create'),(gen_random_uuid(),'po.update','purchase_order','update'),(gen_random_uuid(),'po.issue','purchase_order','issue'),(gen_random_uuid(),'po.hold','purchase_order','hold'),(gen_random_uuid(),'po.cancel','purchase_order','cancel'),(gen_random_uuid(),'po.amend','purchase_order','amend'),(gen_random_uuid(),'po.close','purchase_order','close')
ON CONFLICT (code) DO NOTHING;
