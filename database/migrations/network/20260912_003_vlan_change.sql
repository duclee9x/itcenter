CREATE TABLE network.vlan_changes (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  change_id uuid NOT NULL,
  target_device text NOT NULL,
  target_port text NOT NULL,
  previous_vlan text NOT NULL,
  desired_vlan text NOT NULL,
  reason text NOT NULL,
  rollback_plan text NOT NULL,
  state text NOT NULL DEFAULT 'PLANNED',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  CHECK (previous_vlan <> desired_vlan),
  CHECK (state IN ('PLANNED','IMPLEMENTING','VERIFYING','ROLLBACK_REQUIRED','ROLLED_BACK','FAILED','COMPLETED'))
);

CREATE INDEX network_vlan_changes_lookup
  ON network.vlan_changes(tenant_id,state,created_at DESC);
CREATE INDEX network_vlan_change_link
  ON network.vlan_changes(tenant_id,change_id);

CREATE TABLE network.vlan_change_evidence (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  vlan_change_id uuid NOT NULL,
  phase text NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (phase IN ('IMPLEMENTATION','VERIFICATION','ROLLBACK')),
  FOREIGN KEY (tenant_id,vlan_change_id)
    REFERENCES network.vlan_changes(tenant_id,id)
);
CREATE INDEX network_vlan_change_evidence_lookup
  ON network.vlan_change_evidence(tenant_id,vlan_change_id,created_at);
