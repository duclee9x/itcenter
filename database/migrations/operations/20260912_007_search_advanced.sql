CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE operations.search_documents
  ADD COLUMN display_code text NOT NULL DEFAULT '',
  ADD COLUMN title text NOT NULL DEFAULT '',
  ADD COLUMN subtitle text,
  ADD COLUMN exact_terms text[] NOT NULL DEFAULT '{}',
  ADD COLUMN exact_key_normalized text NOT NULL DEFAULT '',
  ADD COLUMN display_code_normalized text NOT NULL DEFAULT '',
  ADD COLUMN title_normalized text NOT NULL DEFAULT '',
  ADD COLUMN searchable_normalized text NOT NULL DEFAULT '',
  ADD COLUMN filter_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN security_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN source_version bigint NOT NULL DEFAULT 1 CHECK (source_version > 0),
  ADD COLUMN source_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN indexed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN is_tombstone boolean NOT NULL DEFAULT false,
  ADD COLUMN authorization_resource_type text NOT NULL DEFAULT 'ticket',
  ADD COLUMN authorization_action text NOT NULL DEFAULT 'ticket.read';

UPDATE operations.search_documents
SET display_code=exact_key,
    title=searchable_text,
    exact_terms=ARRAY[btrim(lower(regexp_replace(exact_key,'[^[:alnum:]]+',' ','g')))],
    exact_key_normalized=btrim(lower(regexp_replace(exact_key,'[^[:alnum:]]+',' ','g'))),
    display_code_normalized=btrim(lower(regexp_replace(exact_key,'[^[:alnum:]]+',' ','g'))),
    title_normalized=lower(searchable_text),
    searchable_normalized=lower(searchable_text),
    authorization_resource_type=CASE WHEN entity_type='TICKET' THEN 'ticket' ELSE lower(entity_type) END,
    authorization_action=CASE WHEN entity_type='TICKET' THEN 'ticket.read' ELSE lower(entity_type)||'.read' END;

ALTER TABLE operations.search_documents
  ADD CONSTRAINT search_documents_metadata_object CHECK (
    jsonb_typeof(filter_fields)='object' AND jsonb_typeof(security_scope)='object'
  );

CREATE INDEX operations_search_exact_terms ON operations.search_documents USING GIN(exact_terms);
CREATE INDEX operations_search_exact_normalized ON operations.search_documents(tenant_id,exact_key_normalized);
CREATE INDEX operations_search_display_prefix ON operations.search_documents(tenant_id,display_code_normalized text_pattern_ops);
CREATE INDEX operations_search_title_prefix ON operations.search_documents(tenant_id,title_normalized text_pattern_ops);
CREATE INDEX operations_search_filter_fields ON operations.search_documents USING GIN(filter_fields);
CREATE INDEX operations_search_security_scope ON operations.search_documents USING GIN(security_scope);
CREATE INDEX operations_search_text_trgm ON operations.search_documents USING GIN(searchable_normalized gin_trgm_ops);
CREATE INDEX operations_search_text_fts ON operations.search_documents USING GIN(to_tsvector('simple',searchable_normalized));

CREATE TABLE operations.search_index_state (
  tenant_id text PRIMARY KEY,
  index_state text NOT NULL DEFAULT 'CURRENT',
  last_event_at timestamptz,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  last_rebuild_at timestamptz,
  failure_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (index_state IN ('CURRENT','DELAYED','STALE','REBUILDING','FAILED'))
);

CREATE TABLE operations.search_index_retries (
  tenant_id text NOT NULL,
  event_id uuid NOT NULL REFERENCES platform.outbox_events(event_id),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  next_attempt_at timestamptz NOT NULL,
  failure_code text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,event_id)
);
CREATE INDEX search_index_retries_due ON operations.search_index_retries(next_attempt_at);

INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
  (gen_random_uuid(),'asset.read','asset','read'),
  (gen_random_uuid(),'ticket.read','ticket','read'),
  (gen_random_uuid(),'incident.read','incident','read'),
  (gen_random_uuid(),'software.read','software','read'),
  (gen_random_uuid(),'license.read','license','read'),
  (gen_random_uuid(),'search.reindex','search','reindex')
ON CONFLICT(code) DO NOTHING;
