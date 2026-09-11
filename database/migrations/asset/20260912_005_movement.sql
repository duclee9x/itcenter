CREATE TABLE asset.movements (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, asset_id uuid NOT NULL,
  movement_type text NOT NULL, status text NOT NULL DEFAULT 'COMPLETED',
  from_location_id uuid, to_location_id uuid NOT NULL,
  from_user_id uuid, to_user_id uuid, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (tenant_id, asset_id) REFERENCES asset.assets(tenant_id, id),
  FOREIGN KEY (tenant_id, from_location_id) REFERENCES asset.locations(tenant_id, id),
  FOREIGN KEY (tenant_id, to_location_id) REFERENCES asset.locations(tenant_id, id),
  FOREIGN KEY (tenant_id, from_user_id) REFERENCES identity.users(tenant_id, id),
  FOREIGN KEY (tenant_id, to_user_id) REFERENCES identity.users(tenant_id, id),
  CHECK (movement_type IN ('TRANSFER','RETURN')),
  CHECK (status IN ('PLANNED','IN_TRANSIT','COMPLETED','CANCELLED')),
  CHECK ((status='COMPLETED' AND completed_at IS NOT NULL) OR (status<>'COMPLETED'))
);
CREATE INDEX asset_movements_lookup ON asset.movements(tenant_id, asset_id, created_at);
