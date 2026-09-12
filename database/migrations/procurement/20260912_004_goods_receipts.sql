ALTER TABLE procurement.purchase_orders
  ADD CONSTRAINT purchase_orders_tenant_id_supplier_uq UNIQUE (tenant_id,id,supplier_id);
ALTER TABLE procurement.purchase_order_lines
  ADD CONSTRAINT purchase_order_lines_receipt_reference_uq UNIQUE (tenant_id,id,purchase_order_id,commercial_version);

CREATE TABLE procurement.goods_receipts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  receipt_code text NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','POSTED','CANCELLED')),
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  purchase_order_id uuid NOT NULL,
  purchase_order_code_snapshot text NOT NULL,
  purchase_order_commercial_version integer NOT NULL CHECK (purchase_order_commercial_version > 0),
  supplier_id uuid NOT NULL,
  supplier_display_snapshot text NOT NULL,
  warehouse_id uuid,
  location_id uuid,
  receiving_actor_id text NOT NULL,
  received_at timestamptz NOT NULL,
  posted_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  immutable_posted_snapshot jsonb,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,receipt_code),
  UNIQUE (tenant_id,id,purchase_order_id),
  FOREIGN KEY (tenant_id,purchase_order_id) REFERENCES procurement.purchase_orders(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,purchase_order_id,supplier_id) REFERENCES procurement.purchase_orders(tenant_id,id,supplier_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,location_id) REFERENCES asset.locations(tenant_id,id) ON DELETE RESTRICT,
  CHECK ((state='POSTED') = (posted_at IS NOT NULL AND immutable_posted_snapshot IS NOT NULL)),
  CHECK ((state='CANCELLED') = (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL))
);
CREATE INDEX goods_receipts_tenant_po_idx ON procurement.goods_receipts(tenant_id,purchase_order_id,created_at DESC);

CREATE TABLE procurement.goods_receipt_lines (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  goods_receipt_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL REFERENCES procurement.purchase_order_lines(id) ON DELETE RESTRICT,
  commercial_version integer NOT NULL CHECK (commercial_version > 0),
  ordered_quantity_snapshot numeric(18,4) NOT NULL CHECK (ordered_quantity_snapshot > 0),
  previously_accepted_quantity_at_post numeric(18,4) NOT NULL DEFAULT 0 CHECK (previously_accepted_quantity_at_post >= 0),
  observed_quantity numeric(18,4) NOT NULL CHECK (observed_quantity >= 0),
  accepted_quantity numeric(18,4) NOT NULL CHECK (accepted_quantity >= 0),
  rejected_or_damaged_quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK (rejected_or_damaged_quantity >= 0),
  unit text,
  item_reference_id text,
  item_type text NOT NULL,
  description_snapshot text NOT NULL,
  evidence_document_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence_document_refs)='array'),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,goods_receipt_id,id),
  UNIQUE (tenant_id,goods_receipt_id,purchase_order_line_id),
  FOREIGN KEY (tenant_id,goods_receipt_id,purchase_order_id) REFERENCES procurement.goods_receipts(tenant_id,id,purchase_order_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,purchase_order_id) REFERENCES procurement.purchase_orders(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,purchase_order_line_id,purchase_order_id,commercial_version) REFERENCES procurement.purchase_order_lines(tenant_id,id,purchase_order_id,commercial_version) ON DELETE RESTRICT,
  CHECK (accepted_quantity + rejected_or_damaged_quantity <= observed_quantity)
);
CREATE INDEX goods_receipt_lines_po_line_idx ON procurement.goods_receipt_lines(tenant_id,purchase_order_line_id);

