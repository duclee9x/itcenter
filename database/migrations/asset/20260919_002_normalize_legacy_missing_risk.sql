WITH legacy AS MATERIALIZED (
  SELECT tenant_id,id AS asset_id,asset_code
    FROM asset.assets
   WHERE risk_state='MISSING'
), linked AS MATERIALIZED (
  SELECT l.tenant_id,l.asset_id,min(c.id::text)::uuid AS clearance_id,
         min(c.asset_recovery_state) AS previous_recovery_state
    FROM legacy l
    JOIN identity.offboarding_clearance_tasks c
      ON c.tenant_id=l.tenant_id
     AND c.resource_id=l.asset_id
     AND c.clearance_type='ASSET_RETURN'
   GROUP BY l.tenant_id,l.asset_id
  HAVING count(*)=1
), migrated_recovery AS (
  UPDATE identity.offboarding_clearance_tasks c
     SET state='BLOCKED',
         detail='Legacy Asset risk value MISSING preserved in Offboarding recovery state during TASK-094-R2 migration.',
         asset_recovery_state='MISSING',
         version=c.version+1,
         updated_at=now()
    FROM linked l
   WHERE c.tenant_id=l.tenant_id AND c.id=l.clearance_id
     AND c.asset_recovery_state IS DISTINCT FROM 'MISSING'
  RETURNING c.tenant_id,c.id AS clearance_id,c.resource_id AS asset_id,c.version
), recovery_history AS (
  INSERT INTO identity.offboarding_asset_recovery_history
    (id,tenant_id,clearance_id,asset_id,version,from_state,to_state,actor_id,reason,correlation_id)
  SELECT gen_random_uuid(),m.tenant_id,m.clearance_id,m.asset_id,m.version,
         l.previous_recovery_state,'MISSING',
         'SYSTEM_MIGRATION',
         'Preserve legacy Asset risk_state MISSING in the linked Offboarding return clearance.',
         'TASK-094-R2-MIGRATION'
    FROM migrated_recovery m
    JOIN linked l USING (tenant_id,asset_id,clearance_id)
  RETURNING tenant_id,asset_id,clearance_id
)
INSERT INTO asset.lifecycle_evidence_history
  (id,tenant_id,asset_id,related_id,evidence_type,payload,actor_id,reason)
SELECT gen_random_uuid(),l.tenant_id,l.asset_id,
       coalesce(r.clearance_id,gen_random_uuid()),
       CASE WHEN r.clearance_id IS NULL
         THEN 'LEGACY_RISK_MISSING_UNLINKED'
         ELSE 'LEGACY_RISK_MISSING_RECOVERY_MIGRATED' END,
       jsonb_build_object(
         'legacy_risk_state','MISSING',
         'normalized_risk_state','UNKNOWN',
         'asset_code',l.asset_code,
         'offboarding_clearance_id',r.clearance_id,
         'reconciliation_required',r.clearance_id IS NULL
       ),
       'SYSTEM_MIGRATION',
       CASE WHEN r.clearance_id IS NULL
         THEN 'Legacy missing-Asset meaning retained for manual reconciliation; no Offboarding relationship was inferred.'
         ELSE 'Legacy missing-Asset meaning moved to the deterministically linked Offboarding recovery record.' END
  FROM legacy l
  LEFT JOIN recovery_history r ON r.tenant_id=l.tenant_id AND r.asset_id=l.asset_id;

UPDATE asset.assets
   SET risk_state='UNKNOWN',updated_at=now(),version=version+1
 WHERE risk_state='MISSING';

ALTER TABLE asset.assets
  ADD CONSTRAINT assets_risk_state_canonical_check
  CHECK (risk_state IN ('LOW','MEDIUM','HIGH','CRITICAL','UNKNOWN'));
