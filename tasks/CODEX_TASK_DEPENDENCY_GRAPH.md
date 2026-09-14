# CODEX TASK DEPENDENCY GRAPH
## IT Operations Hub — Phase 0 to Phase 5

**Version:** 0.1  
**Source:** `CODEX_TASK_REGISTRY.md`

This file is a visual companion to the registry. The registry remains authoritative for status/readiness.

---

# 1. Macro Phase Graph

```mermaid
flowchart LR
  P0["P0 Platform Foundation<br/>TASK-000..006"] --> P1["P1 Helpdesk + Asset Core<br/>TASK-010..021"]
  P1 --> P2["P2 Operations + Monitoring<br/>TASK-030..039"]
  P2 --> P3["P3 Audit + Network + Software + License<br/>TASK-050..061"]
  P3 --> P4["P4 Procurement + Contract<br/>TASK-070..076"]
  P4 --> P5["P5 Automation + Intelligence<br/>TASK-090..097"]
```

---

# P0 — Platform Foundation

```mermaid
flowchart TD
  TASK_000["TASK-000<br/>Backend Repository Bootstrap"]
  TASK_001["TASK-001<br/>Identity + RBAC Foundation"]
  TASK_002["TASK-002<br/>OIDC Authentication + Session Lifecycle"]
  TASK_003["TASK-003<br/>Authorization Scopes + Privileged Access"]
  TASK_004["TASK-004<br/>Command, Idempotency, Outbox, Inbox + Operation Hardening"]
  TASK_005["TASK-005<br/>Audit Foundation + Query + Integrity Controls"]
  TASK_006["TASK-006<br/>Phase 0 Integration Gate"]
  TASK_000 --> TASK_001
  TASK_001 --> TASK_002
  TASK_001 --> TASK_003
  TASK_002 --> TASK_003
  TASK_000 --> TASK_004
  TASK_001 --> TASK_005
  TASK_004 --> TASK_005
  TASK_002 --> TASK_006
  TASK_003 --> TASK_006
  TASK_004 --> TASK_006
  TASK_005 --> TASK_006
```

---

# P1 — Helpdesk + Asset Core MVP

```mermaid
flowchart TD
  TASK_010["TASK-010<br/>Location Hierarchy + Asset Registry"]
  TASK_011["TASK-011<br/>Asset Lifecycle + Canonical State Constraints"]
  TASK_012["TASK-012<br/>Basic Warehouse Receiving + Reservation"]
  TASK_013["TASK-013<br/>Asset Assignment End-to-End"]
  TASK_014["TASK-014<br/>Asset Transfer End-to-End"]
  TASK_015["TASK-015<br/>Asset Return + Handover/Return Documents"]
  TASK_016["TASK-016<br/>Ticket Core + Ticket State Machine + Commands"]
  TASK_017["TASK-017<br/>Ticket Intake — Portal + Email Normalization"]
  TASK_018["TASK-018<br/>Ticket Auto-Enrichment — User + Asset Context"]
  TASK_019["TASK-019<br/>Work Queue Core"]
  TASK_020["TASK-020<br/>Timeline + Notification + Basic Search Foundations"]
  TASK_021["TASK-021<br/>Phase 1 Vertical Slice + Integration Gate"]
  TASK_006["TASK-006<br/>Phase 0 Integration Gate"]
  TASK_006 --> TASK_010
  TASK_010 --> TASK_011
  TASK_011 --> TASK_012
  TASK_003["TASK-003<br/>Authorization Scopes + Privileged Access"]
  TASK_003 --> TASK_013
  TASK_011 --> TASK_013
  TASK_013 --> TASK_014
  TASK_013 --> TASK_015
  TASK_003 --> TASK_016
  TASK_006 --> TASK_016
  TASK_016 --> TASK_017
  TASK_010 --> TASK_018
  TASK_016 --> TASK_018
  TASK_017 --> TASK_018
  TASK_016 --> TASK_019
  TASK_018 --> TASK_019
  TASK_005["TASK-005<br/>Audit Foundation + Query + Integrity Controls"]
  TASK_005 --> TASK_020
  TASK_010 --> TASK_020
  TASK_016 --> TASK_020
  TASK_019 --> TASK_020
  TASK_012 --> TASK_021
  TASK_013 --> TASK_021
  TASK_014 --> TASK_021
  TASK_015 --> TASK_021
  TASK_017 --> TASK_021
  TASK_018 --> TASK_021
  TASK_019 --> TASK_021
  TASK_020 --> TASK_021
```

