CREATE SCHEMA operations;
CREATE TABLE operations.work_items (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, source_type text NOT NULL,
  source_id uuid NOT NULL, title text NOT NULL, priority text NOT NULL,
  owner_team_id text NOT NULL, assignee_id uuid, state text NOT NULL DEFAULT 'NEW',
  created_at timestamptz NOT NULL DEFAULT now(), last_action_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, source_type, source_id),
  CHECK (source_type IN ('TICKET','INCIDENT','APPROVAL')),
  CHECK (state IN ('NEW','ASSIGNED','IN_PROGRESS','WAITING_USER','WAITING_VENDOR','WAITING_APPROVAL','WAITING_CHANGE','RESOLVED','CLOSED'))
);
CREATE INDEX operations_work_queue_lookup ON operations.work_items(tenant_id,state,priority,created_at);
