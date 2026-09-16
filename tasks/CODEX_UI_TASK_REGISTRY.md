# CODEX UI TASK REGISTRY
## IT Operations Hub — Phase 6 Frontend Implementation Control

**Status:** Active  
**Entry Gate:** TASK-097 = CODE_COMPLETE / VERIFIED  
**Design Authority:** `docs/design/UI_UX_MASTER_SPEC.md`  
**Roadmap:** `docs/design/PHASE6_UI_IMPLEMENTATION_ROADMAP.md`

---

# 1. Governing Rule

This registry extends the completed backend roadmap with the explicitly authorized UI implementation phase.

Do not infer additional tasks beyond TASK-108.

Task readiness follows the same deterministic rules as `tasks/CODEX_TASK_REGISTRY.md`:

```text
status == NOT_STARTED
AND every declared dependency is CODE_COMPLETE
AND no unresolved blocker/spec conflict exists
AND required design/spec inputs are ready
```

Only the current READY task should be implemented.

---

# 2. Task Registry

| Task | Phase | Priority | Title | Depends On | Readiness | Status | Task File |
|---|---|---:|---|---|---|---|---|
| `TASK-098` | P6 | P0 | Frontend Foundation + Design System + Operator Shell | TASK-097 | **READY** | NOT_STARTED | `TASK-098_FRONTEND_FOUNDATION_DESIGN_SYSTEM_OPERATOR_SHELL.md` |
| `TASK-099` | P6 | P0 | Operations Home + Unified Work Queue | TASK-098 | BLOCKED | NOT_STARTED | generated when READY |
| `TASK-100` | P6 | P0 | Case Workspace + Timeline + Context + Resolution | TASK-099 | BLOCKED | NOT_STARTED | generated when READY |
| `TASK-101` | P6 | P0 | Asset 360 + User 360 | TASK-098, TASK-100 | BLOCKED | NOT_STARTED | generated when READY |
| `TASK-102` | P6 | P0 | Monitoring + Alert Investigation + Case Handoff | TASK-098, TASK-100 | BLOCKED | NOT_STARTED | generated when READY |
| `TASK-103` | P6 | P0 | Automation + Action Center + UNKNOWN Safety UX | TASK-098, TASK-100, TASK-102 | BLOCKED | NOT_STARTED | generated when READY |
| `TASK-104` | P6 | P1 | Inventory + Replacement + Procurement Lifecycle | TASK-098, TASK-100, TASK-101 | BLOCKED | NOT_STARTED | generated when READY |
| `TASK-105` | P6 | P0 | Self-Service Portal + Knowledge Experience | TASK-098, TASK-100, TASK-102 | BLOCKED | NOT_STARTED | generated when READY |
| `TASK-106` | P6 | P1 | Reports + Governance + Admin UX | TASK-098, TASK-101, TASK-102, TASK-103, TASK-104 | BLOCKED | NOT_STARTED | generated when READY |
| `TASK-107` | P6 | P0 | Cross-Domain UX Integration + Accessibility + Responsive Hardening | TASK-099, TASK-100, TASK-101, TASK-102, TASK-103, TASK-104, TASK-105, TASK-106 | BLOCKED | NOT_STARTED | generated when READY |
| `TASK-108` | P6 | P0 | Phase 6 UI Integration Gate | TASK-107 | BLOCKED | NOT_STARTED | generated when READY |

---

# 3. Status Protocol

Allowed implementation statuses remain:

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

`READY` is derived readiness, not an implementation status.

On completion of each task:

```text
implementation report
→ reconcile acceptance criteria
→ update this registry
→ derive next READY task
→ generate only that task file
→ update CURRENT_TASK.md
```

---

# 4. Scope Boundary

Phase 6 may add:

- `apps/web`;
- frontend packages/configuration;
- frontend tests;
- narrow query/read projections needed by locked UI screens;
- permission-aware requester-safe projections;
- route/state adapters and frontend API clients.

Phase 6 must not silently add:

- new canonical domain aggregates solely for UI convenience;
- new business state transitions;
- new approval policy;
- new automation retry semantics;
- new tenant inference behavior;
- release/deployment changes unrelated to running/verifying the frontend task;
- edits to `AGENTS.md` unless separately authorized.

If any of those become necessary, report `SCOPE_DEPENDENCY` or `SPEC_CONFLICT`.
