CREATE SCHEMA procurement;

CREATE TABLE procurement.suppliers (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  code text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  legal_name text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 240),
  tax_identifier text,
  address text,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(categories)='array'),
  risk_state text,
  bank_info_reference text,
  contacts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(contacts)='array'),
  state text NOT NULL DEFAULT 'PROSPECT'
    CHECK (state IN ('PROSPECT','APPROVED','PREFERRED','SUSPENDED','BLOCKED','INACTIVE')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,code)
);
CREATE UNIQUE INDEX suppliers_tenant_tax_identifier_uq
  ON procurement.suppliers(tenant_id,lower(btrim(tax_identifier)))
  WHERE tax_identifier IS NOT NULL AND length(btrim(tax_identifier)) > 0;
CREATE INDEX suppliers_tenant_state_name_idx
  ON procurement.suppliers(tenant_id,state,legal_name,id);

CREATE TABLE procurement.supplier_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  supplier_id uuid NOT NULL,
  entity_version integer NOT NULL CHECK (entity_version > 0),
  action text NOT NULL CHECK (action IN (
    'SUPPLIER.CREATE','SUPPLIER.UPDATE_PROFILE','SUPPLIER.APPROVE',
    'SUPPLIER.MARK_PREFERRED','SUPPLIER.REMOVE_PREFERRED','SUPPLIER.SUSPEND',
    'SUPPLIER.RESUME','SUPPLIER.BLOCK','SUPPLIER.UNBLOCK',
    'SUPPLIER.DEACTIVATE','SUPPLIER.REACTIVATE'
  )),
  previous_state text,
  new_state text NOT NULL CHECK (new_state IN ('PROSPECT','APPROVED','PREFERRED','SUSPENDED','BLOCKED','INACTIVE')),
  changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changed_fields)='array'),
  before_snapshot jsonb CHECK (before_snapshot IS NULL OR jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb NOT NULL CHECK (jsonb_typeof(after_snapshot)='object'),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,supplier_id,entity_version),
  FOREIGN KEY (tenant_id,supplier_id) REFERENCES procurement.suppliers(tenant_id,id)
);

CREATE TABLE procurement.procurement_requests (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  request_code text NOT NULL CHECK (length(btrim(request_code)) BETWEEN 1 AND 40),
  requester_user_id uuid NOT NULL,
  source_type text NOT NULL CHECK (length(btrim(source_type)) BETWEEN 1 AND 80),
  source_id text,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT','SUBMITTED','UNDER_REVIEW','WAITING_BUDGET','WAITING_RFQ',
    'WAITING_APPROVAL','APPROVED','ORDERED','PARTIALLY_FULFILLED',
    'FULFILLED','REJECTED','CANCELLED'
  )),
  business_reason text NOT NULL CHECK (length(btrim(business_reason)) BETWEEN 1 AND 2000),
  cost_center_id text,
  project_id text,
  target_date date NOT NULL,
  estimated_total numeric(18,2) CHECK (estimated_total IS NULL OR estimated_total >= 0),
  currency char(3),
  priority text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,request_code),
  FOREIGN KEY (tenant_id,requester_user_id) REFERENCES identity.users(tenant_id,id),
  CHECK ((estimated_total IS NULL) = (currency IS NULL)),
  CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CHECK (source_id IS NULL OR length(btrim(source_id)) > 0),
  CHECK (cost_center_id IS NOT NULL OR project_id IS NOT NULL)
);
CREATE UNIQUE INDEX procurement_active_source_uq
  ON procurement.procurement_requests(tenant_id,source_type,source_id)
  WHERE source_id IS NOT NULL
    AND state NOT IN ('FULFILLED','REJECTED','CANCELLED');
CREATE INDEX procurement_requests_tenant_state_created_idx
  ON procurement.procurement_requests(tenant_id,state,created_at DESC,id);
CREATE INDEX procurement_requests_tenant_requester_idx
  ON procurement.procurement_requests(tenant_id,requester_user_id,created_at DESC);

CREATE TABLE procurement.procurement_request_lines (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  procurement_request_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  item_type text NOT NULL CHECK (length(btrim(item_type)) BETWEEN 1 AND 80),
  item_reference_id text,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 1000),
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  estimated_unit_price numeric(18,2) CHECK (estimated_unit_price IS NULL OR estimated_unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,procurement_request_id,line_number),
  FOREIGN KEY (tenant_id,procurement_request_id)
    REFERENCES procurement.procurement_requests(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE procurement.request_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  procurement_request_id uuid NOT NULL,
  entity_version integer NOT NULL CHECK (entity_version > 0),
  action text NOT NULL CHECK (action IN ('PROCUREMENT.REQUEST_CREATE','PROCUREMENT.REQUEST_SUBMIT')),
  previous_state text,
  new_state text NOT NULL,
  before_snapshot jsonb CHECK (before_snapshot IS NULL OR jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb NOT NULL CHECK (jsonb_typeof(after_snapshot)='object'),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,procurement_request_id,entity_version),
  FOREIGN KEY (tenant_id,procurement_request_id)
    REFERENCES procurement.procurement_requests(tenant_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION procurement.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Procurement history is append-only' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER supplier_history_append_only
  BEFORE UPDATE OR DELETE ON procurement.supplier_history
  FOR EACH ROW EXECUTE FUNCTION procurement.reject_history_mutation();
CREATE TRIGGER request_history_append_only
  BEFORE UPDATE OR DELETE ON procurement.request_history
  FOR EACH ROW EXECUTE FUNCTION procurement.reject_history_mutation();
CREATE TRIGGER suppliers_no_hard_delete
  BEFORE DELETE ON procurement.suppliers
  FOR EACH ROW EXECUTE FUNCTION procurement.reject_history_mutation();
