# TASK-052 — Network Exceptions: Unknown Device, VLAN, IP Conflict

```yaml
task_id: TASK-052
feature_id: F-028/F-029
workflow_id: WF-012/WF-NET02
phase: P3
priority: P0
status: CODE_COMPLETE
owner_domain: network
```

Detect actionable network exceptions from discovery observations and support
audited resolution while keeping source observations and asset state intact.

## In scope

- Detect unknown devices and duplicate-IP observations during ingestion.
- Compare observed VLAN with an explicitly supplied expected VLAN; no VLAN
  policy registry exists yet.
- Persist tenant-scoped exceptions with deduplication and optimistic version.
- Resolve or accept exceptions with reason; support linking unknown devices to
  an existing tenant asset without mutating that asset.
- Create/resolve Work Queue references through a Work Queue-owned projection.
- Provide tenant-scoped exception reads and command permissions/effects.

## Out of scope

- Quarantine, switch/VLAN configuration, asset creation, and automated VLAN
  policy inference.
- Risk scoring and incident escalation.

## Acceptance criteria

1. Unmatched observations create UNKNOWN_DEVICE exceptions; distinct MACs seen
   on one IP create IP_CONFLICT; explicit VLAN comparisons create mismatch
   exceptions only when values differ.
2. Open duplicates do not create duplicate exceptions or work items.
3. Resolution is tenant-scoped, version-checked, reasoned and auditable;
   unknown-device links validate the target asset and never mutate it.
4. Work Queue rows remain references and can only be resolved through the
   source exception command.
5. Full repository verification passes.

## Implementation contract note

The event catalog now defines `NETWORK.EXCEPTION_RESOLVED` for the resolution
fact because no network exception resolution event was previously specified.
