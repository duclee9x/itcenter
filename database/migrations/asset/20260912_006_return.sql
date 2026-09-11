CREATE TABLE asset.return_requests (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, asset_id uuid NOT NULL,
  assignment_id uuid NOT NULL, user_id uuid NOT NULL, due_at timestamptz NOT NULL,
  reason text NOT NULL, status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(), fulfilled_at timestamptz,
  FOREIGN KEY (tenant_id, asset_id) REFERENCES asset.assets(tenant_id, id),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES asset.assignments(tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES identity.users(tenant_id, id),
  UNIQUE (tenant_id, id),
  CHECK (status IN ('PENDING','FULFILLED','CANCELLED'))
);
CREATE UNIQUE INDEX asset_one_pending_return ON asset.return_requests(tenant_id, assignment_id) WHERE status='PENDING';
CREATE TABLE asset.return_documents (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, return_request_id uuid NOT NULL,
  asset_id uuid NOT NULL, condition_grade text NOT NULL, received_location_id uuid NOT NULL,
  notes text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, return_request_id) REFERENCES asset.return_requests(tenant_id, id),
  FOREIGN KEY (tenant_id, asset_id) REFERENCES asset.assets(tenant_id, id),
  FOREIGN KEY (tenant_id, received_location_id) REFERENCES asset.locations(tenant_id, id),
  CHECK (condition_grade IN ('A','B','C','D','E'))
);
CREATE UNIQUE INDEX asset_one_return_document ON asset.return_documents(tenant_id, return_request_id);
