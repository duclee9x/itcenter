# TASK-055 — Software Deployment + Verification

```yaml
task_id: TASK-055
feature_id: F-032
workflow_id: WF-014
phase: P3
priority: P0
status: CODE_COMPLETE
owner_domain: software
```

Implement an auditable deployment campaign and per-asset job lifecycle using
only an approved, active artifact from TASK-054. Agent communication must use
the authenticated agent boundary and a Software application contract; the
Agent Gateway must not write Software tables directly. Success requires
verified installed-software evidence, not only an installer exit code.

## Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`

## In Scope

- Software-owned tenant-scoped deployment campaigns, per-asset deployment
  targets/jobs, and normalized installation-result evidence.
- Campaign creation for selected assets with a rollout cohort, bounded retry
  policy, explicit stop thresholds, and stop-on-security/health failure.
- Job creation only for a published software version linked to an active,
  approved Artifact Version. Recheck artifact state before dispatch and prevent
  dispatch after restriction or revocation.
- Agent pre-check, trusted artifact retrieval, checksum/signature validation,
  bounded install execution, reboot deferral, and post-install reporting
  through narrow application/provider ports.
- Authenticated agent job claim/lease and idempotent result reporting through
  the existing Agent Gateway. Agent HTTP handlers dispatch application
  contracts and do not issue Software SQL.
- Deployment state transitions, expected-version checks, tenant isolation,
  cancellation where safe, append-only execution evidence, audit, outbox,
  cataloged events, and useful operator read queries.
- Install success requires successful installer result plus normalized
  inventory evidence matching the expected product and version. Do not treat
  process exit status alone as installation proof.
- Use `software.deploy`, `software.deployment.read`, and
  `software.deployment.cancel` (or document a justified stable permission
  contract before implementation). Agent claims/reports require authenticated
  enrolled-agent identity scoped to the same tenant and assigned job.

## Out of Scope

- Software installation-request UX and policy approval orchestration
  (WF-SW03); a deployment must be explicitly authorized under the existing
  approval/change policy.
- License entitlement/assignment. If the catalog version requires a license,
  reject or hold dispatch with a canonical unavailable-capability result until
  TASK-057/TASK-058 provide an authoritative reservation contract.
- Unauthorized software detection/remediation (TASK-056), inventory discovery
  beyond the post-install verification evidence, and OS-specific installer
  implementation.
- Concrete production object-storage, signing, and agent execution providers.
  Add ports and safe unavailable behavior; tests may inject isolated fakes.

## Domain Rules

- Deployment and campaign records are owned by Software. Agent code may report
  through Software's application contract but may not mutate Software tables.
- Only published versions with active, approved, non-revoked artifacts can be
  deployed. Revalidate this precondition when dispatching every target.
- Each campaign target is unique for its campaign/asset/software version;
  retry creates an auditable attempt, not a duplicate target or unbounded loop.
- An agent can claim only an eligible job for its enrolled asset and tenant.
  Leases expire; stale or duplicate reports cannot overwrite newer attempts.
- Verify SHA-256 and publisher signature before execution. Never use arbitrary
  agent-supplied URLs or write binaries, tokens, or raw secrets into OLTP,
  audit, outbox, or logs.
- `SUCCESS` requires installer success and observed product/version match.
  A requested reboot is `WAITING_REBOOT` until a later authenticated result.
- Cancellation cannot erase execution history. In-flight or completed work
  needs a new compensating job if removal/rollback is required.
- High-risk/server-side campaigns require the existing approval/change
  controls; absent policy or verification providers fail closed.

## State Flow

```text
Campaign: DRAFT → ACTIVE → PAUSED → ACTIVE → COMPLETED | STOPPED
Target:   QUEUED → PRECHECK → DOWNLOADING → VERIFYING_ARTIFACT
          → INSTALLING → POSTCHECK → SUCCESS
          → FAILED | WAITING_REBOOT | CANCELLED
```

