# Release Verification Summary

**Assessment date:** 2026-09-16

**Decision:** `BLOCKED_FOR_RC`

This document records verification evidence for RELEASE-001 through
RELEASE-007. It is a closure record, not a new release item. The repository
HEAD contains verification commits after `7ea3001`; focused backup capture
remediation is `45d4154`.
`AGENTS.md` remains an unrelated uncommitted change and is intentionally not
part of this record.

## Evidence baseline

The implementation baseline has passed repository checks and RELEASE-007
static/runtime configuration checks: `npm test`, typecheck, lint, format,
migration tests, diff check, Podman Compose rendering, and Caddy staging/
production validation. Those results establish `CODE_COMPLETE`; they do not
establish staging verification.

The bootstrap prepared a local verification candidate from committed source
`7ea3001eccad81dc30c33702179b35aec6d13428`. Its local OCI digest is
`sha256:83942d94521fe2236c8a28277fae5fd689754163ef6d30503cb404f872b4d49d`,
with schema revision
`95886cdc18d735163a76863d050e37b7629c3015bbe37b756b9764a260636fdb`.
This is a `LOCAL_OPERATOR_BUILD`, not a registry-backed RC and remains
`NOT_VERIFIED`. Non-secret local metadata is stored outside the repository at
the host-backed staging verification path.

The Lima guest now has Podman 5.8.4, podman-compose 1.6.0 and `age 1.3.1`.
`/mnt/host-backups/itcenter-staging` is a writable `virtiofs` mount; a
temporary marker write/read/remove test passed. A staging-only age identity
and Agent CA/server/client PKI were generated outside the repository with
restricted permissions. These staging materials do not constitute production
escrow or RELEASE-005 verification. Loopback Lima forwards for staging HTTP,
HTTPS and Agent mTLS ports are configured. The deployed local listeners were
later exercised through the macOS/Lima loopback path; public reachability is
still unverified.

The authorized transitional N-1 reference is now prepared from
`7c403ab53f849abe189bf28ec0d669767427f105`, with local digest
`sha256:18f46a1f8b61cc47b551557d90c23dfcaf91b0ab9c3b9e446866fe710205a0d2`.
It is explicitly not a historical production artifact.

A staging PostgreSQL migration and backup path was exercised. Backup
`staging-20260915T165653Z-11878-7900` completed with `HOST_PROTECTED`,
`VERIFIED_COPY`, and SHA-256 verification. Restore rehearsal
`restore-20260915T165710Z-8570` decrypted the artifact into a fresh isolated
PostgreSQL project, restored it, and validated the schema in under two hours.
Application usability was not validated in that rehearsal, so this is partial
RELEASE-005 evidence only. An earlier backup attempt was invalid because the
pre-fix script allocated a pseudo-TTY; that artifact was removed and the
focused fix was committed separately.

The isolated staging stack now runs PostgreSQL, API, Agent Gateway, Worker and
Caddy from the local immutable candidate. API readiness is `READY`, all three
mandatory workers are healthy, and Gateway returns the expected `DEGRADED`
state because the staging issuer is intentionally unavailable. A pinned
Keycloak `26.3.3` provider is running in a separate verification container
with a real realm, user, JWKS and RS256 access token. The API rejects that
token because Keycloak emits JWT header type `JWT` while the application
correctly requires RFC9068 `at+jwt`; no validator weakening was made.

The deployed Caddy edge was exercised through the macOS/Lima loopback
forwards: HTTP returned a 301 HTTPS redirect, trusted local-CA HTTPS reached
API readiness with the expected security headers, unauthenticated capabilities
returned 401, and a request over 2 MiB returned 413. The raw API and
PostgreSQL ports remain unpublished. The Agent mTLS port is separately
reachable and a valid staging certificate completes the TLS handshake directly
to Gateway; canonical AgentRegistration/AgentCredential acceptance has not
been completed.

