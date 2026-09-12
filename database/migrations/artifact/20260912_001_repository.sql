CREATE SCHEMA artifact;

CREATE TABLE artifact.artifact_versions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  software_version_id uuid NOT NULL,
  filename text NOT NULL,
  media_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  source_type text NOT NULL
    CHECK (source_type IN ('VENDOR_OFFICIAL','INTERNAL_BUILD','APPROVED_MIRROR','PACKAGE_REPOSITORY','MANUAL_UPLOAD','CI_PIPELINE')),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  storage_ref text NOT NULL,
  signature_status text NOT NULL DEFAULT 'PENDING'
    CHECK (signature_status IN ('PENDING','VALID','INVALID','UNSIGNED','UNKNOWN')),
  scan_status text NOT NULL DEFAULT 'PENDING'
    CHECK (scan_status IN ('PENDING','PASSED','FAILED','QUARANTINE','NEEDS_REVIEW','WAIVED')),
  review_status text NOT NULL DEFAULT 'PENDING'
    CHECK (review_status IN ('PENDING','APPROVED','REJECTED')),
  state text NOT NULL DEFAULT 'REVIEW_REQUIRED'
    CHECK (state IN ('REVIEW_REQUIRED','APPROVED','ACTIVE','RESTRICTED','REVOKED','REJECTED','RETIRED')),
  uploaded_by text NOT NULL,
  reviewed_by text,
  review_notes text NOT NULL DEFAULT '',
  scan_waived_until timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, software_version_id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, storage_ref),
  FOREIGN KEY (tenant_id, software_version_id)
    REFERENCES software.software_versions(tenant_id, id),
  CHECK ((scan_status = 'WAIVED') = (scan_waived_until IS NOT NULL)),
  CHECK ((review_status IN ('APPROVED','REJECTED')) = (reviewed_by IS NOT NULL))
);

ALTER TABLE software.software_versions
  ADD CONSTRAINT software_versions_approved_artifact_fk
  FOREIGN KEY (tenant_id, approved_artifact_version_id)
  REFERENCES artifact.artifact_versions(tenant_id, id);

CREATE TABLE artifact.artifact_scan_results (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  artifact_version_id uuid NOT NULL,
  result_type text NOT NULL CHECK (result_type IN ('SCAN','SIGNATURE','WAIVER','REVIEW')),
  status text NOT NULL,
  provider text NOT NULL,
  actor_id text,
  reason text NOT NULL DEFAULT '',
  evidence_ref text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, artifact_version_id)
    REFERENCES artifact.artifact_versions(tenant_id, id)
);

CREATE INDEX artifact_versions_tenant_state_idx
  ON artifact.artifact_versions(tenant_id, state, created_at DESC);
CREATE INDEX artifact_scan_results_tenant_version_idx
  ON artifact.artifact_scan_results(tenant_id, artifact_version_id, created_at);

CREATE FUNCTION artifact.reject_immutable_artifact_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'artifact records are retained and cannot be deleted';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.software_version_id IS DISTINCT FROM OLD.software_version_id
    OR NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256
    OR NEW.storage_ref IS DISTINCT FROM OLD.storage_ref THEN
    RAISE EXCEPTION 'artifact identity, checksum and storage reference are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER artifact_versions_immutable_identity
  BEFORE UPDATE OR DELETE ON artifact.artifact_versions
  FOR EACH ROW EXECUTE FUNCTION artifact.reject_immutable_artifact_change();

CREATE FUNCTION artifact.reject_scan_result_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'artifact scan evidence is append-only';
END;
$$;
CREATE TRIGGER artifact_scan_results_append_only
  BEFORE UPDATE OR DELETE ON artifact.artifact_scan_results
  FOR EACH ROW EXECUTE FUNCTION artifact.reject_scan_result_mutation();
