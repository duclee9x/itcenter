# Release Dependency Graph

This graph is separate from the product task dependency graph. It contains
only release items and the edges approved for the initial release backlog.

```mermaid
flowchart TD
  R001[RELEASE-001 API Authentication & Authorization]
  R002[RELEASE-002 Agent Authentication — CODE_COMPLETE / staging verification pending]
  R003[RELEASE-003 Worker Readiness — CODE_COMPLETE / staging verification pending]
  R004[RELEASE-004 Immutable Build / Promotion — CODE_COMPLETE / NOT VERIFIED]
  R005[RELEASE-005 Backup / Restore]
  R006[RELEASE-006 Migration Rehearsal / N-1]
  R007[RELEASE-007 TLS Ingress / Rate Limiting — READY / NOT_STARTED]
  G001[RELEASE-GATE-001 RC Re-verification]

  R004 --> R006
  R005 --> R006
  R004 --> R007

  R001 --> G001
  R002 --> G001
  R003 --> G001
  R004 --> G001
  R005 --> G001
  R006 --> G001
  R007 --> G001
```

## Direct dependency table

| Release item     | Depends on                                                                                | Reason                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| RELEASE-001      | None                                                                                      | Foundational API security adapter is `CODE_COMPLETE`; real IdP/staging verification remains.                 |
| RELEASE-002      | None                                                                                      | Agent-channel authentication can be designed/configured independently while retaining fail-closed execution. |
| RELEASE-003      | None                                                                                      | No release-item dependency; RELEASE-003-R1 fixes the readiness profiles and all 13 worker policies.          |
| RELEASE-004      | None                                                                                      | R1 fixes the OCI/Compose host target, artifact, migration, promotion, and recovery contracts.                |
| RELEASE-005      | None                                                                                      | Establishes and proves backup/restore before migrations or promotion.                                        |
| RELEASE-006      | RELEASE-004, RELEASE-005                                                                  | Rehearsal must use the immutable release artifact and proven recovery path.                                  |
| RELEASE-007      | RELEASE-004                                                                               | Edge security validation must match the deployable release topology.                                         |
| RELEASE-GATE-001 | RELEASE-001, RELEASE-002, RELEASE-003, RELEASE-004, RELEASE-005, RELEASE-006, RELEASE-007 | Re-run the complete RC gate after all P0 evidence is verified.                                               |

## Derived readiness

Derived state after RELEASE-004 implementation:

- **CODE_COMPLETE, awaiting environment verification:** RELEASE-001.
- **CODE_COMPLETE, awaiting environment verification:** RELEASE-002.
- **CODE_COMPLETE, awaiting staging verification:** RELEASE-003.
- **CODE_COMPLETE / NOT VERIFIED:** RELEASE-004.
- **READY:** RELEASE-005, RELEASE-007.
- **BLOCKED:** None.
- **WAITING_DEPENDENCY:** RELEASE-006, RELEASE-GATE-001. RELEASE-006 waits
  for RELEASE-005 and verified artifact/recovery inputs; the final gate waits
  for all verification evidence.

“Ready” means eligible to start under the release-item status model. It does
not claim verification. RELEASE-004 is `CODE_COMPLETE / NOT VERIFIED` under
[RELEASE-004-R1](items/RELEASE-004-R1_IMMUTABLE_ARTIFACT_DEPLOYMENT_PROMOTION_CONTRACT.md).
Its staging deployment remains pending. RELEASE-001 through RELEASE-003 remain
unverified pending their environment evidence. RELEASE-005 is independent.
RELEASE-007 may begin because the topology is implemented, but it is not
started in this activity. Any newly discovered blocker must be recorded on
the affected item and readiness recomputed; dependencies must not be bypassed.
