# Software catalog and artifact handling

TASK-054 provides tenant-scoped catalog and artifact metadata APIs. Binary data
never enters the API or PostgreSQL. An artifact object must already exist in a
configured object store before intake; the API inspects its opaque reference and
checks its checksum, media type and byte size against the supplied metadata.

## Safe defaults

- Product records start as `UNKNOWN`, visible only to IT by default, with
  self-service disabled. An `END_USER` catalog entry requires an approved,
  published version.
- Artifact intake starts with signature and scan status `PENDING` and review
  status `PENDING`. No client-supplied scan/signature status is accepted.
- Without an object-storage adapter, intake returns `DEPENDENCY_UNAVAILABLE`.
  Without a malware scanner, scan commands fail without changing artifact
  state. Without signature verification, an actual scan result may be recorded,
  but signature stays pending and approval is blocked.
- The publisher signature must be `VALID`. A scan waiver is restricted to
  pending/manual-review results and requires a different approver, a reason and
  a future expiry. Expired waivers cannot be activated or published.
- Restricting or revoking a published artifact withdraws its catalog pointer,
  clears self-service eligibility and lowers an approved product to
  `RESTRICTED`. Artifact checksum, source software version and storage reference
  are immutable; scan/review evidence is append-only.

## Command flow

Use `software.catalog.manage` to create products and versions. Use
`artifact.upload` to register metadata, `artifact.scan.review` to request
provider-backed validation, `artifact.approve` to review/activate and
`artifact.revoke` to restrict or revoke. Catalog publication is a separate
`software.catalog.manage` command and only accepts an active artifact linked to
the exact software version.

All commands require `Idempotency-Key`; mutable commands require
`expected_version`. Reads are tenant-scoped. Permission catalog entries are
seeded without granting any role. Deployment-specific role bindings must be
reviewed by the tenant administrator.

## Provider wiring

Implement `ArtifactObjectStoragePort`, `MalwareScannerPort` and
`PublisherSignaturePort` in the owning deployment adapter. Resolve credentials
from the secret manager, enforce TLS and bounded timeouts, honor abort signals,
return only status/provider/evidence references, and keep detailed reports in
the provider's protected evidence store. Do not add provider secrets to product
records, API payloads, outbox events or audit notes. No provider is wired by
default in this repository.
