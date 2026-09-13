# CODEX TASK REGISTRY
## IT Operations Hub — Deterministic Task Planning and Dependency Control

**Version:** 0.1  
**Status:** Active Planning Registry  
**Purpose:** Determine which Codex task should be created/executed next based on dependencies, phase gates, priority, and the implementation report from the previous task.

---

# 1. Core Rule

Do not choose the next task by intuition.

```text
Previous Task Report
→ Reconcile Acceptance Criteria
→ Update Task Status
→ Resolve/Record Blockers
→ Evaluate Dependencies
→ Derive READY Tasks
→ Pick Highest-Priority READY Task
→ Generate TASK-xxx.md from CODEX_TASK_TEMPLATE.md
```

---

# 2. Task Status

Implementation status values:

```text
NOT_STARTED
IN_PROGRESS
BLOCKED
CODE_COMPLETE
INTEGRATION_TEST
PILOT
PRODUCTION
DEPRECATED
```

`READY` is **not** an implementation status. It is a derived planning state.

---

# 3. Dependency Satisfaction

Default dependency rule:

```text
dependency.status >= CODE_COMPLETE
```

A phase-gate task is written so that its own `CODE_COMPLETE` means the required integration checks for that phase passed. Therefore downstream tasks can depend on the gate normally.

---

# 4. Derived Readiness Algorithm

Readiness is a derived value, recalculated during every registry
reconciliation; it is not an implementation status and must not remain stale
after a task, dependency or blocker changes.

A task is `READY` when all are true:

```text
status == NOT_STARTED
AND every declared dependency is satisfied
AND no unresolved BLOCKER exists
AND no unresolved SPEC_CONFLICT blocks implementation
AND the task's required specs are DESIGN_READY
```

Current initial condition:

```text
TASK-000 = READY
All other tasks = BLOCKED by dependency
```

---

# 5. Selecting the Next Task

If more than one task is READY, choose in this order:

```text
1. Remediation task blocking the current critical path
2. Priority P0
3. Priority P1
4. Priority P2
5. Lower phase
6. Lower Task ID / critical-path order
```

Never skip a phase gate merely because a later feature looks interesting.

---

# 6. Previous Task Report Handling

After Codex finishes a task:

```text
IMPLEMENTED + all applicable gates pass
→ mark CODE_COMPLETE or INTEGRATION_TEST as appropriate

PARTIAL with a non-blocking optional gap
→ record gap
→ only mark CODE_COMPLETE if acceptance criteria are still satisfied

PARTIAL with blocking gap
→ keep task IN_PROGRESS/BLOCKED
→ create remediation child task

BLOCKED
→ record blocker
→ do not unlock dependents
```

---

# 7. Remediation Task Convention

Use remediation IDs such as:

```text
TASK-000-R1
TASK-000-R2
TASK-013-R1
```

A remediation task references the parent task and inherits its phase/priority unless intentionally changed.

---

# 8. Task File Creation Rule

Only generate a detailed `TASK-xxx_*.md` when the task becomes `READY` or is the next planned task. Use `CODEX_TASK_TEMPLATE.md`. This prevents task files from becoming stale long before implementation.

---

# 9. Master Registry

