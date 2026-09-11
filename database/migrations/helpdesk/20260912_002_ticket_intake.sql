ALTER TABLE helpdesk.tickets ADD COLUMN source_channel text NOT NULL DEFAULT 'PORTAL';
ALTER TABLE helpdesk.tickets ADD CONSTRAINT ticket_source_channel_check CHECK (source_channel IN ('PORTAL','EMAIL','API'));
CREATE TABLE helpdesk.ticket_messages (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, ticket_id uuid NOT NULL,
  author_user_id uuid, channel text NOT NULL, body text NOT NULL,
  external_message_id text, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,ticket_id) REFERENCES helpdesk.tickets(tenant_id,id),
  FOREIGN KEY (tenant_id,author_user_id) REFERENCES identity.users(tenant_id,id),
  CHECK (channel IN ('PORTAL','EMAIL','API')),
  UNIQUE (tenant_id,channel,external_message_id)
);