CREATE TABLE procurement.goods_receipt_units (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  goods_receipt_id uuid NOT NULL,
  goods_receipt_line_id uuid NOT NULL,
  identity_type text NOT NULL,
  identity_value text NOT NULL CHECK (length(btrim(identity_value)) BETWEEN 1 AND 300),
  serial_number text NOT NULL CHECK (length(btrim(serial_number)) BETWEEN 1 AND 200),
  accepted boolean NOT NULL DEFAULT true,
  condition text NOT NULL DEFAULT 'ACCEPTED',
  evidence_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence_refs)='array'),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,goods_receipt_id,id),
  FOREIGN KEY (tenant_id,goods_receipt_id) REFERENCES procurement.goods_receipts(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,goods_receipt_id,goods_receipt_line_id) REFERENCES procurement.goods_receipt_lines(tenant_id,goods_receipt_id,id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,goods_receipt_id,identity_type,identity_value)
);
CREATE INDEX goods_receipt_units_pending_idx ON procurement.goods_receipt_units(tenant_id,goods_receipt_id) WHERE accepted;
CREATE UNIQUE INDEX goods_receipt_units_receipt_serial_uq ON procurement.goods_receipt_units(tenant_id,goods_receipt_id,lower(serial_number));

CREATE TABLE procurement.receiving_exceptions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  goods_receipt_id uuid NOT NULL,
  goods_receipt_line_id uuid,
  received_unit_id uuid,
  exception_type text NOT NULL,
  blocking boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','WAIVED')),
  reason text NOT NULL,
  observed_facts jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(observed_facts)='object'),
  evidence_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence_refs)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,goods_receipt_id) REFERENCES procurement.goods_receipts(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,goods_receipt_id,goods_receipt_line_id) REFERENCES procurement.goods_receipt_lines(tenant_id,goods_receipt_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,goods_receipt_id,received_unit_id) REFERENCES procurement.goods_receipt_units(tenant_id,goods_receipt_id,id) ON DELETE RESTRICT
);