Only valid transitions are accepted. A campaign stop condition prevents new
targets from being dispatched; it does not rewrite or erase in-flight results.

## API / Agent Commands

```text
POST /api/v1/software/deployment-campaigns
POST /api/v1/software/deployment-campaigns/{id}/commands/start
POST /api/v1/software/deployment-campaigns/{id}/commands/pause
POST /api/v1/software/deployment-campaigns/{id}/commands/resume
POST /api/v1/software/deployment-campaigns/{id}/commands/advance
POST /api/v1/software/deployment-campaigns/{id}/commands/cancel
GET  /api/v1/software/deployment-campaigns/{id}
GET  /api/v1/software/deployment-campaigns/{id}/targets
POST /api/v1/software/deployment-targets/{id}/commands/retry
POST /api/v1/agent/deployments/claim
POST /api/v1/agent/deployments/{job_id}/commands/report
```

All mutations require `Idempotency-Key`; campaign and target changes require
`expected_version`. Agent requests use enrollment authentication and are
bound to the enrolled agent's asset. Report payloads contain normalized result
fields, `precheck_passed`, and bounded summaries, not raw logs or arbitrary
paths. Manual retry requires `software.retry_deployment` and a still-active
campaign; automatic retries are limited to explicitly retryable precheck or
installer failures.

## Events

Define/add payload contracts before emitting, at minimum:

```text
SOFTWARE.DEPLOYMENT_CAMPAIGN_CREATED
SOFTWARE.DEPLOYMENT_CAMPAIGN_STARTED
SOFTWARE.DEPLOYMENT_CAMPAIGN_PAUSED
SOFTWARE.DEPLOYMENT_JOB_QUEUED
SOFTWARE.DEPLOYMENT_JOB_CLAIMED
SOFTWARE.DEPLOYMENT_PRECHECK_COMPLETED
SOFTWARE.DEPLOYMENT_ARTIFACT_VERIFIED
SOFTWARE.INSTALLATION_REPORTED
SOFTWARE.INSTALLATION_VERIFIED
SOFTWARE.DEPLOYMENT_FAILED
SOFTWARE.DEPLOYMENT_CAMPAIGN_STOPPED
```

Events describe committed facts and must be written to the outbox in the same
transaction as their Software-owned state changes. Never publish before
commit.

## Idempotency, Concurrency, and Transaction Boundary

- Same key and request replays the prior result; same key with changed content
  returns `409 IDEMPOTENCY_KEY_CONFLICT`.
- Stateful commands enforce expected version. Agent result dedupe includes the
  job, lease/attempt, and report identity.
- Commit Software state, target/attempt evidence, outbox, and required durable
  audit references atomically. Artifact download, signing, agent execution,
  notifications, and projections run outside the transaction.
- Retry only explicitly retryable transport/precheck outcomes, with maximum
  attempts, elapsed time, backoff, and no retry of uncertain installs until
  actual installed state is reconciled.

## Required Tests

- Approved active artifact dispatch succeeds; pending, unpublished, restricted,
  and revoked artifacts are rejected.
- License-required software cannot dispatch without an authoritative license
  reservation dependency.
- Same-key replay, changed-payload conflict, stale version, tenant isolation,
  permission denial, and agent-to-asset scope denial.
- Agent claim lease ownership, lease expiry, duplicate/stale result handling,
  and result idempotency.
- Checksum/signature failure prevents execution; unavailable artifact retrieval
  or verification leaves work safely pending/failed without claiming success.
- Installer nonzero result, missing/wrong-version inventory, reboot pending,
  successful post-check, bounded retry, cancellation, and campaign stop
  thresholds.
- Database uniqueness/integrity, append-only evidence, audit/outbox atomicity,
  and no secrets/raw logs in emitted payloads.

## Acceptance Criteria

1. Tenant-scoped campaign/target records have database uniqueness and state
   constraints; Software remains the sole owner of deployment state.
2. Only eligible published active artifacts can be dispatched, and a revoked
   or restricted artifact is blocked before each new dispatch.
