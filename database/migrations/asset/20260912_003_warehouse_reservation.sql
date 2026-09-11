CREATE TABLE asset.reservations (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, asset_id uuid NOT NULL,
  requested_for text NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE',
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (tenant_id, asset_id) REFERENCES asset.assets(tenant_id, id),
  CHECK (status IN ('ACTIVE','RELEASED','EXPIRED','FULFILLED'))
);
CREATE UNIQUE INDEX asset_one_active_reservation ON asset.reservations(tenant_id, asset_id) WHERE status='ACTIVE';
