ALTER TABLE procurement.purchase_order_lines
  ADD CONSTRAINT purchase_order_lines_tenant_id_uq UNIQUE (tenant_id,id);

CREATE TABLE procurement.invoices (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  invoice_code text NOT NULL,
  supplier_id uuid NOT NULL,
  supplier_display_snapshot text NOT NULL,
  supplier_document_number_original text NOT NULL CHECK (length(btrim(supplier_document_number_original)) BETWEEN 1 AND 240),
  supplier_document_number_normalized text NOT NULL CHECK (length(btrim(supplier_document_number_normalized)) BETWEEN 1 AND 240),
  invoice_date date NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  tax_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  charge_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (charge_amount >= 0),
  charges jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(charges)='array'),
  gross_amount numeric(18,4) NOT NULL CHECK (gross_amount >= 0),
  purchase_order_id uuid NOT NULL,
  purchase_order_code_snapshot text NOT NULL,
  po_commercial_version integer NOT NULL CHECK (po_commercial_version > 0),
  lifecycle_state text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_state IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','CANCELLED')),
  match_status text NOT NULL DEFAULT 'NOT_EVALUATED' CHECK (match_status IN ('NOT_EVALUATED','PENDING_RECEIPT','MATCHED','MISMATCHED')),
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  submitted_snapshot jsonb CHECK (submitted_snapshot IS NULL OR jsonb_typeof(submitted_snapshot)='object'),
  snapshot_fingerprint char(64) CHECK (snapshot_fingerprint IS NULL OR snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  duplicate_fingerprint char(64) NOT NULL CHECK (duplicate_fingerprint ~ '^[0-9a-f]{64}$'),
  current_match_evaluation_id uuid,
  created_by text NOT NULL,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,invoice_code),
  UNIQUE (tenant_id,id,supplier_id,currency),
  FOREIGN KEY (tenant_id,supplier_id) REFERENCES procurement.suppliers(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,purchase_order_id) REFERENCES procurement.purchase_orders(tenant_id,id) ON DELETE RESTRICT,
  CHECK ((lifecycle_state IN ('SUBMITTED','APPROVED','REJECTED') AND submitted_snapshot IS NOT NULL AND snapshot_fingerprint IS NOT NULL AND submitted_at IS NOT NULL) OR lifecycle_state IN ('DRAFT','CANCELLED')),
  CHECK ((lifecycle_state='APPROVED') = (approved_at IS NOT NULL)),
  CHECK ((lifecycle_state='REJECTED') = (rejected_at IS NOT NULL)),
  CHECK ((lifecycle_state='CANCELLED') = (cancelled_at IS NOT NULL))
);
CREATE INDEX invoices_tenant_po_state_idx ON procurement.invoices(tenant_id,purchase_order_id,lifecycle_state,created_at DESC);
CREATE INDEX invoices_tenant_supplier_idx ON procurement.invoices(tenant_id,supplier_id,created_at DESC);

CREATE TABLE procurement.invoice_lines (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  invoice_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  purchase_order_line_id uuid,
  item_reference_id text,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 1000),
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit text,
  unit_price numeric(18,6) NOT NULL CHECK (unit_price >= 0),
  tax_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  discount_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  charge_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (charge_amount >= 0),
  line_total numeric(18,4) NOT NULL CHECK (line_total >= 0),
  evidence_document_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence_document_refs)='array'),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,invoice_id,id),
  UNIQUE (tenant_id,invoice_id,line_number),
  FOREIGN KEY (tenant_id,invoice_id) REFERENCES procurement.invoices(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,purchase_order_line_id) REFERENCES procurement.purchase_order_lines(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX invoice_lines_po_line_idx ON procurement.invoice_lines(tenant_id,purchase_order_line_id);

CREATE TABLE procurement.invoice_document_identity_reservations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  supplier_id uuid NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('INVOICE','CREDIT_NOTE')),
  supplier_document_number_normalized text NOT NULL,
  document_id uuid NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,supplier_id,document_type,supplier_document_number_normalized),
  UNIQUE (tenant_id,document_type,document_id),
  FOREIGN KEY (tenant_id,supplier_id) REFERENCES procurement.suppliers(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE procurement.invoice_duplicate_candidates (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('INVOICE','CREDIT_NOTE')),
  document_id uuid NOT NULL,
  candidate_document_id uuid NOT NULL,
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DISMISSED','CONFIRMED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,document_type,document_id,candidate_document_id),
  CHECK (document_id <> candidate_document_id)
);
CREATE INDEX invoice_duplicate_candidates_open_idx ON procurement.invoice_duplicate_candidates(tenant_id,document_type,document_id,status);

