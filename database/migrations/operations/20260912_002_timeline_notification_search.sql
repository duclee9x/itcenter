CREATE TABLE operations.timeline_events (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL,
  event_type text NOT NULL, summary text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(), source_event_id uuid,
  UNIQUE (tenant_id, source_event_id)
);
CREATE INDEX operations_timeline_lookup ON operations.timeline_events(tenant_id,entity_type,entity_id,occurred_at);
CREATE TABLE communication.notifications (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, recipient_user_id uuid NOT NULL,
  event_type text NOT NULL, subject text NOT NULL, body text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING', dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,recipient_user_id) REFERENCES identity.users(tenant_id,id),
  CHECK (status IN ('PENDING','SENT','FAILED','SUPPRESSED')), UNIQUE (tenant_id,dedupe_key)
);
CREATE TABLE operations.search_documents (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, entity_type text NOT NULL,
  entity_id uuid NOT NULL, exact_key text NOT NULL, searchable_text text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,entity_type,entity_id)
);
CREATE INDEX operations_search_exact ON operations.search_documents(tenant_id,exact_key);
CREATE INDEX operations_search_prefix ON operations.search_documents(tenant_id,searchable_text text_pattern_ops);