| Task | Feature | Workflow | Phase | Priority | Title | Depends On | Readiness | Status | Task File |
|---|---|---|---|---|---|---|---|---|---|
| `TASK-000` | `FOUNDATION` | `PLATFORM-BOOTSTRAP` | P0 | P0 | Backend Repository Bootstrap | — | **SATISFIED** | CODE_COMPLETE | `TASK-000_PHASE0_BOOTSTRAP.md` |
| `TASK-001` | `F-001/F-002` | `WF-ID01/WF-ID02` | P0 | P0 | Identity + RBAC Foundation | TASK-000 | **SATISFIED** | CODE_COMPLETE | `TASK-001_IDENTITY_RBAC_FOUNDATION.md` |
| `TASK-002` | `F-001` | `WF-ID01` | P0 | P0 | OIDC Authentication + Session Lifecycle | TASK-001 | **SATISFIED** | CODE_COMPLETE | `TASK-002_OIDC_AUTHENTICATION_SESSION.md` |
| `TASK-003` | `F-002` | `WF-ID02` | P0 | P0 | Authorization Scopes + Privileged Access | TASK-001, TASK-002 | **SATISFIED** | CODE_COMPLETE | `TASK-003_AUTHORIZATION_SCOPES_PRIVILEGED_ACCESS.md` |
| `TASK-004` | `FOUNDATION` | `PLATFORM-CONTROL` | P0 | P0 | Command, Idempotency, Outbox, Inbox + Operation Hardening | TASK-000 | **SATISFIED** | CODE_COMPLETE | `TASK-004_COMMAND_IDEMPOTENCY_OUTBOX_INBOX_OPERATION.md` |
| `TASK-005` | `AUDIT-FOUNDATION` | `AUDIT-CONTROL` | P0 | P0 | Audit Foundation + Query + Integrity Controls | TASK-001, TASK-004 | **SATISFIED** | CODE_COMPLETE | `TASK-005_AUDIT_FOUNDATION_QUERY_INTEGRITY.md` |
| `TASK-006` | `PHASE-GATE` | `P0-GATE` | P0 | P0 | Phase 0 Integration Gate | TASK-002, TASK-003, TASK-004, TASK-005 | **SATISFIED** | CODE_COMPLETE | `TASK-006_PHASE0_INTEGRATION_GATE.md` |
| `TASK-010` | `F-005` | `WF-A01` | P1 | P0 | Location Hierarchy + Asset Registry | TASK-006 | **SATISFIED** | CODE_COMPLETE | `TASK-010_LOCATION_HIERARCHY_ASSET_REGISTRY.md` |
| `TASK-011` | `F-005` | `WF-A01` | P1 | P0 | Asset Lifecycle + Canonical State Constraints | TASK-010 | **SATISFIED** | CODE_COMPLETE | `TASK-011_ASSET_LIFECYCLE_CANONICAL_STATE.md` |
| `TASK-012` | `F-005` | `WF-005/WF-006` | P1 | P1 | Basic Warehouse Receiving + Reservation | TASK-011 | **SATISFIED** | CODE_COMPLETE | `TASK-012_BASIC_WAREHOUSE_RECEIVING_RESERVATION.md` |
| `TASK-013` | `F-006` | `WF-006` | P1 | P0 | Asset Assignment End-to-End | TASK-003, TASK-011 | **SATISFIED** | CODE_COMPLETE | `TASK-013_ASSET_ASSIGNMENT_END_TO_END.md` |
| `TASK-014` | `F-007` | `WF-007` | P1 | P1 | Asset Transfer End-to-End | TASK-013 | **SATISFIED** | CODE_COMPLETE | `TASK-014_ASSET_TRANSFER_END_TO_END.md` |
| `TASK-015` | `F-008/F-016` | `WF-008` | P1 | P0 | Asset Return + Handover/Return Documents | TASK-013 | **SATISFIED** | CODE_COMPLETE | `TASK-015_ASSET_RETURN_HANDOVER_DOCUMENTS.md` |
| `TASK-016` | `F-009/F-010/F-011` | `WF-002` | P1 | P0 | Ticket Core + Ticket State Machine + Commands | TASK-003, TASK-006 | **SATISFIED** | CODE_COMPLETE | `TASK-016_TICKET_CORE_STATE_COMMANDS.md` |
| `TASK-017` | `F-009` | `WF-002/WF-COM01` | P1 | P0 | Ticket Intake — Portal + Email Normalization | TASK-016 | **SATISFIED** | CODE_COMPLETE | `TASK-017_TICKET_INTAKE.md` |
| `TASK-018` | `F-009` | `WF-002` | P1 | P0 | Ticket Auto-Enrichment — User + Asset Context | TASK-010, TASK-016, TASK-017 | **SATISFIED** | CODE_COMPLETE | `TASK-018_TICKET_AUTO_ENRICHMENT.md` |
| `TASK-019` | `F-012` | `WF-OPS01` | P1 | P0 | Work Queue Core | TASK-016, TASK-018 | **SATISFIED** | CODE_COMPLETE | `TASK-019_WORK_QUEUE_CORE.md` |
| `TASK-020` | `F-013/F-014/F-015` | `WF-OPS02/WF-COM01` | P1 | P1 | Timeline + Notification + Basic Search Foundations | TASK-005, TASK-010, TASK-016, TASK-019 | **SATISFIED** | CODE_COMPLETE | `TASK-020_TIMELINE_NOTIFICATION_SEARCH.md` |
| `TASK-021` | `PHASE-GATE` | `P1-E2E` | P1 | P0 | Phase 1 Vertical Slice + Integration Gate | TASK-012, TASK-013, TASK-014, TASK-015, TASK-017, TASK-018, TASK-019, TASK-020 | **SATISFIED** | CODE_COMPLETE | `TASK-021_PHASE1_VERTICAL_SLICE_GATE.md` |
| `TASK-030` | `F-017` | `WF-003` | P2 | P0 | Monitoring Ingestion + Normalization + Dedupe | TASK-021 | **SATISFIED** | CODE_COMPLETE | `TASK-030_MONITORING_INGESTION.md` |
| `TASK-031` | `F-018` | `WF-004` | P2 | P0 | Agent Enrollment + Status + Inventory Projection | TASK-010, TASK-021 | **SATISFIED** | CODE_COMPLETE | `TASK-031_AGENT_ENROLLMENT_STATUS.md` |
| `TASK-032` | `F-019/F-020` | `WF-020` | P2 | P0 | Incident Core + Incident State Machine | TASK-030, TASK-021 | **SATISFIED** | CODE_COMPLETE | `TASK-032_INCIDENT_CORE.md` |
| `TASK-033` | `F-019` | `WF-020` | P2 | P0 | Root Incident Correlation + Ticket Linking | TASK-016, TASK-032 | **SATISFIED** | CODE_COMPLETE | `TASK-033_ROOT_INCIDENT_CORRELATION.md` |
| `TASK-034` | `F-020` | `WF-020/WF-COM01` | P2 | P1 | Major Incident Communication + Status Flow | TASK-020, TASK-033 | **SATISFIED** | CODE_COMPLETE | `TASK-034_MAJOR_INCIDENT_COMMUNICATION.md` |
| `TASK-035` | `F-021` | `WF-SLA01` | P2 | P0 | SLA Engine | TASK-016, TASK-032, TASK-004 | **SATISFIED** | CODE_COMPLETE | `TASK-035_SLA_ENGINE.md` |
| `TASK-036` | `F-022` | `WF-APR01` | P2 | P0 | Approval Engine | TASK-003, TASK-004 | **SATISFIED** | CODE_COMPLETE | `TASK-036_APPROVAL_ENGINE.md` |
| `TASK-037` | `PROBLEM/CHANGE/KNOWLEDGE` | `WF-PC-K` | P2 | P1 | Problem + Change + Knowledge Foundation | TASK-032, TASK-036 | **SATISFIED** | CODE_COMPLETE | `TASK-037_PROBLEM_CHANGE_KNOWLEDGE.md` |
| `TASK-038` | `F-023/F-024` | `WF-009/WF-016` | P2 | P0 | Maintenance + Warranty Core | TASK-011, TASK-036 | **SATISFIED** | CODE_COMPLETE | `TASK-038_MAINTENANCE_WARRANTY.md` |
| `TASK-039` | `F-025/F-048/PHASE-GATE` | `WF-AUT01/WF-RPT01/P2-E2E` | P2 | P0 | Safe Automation + Operations Overview + Phase 2 Gate | TASK-019, TASK-031, TASK-033, TASK-034, TASK-035, TASK-036, TASK-037, TASK-038 | **SATISFIED** | CODE_COMPLETE | `TASK-039_PHASE2_GATE.md` |
| `TASK-050` | `F-026` | `WF-010` | P3 | P0 | Asset Audit — Expected vs Observed | TASK-020, TASK-039 | **SATISFIED** | CODE_COMPLETE | `TASK-050_ASSET_AUDIT.md` |
| `TASK-051` | `F-027` | `WF-011` | P3 | P0 | Network Discovery + Current Topology Projection | TASK-010, TASK-031, TASK-039 | **SATISFIED** | CODE_COMPLETE | `TASK-051_NETWORK_DISCOVERY.md` |
| `TASK-052` | `F-028/F-029` | `WF-012/WF-NET02` | P3 | P0 | Network Exceptions — Unknown Device, VLAN, IP Conflict | TASK-019, TASK-051 | **SATISFIED** | CODE_COMPLETE | `TASK-052_NETWORK_EXCEPTIONS.md` |
| `TASK-053` | `NETWORK-CHANGE` | `WF-012` | P3 | P1 | Controlled Network Change + Verification + Rollback | TASK-036, TASK-037, TASK-052 | **SATISFIED** | CODE_COMPLETE | `TASK-053_CONTROLLED_NETWORK_CHANGE.md` |
| `TASK-054` | `F-030/F-031` | `WF-SW01/WF-SW02` | P3 | P0 | Software Catalog + Artifact Repository | TASK-036, TASK-039 | **SATISFIED** | CODE_COMPLETE | `TASK-054_SOFTWARE_CATALOG_ARTIFACT_REPOSITORY.md` |
| `TASK-055` | `F-032` | `WF-014` | P3 | P0 | Software Deployment + Verification | TASK-031, TASK-054 | **SATISFIED** | CODE_COMPLETE | `TASK-055_SOFTWARE_DEPLOYMENT_VERIFICATION.md` |
| `TASK-056` | `F-033` | `WF-013` | P3 | P1 | Unauthorized Software Detection + Resolution | TASK-019, TASK-054, TASK-055 | **SATISFIED** | CODE_COMPLETE | `TASK-056_UNAUTHORIZED_SOFTWARE_DETECTION_RESOLUTION.md` |
| `TASK-057` | `F-034` | `WF-L01` | P3 | P0 | License Entitlement + Pool Model | TASK-054 | **SATISFIED** | CODE_COMPLETE | `TASK-057_LICENSE_ENTITLEMENT_POOL_MODEL.md` |
| `TASK-058` | `F-035/F-036` | `WF-015` | P3 | P0 | License Assignment + Reclaim + Compliance | TASK-031, TASK-057 | **SATISFIED** | CODE_COMPLETE | `TASK-058_LICENSE_ASSIGNMENT_RECLAIM_COMPLIANCE.md` |
| `TASK-058-R1` | `F-035` | `WF-015` | P3 | P0 | Cancel Unactivated License Assignment | TASK-058 | **SATISFIED** | CODE_COMPLETE | `TASK-058-R1_CANCEL_UNACTIVATED_LICENSE_ASSIGNMENT.md` |
| `TASK-059` | `F-037/F-038` | `WF-017/WF-018` | P3 | P1 | Replacement + Retirement + Disposal + Data Wipe | TASK-015, TASK-036, TASK-038 | **SATISFIED** | CODE_COMPLETE | `TASK-059_REPLACEMENT_RETIREMENT_DISPOSAL_DATA_WIPE.md` |
| `TASK-060` | `F-004/OFFBOARDING` | `WF-ID04/WF-019` | P3 | P0 | User Offboarding Orchestration | TASK-003, TASK-015, TASK-058, TASK-058-R1, TASK-060-R1 | **SATISFIED** | CODE_COMPLETE | `TASK-060_USER_OFFBOARDING_ORCHESTRATION.md` |
| `TASK-060-R1` | `F-004/OFFBOARDING` | `WF-ID04/WF-019` | P3 | P0 | Define Normative Offboarding State Machine | TASK-003, TASK-015, TASK-058, TASK-058-R1 | **SATISFIED** | CODE_COMPLETE | `TASK-060-R1_NORMATIVE_OFFBOARDING_STATE_MACHINE.md` |
| `TASK-061` | `F-047/PHASE-GATE` | `WF-SRCH01/P3-E2E` | P3 | P1 | Advanced Search + Phase 3 Integration Gate | TASK-050, TASK-051, TASK-052, TASK-053, TASK-055, TASK-056, TASK-058, TASK-059, TASK-060 | **SATISFIED** | CODE_COMPLETE | `TASK-061_ADVANCED_SEARCH_PHASE3_INTEGRATION_GATE.md` |
| `TASK-070` | `F-039` | `WF-P01` | P4 | P0 | Supplier + Procurement Request | TASK-061, TASK-070-R1 | **SATISFIED** | CODE_COMPLETE | `TASK-070_SUPPLIER_PROCUREMENT_REQUEST.md` |
| `TASK-070-R1` | `F-039` | `WF-P01` | P4 | P0 | Supplier Lifecycle + Permission Contract | TASK-061 | **SATISFIED** | CODE_COMPLETE | `TASK-070-R1_SUPPLIER_LIFECYCLE_PERMISSION_CONTRACT.md` |
| `TASK-071` | `F-040` | `WF-P02` | P4 | P1 | RFQ + Quotation + Supplier Selection | TASK-070, TASK-071-R1 | **SATISFIED** | CODE_COMPLETE | `TASK-071_RFQ_QUOTATION_SUPPLIER_SELECTION.md` |
| `TASK-071-R1` | `F-040` | `WF-P02` | P4 | P1 | RFQ + Quotation Lifecycle Contract | TASK-070 | **SATISFIED** | CODE_COMPLETE | `TASK-071-R1_RFQ_QUOTATION_LIFECYCLE_CONTRACT.md` |
| `TASK-072` | `F-041` | `WF-P03` | P4 | P0 | Purchase Order + Approval + Amendment | TASK-036, TASK-071, TASK-072-R1 | **SATISFIED** | CODE_COMPLETE | `TASK-072_PURCHASE_ORDER_APPROVAL_AMENDMENT.md` |
| `TASK-072-R1` | `F-041` | `WF-P03` | P4 | P0 | Purchase Order Lifecycle + Approval + Amendment Contract | TASK-036, TASK-071 | **SATISFIED** | CODE_COMPLETE | `TASK-072-R1_PURCHASE_ORDER_LIFECYCLE_APPROVAL_AMENDMENT_CONTRACT.md` |
| `TASK-073-R1` | `F-042` | `WF-005` | P4 | P0 | Goods Receipt + Partial Receipt + PO Receipt Integration Contract | TASK-072 | **SATISFIED** | CODE_COMPLETE | `TASK-073-R1_GOODS_RECEIPT_PARTIAL_RECEIPT_PO_INTEGRATION_CONTRACT.md` |
| `TASK-073` | `F-042` | `WF-005` | P4 | P0 | Goods Receipt + Asset Registration + Partial Receipt | TASK-012, TASK-072, TASK-073-R1 | **SATISFIED** | CODE_COMPLETE | `TASK-073_GOODS_RECEIPT_ASSETIZATION_PARTIAL_RECEIPT.md` |
| `TASK-074-R1` | `F-043/F-044` | `WF-P04/WF-P05` | P4 | P0 | Invoice + Duplicate Protection + 3-Way Match + Credit Note Contract | TASK-072, TASK-073 | **SATISFIED** | CODE_COMPLETE | `TASK-074-R1_INVOICE_DUPLICATE_MATCH_CREDIT_NOTE_CONTRACT.md` |
| `TASK-074` | `F-043/F-044` | `WF-P04/WF-P05` | P4 | P0 | Invoice + Duplicate Protection + 3-Way Match + Credit Note | TASK-072, TASK-073, TASK-074-R1 | **SATISFIED** | CODE_COMPLETE | `TASK-074_INVOICE_DUPLICATE_PROTECTION_3_WAY_MATCH.md` |
| `TASK-075-R1` | `F-045/F-046` | `WF-P06/WF-016` | P4 | P1 | Contract Lifecycle + Renewal + Commercial Document Governance Contract | TASK-070, TASK-074 | **SATISFIED** | CODE_COMPLETE | `TASK-075-R1_CONTRACT_LIFECYCLE_RENEWAL_DOCUMENT_GOVERNANCE_CONTRACT.md` |
| `TASK-075` | `F-045/F-046` | `WF-P06/WF-016` | P4 | P1 | Contract + Renewal + Commercial Document Governance | TASK-070, TASK-074, TASK-075-R1 | **SATISFIED** | CODE_COMPLETE | `TASK-075_CONTRACT_RENEWAL_COMMERCIAL_DOCUMENT_GOVERNANCE.md` |
| `TASK-076-R1` | `PHASE-GATE` | `P4-E2E` | P4 | P0 | Contract Alert + Asset/License Cost Provenance Integration Contract | TASK-071, TASK-072, TASK-073, TASK-074, TASK-075 | **SATISFIED** | CODE_COMPLETE | `TASK-076-R1_PHASE4_INTEGRATION_GATE_CONTRACT.md` |
| `TASK-076` | `PHASE-GATE` | `P4-E2E` | P4 | P0 | Phase 4 Procurement-to-Asset Integration Gate | TASK-071, TASK-072, TASK-073, TASK-074, TASK-075, TASK-076-R1 | **SATISFIED** | CODE_COMPLETE | `TASK-076_PHASE4_PROCUREMENT_TO_ASSET_INTEGRATION_GATE.md` |
| `TASK-090` | `F-049` | `WF-AUT02` | P5 | P1 | Advanced Rules Engine + Policy-Gated Automation | TASK-039, TASK-061, TASK-076, TASK-090-R1 | **SATISFIED** | CODE_COMPLETE | `TASK-090_ADVANCED_RULES_ENGINE_POLICY_GATED_AUTOMATION.md` |
| `TASK-090-R1` | `F-049` | `WF-AUT02` | P5 | P0 | Automation Action Policy + System Principal Authorization Contract | — | **SATISFIED** | CODE_COMPLETE | `TASK-090-R1_AUTOMATION_ACTION_POLICY_SYSTEM_PRINCIPAL_AUTHORIZATION_CONTRACT.md` |
| `TASK-091-R1` | `F-049` | `WF-AUT02` | P5 | P0 | Automation Action Execution + Verification Contract | TASK-090 | **SATISFIED** | CODE_COMPLETE | `TASK-091-R1_AUTOMATION_ACTION_EXECUTION_CONTRACT_GAP.md` |
| `TASK-091` | `F-049` | `WF-AUT02` | P5 | P1 | Controlled Self-Healing + Compensation | TASK-031, TASK-053, TASK-090, TASK-091-R1 | **READY** | NOT_STARTED | `TASK-091_CONTROLLED_SELF_HEALING_COMPENSATION.md` |
| `TASK-092` | `F-050` | `WF-INT01` | P5 | P2 | Advanced Incident Correlation | TASK-033, TASK-051, TASK-090 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-093` | `KNOWLEDGE-DEFLECTION` | `WF-PC-K` | P5 | P2 | Knowledge Deflection + Self-Service Recommendations | TASK-037, TASK-061, TASK-092 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-094` | `F-050` | `WF-017/WF-INT01` | P5 | P2 | Risk + Replacement Scoring | TASK-038, TASK-050, TASK-058, TASK-059 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-095` | `F-048` | `WF-RPT01` | P5 | P1 | Advanced Reporting + Governed KPI + Analytics | TASK-039, TASK-061, TASK-076 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-096` | `F-050` | `WF-INT01` | P5 | P2 | Explainable Recommendation Layer | TASK-090, TASK-092, TASK-093, TASK-094, TASK-095 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-097` | `PHASE-GATE` | `P5-E2E` | P5 | P0 | Phase 5 System Integration + Intelligence Gate | TASK-091, TASK-092, TASK-093, TASK-094, TASK-095, TASK-096 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |

---

# 10. Ready Conditions by Task

## P0 — Platform Foundation

- **TASK-000 — Backend Repository Bootstrap:** Repository available; architecture/spec pack available.
- **TASK-001 — Identity + RBAC Foundation:** TASK-000 >= CODE_COMPLETE.
- **TASK-002 — OIDC Authentication + Session Lifecycle:** Identity model and auth ports exist.
- **TASK-003 — Authorization Scopes + Privileged Access:** RBAC bindings and authenticated principal available.
- **TASK-004 — Command, Idempotency, Outbox, Inbox + Operation Hardening:** Bootstrap persistence and worker skeleton available.
- **TASK-005 — Audit Foundation + Query + Integrity Controls:** Actor model and durable platform transaction primitives available.
- **TASK-006 — Phase 0 Integration Gate:** All Phase 0 foundations integrated and verification runnable.

## P1 — Helpdesk + Asset Core MVP

- **TASK-010 — Location Hierarchy + Asset Registry:** Phase 0 gate passes.
- **TASK-011 — Asset Lifecycle + Canonical State Constraints:** Asset aggregate and persistence exist.
- **TASK-012 — Basic Warehouse Receiving + Reservation:** Asset lifecycle supports RECEIVED/AVAILABLE/RESERVED.
- **TASK-013 — Asset Assignment End-to-End:** Authorization scopes and assignable Asset state available.
- **TASK-014 — Asset Transfer End-to-End:** Active Assignment + Movement model implemented.
- **TASK-015 — Asset Return + Handover/Return Documents:** Assignment lifecycle exists.
- **TASK-016 — Ticket Core + Ticket State Machine + Commands:** Authorization and platform command framework stable.
- **TASK-017 — Ticket Intake — Portal + Email Normalization:** Ticket create command exists.
- **TASK-018 — Ticket Auto-Enrichment — User + Asset Context:** Ticket intake and Asset/User query contracts exist.
- **TASK-019 — Work Queue Core:** Actionable Ticket source and enriched context available.
- **TASK-020 — Timeline + Notification + Basic Search Foundations:** Audit, Asset, Ticket and Work Queue events available.
- **TASK-021 — Phase 1 Vertical Slice + Integration Gate:** Phase 1 core capabilities implemented.

## P2 — Operations + Monitoring + Maintenance

- **TASK-030 — Monitoring Ingestion + Normalization + Dedupe:** Phase 1 operational backbone passes.
- **TASK-031 — Agent Enrollment + Status + Inventory Projection:** Asset identity and Phase 1 platform available.
- **TASK-032 — Incident Core + Incident State Machine:** Normalized monitoring events available.
- **TASK-033 — Root Incident Correlation + Ticket Linking:** Ticket and Incident domains available.
- **TASK-034 — Major Incident Communication + Status Flow:** Root incident and communication foundation available.
- **TASK-035 — SLA Engine:** Ticket/Incident state transitions and durable timers available.
- **TASK-036 — Approval Engine:** Authorization, operation and audit foundations available.
- **TASK-037 — Problem + Change + Knowledge Foundation:** Incident and Approval foundations available.
- **TASK-038 — Maintenance + Warranty Core:** Asset lifecycle and Approval engine available.
- **TASK-039 — Safe Automation + Operations Overview + Phase 2 Gate:** Core Phase 2 sources and control engines available.

## P3 — Audit + Network + Software + License

- **TASK-050 — Asset Audit — Expected vs Observed:** Timeline/audit foundations and Phase 2 gate pass.
- **TASK-051 — Network Discovery + Current Topology Projection:** Asset, Agent and Phase 2 backbone available.
- **TASK-052 — Network Exceptions — Unknown Device, VLAN, IP Conflict:** Discovery observations and Work Queue available.
- **TASK-053 — Controlled Network Change + Verification + Rollback:** Approval, Change foundation and Network exceptions available.
- **TASK-054 — Software Catalog + Artifact Repository:** Approval/control plane and object/event foundations available.
- **TASK-055 — Software Deployment + Verification:** Agent jobs and approved artifact flow available.
- **TASK-056 — Unauthorized Software Detection + Resolution:** Software inventory/deployment and Work Queue available.
- **TASK-057 — License Entitlement + Pool Model:** Software product/catalog identity available.
- **TASK-058 — License Assignment + Reclaim + Compliance:** Entitlement model and endpoint/identity context available.
- **TASK-059 — Replacement + Retirement + Disposal + Data Wipe:** Asset return, maintenance/warranty and approval available.
- **TASK-060 — User Offboarding Orchestration:** Identity authorization, Asset return and License reclaim available.
- **TASK-061 — Advanced Search + Phase 3 Integration Gate:** Phase 3 operational domains integrated.

## P4 — Procurement + Contract + Financial Control

- **TASK-070 — Supplier + Procurement Request:** TASK-061 is `CODE_COMPLETE`
  and TASK-070-R1 is `CODE_COMPLETE`; Supplier lifecycle, permissions,
  eligibility, versioning and event contracts are normative. Implementation
  and verification are complete; see the task implementation report.
- **TASK-071-R1 — RFQ + Quotation Lifecycle Contract:** `CODE_COMPLETE`;
  normative lifecycle, permission, event, data-model, eligibility, atomicity
  and concurrency rules are recorded in its remediation report.
- **TASK-071 — RFQ + Quotation + Supplier Selection:** `CODE_COMPLETE`; the
  clarified lifecycle and conditional linked-approval behavior are implemented
  and verified in its completion report.
- **TASK-072-R1 — Purchase Order Lifecycle + Approval + Amendment Contract:**
  `CODE_COMPLETE` as a specification-only remediation; lifecycle and receipt
  dimensions, conditional approval, immutable amendments, permissions, events,
  data model and concurrency ownership are normative.
- **TASK-072 — Purchase Order + Approval + Amendment:** dependencies TASK-036,
  TASK-071 and TASK-072-R1 are satisfied. Implementation and verification are
  complete; see its implementation report. Its PO lock/counter contract is the
  required TASK-073 integration boundary.
- **TASK-073-R1 — Goods Receipt + Partial Receipt + PO Receipt Integration
  Contract:** `CODE_COMPLETE` as a specification-only remediation. The
  normative receipt/PO/Asset boundary and task contract are recorded in its
  remediation report.
- **TASK-073 — Goods Receipt + Asset Registration + Partial Receipt:**
  dependencies TASK-012, TASK-072 and TASK-073-R1 are satisfied. Runtime
  implementation and PostgreSQL E2E verification are complete; see the task
  implementation report.
- **TASK-074-R1 — Invoice + Duplicate Protection + 3-Way Match + Credit Note
  Contract:** `CODE_COMPLETE`, specification-only. Invoice/credit lifecycles,
  duplicate identity, match/credit dimensions, tolerance, exception approval,
  concurrency and evidence-preservation rules are normative.
- **TASK-074 — Invoice + Duplicate Protection + 3-Way Match + Credit Note:**
  dependencies TASK-072, TASK-073 and TASK-074-R1 are satisfied. Runtime
  implementation and verification are complete; see
  `TASK-074_IMPLEMENTATION_REPORT.md`.
- **TASK-075 — Contract + Renewal + Commercial Document Governance:**
  dependencies TASK-070, TASK-074 and TASK-075-R1 are satisfied. Runtime
  implementation and verification are complete; see
  `TASK-075_IMPLEMENTATION_REPORT.md`.
- **TASK-076-R1 — Contract Alert + Asset/License Cost Provenance Integration
  Contract:** `SATISFIED / CODE_COMPLETE` as a specification-only remediation.
  Version-bound alert triggers, immutable cost provenance/allocation,
  cross-domain ownership and gate evidence are normative.
- **TASK-076 — Phase 4 Procurement-to-Asset Integration Gate:** dependencies
  TASK-071 through TASK-075 and TASK-076-R1 are satisfied. Runtime alert,
  cost-provenance, API, retry, object-storage capability and cross-domain gate
  evidence are complete; see `TASK-076_IMPLEMENTATION_REPORT.md`.

## P5 — Automation + Intelligence + Advanced Reporting

- **TASK-090 — Advanced Rules Engine + Policy-Gated Automation:** Operational, technical and commercial event sources stable.
- **TASK-091 — Controlled Self-Healing + Compensation:** Agent execution, controlled change and rules engine available.
- **TASK-092 — Advanced Incident Correlation:** Incident history, topology and rule engine available.
- **TASK-093 — Knowledge Deflection + Self-Service Recommendations:** Knowledge foundation, search and correlation available.
- **TASK-094 — Risk + Replacement Scoring:** Maintenance, audit, license and replacement history available.
- **TASK-095 — Advanced Reporting + Governed KPI + Analytics:** Stable canonical data and governed events across P1-P4.
- **TASK-096 — Explainable Recommendation Layer:** Automation, correlation, knowledge, scoring and analytics available.
- **TASK-097 — Phase 5 System Integration + Intelligence Gate:** Advanced automation/intelligence capabilities integrated.

---

# 11. Current Next Task

TASK-060-R1, TASK-060, TASK-056, TASK-059, TASK-061, TASK-070-R1, TASK-070,
TASK-071-R1, TASK-071, TASK-072-R1, TASK-072, TASK-073-R1, TASK-073,
TASK-074-R1, TASK-074, TASK-075-R1, TASK-075 and TASK-076-R1 are
`CODE_COMPLETE`.
TASK-056's inventory, exception handling, safe removal flow, audit/outbox
payloads and verification are recorded in its completion report. Dependency implementation
reports and commits confirm TASK-015 (`32c3267`), TASK-036 (`e043c31`) and
TASK-038 (`296336a`) are `CODE_COMPLETE`.

```text
CURRENT = TASK-091 (READY / NOT_STARTED; TASK-091-R1 normative contract complete)
NEXT = TASK-091 runtime implementation requires an explicit continuation instruction
TASK-059 = SATISFIED (CODE_COMPLETE)
TASK-061 = SATISFIED (CODE_COMPLETE)
TASK-070-R1 = SATISFIED (CODE_COMPLETE)
TASK-070 = SATISFIED (CODE_COMPLETE)
TASK-071-R1 = SATISFIED (CODE_COMPLETE)
TASK-071 = SATISFIED (CODE_COMPLETE)
TASK-072-R1 = SATISFIED (CODE_COMPLETE; specification only)
TASK-072 = SATISFIED (CODE_COMPLETE)
TASK-073-R1 = SATISFIED (CODE_COMPLETE; specification only)
TASK-073 = SATISFIED (CODE_COMPLETE; TASK-012, TASK-072 and TASK-073-R1 are complete)
TASK-074-R1 = SATISFIED (CODE_COMPLETE; specification only)
TASK-074 = SATISFIED (CODE_COMPLETE; see TASK-074_IMPLEMENTATION_REPORT.md)
TASK-075-R1 = SATISFIED (CODE_COMPLETE; specification only)
TASK-075 = SATISFIED (CODE_COMPLETE; see TASK-075_IMPLEMENTATION_REPORT.md)
TASK-076-R1 = SATISFIED (CODE_COMPLETE; specification only)
TASK-076 = SATISFIED (CODE_COMPLETE; see TASK-076_IMPLEMENTATION_REPORT.md)
TASK-090-R1 = SATISFIED (CODE_COMPLETE; normative/specification remediation only)
TASK-090 = SATISFIED (CODE_COMPLETE; deny-by-default Action Policy and scoped System Automation authorization implemented; see TASK-090_IMPLEMENTATION_REPORT.md)
TASK-091-R1 = SATISFIED / CODE_COMPLETE (normative/specification remediation only; see TASK-091-R1_AUTOMATION_ACTION_EXECUTION_CONTRACT_GAP.md)
TASK-091 = READY / NOT_STARTED (TASK-031, TASK-053, TASK-090 and TASK-091-R1 satisfied; detailed contract generated; runtime implementation not started)
```

TASK-061's acceptance criteria and verification gates passed; its implementation
report and commit are recorded. Its declared dependencies (TASK-050, TASK-051,
TASK-052, TASK-053, TASK-055, TASK-056, TASK-058, TASK-059 and TASK-060) are
all `CODE_COMPLETE`. TASK-070's declared dependencies were satisfied, and its
detailed contract and acceptance criteria are complete. Supplier
lifecycle/permission/event conflict was resolved by TASK-070-R1. The RFQ and
Quotation `SPEC_CONFLICT` was resolved by TASK-071-R1, and TASK-071 is
`CODE_COMPLETE`. TASK-072-R1 resolved the PO lifecycle/approval/amendment
`SPEC_CONFLICT`; TASK-072 is `CODE_COMPLETE`, with implementation details
and verification in its task report. TASK-073-R1 resolved the Goods Receipt
`SPEC_GAP / PLANNING_REQUIRED` as a specification-only remediation; its
normative lifecycle, quantity, PO concurrency, event, permission, data-model,
Asset registration and 3-Way Match contracts are recorded in the remediation
report. TASK-073 has a detailed reconciled contract and implementation report;
runtime implementation and PostgreSQL E2E verification are complete.
TASK-074-R1 resolved the Invoice/3-Way Match/Credit Note `SPEC_GAP` as a
specification-only remediation, including duplicate reservation, zero
business tolerance, conditional approvals, exception quantity reservation,
Credit Note release, permissions, events and required concurrency cases.
TASK-074 implementation and verification are complete and recorded in its
implementation report. TASK-075-R1 resolved the Contract/Renewal/Commercial
Document Governance `SPEC_GAP` as a specification-only remediation. TASK-075
runtime implementation and its PostgreSQL E2E are complete. TASK-076-R1 has
resolved the Contract alert and Asset/License cost-provenance `SPEC_GAP` as a
specification-only remediation. TASK-076 runtime integration and its
PostgreSQL E2E verification are complete; the local ObjectStore capability is
explicitly `UNAVAILABLE_NOT_READY` and is recorded in its implementation
report. TASK-090's declared dependencies TASK-039, TASK-061 and TASK-076 are
SATISFIED. TASK-090-R1 has completed the normative Action Capability, tenant
Action Policy, System Automation Principal, scoped-grant, evidence and
TASK-091 recheck contract. TASK-090 runtime implementation passed its
acceptance and verification gates and is CODE_COMPLETE; explicit policy and
scoped grants remain required for any tenant to produce READY intents. No
`SPEC_CONFLICT`, `SCOPE_DEPENDENCY` or `SECURITY_CONCERN` remains for TASK-090.
TASK-091-R1 has resolved TASK-091's execution protocol, Agent identity and
deduplication, runtime-marker verification, state model, cancellation/manual
retry, unknown-outcome recovery, permissions, events, audit and concurrency
contract. TASK-091's dependencies TASK-031, TASK-053, TASK-090 and TASK-091-R1
are satisfied. Its detailed contract is ready, so readiness is READY while
implementation remains NOT_STARTED. No TASK-091 runtime implementation was
started by the remediation. Stop here; do not implement TASK-091 until an
explicit instruction. Other later-task readiness states were not reconciled.

---

# 12. Phase Gates

| Gate | Purpose | Unlocks |
|---|---|---|
| TASK-006 | Validate Platform Foundation | Phase 1 |
| TASK-021 | Validate Helpdesk + Asset MVP vertical slice | Phase 2 |
| TASK-039 | Validate Operations/Monitoring control plane | Phase 3 |
| TASK-061 | Validate Audit/Network/Software/License integration | Phase 4 |
| TASK-076 | Validate Procurement-to-Asset commercial lifecycle | Phase 5 |
| TASK-097 | Validate advanced automation/intelligence | Advanced platform release |

---

# 13. Phase 0 Critical Path

```text
TASK-000
├─ TASK-001 → TASK-002 → TASK-003 ─┐
└─ TASK-004 ───────────────┬───────┤
                           └→ TASK-005