CREATE TABLE procurement.invoice_match_evaluations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  invoice_id uuid NOT NULL,
  evaluation_version integer NOT NULL CHECK (evaluation_version > 0),
  invoice_snapshot_fingerprint char(64) NOT NULL CHECK (invoice_snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  po_commercial_version integer NOT NULL CHECK (po_commercial_version > 0),
  receipt_evidence_fingerprint char(64) NOT NULL CHECK (receipt_evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  match_status text NOT NULL CHECK (match_status IN ('PENDING_RECEIPT','MATCHED','MISMATCHED')),
  reason_codes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(reason_codes)='array'),
  expected_values jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(expected_values)='object'),
  observed_values jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(observed_values)='object'),
  evaluation_fingerprint char(64) NOT NULL CHECK (evaluation_fingerprint ~ '^[0-9a-f]{64}$'),
  correlation_id text NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,invoice_id,evaluation_version),
  UNIQUE (tenant_id,invoice_id,id),
  FOREIGN KEY (tenant_id,invoice_id) REFERENCES procurement.invoices(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX invoice_match_evaluations_current_idx ON procurement.invoice_match_evaluations(tenant_id,invoice_id,evaluation_version DESC);
ALTER TABLE procurement.invoices
  ADD CONSTRAINT invoices_current_match_evaluation_fk
  FOREIGN KEY (tenant_id,id,current_match_evaluation_id)
  REFERENCES procurement.invoice_match_evaluations(tenant_id,invoice_id,id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE procurement.invoice_match_allocations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  invoice_id uuid NOT NULL,
  invoice_line_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  evaluation_id uuid NOT NULL,
  allocation_type text NOT NULL CHECK (allocation_type IN ('RECEIPT_MATCHED','APPROVED_EXCEPTION')),
  goods_receipt_id uuid,
  goods_receipt_line_id uuid,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,invoice_id,invoice_line_id) REFERENCES procurement.invoice_lines(tenant_id,invoice_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,purchase_order_line_id) REFERENCES procurement.purchase_order_lines(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,invoice_id,evaluation_id) REFERENCES procurement.invoice_match_evaluations(tenant_id,invoice_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,goods_receipt_id,goods_receipt_line_id) REFERENCES procurement.goods_receipt_lines(tenant_id,goods_receipt_id,id) ON DELETE RESTRICT,
  CHECK ((allocation_type='RECEIPT_MATCHED' AND goods_receipt_id IS NOT NULL AND goods_receipt_line_id IS NOT NULL) OR (allocation_type='APPROVED_EXCEPTION' AND goods_receipt_id IS NULL AND goods_receipt_line_id IS NULL))
);
CREATE INDEX invoice_match_allocations_capacity_idx ON procurement.invoice_match_allocations(tenant_id,purchase_order_line_id,allocation_type);
CREATE UNIQUE INDEX invoice_match_receipt_allocation_uq
  ON procurement.invoice_match_allocations(tenant_id,invoice_line_id,evaluation_id,goods_receipt_line_id)
  WHERE allocation_type='RECEIPT_MATCHED';
CREATE UNIQUE INDEX invoice_match_exception_allocation_uq
  ON procurement.invoice_match_allocations(tenant_id,invoice_line_id,evaluation_id)
  WHERE allocation_type='APPROVED_EXCEPTION';

CREATE TABLE procurement.invoice_match_exceptions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  invoice_id uuid NOT NULL,
  evaluation_id uuid NOT NULL,
  reason_codes jsonb NOT NULL CHECK (jsonb_typeof(reason_codes)='array'),
  expected_values jsonb NOT NULL CHECK (jsonb_typeof(expected_values)='object'),
  observed_values jsonb NOT NULL CHECK (jsonb_typeof(observed_values)='object'),
  evaluation_fingerprint char(64) NOT NULL CHECK (evaluation_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACCEPTED')),
  approval_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,invoice_id,evaluation_id),
  UNIQUE (tenant_id,invoice_id,id),
  FOREIGN KEY (tenant_id,invoice_id) REFERENCES procurement.invoices(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,invoice_id,evaluation_id) REFERENCES procurement.invoice_match_evaluations(tenant_id,invoice_id,id) ON DELETE RESTRICT
);