---

# P2 — Operations + Monitoring + Maintenance

```mermaid
flowchart TD
  TASK_030["TASK-030<br/>Monitoring Ingestion + Normalization + Dedupe"]
  TASK_031["TASK-031<br/>Agent Enrollment + Status + Inventory Projection"]
  TASK_032["TASK-032<br/>Incident Core + Incident State Machine"]
  TASK_033["TASK-033<br/>Root Incident Correlation + Ticket Linking"]
  TASK_034["TASK-034<br/>Major Incident Communication + Status Flow"]
  TASK_035["TASK-035<br/>SLA Engine"]
  TASK_036["TASK-036<br/>Approval Engine"]
  TASK_037["TASK-037<br/>Problem + Change + Knowledge Foundation"]
  TASK_038["TASK-038<br/>Maintenance + Warranty Core"]
  TASK_039["TASK-039<br/>Safe Automation + Operations Overview + Phase 2 Gate"]
  TASK_021["TASK-021<br/>Phase 1 Vertical Slice + Integration Gate"]
  TASK_021 --> TASK_030
  TASK_010["TASK-010<br/>Location Hierarchy + Asset Registry"]
  TASK_010 --> TASK_031
  TASK_021 --> TASK_031
  TASK_030 --> TASK_032
  TASK_021 --> TASK_032
  TASK_016["TASK-016<br/>Ticket Core + Ticket State Machine + Commands"]
  TASK_016 --> TASK_033
  TASK_032 --> TASK_033
  TASK_020["TASK-020<br/>Timeline + Notification + Basic Search Foundations"]
  TASK_020 --> TASK_034
  TASK_033 --> TASK_034
  TASK_016 --> TASK_035
  TASK_032 --> TASK_035
  TASK_004["TASK-004<br/>Command, Idempotency, Outbox, Inbox + Operation Hardening"]
  TASK_004 --> TASK_035
  TASK_003["TASK-003<br/>Authorization Scopes + Privileged Access"]
  TASK_003 --> TASK_036
  TASK_004 --> TASK_036
  TASK_032 --> TASK_037
  TASK_036 --> TASK_037
  TASK_011["TASK-011<br/>Asset Lifecycle + Canonical State Constraints"]
  TASK_011 --> TASK_038
  TASK_036 --> TASK_038
  TASK_019["TASK-019<br/>Work Queue Core"]
  TASK_019 --> TASK_039
  TASK_031 --> TASK_039
  TASK_033 --> TASK_039
  TASK_034 --> TASK_039
  TASK_035 --> TASK_039
  TASK_036 --> TASK_039
  TASK_037 --> TASK_039
  TASK_038 --> TASK_039
```

---

# P3 — Audit + Network + Software + License

