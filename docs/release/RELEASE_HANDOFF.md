# Release Planning Handoff

## Current position

Phase 4 focused remediation is committed as `cca7d1b` and pushed to
`origin/master`; Bootstrap CI run `35007367015` passed. The runtime image now
includes OpenSSL and the Agent issuer is compatible with Debian Bookworm
OpenSSL 3.0. The next candidate is local-only until `master` is protected and
the GHCR publish workflow can produce an immutable registry digest.

The latest verification closure is
[RELEASE_VERIFICATION_SUMMARY.md](RELEASE_VERIFICATION_SUMMARY.md). The
environment now has a local immutable candidate, staging OIDC/PKI material,
Lima `age` and a writable HOST_PROTECTED mount; the release remains
`BLOCKED_FOR_RC` because registry publication and qualifying verification
evidence are incomplete.

- Product implementation roadmap: complete through Phase 5; TASK-097 is
  `CODE_COMPLETE / VERIFIED`.
- Product roadmap is frozen for this planning activity. Do not create
  TASK-098 or open Phase 6.
- Release decision: `BLOCKED_FOR_RC` until the items in
  [RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) are verified.
- Release-readiness assessment: commit `3a0cda2`.
- RELEASE-001 is `CODE_COMPLETE`, not `VERIFIED`; real OIDC provider/staging
  validation remains open.
- RELEASE-002 is `CODE_COMPLETE`, not `VERIFIED`; real private CA provisioning
  and mTLS validation through the RELEASE-007 staging topology remain open.
- RELEASE-003-R1 is `CODE_COMPLETE`; RELEASE-003 runtime is
  `CODE_COMPLETE / NOT VERIFIED`. Staging/orchestrator verification remains.
  See
  [RELEASE-003-R1](items/RELEASE-003-R1_PRODUCTION_READINESS_CRITICAL_WORKER_CONTRACT.md).
- RELEASE-004-R1/R2 and its runtime implementation are `CODE_COMPLETE`;
  Phase 6 deployed the clean CI-published R4 digest through canonical
  `deploy.sh` in Lima and recorded `SMOKE_PASSED`; RELEASE-004 is not
  `VERIFIED` pending full acceptance evidence and attestation.
  Its runtime alignment is recorded in
  [RELEASE-004-R2](items/RELEASE-004-R2_PODMAN_LIMA_RUNTIME_ALIGNMENT.md); the
  canonical runtime is Podman in Lima Linux with `podman compose`.
  The immutable artifact contract is at
  [RELEASE-004-R1](items/RELEASE-004-R1_IMMUTABLE_ARTIFACT_DEPLOYMENT_PROMOTION_CONTRACT.md).
- Unrelated user change in `AGENTS.md` is preserved and must remain outside
  release-planning commits unless a later explicit scope requires a separate
  relevant edit.

## Next action

RELEASE-001 runtime has full automated verification but still requires a real
staging IdP before `VERIFIED`; RR-01 remains open. RELEASE-002 runtime and
automated tests are complete under its R1 mTLS contract, but real CA
provisioning and staging topology validation remain before `VERIFIED`.
RELEASE-003 runtime is implemented and automated checks pass; staging/
orchestrator verification remains required before `VERIFIED`. RELEASE-004
uses one OCI image promoted unchanged through Podman and `podman compose` in a
Lima Linux VM. The selected v1 deployment is single-host and explicitly not
HA. Phase 6 staging deployment and smoke use the exact R4 digest, while full
attestation remains pending;
RELEASE-005 implementation is now code-complete, while its protected
backup/restore and RPO/RTO evidence require operational verification. This
activity implements RELEASE-006's isolated migration rehearsal infrastructure;
its qualifying N-1 and production-like evidence are recorded and RELEASE-006
is VERIFIED. RELEASE-007
is now `CODE_COMPLETE / NOT VERIFIED`; the edge implementation is recorded in
[its implementation report](items/RELEASE-007_IMPLEMENTATION_REPORT.md), and
real staging edge evidence remains.

## Release order

RELEASE-005 is `CODE_COMPLETE / NOT VERIFIED`. Its backup/restore operations
use guest-side PostgreSQL logical interfaces, age encryption, a verified
`HOST_PROTECTED` Lima mount and isolated Podman Compose restore projects; they
never use Podman volume internals. RPO 6h and RTO 2h remain UNVERIFIED until
the required rehearsal. See [RELEASE-005 implementation report](items/RELEASE-005_IMPLEMENTATION_REPORT.md).
RELEASE-006 is `VERIFIED` after the production-like rehearsal proved the
isolated Podman command, exact four-cell matrix, independent fixture integrity,
Worker/Gateway probes, timeout controls and rollback-mode derivation. Its
contract fixes controlled maintenance,
exact-schema defaults, the four-cell matrix, 10-second lock timeout,
10-minute statement timeout and 30-minute migration budget. See [the
implementation report](items/RELEASE-006_IMPLEMENTATION_REPORT.md) and
[RELEASE-006-R1](items/RELEASE-006-R1_POSTGRESQL_MIGRATION_COMPATIBILITY_CONTRACT.md).
RELEASE-007 is `CODE_COMPLETE / NOT VERIFIED` after
[RELEASE-007-R1](items/RELEASE-007-R1_PRODUCTION_EDGE_TLS_RATE_LIMITING_CONTRACT.md)
fixed its security limits, certificate lifecycle and trusted-proxy policy.
RELEASE-006 also depends on RELEASE-005
verification inputs;
the final
RELEASE-GATE-001 waits for every initial remediation item to be verified.
Follow [RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).

## Scope boundaries

- Do not alter `tasks/CODEX_TASK_REGISTRY.md` or product task readiness to
  represent release work.
- Do not include known non-blocking repair-cost limitations or PostgreSQL
  client deprecation debt in the blocking backlog unless launch scope changes.
- Keep runtime fail-closed behavior until real production adapters are
  configured and verified.
- Do not begin RELEASE-GATE-001 automatically after RELEASE-007 implementation.
- Keep `AGENTS.md` unrelated working-tree changes unstaged and uncommitted.
