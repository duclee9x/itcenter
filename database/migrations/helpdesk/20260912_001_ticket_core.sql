CREATE SCHEMA helpdesk;
CREATE TABLE helpdesk.tickets (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, ticket_code text NOT NULL,
  title text NOT NULL, description text NOT NULL, requester_user_id uuid NOT NULL,
  assignee_user_id uuid, priority text NOT NULL DEFAULT 'P3', state text NOT NULL DEFAULT 'NEW',
  resolution_code text, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), UNIQUE (tenant_id,id), UNIQUE (tenant_id,ticket_code),
  FOREIGN KEY (tenant_id,requester_user_id) REFERENCES identity.users(tenant_id,id), FOREIGN KEY (tenant_id,assignee_user_id) REFERENCES identity.users(tenant_id,id),
  CHECK (priority IN ('P1','P2','P3','P4')),
  CHECK (state IN ('NEW','TRIAGE','ASSIGNED','IN_PROGRESS','WAITING_USER','WAITING_VENDOR','WAITING_APPROVAL','WAITING_CHANGE','RESOLVED','CLOSED','REOPENED','CANCELLED')),
  CHECK ((state='RESOLVED' AND resolution_code IS NOT NULL AND resolved_at IS NOT NULL) OR state<>'RESOLVED')
);
CREATE TABLE helpdesk.ticket_transitions (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, ticket_id uuid NOT NULL, from_state text, to_state text NOT NULL, command_type text NOT NULL, reason text NOT NULL, actor_type text NOT NULL, actor_id text NOT NULL, correlation_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY (tenant_id,ticket_id) REFERENCES helpdesk.tickets(tenant_id,id)
);
CREATE INDEX helpdesk_ticket_lookup ON helpdesk.tickets(tenant_id,state,created_at);
