CREATE SCHEMA audit;
CREATE TABLE audit.audit_events (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, event_type text NOT NULL, event_version integer NOT NULL DEFAULT 1 CHECK(event_version>0),
 occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 actor jsonb NOT NULL CHECK(actor ? 'type'), action jsonb NOT NULL,
 subject jsonb NOT NULL CHECK(subject ? 'entity_type' AND subject ? 'entity_id'),
 correlation_id text NOT NULL, causation_id text NOT NULL,
 reason jsonb NOT NULL, before jsonb NOT NULL, after jsonb NOT NULL,
 outcome jsonb NOT NULL CHECK(outcome ? 'status'), classification text NOT NULL,
 UNIQUE(tenant_id,id)
);
CREATE TABLE audit.audit_event_relations (
 tenant_id text NOT NULL, audit_event_id uuid NOT NULL, related_entity_type text NOT NULL,
 related_entity_id text NOT NULL, relation_type text NOT NULL,
 PRIMARY KEY(audit_event_id,related_entity_type,related_entity_id,relation_type),
 FOREIGN KEY(tenant_id,audit_event_id) REFERENCES audit.audit_events(tenant_id,id)
);
CREATE TABLE audit.audit_evidence_links (
 tenant_id text NOT NULL, audit_event_id uuid NOT NULL, evidence_type text NOT NULL,
 evidence_id text NOT NULL, checksum text NOT NULL, relation text NOT NULL,
 PRIMARY KEY(audit_event_id,evidence_type,evidence_id,relation),
 FOREIGN KEY(tenant_id,audit_event_id) REFERENCES audit.audit_events(tenant_id,id)
);
CREATE FUNCTION audit.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit storage is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.audit_events FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER relations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.audit_event_relations FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.audit_evidence_links FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();
REVOKE UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA audit FROM PUBLIC;
