CREATE SCHEMA IF NOT EXISTS document;
INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
 (gen_random_uuid(),'contract.read','contract','read'),
 (gen_random_uuid(),'contract.create','contract','create'),
 (gen_random_uuid(),'contract.update','contract','update'),
 (gen_random_uuid(),'contract.execute','contract','execute'),
 (gen_random_uuid(),'contract.lifecycle','contract','lifecycle'),
 (gen_random_uuid(),'contract.amend','contract','amend'),
 (gen_random_uuid(),'contract.renew','contract','renew'),
 (gen_random_uuid(),'contract.terminate','contract','terminate'),
 (gen_random_uuid(),'commercial_document.read','commercial_document','read'),
 (gen_random_uuid(),'commercial_document.write','commercial_document','write'),
 (gen_random_uuid(),'commercial_document.finalize','commercial_document','finalize')
ON CONFLICT(code) DO NOTHING;
CREATE TABLE document.documents (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, document_code text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('CONTRACT','AMENDMENT','RENEWAL','TERMINATION_NOTICE','EXECUTION_EVIDENCE','OTHER_COMMERCIAL_EVIDENCE')),
  governance_status text NOT NULL DEFAULT 'DRAFT' CHECK (governance_status IN ('DRAFT','FINAL','SUPERSEDED','VOID')),
  signature_status text NOT NULL DEFAULT 'NONE' CHECK (signature_status IN ('NONE','PENDING','PARTIALLY_SIGNED','SIGNED','DECLINED')),
  classification text NOT NULL CHECK (classification IN ('INTERNAL','CONFIDENTIAL','RESTRICTED')),
  resource_type text NOT NULL, resource_id uuid NOT NULL, current_version_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_by text NOT NULL,
  correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,document_code)
);
CREATE TABLE document.document_versions (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, document_id uuid NOT NULL, version_number integer NOT NULL CHECK (version_number>0),
  storage_ref text NOT NULL CHECK (length(btrim(storage_ref)) BETWEEN 1 AND 1024),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  content_type text NOT NULL CHECK (length(btrim(content_type)) BETWEEN 1 AND 256),
  size_bytes bigint NOT NULL CHECK (size_bytes>0), governance_status text NOT NULL CHECK (governance_status IN ('DRAFT','FINAL','SUPERSEDED','VOID')),
  signature_status text NOT NULL CHECK (signature_status IN ('NONE','PENDING','PARTIALLY_SIGNED','SIGNED','DECLINED')),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), finalized_by text, finalized_at timestamptz,
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,document_id,id), UNIQUE (tenant_id,document_id,version_number),
  FOREIGN KEY (tenant_id,document_id) REFERENCES document.documents(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE document.documents ADD CONSTRAINT documents_current_version_fk FOREIGN KEY (tenant_id,current_version_id) REFERENCES document.document_versions(tenant_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE document.document_links (
  tenant_id text NOT NULL, document_id uuid NOT NULL, resource_type text NOT NULL, resource_id uuid NOT NULL, relation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id,document_id,resource_type,resource_id,relation),
  FOREIGN KEY (tenant_id,document_id) REFERENCES document.documents(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE document.document_relationships (
  tenant_id text NOT NULL, predecessor_document_id uuid NOT NULL, successor_document_id uuid NOT NULL,
  relationship text NOT NULL CHECK (relationship IN ('SUPERSEDED_BY')),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,predecessor_document_id,successor_document_id,relationship),
  FOREIGN KEY (tenant_id,predecessor_document_id) REFERENCES document.documents(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,successor_document_id) REFERENCES document.documents(tenant_id,id) ON DELETE RESTRICT,
  CHECK (predecessor_document_id<>successor_document_id)
);
ALTER TABLE contract.contract_versions ADD CONSTRAINT contract_versions_amendment_document_fk FOREIGN KEY (tenant_id,evidence_document_id,evidence_document_version_id) REFERENCES document.document_versions(tenant_id,document_id,id) ON DELETE RESTRICT;
ALTER TABLE contract.execution_evidence ADD CONSTRAINT contract_execution_document_fk FOREIGN KEY (tenant_id,document_id,document_version_id) REFERENCES document.document_versions(tenant_id,document_id,id) ON DELETE RESTRICT;
CREATE FUNCTION document.reject_final_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' THEN RAISE EXCEPTION 'document version deletion is forbidden'; END IF; IF OLD.governance_status IN ('FINAL','SUPERSEDED') THEN IF NEW.governance_status='SUPERSEDED' AND OLD.governance_status='FINAL' AND NEW.id=OLD.id AND NEW.tenant_id=OLD.tenant_id AND NEW.document_id=OLD.document_id AND NEW.version_number=OLD.version_number AND NEW.storage_ref=OLD.storage_ref AND NEW.content_hash=OLD.content_hash AND NEW.content_type=OLD.content_type AND NEW.size_bytes=OLD.size_bytes AND NEW.signature_status=OLD.signature_status AND NEW.created_by=OLD.created_by AND NEW.created_at=OLD.created_at THEN RETURN NEW; END IF; RAISE EXCEPTION 'final commercial document version is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER document_version_immutable BEFORE UPDATE OR DELETE ON document.document_versions FOR EACH ROW EXECUTE FUNCTION document.reject_final_version_mutation();
