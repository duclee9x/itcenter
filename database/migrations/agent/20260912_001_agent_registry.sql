CREATE SCHEMA agent;
CREATE TABLE agent.agents (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  asset_id uuid NOT NULL,
  agent_version text NOT NULL,
  enrollment_token_hash text UNIQUE,
  enrollment_token_expires_at timestamptz,
  status text NOT NULL DEFAULT 'ENROLLED',
  last_seen_at timestamptz,
  hardware_inventory jsonb,
  software_inventory jsonb,
  hardware_inventory_at timestamptz,
  software_inventory_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, asset_id),
  CHECK (status IN ('ENROLLED','ONLINE','DEGRADED','UPDATE_REQUIRED','OFFLINE','RECOVERING','UNMANAGED'))
);
CREATE INDEX agent_agents_status ON agent.agents(tenant_id, status, last_seen_at);