```mermaid
flowchart TD
  TASK_050["TASK-050<br/>Asset Audit — Expected vs Observed"]
  TASK_051["TASK-051<br/>Network Discovery + Current Topology Projection"]
  TASK_052["TASK-052<br/>Network Exceptions — Unknown Device, VLAN, IP Conflict"]
  TASK_053["TASK-053<br/>Controlled Network Change + Verification + Rollback"]
  TASK_054["TASK-054<br/>Software Catalog + Artifact Repository"]
  TASK_055["TASK-055<br/>Software Deployment + Verification"]
  TASK_056["TASK-056<br/>Unauthorized Software Detection + Resolution"]
  TASK_057["TASK-057<br/>License Entitlement + Pool Model"]
  TASK_058["TASK-058<br/>License Assignment + Reclaim + Compliance"]
  TASK_059["TASK-059<br/>Replacement + Retirement + Disposal + Data Wipe"]
  TASK_060["TASK-060<br/>User Offboarding Orchestration"]
  TASK_061["TASK-061<br/>Advanced Search + Phase 3 Integration Gate"]
  TASK_020["TASK-020<br/>Timeline + Notification + Basic Search Foundations"]
  TASK_020 --> TASK_050
  TASK_039["TASK-039<br/>Safe Automation + Operations Overview + Phase 2 Gate"]
  TASK_039 --> TASK_050
  TASK_010["TASK-010<br/>Location Hierarchy + Asset Registry"]
  TASK_010 --> TASK_051
  TASK_031["TASK-031<br/>Agent Enrollment + Status + Inventory Projection"]
  TASK_031 --> TASK_051
  TASK_039 --> TASK_051
  TASK_019["TASK-019<br/>Work Queue Core"]
  TASK_019 --> TASK_052
  TASK_051 --> TASK_052
  TASK_036["TASK-036<br/>Approval Engine"]
  TASK_036 --> TASK_053
  TASK_037["TASK-037<br/>Problem + Change + Knowledge Foundation"]
  TASK_037 --> TASK_053
  TASK_052 --> TASK_053
  TASK_036 --> TASK_054
  TASK_039 --> TASK_054
  TASK_031 --> TASK_055
  TASK_054 --> TASK_055
  TASK_019 --> TASK_056
  TASK_054 --> TASK_056
  TASK_055 --> TASK_056
  TASK_054 --> TASK_057
  TASK_031 --> TASK_058
  TASK_057 --> TASK_058
  TASK_015["TASK-015<br/>Asset Return + Handover/Return Documents"]
  TASK_015 --> TASK_059
  TASK_036 --> TASK_059
  TASK_038["TASK-038<br/>Maintenance + Warranty Core"]
  TASK_038 --> TASK_059
  TASK_003["TASK-003<br/>Authorization Scopes + Privileged Access"]
  TASK_003 --> TASK_060
  TASK_015 --> TASK_060
  TASK_058 --> TASK_060
  TASK_050 --> TASK_061
  TASK_051 --> TASK_061
  TASK_052 --> TASK_061
  TASK_053 --> TASK_061
  TASK_055 --> TASK_061
  TASK_056 --> TASK_061
  TASK_058 --> TASK_061
  TASK_059 --> TASK_061
  TASK_060 --> TASK_061
```

---

# P4 — Procurement + Contract + Financial Control

```mermaid
flowchart TD
  TASK_070["TASK-070<br/>Supplier + Procurement Request"]
  TASK_071["TASK-071<br/>RFQ + Quotation + Supplier Selection"]
  TASK_072["TASK-072<br/>Purchase Order + Approval + Amendment"]
  TASK_073_R1["TASK-073-R1<br/>Goods Receipt + Partial Receipt + PO Receipt Contract"]
  TASK_073["TASK-073<br/>Goods Receipt + Asset Registration + Partial Receipt"]
  TASK_074["TASK-074<br/>Invoice + Duplicate Protection + 3-Way Match"]
  TASK_075["TASK-075<br/>Contract + Renewal + Commercial Document Governance"]
  TASK_076_R1["TASK-076-R1<br/>Contract Alert + Asset/License Cost Provenance Integration Contract"]
  TASK_076["TASK-076<br/>Phase 4 Procurement-to-Asset Integration Gate"]
  TASK_061["TASK-061<br/>Advanced Search + Phase 3 Integration Gate"]
  TASK_061 --> TASK_070
  TASK_070 --> TASK_071
  TASK_036["TASK-036<br/>Approval Engine"]
  TASK_036 --> TASK_072
  TASK_071 --> TASK_072
  TASK_012["TASK-012<br/>Basic Warehouse Receiving + Reservation"]
  TASK_012 --> TASK_073
  TASK_072 --> TASK_073
  TASK_072 --> TASK_073_R1
  TASK_073_R1 --> TASK_073
  TASK_072 --> TASK_074
  TASK_073 --> TASK_074
  TASK_070 --> TASK_075
  TASK_074 --> TASK_075
  TASK_071 --> TASK_076
  TASK_072 --> TASK_076
  TASK_073 --> TASK_076
  TASK_074 --> TASK_076
  TASK_075 --> TASK_076
  TASK_071 --> TASK_076_R1
  TASK_072 --> TASK_076_R1
  TASK_073 --> TASK_076_R1
  TASK_074 --> TASK_076_R1
  TASK_075 --> TASK_076_R1
  TASK_076_R1 --> TASK_076
```

---

# P5 — Automation + Intelligence + Advanced Reporting