TASK-002 + TASK-003 + TASK-004 + TASK-005
→ TASK-006
```

---

# 14. Phase 1 Critical Path

```text
TASK-006
├→ TASK-010 → TASK-011 → TASK-012
│                 ├→ TASK-013 → TASK-014
│                 │          └→ TASK-015
│
└→ TASK-016 → TASK-017
          └──────────────┐
TASK-010 + TASK-016 + TASK-017
→ TASK-018 → TASK-019

Audit + Asset + Ticket + Work Queue
→ TASK-020

Phase 1 capabilities
→ TASK-021
```

---

# 15. Task Granularity Rule

A good Codex task usually has:

```text
1 primary capability/use case
1 owning domain
1 main state-machine area
1–3 public API actions
a bounded set of events
a testable acceptance boundary
```

Too large: `Implement Asset Management` or `Implement Phase 3`. Too small: `Create one DTO` or `Add one interface`.

---

# 16. When to Split a Registry Task

Split before implementation only if repository inspection shows multiple independently valuable/risky capabilities. Example: `TASK-032 Incident Core` may become `TASK-032A Model + State`, `TASK-032B Commands + API`, `TASK-032C Monitoring Consumer`. Do not fragment work into file-level tasks.

---

# 17. Registry Update Procedure

After each Codex run update:

```text
Status
Readiness
Blocker
Codex Report reference
Task File
```

Then recalculate dependents.

---

# 18. Suggested Live Tracking Fields

When implementation begins, add or maintain companion fields:

```text
Owner
Started At
Completed At
PR/Commit
Codex Report
Blocker
Notes
```

---

# 19. Planner Decision Examples

## Example A — Task passes

```text
TASK-000 = CODE_COMPLETE

READY candidates:
- TASK-001
- TASK-004

Select TASK-001 because it is P0 and earlier on the critical path.
```

## Example B — Bootstrap has blocking gap

```text
TASK-000 report:
- migration tests missing
- inbox dedupe incomplete

Do NOT unlock TASK-001.
Create TASK-000-R1.
```

## Example C — Optional non-blocking gap

```text
TASK-013 passes all acceptance criteria.
Optional admin metric dashboard deferred.

TASK-013 may become CODE_COMPLETE.
Record the optional gap separately.
```

---

# 20. Rules for Codex

Codex does not choose a future task on its own. It may recommend a next task, but execution starts only after the registry is reconciled and a task file is explicitly assigned.

---

# 21. Definition of Done

This registry is functioning correctly when:

- The next task can be selected without subjective guessing.
- No task becomes READY while a required dependency is incomplete.
- Blocking gaps create remediation work before downstream work.
- Phase gates prevent uncontrolled roadmap jumping.
- Detailed task files are generated only when needed.
- Every implementation task remains traceable to Feature/Workflow/Phase.
- Codex completion reports feed back into readiness.
- The critical path remains visible throughout implementation.