CREATE TABLE procurement.invoice_match_exception_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  match_exception_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('CREATED','ACCEPTED')),
  approval_request_id uuid,
  actor_id text NOT NULL,
  reason text,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,invoice_id,match_exception_id) REFERENCES procurement.invoice_match_exceptions(tenant_id,invoice_id,id) ON DELETE RESTRICT
);

CREATE TABLE procurement.credit_notes (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  credit_note_code text NOT NULL,
  supplier_id uuid NOT NULL,
  supplier_display_snapshot text NOT NULL,
  supplier_document_number_original text NOT NULL CHECK (length(btrim(supplier_document_number_original)) BETWEEN 1 AND 240),
  supplier_document_number_normalized text NOT NULL CHECK (length(btrim(supplier_document_number_normalized)) BETWEEN 1 AND 240),
  document_date date NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  invoice_id uuid NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_state IN ('DRAFT','SUBMITTED','APPLIED','REJECTED','CANCELLED')),
  aggregate_version integer NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  submitted_snapshot jsonb CHECK (submitted_snapshot IS NULL OR jsonb_typeof(submitted_snapshot)='object'),
  snapshot_fingerprint char(64) CHECK (snapshot_fingerprint IS NULL OR snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  duplicate_fingerprint char(64) NOT NULL CHECK (duplicate_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by text NOT NULL,
  submitted_at timestamptz,
  applied_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,credit_note_code),
  UNIQUE (tenant_id,id,supplier_id,currency,invoice_id),
  FOREIGN KEY (tenant_id,invoice_id,supplier_id,currency) REFERENCES procurement.invoices(tenant_id,id,supplier_id,currency) ON DELETE RESTRICT,
  CHECK ((lifecycle_state IN ('SUBMITTED','APPLIED','REJECTED') AND submitted_snapshot IS NOT NULL AND snapshot_fingerprint IS NOT NULL AND submitted_at IS NOT NULL) OR lifecycle_state IN ('DRAFT','CANCELLED')),
  CHECK ((lifecycle_state='APPLIED') = (applied_at IS NOT NULL)),
  CHECK ((lifecycle_state='REJECTED') = (rejected_at IS NOT NULL)),
  CHECK ((lifecycle_state='CANCELLED') = (cancelled_at IS NOT NULL))
);
CREATE INDEX credit_notes_invoice_idx ON procurement.credit_notes(tenant_id,invoice_id,lifecycle_state);

CREATE TABLE procurement.credit_note_lines (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  credit_note_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  invoice_line_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  credited_quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK (credited_quantity >= 0),
  credited_amount numeric(18,4) NOT NULL DEFAULT 0 CHECK (credited_amount >= 0),
  reason text,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,credit_note_id,id),
  UNIQUE (tenant_id,credit_note_id,line_number),
  FOREIGN KEY (tenant_id,credit_note_id) REFERENCES procurement.credit_notes(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,invoice_id,invoice_line_id) REFERENCES procurement.invoice_lines(tenant_id,invoice_id,id) ON DELETE RESTRICT,
  CHECK (credited_quantity > 0 OR credited_amount > 0)
);
CREATE INDEX credit_note_lines_invoice_line_idx ON procurement.credit_note_lines(tenant_id,invoice_line_id);