3. Only the enrolled agent assigned to a target can claim/report its job;
   duplicate/stale reports cannot mutate current state.
4. No binary or arbitrary URL crosses the API trust boundary; checksum and
   signature verification precede execution.
5. A deployment is successful only when installer and actual software/version
   verification both pass; reboot and failed verification remain non-success.
6. Campaign stages and stop thresholds prevent further dispatch when tripped;
   execution history is preserved.
7. Commands enforce authorization, idempotency, concurrency, tenant scope,
   audit, outbox, canonical errors, and bounded retry behavior.
8. Integration tests cover all safety boundaries and repository gates pass;
   `CURRENT_TASK.md`, handoff, task file, and registry are updated.

## Scope Dependencies

- TASK-031 supplies enrolled-agent identity/status, but no deployment job
  transport or installer is configured. Implement a provider-neutral claim and
  result boundary with fail-closed runtime behavior.
- TASK-054 supplies the catalog and artifact lifecycle. Its production storage,
  malware scanner, and signature verifier are not wired; do not claim a live
  deployment path until trusted adapters exist.
- TASK-057/TASK-058 own license entitlement and reservation. Licensed software
  remains non-dispatchable until that owner exposes an application contract.

## Implementation Report

### Status

CODE_COMPLETE. Repository test, lint, typecheck, formatting, and migration gates
passed. Production Agent authentication, signed artifact delivery, operating
system installer, and License reservation providers remain unconfigured; their
absence fails closed.

### Files Changed

- Added Software deployment application contracts, campaign/target/attempt/
  installation schema, API routes, and Agent Gateway claim/report routes.
- Added `tests/e2e/software-deployment.test.ts` covering unavailable delivery,
  tenant and permission boundaries, idempotency, verified installation,
  security stop, retry denial, audit/outbox, and immutable evidence.
- Updated event actor contract to recognize authenticated enrolled `AGENT`
  actors; documented deployment APIs, data model, permissions, events, and
  traceability.
- Updated task registry and handoff/current-task pointers.

### Database Changes

- Added `software.deployments`, `software.deployment_targets`,
  `software.deployment_attempts`, and `software.software_installations` with
  tenant-consistent foreign keys, bounded attempts, target uniqueness, leases,
  and append-only attempt evidence.
- Ordered the deployment migration after Software catalog and Artifact schemas.

### APIs / Commands

- Added campaign create/read/list, start, pause, resume, advance, cancel/stop,
  and bounded manual retry routes.
- Added enrolled-agent claim/lease and normalized report routes. Download grants
  are HTTPS-only and short-lived; storage references are never returned.
- Installation evidence is written only when installer result, checksum,
  signature, observed product code, and observed version all match.

### Events and Permissions

- Added deployment campaign, job, precheck, artifact verification, installation,
  failure, security stop, and completion event payload contracts.
- Added `software.deploy`, `software.deployment.read`,
  `software.deployment.cancel`, and `software.retry_deployment`.
- Agent and manager mutations write audit and outbox records in the same
  transaction as state changes.

### Tests Run

- `npm test`: passed (22 unit/architecture, 2 contract, 1 migration, 18
  integration, 14 E2E tests).
- Focused `tests/e2e/software-deployment.test.ts`: passed again after adding
  security-stop and retry-denial coverage.
- `npm run lint`, `npm run typecheck`, and `npm run format:check`: passed.

### Remaining Gaps

- Production Agent enrollment authentication, signed object-storage delivery,
  and platform-specific installer execution require configured providers.
- Licensed catalog products are rejected until TASK-058 exposes an authoritative
  License reservation contract.
- An expired uncertain installation lease is rejected for reconciliation; an
  operator/agent recovery workflow is outside this task.

### Spec Conflicts and Assumptions

- The event envelope excluded `AGENT`, although this task requires authenticated
  enrolled agents to be recorded as actors. The event schema and actor catalog
  now include this distinct type.
- No other blocking specification conflict was found.
