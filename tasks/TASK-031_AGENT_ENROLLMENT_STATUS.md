# TASK-031 — Agent Enrollment + Status + Inventory Projection

```yaml
task_id: TASK-031
feature_id: F-018
workflow_id: WF-004
phase: P2
priority: P0
status: CODE_COMPLETE
owner_domain: agent
```

## Objective

Persist an enrolled agent's heartbeat and latest inventory projection through
the dedicated agent gateway, preserving independent freshness timestamps.

## Required specifications

- `docs/HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`

## In scope

- Agent registry bound to an existing asset.
- Authenticated agent heartbeat and inventory endpoints.
- Admin enrollment token command with one-time plaintext response and hashed storage.
- ONLINE/OFFLINE status and inventory snapshot projection.
- `AGENT.ONLINE`, `AGENT.OFFLINE`, and `AGENT.INVENTORY_SYNCED` outbox facts.

## Out of scope

- Agent job execution and self-healing.
- Enrollment token issuance UI.
- Offline threshold worker and incident correlation.

## API

- `POST /api/v1/agent/heartbeat`
- `POST /api/v1/agent/inventory`

The authenticated agent identity is the registry key; requests are tenant
scoped and cannot call administrative API commands.

## Acceptance criteria

1. An authorized operator can issue one enrollment token for an eligible asset.
2. An enrolled agent can update heartbeat status and last-seen timestamp.
3. Inventory sync updates only the agent projection and preserves dataset freshness.
4. Unknown agent or wrong tenant is rejected.
5. Each accepted enrollment, heartbeat and inventory update writes its outbox event atomically.
6. Existing unit, migration, integration, lint, typecheck and build gates pass.
