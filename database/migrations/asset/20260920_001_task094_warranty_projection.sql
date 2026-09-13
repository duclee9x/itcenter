UPDATE asset.assets
   SET warranty_state='UNKNOWN'
 WHERE warranty_state NOT IN ('VALID','EXPIRING','EXPIRED','UNKNOWN');

ALTER TABLE asset.assets
  ADD COLUMN warranty_state_evaluated_on date,
  ADD COLUMN warranty_state_policy_version text,
  ADD COLUMN warranty_state_evidence_ref text;

ALTER TABLE asset.assets
  ADD CONSTRAINT asset_warranty_state_canonical
  CHECK (warranty_state IN ('VALID','EXPIRING','EXPIRED','UNKNOWN'));
