CREATE SCHEMA software;

CREATE TABLE software.software_products (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  product_code text NOT NULL,
  name text NOT NULL,
  vendor text NOT NULL,
  category text NOT NULL,
  classification text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (classification IN ('APPROVED','RESTRICTED','PROHIBITED','UNKNOWN','DEPRECATED','RETIRED')),
  owner_id text NOT NULL,
  support_team text NOT NULL,
  supported_os text[] NOT NULL DEFAULT '{}',
  supported_asset_classes text[] NOT NULL DEFAULT '{}',
  visibility text NOT NULL DEFAULT 'IT_ONLY'
    CHECK (visibility IN ('END_USER','IT_ONLY','HIDDEN')),
  self_service_allowed boolean NOT NULL DEFAULT false,
  license_required boolean NOT NULL DEFAULT false,
  published_version_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_code),
  UNIQUE (tenant_id, id),
  CHECK (NOT self_service_allowed OR (classification = 'APPROVED' AND visibility = 'END_USER')),
  CHECK (visibility <> 'END_USER' OR (classification = 'APPROVED' AND published_version_id IS NOT NULL))
);

CREATE TABLE software.software_versions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  product_id uuid NOT NULL,
  version_label text NOT NULL,
  release_notes text NOT NULL DEFAULT '',
  approved_artifact_version_id uuid,
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','PUBLISHED','RETIRED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id, version_label),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id)
    REFERENCES software.software_products(tenant_id, id)
);

ALTER TABLE software.software_products
  ADD CONSTRAINT software_products_published_version_fk
  FOREIGN KEY (tenant_id, published_version_id)
  REFERENCES software.software_versions(tenant_id, id);
