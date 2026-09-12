# TASK-051 — Network Discovery + Current Topology Projection

```yaml
task_id: TASK-051
feature_id: F-027
workflow_id: WF-011
phase: P3
priority: P0
status: CODE_COMPLETE
owner_domain: network
```

Implement a provider-neutral discovery job and observation ingestion boundary,
plus a tenant-scoped current-topology projection.

## In scope

- Create and complete discovery jobs with explicit state transitions.
- Normalize and append observed IP/MAC/device context with source, confidence
  and observed time. Observations never update canonical asset state.
- Project the newest observation per interface and report freshness using the
  threshold configured on its discovery job.
- Enforce tenant scope, idempotency, permission, outbox and audit controls.

## Out of scope

- Active SNMP, ICMP, ARP, LLDP/CDP or vendor-controller probes; those require
  source-specific connectors and credentials.
- Unknown-device, VLAN-mismatch and IP-conflict resolution (TASK-052).
- Canonical asset/network-device matching beyond an optional supplied asset ID.

## Acceptance criteria

1. Jobs follow QUEUED → RUNNING → PARTIAL/COMPLETED or FAILED/CANCELLED rules.
2. Observations are normalized, append-only and deduplicated by source event.
3. Topology reads return tenant-scoped latest observations with confidence,
   source, timestamp and threshold-based freshness.
4. Observation ingestion does not mutate asset canonical records.
5. Full repository verification passes.