Phase 3 enabled the Keycloak 26.3.3 client setting
`access.token.header.type.rfc9068=true`; a newly issued real token now has
`typ=at+jwt`, `alg=RS256`, the expected issuer and audience, and the API
accepts its signature and identity. The staging tenant membership and local
RBAC data are present. An authorized capabilities request is now accepted
through the edge, while a wrong tenant remains denied. The remaining
RELEASE-001 negative-token matrix is not yet complete.

The canonical Agent enrollment attempt reached the existing
`CertificateIssuerPort` but the old candidate Gateway image had no `openssl`
executable, so issuer readiness was unavailable and no AgentCredential was
created. Phase 4 remediated this by installing Debian Bookworm OpenSSL in the
runtime image and replacing unsupported OpenSSL 3.0 `x509 -not_before` /
`-not_after` flags with the portable `openssl ca -startdate` / `-enddate`
path. The issuer now passes in the Linux runtime image and the focused Agent
tests pass; canonical staging enrollment still needs to be rerun with the new
candidate.

The API edge rate limiter produced HTTP 429 for the mutation threshold in an
isolated loop. The Caddy path, raw API/DB exposure checks and local TLS checks
remain partial staging evidence. The Lima guest has no installed user
`itcenter-backup.timer`, so the scheduled RPO path was not executed; the
checked-in six-hour timer definition remains available for operator install.

At the time of the initial summary, no registry-backed immutable RC metadata
was available. Phase 5 adds that RC and exact-digest local staging evidence;
completed RFC9068 negative acceptance, Agent registration/credential
acceptance, canonical deployment attestation, scheduled backup evidence,
application restore validation, the migration matrix, public production
edge evidence and production escrow governance are still unavailable. No
release is therefore VERIFIED.

## Phase 6 canonical R4 deployment evidence

Focused deployment integration commit `7ea1607` adds the checked-in optional
`OIDC_CA_CERT_FILE` Compose trust overlay. `verify-config.sh` validates the
absolute PEM certificate and rejects missing, malformed or private-key input;
the configuration revision includes the certificate content hash. This closes
the earlier need for an undocumented Compose override while preserving normal
system-trusted OIDC operation when the variable is absent.

Bootstrap CI run `35040086404` passed both `verify` and `publish-oci`. It
published `RC-20260916-R4` from source
`7ea16079860cca6c0b33b0dbf8dfd6eb6f03663f` with GHCR image
`ghcr.io/duclee9x/itcenter@sha256:cfed2a3b011a61f1ba98c8f263dfef6341302c2a8d228ca173e396f01aa2cc91`.
SBOM and provenance were generated; schema revision remains
`95886cdc18d735163a76863d050e37b7629c3015bbe37b756b9764a260636fdb`.

The exact R4 digest was pulled into Lima without a local rebuild. Canonical
`verify-config.sh` and `deploy.sh staging` ran with the staging OIDC CA
configured and returned `DEPLOYMENT_SUCCEEDED RC-20260916-R4`; deployment
state records `SMOKE_PASSED` and configuration revision
`fb999a453825d914e1985090ebcec4eceded5a593786900182275fdc9a01c1b9`. API,
Agent Gateway and Worker each report the same R4 image digest. PostgreSQL and
the raw API port remain unpublished; only Caddy's staging ports and the
dedicated Gateway mTLS port are published.

R4 edge checks through Lima loopback passed: HTTP returned `301` to HTTPS,
HTTPS API readiness returned `200`, required security headers were present,
capabilities without authentication returned `401`, and TLS 1.2 succeeded
while TLS 1.0 and 1.1 failed. The direct Gateway readiness endpoint returned
`READY` separately from Caddy. These checks are local staging evidence; they
do not prove public production ACME or external reachability.

The complete release acceptance is still open. The full OIDC negative matrix,
canonical Agent enrollment and negative mTLS matrix, readiness failure/drain
evidence, scheduled backup timer, application restore validation, R4 migration
matrix and production recovery escrow remain incomplete. No RELEASE item is
promoted to `VERIFIED` by this phase.

