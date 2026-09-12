CREATE SCHEMA license;

CREATE TABLE license.license_pools (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  pool_type text NOT NULL
    CHECK (pool_type IN ('DEPARTMENT','COUNTRY','BUSINESS_UNIT','PROJECT','CONTRACT')),
  scope_reference text NOT NULL CHECK (length(btrim(scope_reference)) BETWEEN 1 AND 256),
  contract_reference text,
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','INACTIVE')),
  created_by text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pool_type, scope_reference, name)
);

CREATE TABLE license.license_entitlements (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  software_product_id uuid NOT NULL,
  pool_id uuid,
  license_type text NOT NULL CHECK (license_type IN (
    'PER_USER','PER_DEVICE','CONCURRENT','SUBSCRIPTION','PERPETUAL',
    'SITE','ENTERPRISE_AGREEMENT','NAMED_USER','FLOATING',
    'CORE_CPU','SERVER_INSTANCE'
  )),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000000),
  purchased_at timestamptz,
  contract_reference text,
  supplier_reference text,
  cost numeric(18,2) CHECK (cost IS NULL OR cost >= 0),
  currency char(3),
  renewal_notice_days integer CHECK (renewal_notice_days IS NULL OR renewal_notice_days BETWEEN 0 AND 3650),
  restrictions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(restrictions) = 'array'),
  current_term_version integer NOT NULL DEFAULT 1 CHECK (current_term_version > 0),
  created_by text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, software_product_id)
    REFERENCES software.software_products(tenant_id, id),
  FOREIGN KEY (tenant_id, pool_id)
    REFERENCES license.license_pools(tenant_id, id),
  CHECK ((cost IS NULL) = (currency IS NULL)),
  CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$')
);

CREATE TABLE license.entitlement_terms (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  entitlement_id uuid NOT NULL,
  term_version integer NOT NULL CHECK (term_version > 0),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  recorded_by text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, entitlement_id, term_version),
  FOREIGN KEY (tenant_id, entitlement_id)
    REFERENCES license.license_entitlements(tenant_id, id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

ALTER TABLE license.license_entitlements
  ADD CONSTRAINT license_entitlements_current_term_fk
  FOREIGN KEY (tenant_id, id, current_term_version)
  REFERENCES license.entitlement_terms(tenant_id, entitlement_id, term_version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE license.entitlement_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  entitlement_id uuid NOT NULL,
  entity_version integer NOT NULL CHECK (entity_version > 0),
  term_version integer NOT NULL CHECK (term_version > 0),
  action text NOT NULL CHECK (action IN ('CREATED','UPDATED','RENEWED')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entitlement_id, entity_version),
  FOREIGN KEY (tenant_id, entitlement_id)
    REFERENCES license.license_entitlements(tenant_id, id)
);

CREATE TABLE license.entitlement_expiry_facts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  entitlement_id uuid NOT NULL,
  term_version integer NOT NULL CHECK (term_version > 0),
  valid_until timestamptz NOT NULL,
  expired_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entitlement_id, term_version),
  FOREIGN KEY (tenant_id, entitlement_id, term_version)
    REFERENCES license.entitlement_terms(tenant_id, entitlement_id, term_version)
);

CREATE TABLE license.entitlement_expiring_facts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  entitlement_id uuid NOT NULL,
  term_version integer NOT NULL CHECK (term_version > 0),
  valid_until timestamptz NOT NULL,
  notice_days integer NOT NULL CHECK (notice_days BETWEEN 1 AND 3650),
  emitted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entitlement_id, term_version),
  FOREIGN KEY (tenant_id, entitlement_id, term_version)
    REFERENCES license.entitlement_terms(tenant_id, entitlement_id, term_version)
);

CREATE INDEX license_entitlements_tenant_product_idx
  ON license.license_entitlements(tenant_id, software_product_id, created_at DESC);
CREATE INDEX license_entitlements_pool_idx
  ON license.license_entitlements(tenant_id, pool_id)
  WHERE pool_id IS NOT NULL;
CREATE INDEX entitlement_terms_expiry_idx
  ON license.entitlement_terms(tenant_id, valid_until)
  WHERE valid_until IS NOT NULL;
CREATE INDEX license_pools_tenant_state_idx
  ON license.license_pools(tenant_id, state, created_at DESC);

CREATE FUNCTION license.reject_entitlement_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'License term and history evidence is append-only';
END;
$$;
CREATE TRIGGER entitlement_terms_append_only
  BEFORE UPDATE OR DELETE ON license.entitlement_terms
  FOR EACH ROW EXECUTE FUNCTION license.reject_entitlement_history_mutation();
CREATE TRIGGER entitlement_history_append_only
  BEFORE UPDATE OR DELETE ON license.entitlement_history
  FOR EACH ROW EXECUTE FUNCTION license.reject_entitlement_history_mutation();
CREATE TRIGGER entitlement_expiry_facts_append_only
  BEFORE UPDATE OR DELETE ON license.entitlement_expiry_facts
  FOR EACH ROW EXECUTE FUNCTION license.reject_entitlement_history_mutation();
CREATE TRIGGER entitlement_expiring_facts_append_only
  BEFORE UPDATE OR DELETE ON license.entitlement_expiring_facts
  FOR EACH ROW EXECUTE FUNCTION license.reject_entitlement_history_mutation();