CREATE TABLE procurement.credit_note_applications (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  credit_note_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  actor_id text NOT NULL,
  correlation_id text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,credit_note_id),
  FOREIGN KEY (tenant_id,credit_note_id) REFERENCES procurement.credit_notes(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,invoice_id) REFERENCES procurement.invoices(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE procurement.credit_note_allocation_releases (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  application_id uuid NOT NULL,
  credit_note_id uuid NOT NULL,
  credit_note_line_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  invoice_line_id uuid NOT NULL,
  allocation_id uuid NOT NULL,
  released_quantity numeric(18,4) NOT NULL CHECK (released_quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,application_id,credit_note_line_id,allocation_id),
  FOREIGN KEY (tenant_id,application_id) REFERENCES procurement.credit_note_applications(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,credit_note_id,credit_note_line_id) REFERENCES procurement.credit_note_lines(tenant_id,credit_note_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,invoice_id,invoice_line_id) REFERENCES procurement.invoice_lines(tenant_id,invoice_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,allocation_id) REFERENCES procurement.invoice_match_allocations(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE procurement.invoice_match_allocation_releases (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  invoice_id uuid NOT NULL,
  allocation_id uuid NOT NULL,
  release_type text NOT NULL CHECK (release_type IN ('INVOICE_REJECTED')),
  released_quantity numeric(18,4) NOT NULL CHECK (released_quantity > 0),
  actor_id text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,invoice_id,allocation_id,release_type),
  FOREIGN KEY (tenant_id,invoice_id) REFERENCES procurement.invoices(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,allocation_id) REFERENCES procurement.invoice_match_allocations(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE procurement.invoice_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  invoice_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  action text NOT NULL,
  previous_lifecycle_state text,
  lifecycle_state text NOT NULL,
  previous_match_status text,
  match_status text NOT NULL,
  before_snapshot jsonb CHECK (before_snapshot IS NULL OR jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb NOT NULL CHECK (jsonb_typeof(after_snapshot)='object'),
  actor_id text NOT NULL,
  reason text,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,invoice_id,aggregate_version),
  FOREIGN KEY (tenant_id,invoice_id) REFERENCES procurement.invoices(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE procurement.credit_note_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  credit_note_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  action text NOT NULL,
  previous_state text,
  state text NOT NULL,
  before_snapshot jsonb CHECK (before_snapshot IS NULL OR jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb NOT NULL CHECK (jsonb_typeof(after_snapshot)='object'),
  actor_id text NOT NULL,
  reason text,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,credit_note_id,aggregate_version),
  FOREIGN KEY (tenant_id,credit_note_id) REFERENCES procurement.credit_notes(tenant_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION procurement.reject_invoice_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Invoice and Credit Note evidence is append-only' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER invoice_match_evaluations_append_only BEFORE UPDATE OR DELETE ON procurement.invoice_match_evaluations FOR EACH ROW EXECUTE FUNCTION procurement.reject_invoice_evidence_mutation();
CREATE TRIGGER invoice_match_allocations_append_only BEFORE UPDATE OR DELETE ON procurement.invoice_match_allocations FOR EACH ROW EXECUTE FUNCTION procurement.reject_invoice_evidence_mutation();
CREATE TRIGGER invoice_match_exception_history_append_only BEFORE UPDATE OR DELETE ON procurement.invoice_match_exception_history FOR EACH ROW EXECUTE FUNCTION procurement.reject_invoice_evidence_mutation();
CREATE TRIGGER credit_note_applications_append_only BEFORE UPDATE OR DELETE ON procurement.credit_note_applications FOR EACH ROW EXECUTE FUNCTION procurement.reject_invoice_evidence_mutation();
CREATE TRIGGER credit_note_allocation_releases_append_only BEFORE UPDATE OR DELETE ON procurement.credit_note_allocation_releases FOR EACH ROW EXECUTE FUNCTION procurement.reject_invoice_evidence_mutation();
CREATE TRIGGER invoice_match_allocation_releases_append_only BEFORE UPDATE OR DELETE ON procurement.invoice_match_allocation_releases FOR EACH ROW EXECUTE FUNCTION procurement.reject_invoice_evidence_mutation();
CREATE TRIGGER invoice_history_append_only BEFORE UPDATE OR DELETE ON procurement.invoice_history FOR EACH ROW EXECUTE FUNCTION procurement.reject_invoice_evidence_mutation();
CREATE TRIGGER credit_note_history_append_only BEFORE UPDATE OR DELETE ON procurement.credit_note_history FOR EACH ROW EXECUTE FUNCTION procurement.reject_invoice_evidence_mutation();
CREATE TRIGGER invoice_identity_reservation_append_only BEFORE UPDATE OR DELETE ON procurement.invoice_document_identity_reservations FOR EACH ROW EXECUTE FUNCTION procurement.reject_invoice_evidence_mutation();

CREATE FUNCTION procurement.validate_invoice_document_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document_type='INVOICE' AND NOT EXISTS (
    SELECT 1 FROM procurement.invoices i
     WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.document_id
       AND i.supplier_id=NEW.supplier_id AND i.supplier_document_number_normalized=NEW.supplier_document_number_normalized
       AND i.lifecycle_state='SUBMITTED'
  ) THEN
    RAISE EXCEPTION 'Invoice identity can be reserved only for its submitted document' USING ERRCODE='23514';
  END IF;
  IF NEW.document_type='CREDIT_NOTE' AND NOT EXISTS (
    SELECT 1 FROM procurement.credit_notes c
     WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.document_id
       AND c.supplier_id=NEW.supplier_id AND c.supplier_document_number_normalized=NEW.supplier_document_number_normalized
       AND c.lifecycle_state='SUBMITTED'
  ) THEN
    RAISE EXCEPTION 'Credit Note identity can be reserved only for its submitted document' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER invoice_document_reservation_identity_guard AFTER INSERT ON procurement.invoice_document_identity_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION procurement.validate_invoice_document_reservation();
CREATE TRIGGER invoice_no_hard_delete BEFORE DELETE ON procurement.invoices FOR EACH ROW EXECUTE FUNCTION procurement.reject_invoice_evidence_mutation();
CREATE TRIGGER credit_note_no_hard_delete BEFORE DELETE ON procurement.credit_notes FOR EACH ROW EXECUTE FUNCTION procurement.reject_invoice_evidence_mutation();

CREATE FUNCTION procurement.guard_invoice_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lifecycle_state IN ('APPROVED','REJECTED','CANCELLED') AND NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    RAISE EXCEPTION 'Terminal Invoice lifecycle state cannot transition' USING ERRCODE='23514';
  END IF;
  IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state AND NOT (
    (OLD.lifecycle_state='DRAFT' AND NEW.lifecycle_state IN ('SUBMITTED','CANCELLED')) OR
    (OLD.lifecycle_state='SUBMITTED' AND NEW.lifecycle_state IN ('APPROVED','REJECTED'))
  ) THEN
    RAISE EXCEPTION 'Invalid Invoice lifecycle transition' USING ERRCODE='23514';
  END IF;
  IF OLD.lifecycle_state <> 'DRAFT' AND
     (NEW.supplier_id,NEW.supplier_display_snapshot,NEW.supplier_document_number_original,NEW.supplier_document_number_normalized,NEW.invoice_date,NEW.currency,NEW.tax_amount,NEW.charge_amount,NEW.charges,NEW.gross_amount,NEW.purchase_order_id,NEW.purchase_order_code_snapshot,NEW.po_commercial_version,NEW.duplicate_fingerprint,NEW.submitted_snapshot,NEW.snapshot_fingerprint)
     IS DISTINCT FROM
     (OLD.supplier_id,OLD.supplier_display_snapshot,OLD.supplier_document_number_original,OLD.supplier_document_number_normalized,OLD.invoice_date,OLD.currency,OLD.tax_amount,OLD.charge_amount,OLD.charges,OLD.gross_amount,OLD.purchase_order_id,OLD.purchase_order_code_snapshot,OLD.po_commercial_version,OLD.duplicate_fingerprint,OLD.submitted_snapshot,OLD.snapshot_fingerprint) THEN
    RAISE EXCEPTION 'Submitted Invoice snapshot is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.lifecycle_state <> 'SUBMITTED' AND NEW.match_status IS DISTINCT FROM OLD.match_status THEN
    RAISE EXCEPTION 'Invoice match status can change only while submitted' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_lifecycle_guard BEFORE UPDATE ON procurement.invoices FOR EACH ROW EXECUTE FUNCTION procurement.guard_invoice_lifecycle();

CREATE FUNCTION procurement.guard_credit_note_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lifecycle_state IN ('APPLIED','REJECTED','CANCELLED') AND NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    RAISE EXCEPTION 'Terminal Credit Note lifecycle state cannot transition' USING ERRCODE='23514';
  END IF;
  IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state AND NOT (
    (OLD.lifecycle_state='DRAFT' AND NEW.lifecycle_state IN ('SUBMITTED','CANCELLED')) OR
    (OLD.lifecycle_state='SUBMITTED' AND NEW.lifecycle_state IN ('APPLIED','REJECTED'))
  ) THEN
    RAISE EXCEPTION 'Invalid Credit Note lifecycle transition' USING ERRCODE='23514';
  END IF;
  IF OLD.lifecycle_state <> 'DRAFT' AND
     (NEW.supplier_id,NEW.supplier_display_snapshot,NEW.supplier_document_number_original,NEW.supplier_document_number_normalized,NEW.document_date,NEW.currency,NEW.total_amount,NEW.invoice_id,NEW.duplicate_fingerprint,NEW.submitted_snapshot,NEW.snapshot_fingerprint)
     IS DISTINCT FROM
     (OLD.supplier_id,OLD.supplier_display_snapshot,OLD.supplier_document_number_original,OLD.supplier_document_number_normalized,OLD.document_date,OLD.currency,OLD.total_amount,OLD.invoice_id,OLD.duplicate_fingerprint,OLD.submitted_snapshot,OLD.snapshot_fingerprint) THEN
    RAISE EXCEPTION 'Submitted Credit Note snapshot is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER credit_note_lifecycle_guard BEFORE UPDATE ON procurement.credit_notes FOR EACH ROW EXECUTE FUNCTION procurement.guard_credit_note_lifecycle();

CREATE FUNCTION procurement.guard_invoice_draft_children() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state text; tenant text; parent_id uuid;
BEGIN
  tenant := CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  parent_id := CASE WHEN TG_OP='DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  SELECT lifecycle_state INTO current_state FROM procurement.invoices WHERE tenant_id=tenant AND id=parent_id FOR UPDATE;
  IF current_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Invoice lines are immutable outside DRAFT' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_lines_draft_only BEFORE INSERT OR UPDATE OR DELETE ON procurement.invoice_lines FOR EACH ROW EXECUTE FUNCTION procurement.guard_invoice_draft_children();

CREATE FUNCTION procurement.guard_credit_note_draft_children() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state text; tenant text; parent_id uuid;
BEGIN
  tenant := CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  parent_id := CASE WHEN TG_OP='DELETE' THEN OLD.credit_note_id ELSE NEW.credit_note_id END;
  SELECT lifecycle_state INTO current_state FROM procurement.credit_notes WHERE tenant_id=tenant AND id=parent_id FOR UPDATE;
  IF current_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Credit Note lines are immutable outside DRAFT' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER credit_note_lines_draft_only BEFORE INSERT OR UPDATE OR DELETE ON procurement.credit_note_lines FOR EACH ROW EXECUTE FUNCTION procurement.guard_credit_note_draft_children();

INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
 (gen_random_uuid(),'invoice.read','invoice','read'),(gen_random_uuid(),'invoice.create','invoice','create'),(gen_random_uuid(),'invoice.update','invoice','update'),(gen_random_uuid(),'invoice.submit','invoice','submit'),(gen_random_uuid(),'invoice.match','invoice','match'),(gen_random_uuid(),'invoice.approve','invoice','approve'),(gen_random_uuid(),'invoice.reject','invoice','reject'),
 (gen_random_uuid(),'credit_note.read','credit_note','read'),(gen_random_uuid(),'credit_note.create','credit_note','create'),(gen_random_uuid(),'credit_note.update','credit_note','update'),(gen_random_uuid(),'credit_note.submit','credit_note','submit'),(gen_random_uuid(),'credit_note.apply','credit_note','apply'),(gen_random_uuid(),'credit_note.reject','credit_note','reject')
ON CONFLICT (code) DO NOTHING;

-- The Goods Receipt migration already extends this shared source reference check.
-- Preserve all registered Work Queue sources while adding Invoice workflows.
ALTER TABLE operations.work_items DROP CONSTRAINT work_items_source_type_check;
ALTER TABLE operations.work_items ADD CONSTRAINT work_items_source_type_check
  CHECK (source_type IN ('TICKET','INCIDENT','APPROVAL','NETWORK_EXCEPTION','OFFBOARDING','SOFTWARE_EXCEPTION','ASSET_LIFECYCLE','GOODS_RECEIPT','INVOICE_DUPLICATE','INVOICE_MATCH_EXCEPTION'));