CREATE TABLE procurement.receipt_assetization_state (
  tenant_id text NOT NULL,
  received_unit_id uuid NOT NULL,
  goods_receipt_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','REGISTERED','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  failure_code text,
  asset_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,received_unit_id),
  FOREIGN KEY (tenant_id,goods_receipt_id,received_unit_id) REFERENCES procurement.goods_receipt_units(tenant_id,goods_receipt_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,goods_receipt_id) REFERENCES procurement.goods_receipts(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE procurement.goods_receipt_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  goods_receipt_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  action text NOT NULL,
  before_snapshot jsonb,
  after_snapshot jsonb NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,goods_receipt_id,aggregate_version),
  FOREIGN KEY (tenant_id,goods_receipt_id) REFERENCES procurement.goods_receipts(tenant_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION procurement.guard_goods_receipt_children() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_state text; receipt_id uuid;
BEGIN
  receipt_id := CASE WHEN TG_OP='DELETE' THEN OLD.goods_receipt_id ELSE NEW.goods_receipt_id END;
  SELECT state INTO receipt_state FROM procurement.goods_receipts
   WHERE tenant_id=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END AND id=receipt_id FOR UPDATE;
  IF receipt_state IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Goods Receipt children are immutable outside DRAFT' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER goods_receipt_lines_draft_only BEFORE INSERT OR UPDATE OR DELETE ON procurement.goods_receipt_lines FOR EACH ROW EXECUTE FUNCTION procurement.guard_goods_receipt_children();
CREATE TRIGGER goods_receipt_units_draft_only BEFORE INSERT OR UPDATE OR DELETE ON procurement.goods_receipt_units FOR EACH ROW EXECUTE FUNCTION procurement.guard_goods_receipt_children();
CREATE TRIGGER receiving_exceptions_draft_only BEFORE INSERT OR UPDATE OR DELETE ON procurement.receiving_exceptions FOR EACH ROW EXECUTE FUNCTION procurement.guard_goods_receipt_children();

CREATE FUNCTION procurement.guard_goods_receipt_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invalid_line boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Goods Receipts cannot be deleted' USING ERRCODE='55000'; END IF;
  IF OLD.state IN ('POSTED','CANCELLED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal Goods Receipt is immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (OLD.state='DRAFT' AND NEW.state IN ('POSTED','CANCELLED')) THEN
    RAISE EXCEPTION 'Invalid Goods Receipt transition' USING ERRCODE='23514';
  END IF;
  IF OLD.state='DRAFT' AND NEW.state='POSTED' THEN
    PERFORM 1 FROM procurement.purchase_orders WHERE tenant_id=NEW.tenant_id AND id=NEW.purchase_order_id AND lifecycle_state='ISSUED' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only an ISSUED PO can be received' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS (SELECT 1 FROM procurement.goods_receipt_lines WHERE tenant_id=NEW.tenant_id AND goods_receipt_id=NEW.id) THEN
      RAISE EXCEPTION 'Posted Goods Receipt requires lines' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM procurement.receiving_exceptions WHERE tenant_id=NEW.tenant_id AND goods_receipt_id=NEW.id AND blocking AND status='OPEN') THEN
      RAISE EXCEPTION 'Blocking receiving exception prevents POST' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM procurement.goods_receipt_lines gl JOIN procurement.purchase_order_lines pl
        ON pl.tenant_id=gl.tenant_id AND pl.id=gl.purchase_order_line_id AND pl.purchase_order_id=gl.purchase_order_id AND pl.commercial_version=gl.commercial_version
       WHERE gl.tenant_id=NEW.tenant_id AND gl.goods_receipt_id=NEW.id AND gl.accepted_quantity<=0
    ) THEN RAISE EXCEPTION 'Posted receipt lines require positive accepted quantities' USING ERRCODE='23514'; END IF;
    IF EXISTS (
      SELECT 1 FROM procurement.goods_receipt_lines gl
       WHERE gl.tenant_id=NEW.tenant_id AND gl.goods_receipt_id=NEW.id AND upper(gl.item_type) IN ('ASSET','ASSET_TRACKED')
         AND gl.accepted_quantity<>(SELECT count(*) FROM procurement.goods_receipt_units u WHERE u.tenant_id=gl.tenant_id AND u.goods_receipt_line_id=gl.id AND u.accepted)
    ) THEN RAISE EXCEPTION 'Asset-tracked accepted units require serialized unit identities' USING ERRCODE='23514'; END IF;
    SELECT EXISTS (
      SELECT 1 FROM procurement.goods_receipt_lines current_line
        JOIN procurement.purchase_order_lines pol ON pol.tenant_id=current_line.tenant_id AND pol.id=current_line.purchase_order_line_id
       WHERE current_line.tenant_id=NEW.tenant_id AND current_line.goods_receipt_id=NEW.id
       GROUP BY pol.id,pol.quantity
       HAVING sum(current_line.accepted_quantity) + COALESCE((
         SELECT sum(prior_line.accepted_quantity) FROM procurement.goods_receipt_lines prior_line
           JOIN procurement.goods_receipts prior_receipt ON prior_receipt.tenant_id=prior_line.tenant_id AND prior_receipt.id=prior_line.goods_receipt_id
          WHERE prior_line.tenant_id=NEW.tenant_id AND prior_line.purchase_order_line_id=pol.id AND prior_receipt.state='POSTED'
       ),0) > pol.quantity
    ) INTO invalid_line;
    IF invalid_line THEN RAISE EXCEPTION 'Cumulative accepted quantity exceeds ordered quantity' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER goods_receipts_immutable BEFORE UPDATE OR DELETE ON procurement.goods_receipts FOR EACH ROW EXECUTE FUNCTION procurement.guard_goods_receipt_state();

CREATE FUNCTION procurement.reject_goods_receipt_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Goods Receipt history is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER goods_receipt_history_append_only BEFORE UPDATE OR DELETE ON procurement.goods_receipt_history FOR EACH ROW EXECUTE FUNCTION procurement.reject_goods_receipt_history_mutation();

ALTER TABLE operations.work_items DROP CONSTRAINT work_items_source_type_check;
ALTER TABLE operations.work_items ADD CONSTRAINT work_items_source_type_check CHECK (source_type IN ('TICKET','INCIDENT','APPROVAL','NETWORK_EXCEPTION','OFFBOARDING','SOFTWARE_EXCEPTION','ASSET_LIFECYCLE','GOODS_RECEIPT'));

INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
 (gen_random_uuid(),'goods_receipt.read','goods_receipt','read'),
 (gen_random_uuid(),'goods_receipt.create','goods_receipt','create'),
 (gen_random_uuid(),'goods_receipt.update','goods_receipt','update'),
 (gen_random_uuid(),'goods_receipt.post','goods_receipt','post'),
 (gen_random_uuid(),'goods_receipt.cancel','goods_receipt','cancel')
ON CONFLICT (code) DO NOTHING;