The checked-in backup timer was also corrected in this phase: it now consumes
an explicit user EnvironmentFile instead of hard-coded checkout and production
paths. In Lima, the staging user timer was installed and the real service was
triggered successfully. It produced protected encrypted backup
`staging-20260916T015617Z-20381-487044`, and the timer reports the next firing
at `2026-09-16 12:00:00 +07`. This is staging-equivalent RPO evidence; the
production EnvironmentFile and production recovery custody remain deployment
prerequisites after gate approval.

The R4 canonical deployment was initially retried after a task-owned stale
deployment process was stopped. The successful run used the checked-in base,
staging and OIDC-CA Compose context only; no ad-hoc Compose override was used.

## Phase 5 exact registry candidate and staging edge evidence

Bootstrap CI run `35010287210` completed successfully for both `verify` and
`publish-oci` after the protected `master` prerequisite was enabled. The
workflow source is `e690ea47a7eb4b70057247b2793dd0db67918c7e`. It published
`RC-CCA7D1B-20260916-R3` to GHCR with image digest
`sha256:3715744c11e133d7068651d7df6fe1ef2f1377643bf65e6635f4fcadfdac1d9e`.
The RC metadata was committed at `76ab410`; SBOM and provenance are recorded
as generated. The digest was pulled into Lima and inspected as `linux/arm64`.

The isolated staging API, Agent Gateway and Worker were recreated from that
exact digest. Their inspected image digest is the RC digest above. PostgreSQL
and Caddy remain separate infrastructure images. The API and PostgreSQL have
no published host port; only Caddy staging ports and the dedicated Gateway
mTLS port are published. API readiness became usable after the staging
Keycloak CA was trusted, and the canonical smoke command returned
`SMOKE_READY`.

The local staging edge checks passed: HTTP returned the HTTPS redirect, HTTPS
reached `/api/v1/health/live` with `200`, the required security headers were
present, unauthenticated capabilities returned `401`, and a body above 2 MiB
returned `413`. A bounded real-token general limiter check returned `206` at
the normal threshold and `99` `429` responses after the bucket was exhausted;
the mutation check returned `80` route responses followed by one `429`.
The direct Gateway readiness endpoint returned `200` through its separate
forwarded port. These are local/internal staging results, not public DNS or
production ACME evidence.

The first canonical `deploy.sh` attempt exposed a deployment integration gap:
the current staging env uses an HTTPS Keycloak issuer, but `deploy.sh` does
not load the existing non-secret Keycloak CA compose override. The stack was
then started with that isolated override and the exact RC digest, without
changing the image or validator. This leaves canonical registry-backed
staging attestation incomplete until the deployment path accepts the required
staging trust configuration.

The general and mutation checks do not close RELEASE-007 by themselves. Real
OIDC negative-token and authorization evidence, canonical Agent enrollment
and negative mTLS behavior, readiness failure/drain evidence, scheduled
backup/timer evidence, application restore validation, the N-1 migration
matrix, and production escrow governance remain open.

## Verification result

| Item        | Result                         | Evidence / remaining blocker                                                                                                                                                                                 |
| ----------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RELEASE-001 | `CODE_COMPLETE / NOT VERIFIED` | Real Keycloak/JWKS/RS256 `at+jwt` token is accepted in the isolated stack; the complete negative-token, revoked-membership and RBAC matrix remains incomplete.                                               |
| RELEASE-002 | `CODE_COMPLETE / NOT VERIFIED` | Linux/OpenSSL remediation and direct TLS handshake pass; canonical enrollment, credential acceptance and negative staging matrix remain incomplete.                                                          |
| RELEASE-003 | `CODE_COMPLETE / NOT VERIFIED` | API readiness and three mandatory workers are healthy; dependency-failure, worker-failure and drain transitions are not fully evidenced.                                                                     |
| RELEASE-004 | `CODE_COMPLETE / NOT VERIFIED` | R4 registry publication, exact-digest pull and canonical `deploy.sh` staging smoke pass; full attestation still requires qualifying RELEASE-001/002/003 evidence.                                            |
| RELEASE-005 | `CODE_COMPLETE / NOT VERIFIED` | Protected backup, checksum, isolated schema restore and staging timer execution pass; application restore validation, production escrow and complete RTO evidence remain open.                               |
| RELEASE-006 | `CODE_COMPLETE / NOT VERIFIED` | Transitional N-1 is preserved, but baseline/application compatibility and backup-gated N-1→N rehearsal remain incomplete.                                                                                    |
| RELEASE-007 | `CODE_COMPLETE / NOT VERIFIED` | Local exact-RC edge checks pass for redirect, HTTPS, headers, 401, 413, general/mutation 429 and direct Gateway reachability; spoof, TLS-version and full direct Agent application checks remain incomplete. |

