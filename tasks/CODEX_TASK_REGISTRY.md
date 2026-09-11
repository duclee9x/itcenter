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
| `TASK-000` | `FOUNDATION` | `PLATFORM-BOOTSTRAP` | P0 | P0 | Backend Repository Bootstrap | — | **READY** | NOT_STARTED | `TASK-000_PHASE0_BOOTSTRAP.md` |
| `TASK-001` | `F-001/F-002` | `WF-ID01/WF-ID02` | P0 | P0 | Identity + RBAC Foundation | TASK-000 | **SATISFIED** | CODE_COMPLETE | `TASK-001_IDENTITY_RBAC_FOUNDATION.md` |
| `TASK-002` | `F-001` | `WF-ID01` | P0 | P0 | OIDC Authentication + Session Lifecycle | TASK-001 | **SATISFIED** | CODE_COMPLETE | `TASK-002_OIDC_AUTHENTICATION_SESSION.md` |
| `TASK-003` | `F-002` | `WF-ID02` | P0 | P0 | Authorization Scopes + Privileged Access | TASK-001, TASK-002 | **SATISFIED** | CODE_COMPLETE | `TASK-003_AUTHORIZATION_SCOPES_PRIVILEGED_ACCESS.md` |
| `TASK-004` | `FOUNDATION` | `PLATFORM-CONTROL` | P0 | P0 | Command, Idempotency, Outbox, Inbox + Operation Hardening | TASK-000 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-005` | `AUDIT-FOUNDATION` | `AUDIT-CONTROL` | P0 | P0 | Audit Foundation + Query + Integrity Controls | TASK-001, TASK-004 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-006` | `PHASE-GATE` | `P0-GATE` | P0 | P0 | Phase 0 Integration Gate | TASK-002, TASK-003, TASK-004, TASK-005 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-010` | `F-005` | `WF-A01` | P1 | P0 | Location Hierarchy + Asset Registry | TASK-006 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-011` | `F-005` | `WF-A01` | P1 | P0 | Asset Lifecycle + Canonical State Constraints | TASK-010 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-012` | `F-005` | `WF-005/WF-006` | P1 | P1 | Basic Warehouse Receiving + Reservation | TASK-011 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-013` | `F-006` | `WF-006` | P1 | P0 | Asset Assignment End-to-End | TASK-003, TASK-011 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-014` | `F-007` | `WF-007` | P1 | P1 | Asset Transfer End-to-End | TASK-013 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-015` | `F-008/F-016` | `WF-008` | P1 | P0 | Asset Return + Handover/Return Documents | TASK-013 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-016` | `F-009/F-010/F-011` | `WF-002` | P1 | P0 | Ticket Core + Ticket State Machine + Commands | TASK-003, TASK-006 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-017` | `F-009` | `WF-002/WF-COM01` | P1 | P0 | Ticket Intake — Portal + Email Normalization | TASK-016 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-018` | `F-009` | `WF-002` | P1 | P0 | Ticket Auto-Enrichment — User + Asset Context | TASK-010, TASK-016, TASK-017 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-019` | `F-012` | `WF-OPS01` | P1 | P0 | Work Queue Core | TASK-016, TASK-018 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-020` | `F-013/F-014/F-015` | `WF-OPS02/WF-COM01` | P1 | P1 | Timeline + Notification + Basic Search Foundations | TASK-005, TASK-010, TASK-016, TASK-019 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-021` | `PHASE-GATE` | `P1-E2E` | P1 | P0 | Phase 1 Vertical Slice + Integration Gate | TASK-012, TASK-013, TASK-014, TASK-015, TASK-017, TASK-018, TASK-019, TASK-020 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-030` | `F-017` | `WF-003` | P2 | P0 | Monitoring Ingestion + Normalization + Dedupe | TASK-021 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-031` | `F-018` | `WF-004` | P2 | P0 | Agent Enrollment + Status + Inventory Projection | TASK-010, TASK-021 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-032` | `F-019/F-020` | `WF-020` | P2 | P0 | Incident Core + Incident State Machine | TASK-030, TASK-021 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-033` | `F-019` | `WF-020` | P2 | P0 | Root Incident Correlation + Ticket Linking | TASK-016, TASK-032 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-034` | `F-020` | `WF-020/WF-COM01` | P2 | P1 | Major Incident Communication + Status Flow | TASK-020, TASK-033 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-035` | `F-021` | `WF-SLA01` | P2 | P0 | SLA Engine | TASK-016, TASK-032, TASK-004 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-036` | `F-022` | `WF-APR01` | P2 | P0 | Approval Engine | TASK-003, TASK-004 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-037` | `PROBLEM/CHANGE/KNOWLEDGE` | `WF-PC-K` | P2 | P1 | Problem + Change + Knowledge Foundation | TASK-032, TASK-036 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-038` | `F-023/F-024` | `WF-009/WF-016` | P2 | P0 | Maintenance + Warranty Core | TASK-011, TASK-036 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-039` | `F-025/F-048/PHASE-GATE` | `WF-AUT01/WF-RPT01/P2-E2E` | P2 | P0 | Safe Automation + Operations Overview + Phase 2 Gate | TASK-019, TASK-031, TASK-033, TASK-034, TASK-035, TASK-036, TASK-037, TASK-038 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-050` | `F-026` | `WF-010` | P3 | P0 | Asset Audit — Expected vs Observed | TASK-020, TASK-039 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-051` | `F-027` | `WF-011` | P3 | P0 | Network Discovery + Current Topology Projection | TASK-010, TASK-031, TASK-039 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-052` | `F-028/F-029` | `WF-012/WF-NET02` | P3 | P0 | Network Exceptions — Unknown Device, VLAN, IP Conflict | TASK-019, TASK-051 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-053` | `NETWORK-CHANGE` | `WF-012` | P3 | P1 | Controlled Network Change + Verification + Rollback | TASK-036, TASK-037, TASK-052 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-054` | `F-030/F-031` | `WF-SW01/WF-SW02` | P3 | P0 | Software Catalog + Artifact Repository | TASK-036, TASK-039 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-055` | `F-032` | `WF-014` | P3 | P0 | Software Deployment + Verification | TASK-031, TASK-054 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-056` | `F-033` | `WF-013` | P3 | P1 | Unauthorized Software Detection + Resolution | TASK-019, TASK-054, TASK-055 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-057` | `F-034` | `WF-L01` | P3 | P0 | License Entitlement + Pool Model | TASK-054 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-058` | `F-035/F-036` | `WF-015` | P3 | P0 | License Assignment + Reclaim + Compliance | TASK-031, TASK-057 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-059` | `F-037/F-038` | `WF-017/WF-018` | P3 | P1 | Replacement + Retirement + Disposal + Data Wipe | TASK-015, TASK-036, TASK-038 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-060` | `F-004/OFFBOARDING` | `WF-ID04/WF-019` | P3 | P0 | User Offboarding Orchestration | TASK-003, TASK-015, TASK-058 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-061` | `F-047/PHASE-GATE` | `WF-SRCH01/P3-E2E` | P3 | P1 | Advanced Search + Phase 3 Integration Gate | TASK-050, TASK-051, TASK-052, TASK-053, TASK-055, TASK-056, TASK-058, TASK-059, TASK-060 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-070` | `F-039` | `WF-P01` | P4 | P0 | Supplier + Procurement Request | TASK-061 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-071` | `F-040` | `WF-P02` | P4 | P1 | RFQ + Quotation + Supplier Selection | TASK-070 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-072` | `F-041` | `WF-P03` | P4 | P0 | Purchase Order + Approval + Amendment | TASK-036, TASK-071 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-073` | `F-042` | `WF-005` | P4 | P0 | Goods Receipt + Asset Creation + Partial Receipt | TASK-012, TASK-072 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-074` | `F-043/F-044` | `WF-P04/WF-P05` | P4 | P0 | Invoice + Duplicate Protection + 3-Way Match | TASK-072, TASK-073 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-075` | `F-045/F-046` | `WF-P06/WF-016` | P4 | P1 | Contract + Renewal + Commercial Document Governance | TASK-070, TASK-074 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-076` | `PHASE-GATE` | `P4-E2E` | P4 | P0 | Phase 4 Procurement-to-Asset Integration Gate | TASK-071, TASK-072, TASK-073, TASK-074, TASK-075 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-090` | `F-049` | `WF-AUT02` | P5 | P1 | Advanced Rules Engine + Policy-Gated Automation | TASK-039, TASK-061, TASK-076 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
| `TASK-091` | `F-049` | `WF-AUT02` | P5 | P1 | Controlled Self-Healing + Compensation | TASK-031, TASK-053, TASK-090 | **BLOCKED** | NOT_STARTED | `GENERATE_ON_READY` |
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

- **TASK-070 — Supplier + Procurement Request:** Phase 3 gate passes.
- **TASK-071 — RFQ + Quotation + Supplier Selection:** Procurement request and supplier model available.
- **TASK-072 — Purchase Order + Approval + Amendment:** Approval engine and quotation selection available.
- **TASK-073 — Goods Receipt + Asset Creation + Partial Receipt:** Warehouse receiving basics and PO available.
- **TASK-074 — Invoice + Duplicate Protection + 3-Way Match:** PO and Goods Receipt available.
- **TASK-075 — Contract + Renewal + Commercial Document Governance:** Supplier/procurement and invoice flow available.
- **TASK-076 — Phase 4 Procurement-to-Asset Integration Gate:** Procurement lifecycle integrated end-to-end.

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

TASK-000 is CODE_COMPLETE after review remediation. TASK-001 is CODE_COMPLETE after RBAC evaluation and API verification.

```text
NEXT = TASK-002 (in progress)
```

After TASK-000 passes, `TASK-001` and `TASK-004` can become dependency-ready. The default critical path chooses:

```text
TASK-001 — Identity + RBAC Foundation
```

because Identity/RBAC unlocks most business capabilities.

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