```mermaid
flowchart TD
  TASK_090["TASK-090<br/>Advanced Rules Engine + Policy-Gated Automation"]
  TASK_091["TASK-091<br/>Controlled Self-Healing + Compensation"]
  TASK_092["TASK-092<br/>Advanced Incident Correlation"]
  TASK_093["TASK-093<br/>Knowledge Deflection + Self-Service Recommendations"]
  TASK_094_R1["TASK-094-R1<br/>Asset Risk + Replacement Scoring Contract"]
  TASK_094["TASK-094<br/>Risk + Replacement Scoring"]
  TASK_095["TASK-095<br/>Advanced Reporting + Governed KPI + Analytics"]
  TASK_096_R1["TASK-096-R1<br/>Explainable Recommendation Layer Contract"]
  TASK_096["TASK-096<br/>Explainable Recommendation Layer"]
  TASK_097["TASK-097<br/>Phase 5 System Integration + Intelligence Gate"]
  TASK_039["TASK-039<br/>Safe Automation + Operations Overview + Phase 2 Gate"]
  TASK_039 --> TASK_090
  TASK_061["TASK-061<br/>Advanced Search + Phase 3 Integration Gate"]
  TASK_061 --> TASK_090
  TASK_076["TASK-076<br/>Phase 4 Procurement-to-Asset Integration Gate"]
  TASK_076 --> TASK_090
  TASK_031["TASK-031<br/>Agent Enrollment + Status + Inventory Projection"]
  TASK_031 --> TASK_091
  TASK_053["TASK-053<br/>Controlled Network Change + Verification + Rollback"]
  TASK_053 --> TASK_091
  TASK_090 --> TASK_091
  TASK_033["TASK-033<br/>Root Incident Correlation + Ticket Linking"]
  TASK_033 --> TASK_092
  TASK_051["TASK-051<br/>Network Discovery + Current Topology Projection"]
  TASK_051 --> TASK_092
  TASK_090 --> TASK_092
  TASK_037["TASK-037<br/>Problem + Change + Knowledge Foundation"]
  TASK_037 --> TASK_093
  TASK_061 --> TASK_093
  TASK_092 --> TASK_093
  TASK_038["TASK-038<br/>Maintenance + Warranty Core"]
  TASK_038 --> TASK_094_R1
  TASK_050["TASK-050<br/>Asset Audit — Expected vs Observed"]
  TASK_050 --> TASK_094_R1
  TASK_058["TASK-058<br/>License Assignment + Reclaim + Compliance"]
  TASK_058 --> TASK_094_R1
  TASK_059["TASK-059<br/>Replacement + Retirement + Disposal + Data Wipe"]
  TASK_059 --> TASK_094_R1
  TASK_094_R1 --> TASK_094
  TASK_039 --> TASK_095
  TASK_061 --> TASK_095
  TASK_076 --> TASK_095
  TASK_090 --> TASK_096_R1
  TASK_092 --> TASK_096_R1
  TASK_093 --> TASK_096_R1
  TASK_094 --> TASK_096_R1
  TASK_095 --> TASK_096_R1
  TASK_096_R1 --> TASK_096
  TASK_090 --> TASK_096
  TASK_092 --> TASK_096
  TASK_093 --> TASK_096
  TASK_094 --> TASK_096
  TASK_095 --> TASK_096
  TASK_091 --> TASK_097
  TASK_092 --> TASK_097
  TASK_093 --> TASK_097
  TASK_094 --> TASK_097
  TASK_095 --> TASK_097
  TASK_096 --> TASK_097
```

---

# 8. Default Critical Path Summary

```text
TASK-000
→ TASK-001
→ TASK-002
→ TASK-003
→ TASK-005
→ TASK-006
→ TASK-010
→ TASK-011
→ TASK-013
→ TASK-016
→ TASK-018
→ TASK-019
→ TASK-020
→ TASK-021
→ TASK-030 / TASK-031
→ TASK-032
→ TASK-033
→ TASK-039
→ TASK-050 / TASK-051 / TASK-054
→ TASK-061
→ TASK-070
→ TASK-072
→ TASK-073-R1
→ TASK-073
→ TASK-074
→ TASK-076
→ TASK-090
→ TASK-097
```

This is the default backbone, not a prohibition on safe parallel work once dependencies are satisfied.

P5 automation boundary: TASK-090 evaluates event-triggered rules and creates
durable policy-gated Action Intents. TASK-091 consumes only eligible intents
and owns action execution, self-healing, retry, verification and
compensation. TASK-090 never invokes a remediation adapter.
