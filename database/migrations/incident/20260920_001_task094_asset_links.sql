CREATE TABLE incident.asset_links (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  incident_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  relation_type text NOT NULL DEFAULT 'AFFECTED_ASSET'
    CHECK (relation_type='AFFECTED_ASSET'),
  source_type text NOT NULL
    CHECK (source_type IN ('MONITORING_EVENT','EXPLICIT_TICKET_OR_INTAKE_ASSET','MANUAL_AUTHORIZED')),
  source_reference text,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  reason text,
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','DETACHED')),
  linked_at timestamptz NOT NULL DEFAULT now(),
  detached_at timestamptz,
  detached_by_type text,
  detached_by_id text,
  detach_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,incident_id)
    REFERENCES incident.incidents(tenant_id,id),
  FOREIGN KEY (tenant_id,asset_id)
    REFERENCES asset.assets(tenant_id,id),
  CHECK (length(trim(actor_id)) > 0),
  CHECK ((state='ACTIVE' AND detached_at IS NULL AND detach_reason IS NULL)
      OR (state='DETACHED' AND detached_at IS NOT NULL AND length(trim(detach_reason)) > 0)),
  CHECK (source_type<>'MANUAL_AUTHORIZED' OR length(trim(COALESCE(reason,''))) > 0)
);
CREATE UNIQUE INDEX incident_one_active_asset_link
  ON incident.asset_links(tenant_id,incident_id,asset_id) WHERE state='ACTIVE';
CREATE INDEX incident_asset_history_lookup
  ON incident.asset_links(tenant_id,asset_id,linked_at DESC);

CREATE TABLE incident.asset_link_history (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  link_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('LINKED','DETACHED')),
  source_type text NOT NULL,
  source_reference text,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  reason text,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,link_id)
    REFERENCES incident.asset_links(tenant_id,id),
  FOREIGN KEY (tenant_id,incident_id)
    REFERENCES incident.incidents(tenant_id,id)
);
CREATE INDEX incident_asset_link_history_lookup
  ON incident.asset_link_history(tenant_id,incident_id,asset_id,occurred_at DESC);

CREATE FUNCTION incident.guard_asset_link_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE'
     OR OLD.state <> 'ACTIVE'
     OR NEW.state <> 'DETACHED'
     OR NEW.version <> OLD.version + 1
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.incident_id IS DISTINCT FROM OLD.incident_id
     OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
     OR NEW.relation_type IS DISTINCT FROM OLD.relation_type
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
     OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.linked_at IS DISTINCT FROM OLD.linked_at
     OR NEW.detached_at IS NULL
     OR NEW.detached_by_type IS NULL
     OR NEW.detached_by_id IS NULL
     OR length(trim(COALESCE(NEW.detach_reason,'')))=0 THEN
    RAISE EXCEPTION 'Incident Asset links permit only one audited detach transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER incident_asset_link_transition_guard
  BEFORE UPDATE ON incident.asset_links
  FOR EACH ROW EXECUTE FUNCTION incident.guard_asset_link_update();

CREATE FUNCTION incident.reject_asset_link_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Incident Asset links cannot be deleted; detach with history';
END $$;
CREATE TRIGGER incident_asset_link_delete_guard
  BEFORE DELETE ON incident.asset_links
  FOR EACH ROW EXECUTE FUNCTION incident.reject_asset_link_delete();

CREATE FUNCTION incident.reject_asset_link_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Incident Asset link history is immutable';
END $$;
CREATE TRIGGER incident_asset_link_history_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON incident.asset_link_history
  FOR EACH STATEMENT EXECUTE FUNCTION incident.reject_asset_link_history_mutation();
