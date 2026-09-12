CREATE TABLE asset.received_unit_registrations (
  tenant_id text NOT NULL,
  received_unit_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  goods_receipt_id uuid NOT NULL,
  asset_model_id uuid NOT NULL,
  serial_number text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,received_unit_id),
  UNIQUE (tenant_id,asset_id),
  FOREIGN KEY (tenant_id,goods_receipt_id,received_unit_id) REFERENCES procurement.goods_receipt_units(tenant_id,goods_receipt_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,asset_id) REFERENCES asset.assets(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX received_unit_registration_serial_idx ON asset.received_unit_registrations(tenant_id,asset_model_id,lower(serial_number));

CREATE FUNCTION asset.reject_received_registration_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Received-unit Asset registrations are immutable' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER received_unit_registration_immutable BEFORE UPDATE OR DELETE ON asset.received_unit_registrations FOR EACH ROW EXECUTE FUNCTION asset.reject_received_registration_mutation();
