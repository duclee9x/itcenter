# TASK-030 — Monitoring Ingestion + Normalization + Dedupe

```yaml
task_id: TASK-030
feature_id: F-017
workflow_id: WF-003
phase: P2
priority: P0
status: IN_PROGRESS
owner_domain: monitoring
```

## Objective

Accept a normalized monitoring observation through the command boundary,
persist the canonical observation with tenant-scoped dedupe, and emit the
`MONITORING.CRITICAL` or `MONITORING.RECOVERED` outbox fact.

## Required specifications

- `docs/HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`

## In scope

- Monitoring observation persistence and dedupe key.
- Source payload normalization at the API boundary.
- `POST /api/v1/monitoring/events` with `Idempotency-Key`.
- Outbox event and audit record in the same transaction.
- Unit, migration, contract and API coverage.

## Out of scope

- Incident creation/correlation (TASK-032/033).
- Maintenance-window suppression and flapping policy evaluation.
- Provider-specific webhook signature adapters.
- Time-series storage and dashboards.

## Domain rules

- Raw provider fields do not cross into the monitoring domain.
- Duplicate provider event plus source is one observation per tenant.
- Suppression does not delete the observation.
- Critical and recovered observations are immutable facts.

## Authorization

```yaml
permission: monitoring.event.write
resource: monitoring_event
scope: TENANT
high_risk: false
```

## API

`POST /api/v1/monitoring/events`

```yaml
source: string
provider_event_id: string
asset_id: uuid|null
service_id: uuid|null
metric: string
observed_value: number|string
threshold: number|string|null
severity: CRITICAL|WARNING|INFO|RECOVERED
observed_at: ISO-8601 timestamp
```

## Acceptance criteria

1. Valid normalized observations persist once per tenant/source/provider event.
2. Replaying the same idempotency key returns the original result.
3. A conflicting idempotency payload returns `409`.
4. Critical/recovered outbox facts contain the catalog minimum payload.
5. Audit records contain actor, subject, source and correlation metadata.
6. Invalid payloads and unknown tenant resources return canonical errors.
7. Existing test, format, lint, typecheck and build gates pass.