**RPO:** `MET`. The six-hour systemd timer was installed and exercised in the
production-equivalent Lima staging environment; backup
`staging-20260916T015617Z-20381-487044` completed encryption, HOST_PROTECTED
copy and checksum verification, and the next timer firing is scheduled for
`2026-09-16 12:00:00 +07`.

**RTO:** `UNVERIFIED` for release closure. The isolated database restore was
under two hours, but application usability validation was not completed.

## Phase 4 remediation evidence

Focused remediation commit `cca7d1b3bfc7510635d4db1be67bafa65981a8a3`
fixes Linux Agent certificate issuance. The runtime image now contains
OpenSSL 3.0 from Debian Bookworm, the issuer uses the OpenSSL-3.0-compatible
`ca` signing path with bounded stderr diagnostics, and the issuer preserves
the server-controlled URI SAN, clientAuth EKU, requested serial and 30-day
maximum lifetime. The local focused issuer test, full repository suite and
Linux-like runtime-image issuer exercise pass.

GitHub Actions Bootstrap CI run `35007367015` for this commit completed with
`success`. A new local candidate was built from the committed source:

| Field                    | Value                                                                     |
| ------------------------ | ------------------------------------------------------------------------- |
| Release                  | `RC-LOCAL-CCA7D1B`                                                        |
| Source                   | `cca7d1b3bfc7510635d4db1be67bafa65981a8a3`                                |
| Local OCI image identity | `sha256:474f72db0aca9f5464c365a4b9e47db695e100a45b852b32bf5e21be70b72b0f` |
| Schema                   | `95886cdc18d735163a76863d050e37b7629c3015bbe37b756b9764a260636fdb`        |
| Registry digest          | Not available; publish job requires protected `master`                    |

GitHub reports `master` as unprotected. The publish safeguard remains in
place; no GHCR digest or registry-backed RC has been fabricated.

## Environment readiness

| Prerequisite                   | Status                   | Evidence / boundary                                                                                                     |
| ------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Local immutable OCI candidate  | `READY`                  | `RC-LOCAL-7EA3001`; local-only, not a promotable RC.                                                                    |
| Registry-backed RC metadata    | `OPERATOR_REQUIRED`      | Registry URL/repository and protected publish credentials are absent.                                                   |
| `age` in Lima                  | `READY`                  | `age 1.3.1`.                                                                                                            |
| HOST_PROTECTED mount           | `READY`                  | Writable host-backed `virtiofs`; marker write/read/remove passed.                                                       |
| Staging age escrow             | `READY`                  | Staging identity exists outside Lima on the host-backed path; production governance remains separate.                   |
| Staging Agent PKI              | `READY`                  | Staging CA/server/client material exists outside the repository; application enrollment is still required.              |
| Agent CA/private issuer escrow | `OPERATOR_REQUIRED`      | Production recovery custody/reference is not evidenced.                                                                 |
| Staging OIDC                   | `READY (PARTIAL MATRIX)` | Pinned Keycloak 26.3.3 issues real RS256 `at+jwt` tokens and canonical R4 deploy loads its CA; negative matrix remains. |
| Staging TLS                    | `READY` (local)          | Independent local staging mode is configured; public DNS/ACME remains unverified.                                       |
| Lima port forwarding           | `EXERCISED (LOOPBACK)`   | HTTP, HTTPS and Agent mTLS listeners responded through macOS/Lima loopback; public reachability remains unverified.     |
| N-1 release reference          | `READY`                  | Transitional reference from `7c403ab53f...`; local artifact only, not a historical production release.                  |

