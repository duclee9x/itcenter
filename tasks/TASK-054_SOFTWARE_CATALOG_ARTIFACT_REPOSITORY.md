# TASK-054 — Software Catalog + Artifact Repository

```yaml
task_id: TASK-054
feature_id: F-030/F-031
workflow_id: WF-SW01/WF-SW02
phase: P3
priority: P0
status: CODE_COMPLETE
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

## Implementation Report

### Status

CODE_COMPLETE. Acceptance criteria and repository verification passed. Runtime
object storage, malware scanning, and signature-verification providers remain
unconfigured; the API fails closed or keeps evidence pending until adapters
are supplied.

### Files Changed

- Added Software and Artifact domain modules, API composition routes, migrations,
  permission catalog entries, and a software/artifact operations runbook.
- Added regression coverage in `tests/e2e/software-artifact.test.ts` and migration
  schema expectations.
- Extended the event catalog, traceability matrix, and workflow event registry
  with the catalog and artifact lifecycle facts implemented here.
- Updated `CURRENT_TASK.md`, `IMPLEMENTATION_HANDOFF.md`, and the task registry.

### Database Changes

- Added tenant-scoped software products/versions and artifact-version metadata.
- Enforced immutable artifact checksum/storage references, append-only scan
  evidence, lifecycle constraints, and uniqueness/foreign-key boundaries.
- Applied the migrations to the local `itcenter` database.

### APIs / Commands

- Added authenticated product/version, catalog classification/visibility and
  publication routes; artifact intake, scan, review, activation,
  restriction/revocation, and read routes.
- Writes use idempotency, version checks where mutable, tenant filtering, audit,
  and outbox records. Adapter calls happen outside database transactions.

### Events

- Added catalog item/version creation, classification/visibility changes,
  publication/withdrawal, scan review, signature validation, rejection,
  activation, and restriction event contracts.

### Permissions

- Added `software.read`, `software.catalog.manage`, `artifact.read`,
  `artifact.upload`, `artifact.scan.review`, `artifact.approve`, and
  `artifact.revoke`; no implicit role grants were added.

### Audit / Timeline

- Mutations write durable audit evidence and outbox events. No raw binaries,
  provider secrets, or unfiltered scanner output are persisted in API/audit
  payloads.

### Tests Run

- `npm test`: passed, 56 tests across unit, contract, migration, integration,
  and E2E suites.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run format:check`: passed.
- `npm run db:migrate` against the local PostgreSQL `itcenter` database:
  passed.

### Remaining Gaps

- Provider-specific object storage, malware scanning, and signature verification
  remain an integration boundary; absence safely prevents trusted publication.

### Spec Conflicts

- None. Dedicated catalog lifecycle event contracts were added where the event
  catalog previously had no matching facts.

### Assumptions

- Object references are opaque identifiers returned by a trusted storage
  adapter; binary data is never accepted by the API or stored in PostgreSQL.
