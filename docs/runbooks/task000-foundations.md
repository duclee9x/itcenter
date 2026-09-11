# TASK-000 ownership and traceability

Feature: FOUNDATION. Workflow: PLATFORM-BOOTSTRAP. Owner: Platform. Phase: P0.

| Task requirements                  | Implementation                                         | Verification                                        |
| ---------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| §§4–8 boundaries and ports         | apps, modules, focused packages                        | architecture + typecheck                            |
| §§9–11 config, correlation, errors | config, observability, api-contracts                   | unit + contract + HTTP E2E                          |
| §12 durable idempotency            | platform migration; messaging/PostgresIdempotencyStore | integration replay/conflict/concurrency             |
| §13 outbox                         | platform migration; PostgresOutboxWriter; worker host  | integration precommit visibility/rollback           |
| §14 inbox                          | PostgresInboxStore and consume                         | parallel redelivery and failure retry               |
| §15 operation registry             | platform.operations; OperationRegistry                 | tenant filtering, initial QUEUED state              |
| §16 append-only audit              | audit module and migration                             | event/relation/evidence immutable and transactional |
| §§17–20 identity and security      | identity model/seed; OIDC port; auth port              | seed replay, no grants, auth allow/deny             |
| §§21–22 persistence                | pool, UnitOfWork, migration runner                     | empty DB, rerun, checksum rejection                 |
| §§23–28 runtime/contracts          | HTTP health, worker lifecycle, versioned contracts     | unit + contract + E2E                               |
| §§29–33 tooling                    | dependency checker, Compose, CI                        | lint/build and migration tests                      |

## Ports

Clock, IdGenerator, CorrelationContext, ActorContext: shared-kernel.

UnitOfWork, Transaction: persistence. Stores receive a transaction, never open an independent domain write transaction. Do not retain a transaction beyond its callback; the implementation rejects later use.

OutboxWriter, InboxStore, IdempotencyStore, EventPublisher: messaging. EventPublisher is a port only. No publisher or business consumer is enabled.

AuthorizationPort, AuthenticationPort: auth. OidcAuthenticationPort: identity application. AuditPort: audit application. ObjectStore: optional metadata boundary, no adapter.

## Command pattern for later tasks

An owning application handler authenticates/authorizes with canonical resource context, then opens a UnitOfWork and executes PostgresIdempotencyStore with semantic target/payload/version input. It validates the canonical version/invariants, saves its own aggregate, writes outbox and required AuditPort evidence, and returns a replayable response. It must let failure propagate out of UnitOfWork. Never call a remote system or publisher in this transaction.

OperationRegistry exposes enqueue and tenant-filtered find only. Enqueue always starts QUEUED; future explicit commands own transitions. No HTTP mutation endpoint is created by TASK-000.

## Consumer pattern

Validate the envelope, claim the consumer/event pair, invoke the owning application handler using the same transaction, then mark processed. The helper returns only after commit. Failed transactions roll back effects and record FAILED separately; a redelivery can reclaim FAILED. Concurrent failure recording never overwrites a successful delivery. A future broker adapter must ACK only after success and apply event-specific payload schemas before business handlers.

## Audit

Audit append inserts event, relations and evidence under the caller transaction. Database triggers reject UPDATE, DELETE and TRUNCATE for all three tables. This is application/database append-only enforcement, not protection against a database owner deliberately disabling triggers. Production infrastructure should separate migration ownership, runtime credentials and audit administration.

Audit is separate from timeline. Timeline is not created. Do not pass passwords, tokens, private keys or raw license keys in audit before/after data; the owning audit module rejects known secret field names. Integrity chains, retention/redaction overlay, signed evidence and compliance export are deferred.

## Static guardrails and limits

The dependency checker examines imports, exports, dynamic imports and cycles. It rejects domain-to-infrastructure, cross-module internal imports, modules-to-apps, and packages-to-modules/apps. It does not prove arbitrary SQL ownership or runtime authorization correctness; future reviews and repository tests remain necessary. No RLS policy is installed; current query implementations filter tenant explicitly.
