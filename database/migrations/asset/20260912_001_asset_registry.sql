CREATE SCHEMA asset;
CREATE TABLE asset.locations (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, code text NOT NULL, name text NOT NULL,
 type text NOT NULL, parent_id uuid, status text NOT NULL DEFAULT 'ACTIVE',
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,code),
 FOREIGN KEY (tenant_id,parent_id) REFERENCES asset.locations(tenant_id,id),
 CHECK (parent_id IS NULL OR parent_id<>id)
);
CREATE TABLE asset.categories (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, name text NOT NULL, parent_id uuid,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,name),
 FOREIGN KEY (tenant_id,parent_id) REFERENCES asset.categories(tenant_id,id)
);
CREATE TABLE asset.models (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, manufacturer text NOT NULL, model_name text NOT NULL,
 category_id uuid NOT NULL, specifications jsonb NOT NULL DEFAULT '{}', support_end_date date,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,manufacturer,model_name),
 FOREIGN KEY (tenant_id,category_id) REFERENCES asset.categories(tenant_id,id)
);
CREATE TABLE asset.assets (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, asset_code text NOT NULL, asset_tag text,
 serial_number text, asset_model_id uuid NOT NULL, lifecycle_state text NOT NULL DEFAULT 'REGISTERED',
 operational_state text NOT NULL DEFAULT 'UNKNOWN', health_state text NOT NULL DEFAULT 'UNKNOWN',
 assignment_state text NOT NULL DEFAULT 'UNASSIGNED', warranty_state text NOT NULL DEFAULT 'UNKNOWN',
 compliance_state text NOT NULL DEFAULT 'UNKNOWN', risk_state text NOT NULL DEFAULT 'UNKNOWN',
 current_location_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), UNIQUE(tenant_id,id), UNIQUE(tenant_id,asset_code),
 UNIQUE(tenant_id,asset_tag), FOREIGN KEY (tenant_id,asset_model_id) REFERENCES asset.models(tenant_id,id),
 FOREIGN KEY (tenant_id,current_location_id) REFERENCES asset.locations(tenant_id,id)
);
CREATE INDEX assets_tenant_location ON asset.assets(tenant_id,current_location_id);
