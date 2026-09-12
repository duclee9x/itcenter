# IMPLEMENTATION HANDOFF

## Active Task

TASK-052 — Network Exceptions — Unknown Device, VLAN, IP Conflict

Feature: F-028/F-029
Workflow: WF-012/WF-NET02
Branch: master

## Overall Status

CODE_COMPLETE

TASK-052 network exception detection, resolution and Work Queue projection
verification passed.

## Completed

- Added `identity.sessions` migration with tenant/user foreign key, expiry,
  revocation, version and active-session index.
- Added OIDC claim validation and active-user session creation/revocation
  helpers.
- Added `/api/v1/me` authentication boundary and logout route wiring with
  authorization, outbox and audit writes.
- Logout now requires `Idempotency-Key` and executes through the durable,
  tenant/principal/session scoped idempotency ledger.
- Session use now locks the authoritative row and requires the canonical user
  to remain active.
- Added regression coverage for invalid session durations and authoritative
  session-use checks.
- Added the OIDC login application use case: verified claims create a session
  and emit success audit/outbox effects; failed authentication emits failure
  audit/outbox effects without recording a token.
- Added unit coverage for verified OIDC login and success effects.
- Updated migration coverage for the session table.
- Replaced stale prompt examples with reusable current-task and handoff
  templates.

## Remaining Work

- TASK-002 completed at `c518d48`; TASK-003 completed at `7b7c2c0`.
- Existing idempotency, outbox, inbox and operation foundations are the
  starting point for TASK-004.
- Added versioned operation state transitions with allowed-state validation.
- Added outbox claim/attempt and tenant-scoped publication marking.
- Added explicit expired-idempotency-key conflict behavior.
- Added PostgreSQL integration coverage for operation and outbox hardening.
- Added audit checksum/hash-chain metadata, tenant-scoped audit queries and
  integrity verification.
- Added migration and integration coverage for audit query/integrity controls.
- Added tenant-scoped asset registry schema and asset create command with
  idempotency, `ASSET.CREATED` outbox and audit.
- Added E2E coverage for asset creation and idempotent replay.
- Fixed migration runner ordering so identity schema is applied before asset.
- Added movement persistence with source/destination location and user.
- Added transfer validation, assignment history preservation, and `ASSET.TRANSFERRED` effects.
- Added `ASSET.REQUEST_RETURN` and `ASSET.RECEIVE_RETURN` commands with pending/returned state handling.
- Added immutable return documents, condition grades, return movement, and return E2E coverage.
- Added monitoring event normalization, persistence, tenant/source/provider-event dedupe,
  idempotency, critical/recovered outbox events, audit and API permission enforcement.
- Added incident persistence, create/state transition commands, state invariants,
  idempotency, outbox and audit effects.
- Added root incident relations, child incident/ticket correlation command,
  tenant checks, unique dedupe constraint, outbox and audit effects.
- Added major incident declaration and communication publication records with
  channel/audience validation, idempotency, outbox and audit effects.
- Added SLA policies, targets, instances and append-only SLA events with
  engine-managed start and transition commands.
- Added approval policies, requests and append-only decisions with explicit
  create/approve/reject commands, self-approval protection and audit/outbox.
- Added Problem, Change and Knowledge persistence with explicit create and
  transition APIs, validation, idempotency, outbox and audit effects.
- Added maintenance orders, warranty coverage records and protected
  maintenance transitions with tenant-scoped persistence, outbox and audit.
- Added tenant-scoped network discovery jobs and state transitions, normalized
  append-only IP/MAC/device observations, provider-event deduplication, and the
  latest-observation topology projection with source confidence and configured
  freshness thresholds. Added permission, idempotency, outbox, audit and E2E
  coverage; observations do not mutate canonical asset state.
- Added unknown-device and duplicate-IP exception detection, explicit expected
  VLAN comparison, tenant-scoped exception reads and version-checked resolution
  with audit/outbox effects. Unknown-device links validate the asset and store
  a network-owned MAC disposition without changing asset master data.
- Added Work Queue-owned network exception references; generic queue resolution
  rejects network-source items so resolution always uses the exception command.
- Added E2E coverage for exception dedupe, Work Queue projection, tenant scope,
  versioned linking, topology association, canonical asset immutability, audit
  and outbox events.

## Verification State

PASS: `npm test`, `typecheck`, `format:check`, `lint` and `build`, with
`TEST_DATABASE_URL` pointed at the running PostgreSQL container so migration,
integration and E2E database gates used disposable databases.

PASS: `./local serve` connected to the running PostgreSQL container on the
published port `127.0.0.1:15432`; API readiness returned HTTP 200.

TASK-038 complete: maintenance and warranty APIs enforce asset-scoped records,
valid coverage dates and protected maintenance transitions with tenant-scoped
persistence, outbox and audit effects.

TASK-039 complete: added durable automation rule safety metadata and kill-switch
control plus an authorization-scoped Operations Overview projection covering
work, incidents, SLA, approvals, maintenance and automation attention.

TASK-050 complete: added tenant-scoped audit sessions, expected asset values,
append-only observations, durable mismatch exceptions and explicit resolution
commands with idempotency, outbox and audit effects. Observations do not mutate
canonical asset state.

TASK-051 complete: added discovery job lifecycle, provider-neutral observation
ingestion and tenant-scoped current topology reads. Freshness is calculated
against each job's configured threshold. Active source-specific network probes
remain integration work; no discovery result is fabricated.

TASK-052 complete: discovery now creates unknown-device and duplicate-IP
exceptions. VLAN mismatches are recorded only when a caller supplies the
expected VLAN because no VLAN policy registry exists. Resolution accepts an
explicit reason and expected version, validates any target asset, records a
durable MAC disposition, updates the Work Queue projection and emits the
cataloged exception-resolved event.

MIGRATION_RISK: the existing local volume rejects `npm run db:migrate` because
an applied migration checksum differs. Do not edit migration history or reset
the volume automatically; restore the original migration or add a forward
migration before applying schema changes.

## Exact Next Step

TASK-053 is next; its prerequisites are satisfied. Generate the task spec from
the registry, then implement controlled network change, verification and
rollback.

## SPEC_CONFLICT

None.

## SCOPE_DEPENDENCY

Live SNMP/ICMP/ARP/LLDP and controller polling need source connectors and
scoped credentials; TASK-051 provides the normalized ingestion and topology
boundary without claiming live polling.
