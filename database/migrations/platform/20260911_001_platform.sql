CREATE SCHEMA platform;
CREATE TABLE platform.idempotency_records (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, idempotency_key text NOT NULL CHECK(length(idempotency_key)>0),
 operation text NOT NULL, business_scope text NOT NULL, principal_id text NOT NULL, request_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('IN_PROGRESS','SUCCEEDED','FAILED_RETRYABLE','FAILED_FINAL','EXPIRED')),
 response_status integer CHECK(response_status BETWEEN 100 AND 599), result_reference jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 UNIQUE(tenant_id,principal_id,operation,business_scope,idempotency_key), CHECK(expires_at > created_at)
);
CREATE TABLE platform.outbox_events (
 id uuid PRIMARY KEY, event_id uuid NOT NULL UNIQUE, tenant_id text NOT NULL,
 event_type text NOT NULL, schema_version integer NOT NULL CHECK(schema_version>0),
 aggregate_type text NOT NULL, aggregate_id text NOT NULL, aggregate_version integer NOT NULL CHECK(aggregate_version>0),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 correlation_id text NOT NULL, causation_id text NOT NULL, occurred_at timestamptz NOT NULL,
 published_at timestamptz, attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PUBLISHED','FAILED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='PUBLISHED') = (published_at IS NOT NULL))
);
CREATE INDEX outbox_pending ON platform.outbox_events(created_at) WHERE status='PENDING';
CREATE TABLE platform.inbox_events (
 consumer_name text NOT NULL, event_id uuid NOT NULL, tenant_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('NOT_PROCESSED','PROCESSED','FAILED')),
 processed_at timestamptz, result jsonb, error_code text,
 PRIMARY KEY(consumer_name,event_id), CHECK((status='PROCESSED')=(processed_at IS NOT NULL))
);
CREATE TABLE platform.operations (
 operation_id uuid PRIMARY KEY, tenant_id text NOT NULL, type text NOT NULL,
 target_type text NOT NULL, target_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('QUEUED','RUNNING','WAITING','SUCCEEDED','FAILED','CANCELLED')),
 correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 error_code text, version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE INDEX operations_tenant ON platform.operations(tenant_id,operation_id);
