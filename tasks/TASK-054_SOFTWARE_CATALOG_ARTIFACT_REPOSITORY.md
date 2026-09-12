# TASK-054 — Software Catalog + Artifact Repository

```yaml
task_id: TASK-054
feature_id: F-030/F-031
workflow_id: WF-SW01/WF-SW02
phase: P3
priority: P0
status: NOT_STARTED
owner_domain: software_and_artifact
```

Implement approved software catalog records and the artifact intake/review
metadata lifecycle. Binary content stays in object storage behind an adapter;
the relational database stores only immutable metadata and an opaque object
reference.

## Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`

## In Scope

- Tenant-scoped software product and version records with classification,
  owner/support metadata, supported OS/asset classes, visibility and
  self-service eligibility.
- Artifact intake metadata: product/version, filename/media type/size/source,
  immutable SHA-256, opaque storage reference, signature result, scan result,
  uploader, review/approval status and notes.
- Explicit artifact lifecycle commands for scan-result recording, approval,
  activation, restriction/revocation, and catalog publication of an approved
  version.
- Permission enforcement, tenant isolation, idempotency, concurrency where the
  record is mutable, append-only audit/evidence, catalog/artifact events and
  meaningful tests.
- Fail closed when required malware/signature/object-storage adapters are not
  configured; never accept binary bytes into OLTP or infer a clean scan.

## Out of Scope

- Agent deployment, installation/removal, software inventory discovery,
  unauthorized-software remediation, license entitlement/assignment, and
  provider-specific object storage or scanning implementation.

## Domain Rules

- Artifact version checksum and storage reference are immutable after intake.
- Reusing a product/version with a different checksum is an integrity conflict;
  do not replace the original binary.
- Only reviewed, approved and active artifacts can be published as approved
  catalog versions.
- `WAIVED` scan status requires a reason, approver and expiry; a caller cannot
  self-approve an artifact they uploaded.
- Artifact revocation prevents future approved publication/use and is audited.

## Acceptance Criteria

1. Products, versions and artifact records are tenant-scoped and have database
   uniqueness/integrity constraints.
2. Artifact intake stores only metadata and a storage reference; a checksum is
   required and immutable, and duplicate version/checksum conflicts are
   explicit.
3. Scan/signature results cannot be fabricated by default; missing providers
   leave the artifact pending/review-required.
4. Approval enforces permission, reason, version and separation from uploader;
   waived scans additionally require expiry.
5. Catalog publication requires an active approved artifact and records the
   approved version without mutating artifact history.
6. Mutations are idempotent and audited, emit cataloged outbox events, and
   preserve tenant isolation.
7. Tests cover success, invalid transitions, checksum conflict, unauthorized
   and self-approval, tenant scope, retries, version conflict and adapter
   absence; repository gates pass.

## Scope Dependencies

Object storage, malware scanning and publisher/signature verification
implementations are not currently wired. Provide application ports and safe
pending states; do not create fake adapters or store binary data in PostgreSQL.
