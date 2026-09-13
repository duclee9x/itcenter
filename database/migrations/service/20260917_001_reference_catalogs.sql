CREATE SCHEMA service;

CREATE TABLE service.services (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  state text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,key),
  CHECK (state IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE service.platforms (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  key text NOT NULL,
  family text NOT NULL,
  name text NOT NULL,
  major_version text,
  state text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,key),
  CHECK (family IN ('WINDOWS','MACOS','LINUX','IOS','ANDROID','OTHER')),
  CHECK (state IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE service.environments (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  service_id uuid NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,service_id,key),
  FOREIGN KEY (tenant_id,service_id) REFERENCES service.services(tenant_id,id),
  CHECK (state IN ('ACTIVE','INACTIVE'))
);

CREATE INDEX service_active_lookup ON service.services(tenant_id,state,key);
CREATE INDEX platform_active_lookup ON service.platforms(tenant_id,state,family,key);
CREATE INDEX service_environment_lookup ON service.environments(tenant_id,service_id,state,key);
