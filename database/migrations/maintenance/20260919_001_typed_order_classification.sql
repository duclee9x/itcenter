ALTER TABLE maintenance.orders
  ADD COLUMN classification text NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE maintenance.orders
  ADD COLUMN completed_at timestamptz;

UPDATE maintenance.orders
   SET completed_at=updated_at
 WHERE state='COMPLETED';

ALTER TABLE maintenance.orders
  ADD CONSTRAINT maintenance_order_classification_check
  CHECK (classification IN ('CORRECTIVE','PREVENTIVE','INSPECTION','OTHER','UNKNOWN'));

CREATE INDEX maintenance_asset_completed_classification
  ON maintenance.orders(tenant_id,asset_id,completed_at)
  WHERE state='COMPLETED';

CREATE FUNCTION maintenance.prevent_completed_classification_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='COMPLETED' AND OLD.classification IS DISTINCT FROM NEW.classification THEN
    RAISE EXCEPTION 'completed maintenance classification is immutable'
      USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER maintenance_completed_classification_immutable
  BEFORE UPDATE OF classification ON maintenance.orders
  FOR EACH ROW EXECUTE FUNCTION maintenance.prevent_completed_classification_change();