The exact unresolved operator actions are maintained in
`docs/release/RELEASE_OPERATOR_PREREQUISITES.md`.

Until every item above has qualifying evidence and RPO/RTO are measured, do
not mark any item `VERIFIED`, advance `CURRENT_RELEASE_ITEM` to
RELEASE-GATE-001, or execute the gate.

## Phase 8 execution evidence

Phase 8 executed the remaining acceptance paths against the exact R4 staging deployment. No release item is promoted by this phase.

### RELEASE-001

Real Keycloak 26.3.3 HTTPS/JWKS was exercised with a fresh RS256 RFC 9068 `at+jwt` token. The positive capabilities request returned `200`; missing, malformed, duplicate and unknown tenant selectors returned `400`, `400`, `400` and `403`; malformed bearer credentials returned `401`. The complete issuer, audience, expiry, signature, unknown-kid, token-type, membership and RBAC negative matrix was not executable with the currently provisioned staging identity. Status remains `CODE_COMPLETE / NOT VERIFIED`.

### RELEASE-002

Canonical enrollment was attempted through `POST /api/v1/agents/{id}/enrollment-tokens` and returned `403 PERMISSION_DENIED` for the staging principal, before a token could be issued. Direct mTLS was exercised through the Lima-forwarded Gateway port: no client certificate and a client certificate signed by an untrusted CA both returned `401`; the existing staging certificate also returned `401` because no corresponding `AgentCredential` exists. No credential row was fabricated. Status remains `CODE_COMPLETE / NOT VERIFIED`.

### RELEASE-003

With Keycloak stopped and the API restarted, the public edge observed `502` because the Caddy upstream was unavailable; after Keycloak recovery the API returned `READY/200`. A real API container stop produced an exited container and upstream `502`, then recovered to healthy. A real Worker container stop produced an exited Worker and it recovered to healthy. The Worker runtime is a single Node process containing all 13 tasks and exposes no per-task fault control, so an isolated degradable-worker failure could not be produced without changing runtime semantics. Required per-component failure and readiness-first drain evidence remains incomplete.

### RELEASE-005

The canonical restore command was executed against timer-produced HOST_PROTECTED backup `staging-20260916T015617Z-20381-487044`. It completed checksum verification, age decryption, fresh PostgreSQL restore and schema validation in rehearsal `restore-20260916T032141Z-572953` in approximately 8 seconds. The restore script does not start an application against the restored database, so representative protected read/write and application usability were not established. `RPO` remains `MET`; `RTO` remains `UNVERIFIED`.

### RELEASE-006

The canonical rehearsal was attempted with the preserved transitional N-1. The original metadata failed validation because `migration_steps` was absent. An isolated derived metadata attempt using the exact 100-step committed manifest created and cleaned its own Compose resources but failed while starting the rehearsal stack because canonical Gateway port `127.0.0.1:13001` was already occupied by staging. No four-cell migration matrix was recorded and status remains `CODE_COMPLETE / NOT VERIFIED`.

### RELEASE-007

Against R4, bounded tests produced general and mutation `429` responses with `Retry-After`; spoofed forwarded headers still produced the normal authenticated response and did not alter tenant/authentication behavior. TLS 1.3 negotiated successfully. From macOS, raw API port `3000` and PostgreSQL `5432` were closed; Caddy ports `18080`/`18443` and dedicated Gateway port `13001` were open. Status remains `CODE_COMPLETE / NOT VERIFIED` because the direct authenticated Agent application path depends on blocked canonical enrollment.

### Phase 8 verification execution record

