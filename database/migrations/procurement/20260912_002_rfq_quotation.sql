CREATE TABLE procurement.rfqs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  code text NOT NULL,
  procurement_request_id uuid,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  description text,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','OPEN','EVALUATING','AWARDED','CLOSED_NO_AWARD','CANCELLED')),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  submission_deadline timestamptz NOT NULL,
  issued_at timestamptz,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(terms)='object'),
  awarded_quotation_id uuid,
  award_approval_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,id,code),
  UNIQUE (tenant_id,code),
  FOREIGN KEY (tenant_id,procurement_request_id) REFERENCES procurement.procurement_requests(tenant_id,id) ON DELETE RESTRICT,
  CHECK ((state='AWARDED') = (awarded_quotation_id IS NOT NULL)),
  CHECK (award_approval_id IS NULL OR state='AWARDED')
);
CREATE INDEX rfqs_tenant_state_created_idx ON procurement.rfqs(tenant_id,state,created_at DESC,id);

CREATE TABLE procurement.rfq_suppliers (
  tenant_id text NOT NULL,
  rfq_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,rfq_id,supplier_id),
  FOREIGN KEY (tenant_id,rfq_id) REFERENCES procurement.rfqs(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,supplier_id) REFERENCES procurement.suppliers(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE procurement.quotations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  rfq_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  quote_number text NOT NULL,
  revision_number integer NOT NULL DEFAULT 1 CHECK (revision_number > 0),
  replaces_quotation_id uuid,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','SUBMITTED','WITHDRAWN','DISQUALIFIED','ACCEPTED','REJECTED','VOID')),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total numeric(18,2) NOT NULL CHECK (total >= 0),
  valid_until date,
  lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  payment_terms text,
  warranty text,
  delivery_terms text,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(terms)='object'),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines)='array'),
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments)='array'),
  submitted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,quote_number),
  UNIQUE (tenant_id,rfq_id,id),
  UNIQUE (tenant_id,id,rfq_id,supplier_id),
  UNIQUE (tenant_id,rfq_id,supplier_id,revision_number),
  FOREIGN KEY (tenant_id,rfq_id) REFERENCES procurement.rfqs(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,supplier_id) REFERENCES procurement.suppliers(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,rfq_id,supplier_id) REFERENCES procurement.rfq_suppliers(tenant_id,rfq_id,supplier_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,replaces_quotation_id,rfq_id,supplier_id) REFERENCES procurement.quotations(tenant_id,id,rfq_id,supplier_id) ON DELETE RESTRICT,
  CHECK ((revision_number=1 AND replaces_quotation_id IS NULL) OR (revision_number>1 AND replaces_quotation_id IS NOT NULL)),
  CHECK (state<>'SUBMITTED' OR submitted_at IS NOT NULL)
);
ALTER TABLE procurement.rfqs ADD CONSTRAINT rfqs_awarded_quotation_fk
  FOREIGN KEY (tenant_id,id,awarded_quotation_id) REFERENCES procurement.quotations(tenant_id,rfq_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX quotations_one_submitted_per_supplier_rfq_uq
  ON procurement.quotations(tenant_id,rfq_id,supplier_id) WHERE state='SUBMITTED';
CREATE INDEX quotations_tenant_rfq_state_idx ON procurement.quotations(tenant_id,rfq_id,state,created_at,id);

CREATE TABLE procurement.rfq_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  rfq_id uuid NOT NULL,
  entity_version integer NOT NULL CHECK (entity_version>0),
  action text NOT NULL,
  previous_state text,
  new_state text NOT NULL,
  before_snapshot jsonb CHECK (before_snapshot IS NULL OR jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb NOT NULL CHECK (jsonb_typeof(after_snapshot)='object'),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,rfq_id,entity_version),
  FOREIGN KEY (tenant_id,rfq_id) REFERENCES procurement.rfqs(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE procurement.quotation_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  quotation_id uuid NOT NULL,
  entity_version integer NOT NULL CHECK (entity_version>0),
  action text NOT NULL,
  previous_state text,
  new_state text NOT NULL,
  before_snapshot jsonb CHECK (before_snapshot IS NULL OR jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb NOT NULL CHECK (jsonb_typeof(after_snapshot)='object'),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,quotation_id,entity_version),
  FOREIGN KEY (tenant_id,quotation_id) REFERENCES procurement.quotations(tenant_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER rfq_history_append_only BEFORE UPDATE OR DELETE ON procurement.rfq_history FOR EACH ROW EXECUTE FUNCTION procurement.reject_history_mutation();
CREATE TRIGGER quotation_history_append_only BEFORE UPDATE OR DELETE ON procurement.quotation_history FOR EACH ROW EXECUTE FUNCTION procurement.reject_history_mutation();
CREATE TRIGGER rfqs_no_hard_delete BEFORE DELETE ON procurement.rfqs FOR EACH ROW EXECUTE FUNCTION procurement.reject_history_mutation();
CREATE TRIGGER quotations_no_hard_delete BEFORE DELETE ON procurement.quotations FOR EACH ROW EXECUTE FUNCTION procurement.reject_history_mutation();

CREATE FUNCTION procurement.protect_submitted_quotation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL AND (NEW.rfq_id,NEW.supplier_id,NEW.quote_number,NEW.revision_number,NEW.replaces_quotation_id,NEW.currency,NEW.total,NEW.valid_until,NEW.lead_time_days,NEW.payment_terms,NEW.warranty,NEW.delivery_terms,NEW.terms,NEW.lines,NEW.attachments,NEW.submitted_at)
      IS DISTINCT FROM (OLD.rfq_id,OLD.supplier_id,OLD.quote_number,OLD.revision_number,OLD.replaces_quotation_id,OLD.currency,OLD.total,OLD.valid_until,OLD.lead_time_days,OLD.payment_terms,OLD.warranty,OLD.delivery_terms,OLD.terms,OLD.lines,OLD.attachments,OLD.submitted_at) THEN
    RAISE EXCEPTION 'Submitted quotation commercial data is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER submitted_quotation_immutable BEFORE UPDATE ON procurement.quotations FOR EACH ROW EXECUTE FUNCTION procurement.protect_submitted_quotation();

CREATE FUNCTION procurement.assert_terminal_rfq_children() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_rfq_id uuid;
  target_tenant_id text;
  target_state text;
  selected_quotation_id uuid;
BEGIN
  IF TG_TABLE_NAME='rfqs' THEN
    target_rfq_id := NEW.id;
    target_tenant_id := NEW.tenant_id;
  ELSE
    target_rfq_id := NEW.rfq_id;
    target_tenant_id := NEW.tenant_id;
  END IF;
  SELECT state,awarded_quotation_id INTO target_state,selected_quotation_id
    FROM procurement.rfqs WHERE tenant_id=target_tenant_id AND id=target_rfq_id;
  IF target_state IN ('AWARDED','CLOSED_NO_AWARD','CANCELLED') AND EXISTS (
    SELECT 1 FROM procurement.quotations
     WHERE tenant_id=target_tenant_id AND rfq_id=target_rfq_id
       AND state IN ('DRAFT','SUBMITTED')
  ) THEN
    RAISE EXCEPTION 'Terminal RFQ cannot retain a non-terminal quotation' USING ERRCODE='23514';
  END IF;
  IF target_state='AWARDED' AND NOT EXISTS (
    SELECT 1 FROM procurement.quotations
     WHERE tenant_id=target_tenant_id AND rfq_id=target_rfq_id
       AND id=selected_quotation_id AND state='ACCEPTED'
  ) THEN
    RAISE EXCEPTION 'Awarded RFQ must reference its accepted quotation' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER rfq_terminal_children_invariant
  AFTER INSERT OR UPDATE ON procurement.rfqs DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION procurement.assert_terminal_rfq_children();
CREATE CONSTRAINT TRIGGER quotation_terminal_parent_invariant
  AFTER INSERT OR UPDATE ON procurement.quotations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION procurement.assert_terminal_rfq_children();

INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
 (gen_random_uuid(),'rfq.read','rfq','read'),(gen_random_uuid(),'rfq.create','rfq','create'),(gen_random_uuid(),'rfq.update','rfq','update'),(gen_random_uuid(),'rfq.issue','rfq','issue'),(gen_random_uuid(),'rfq.close','rfq','close'),(gen_random_uuid(),'rfq.cancel','rfq','cancel'),(gen_random_uuid(),'rfq.award','rfq','award'),
 (gen_random_uuid(),'quotation.read','quotation','read'),(gen_random_uuid(),'quotation.create','quotation','create'),(gen_random_uuid(),'quotation.update','quotation','update'),(gen_random_uuid(),'quotation.submit','quotation','submit'),(gen_random_uuid(),'quotation.withdraw','quotation','withdraw'),(gen_random_uuid(),'quotation.evaluate','quotation','evaluate')
ON CONFLICT (code) DO NOTHING;
