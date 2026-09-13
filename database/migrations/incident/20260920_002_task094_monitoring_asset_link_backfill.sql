INSERT INTO incident.asset_links(
  id,tenant_id,incident_id,asset_id,relation_type,source_type,source_reference,
  actor_type,actor_id,reason,state,linked_at
)
SELECT gen_random_uuid(),i.tenant_id,i.id,m.asset_id,'AFFECTED_ASSET',
       'MONITORING_EVENT',m.id::text,'SYSTEM','task094-r3-backfill',
       'Deterministic same-tenant validated Monitoring Asset reference',
       'ACTIVE',i.created_at
  FROM incident.incidents i
  JOIN monitoring.events m
    ON m.tenant_id=i.tenant_id AND m.id=i.monitoring_event_id
   AND m.asset_reference_validated=true
  JOIN asset.assets a
    ON a.tenant_id=m.tenant_id AND a.id=m.asset_id
 WHERE m.asset_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM incident.asset_links l
      WHERE l.tenant_id=i.tenant_id AND l.incident_id=i.id
        AND l.asset_id=m.asset_id AND l.state='ACTIVE'
   );

INSERT INTO incident.asset_link_history(
  id,tenant_id,link_id,incident_id,asset_id,event_type,source_type,
  source_reference,actor_type,actor_id,reason,correlation_id,occurred_at
)
SELECT gen_random_uuid(),tenant_id,id,incident_id,asset_id,'LINKED',source_type,
       source_reference,actor_type,actor_id,reason,
       'task094-r3-migration-backfill',linked_at
  FROM incident.asset_links
 WHERE actor_id='task094-r3-backfill'
   AND NOT EXISTS (
     SELECT 1 FROM incident.asset_link_history h
      WHERE h.tenant_id=incident.asset_links.tenant_id
        AND h.link_id=incident.asset_links.id AND h.event_type='LINKED'
   );