| Path                                   | Result       | Evidence classification                                                     |
| -------------------------------------- | ------------ | --------------------------------------------------------------------------- |
| R4 OIDC positive/tenant edge checks    | PASS         | Real Keycloak HTTPS/JWKS; no token material persisted                       |
| Canonical enrollment-token request     | BLOCKED      | `403 PERMISSION_DENIED`; staging grant missing                              |
| Direct mTLS negative checks            | PASS         | Lima-forwarded Gateway; no private material recorded                        |
| API dependency interruption/recovery   | PARTIAL      | Caddy observed upstream `502`; API recovered `READY/200`                    |
| Worker container interruption/recovery | PARTIAL      | Container-level failure only; no per-task degradable control                |
| R4 edge limits/spoof/TLS/exposure      | PASS/PARTIAL | General/mutation `429`, spoof request, TLS 1.3, port inventory              |
| Protected restore rehearsal            | PARTIAL      | DB/schema pass; application usability not provided by restore script        |
| N-1 migration rehearsal                | FAIL         | Transitional metadata/port collision prevented qualifying run               |
| Final repository suite                 | PASS         | 122 unit + 2 contract + 6 migration + 61 integration + 64 e2e; 1 flock skip |

The full release remains `BLOCKED_FOR_VERIFICATION`. No staging attestation was created because RELEASE-001/002/003 evidence prerequisites for the attestation are not complete.

## Phase 9 remediation and execution evidence

Focused remediation commit `cbf071b` changes only verification and recovery
tooling; the R4 OCI contents and runtime candidate remain unchanged. The
rehearsal now uses a dedicated Compose overlay with no published host ports,
creates its isolated runtime configuration, probes services from inside the
project, and initializes rollback status as `NOT_DETERMINED`. The new
transitional metadata generator counts SQL migrations from the exact committed
N-1 source and generated `migration_steps=100` for `7c403ab`.

The restore rehearsal now records `application_validation=NOT_RUN` and keeps
`RTO=UNVERIFIED` unless an executable isolated application-validation harness
passes after schema restore. This prevents a database-only restore from being
reported as a completed RTO.

The updated migration rehearsal was executed against the preserved N-1 image
and R4 metadata while live staging remained running. The previous Gateway
port collision was removed. The attempt then failed reproducibly at N-1 API
startup with `Production authentication trust initialization failed`: the
Lima podman-compose provider retains OIDC variables from the service
environment even when the rehearsal overlay selects `AUTH_MODE=unavailable`.
The API remained fail-closed; no OIDC validation was weakened. The isolated
resources were removed after the failure and the live staging stack was left
untouched.

Phase 9 status remains unchanged: no release item is promoted, RPO remains
`MET`, RTO remains `UNVERIFIED`, and the complete OIDC, Agent enrollment,
runtime failure/drain, application restore, migration matrix, and direct
authenticated Agent application evidence are still blocked by their actual
execution prerequisites. No staging attestation was created.

## Phase 10 execution evidence

The rehearsal integration was corrected to include the checked-in OIDC trust
overlay and, when configured, connect the real staging Keycloak container to
the isolated rehearsal network under the `keycloak` alias. This preserves real
OIDC/JWKS readiness and does not weaken authentication or change the R4 OCI.

The Phase 10 run reached the N-1 application startup path with real OIDC
configuration and no host-port collision. It then failed at target schema
validation with `TARGET_SCHEMA_MISMATCH`; the persisted evidence records the
same source and target metadata revisions but no qualifying four-cell matrix.
The failure is retained as a concrete migration-tooling/runtime evidence gap,
not converted into a rollback conclusion. Temporary rehearsal resources were
removed and live staging remained running.

Phase 10 therefore promotes no release item. `RPO` remains `MET` and `RTO`
remains `UNVERIFIED`. The remaining Agent enrollment/RBAC, real OIDC negative
matrix, readiness failure/drain, restore application validation, target schema
diagnosis, direct Agent application, and RELEASE-004 attestation paths remain
open.
