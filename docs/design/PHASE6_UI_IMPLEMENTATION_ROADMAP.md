# Phase 6 — UI Implementation Roadmap

**Status:** ACTIVE / IMPLEMENTATION AUTHORIZED  
**Entry gate:** TASK-097 `CODE_COMPLETE / VERIFIED`  
**Design authority:** `docs/design/UI_UX_MASTER_SPEC.md`  
**Goal:** Implement the locked operator application and end-user self-service UX on top of the existing canonical backend without changing domain semantics.

---

# 1. Phase Rules

1. This phase is **frontend/UI implementation**, not a new product-domain phase.
2. Existing backend canonical commands, state machines, RBAC, tenant boundaries, automation safety and audit rules remain authoritative.
3. UI projections/BFF/read adapters may be added only when required to render the locked UX efficiently and safely.
4. Any required canonical mutation or business-rule expansion not already specified must stop as `SCOPE_DEPENDENCY` or `SPEC_CONFLICT`.
5. No release/deployment/security-verification work is resumed by this roadmap.
6. Do not modify `AGENTS.md` as part of UI tasks unless a separate explicit task authorizes it.
7. Do not introduce Kubernetes or additional infrastructure for the frontend. The repository remains the existing lightweight modular-monolith/local-Podman environment.
8. Every task must run the repository's applicable verification commands and add focused frontend tests for its behavior.

---

# 2. Frontend Architecture Decision for Phase 6

Implement a new workspace application:

```text
apps/web
```

Use:

```text
React
TypeScript
Vite
React Router
TanStack Query
Tailwind CSS
Radix/shadcn-style accessible primitives where useful
Lucide icons
```

Rationale:

- the backend/API is already a separate deployable runtime;
- the UI is primarily an authenticated operational SPA;
- Vite keeps the frontend build/runtime simple and avoids creating a second server framework merely for rendering;
- React Router + TanStack Query map cleanly to the route/state/read-model design in `UI_UX_MASTER_SPEC.md`;
- the existing npm workspace can contain `apps/web` without changing backend deployables.

Codex may adjust exact package versions to current compatible stable versions after inspecting the repository, but must not replace this architecture with a different framework without reporting `SPEC_CONFLICT`.

The frontend must not introduce its own authorization source of truth. Permission-aware navigation/actions are based on authenticated server/read-model data and backend enforcement.

---

# 3. Task Sequence

| Task | Priority | Title | Depends On | Outcome |
|---|---:|---|---|---|
| `TASK-098` | P0 | Frontend Foundation + Design System + Operator Shell | TASK-097 | Runnable `apps/web`, route shell, design tokens, shared primitives, API/query/auth/tenant client foundations |
| `TASK-099` | P0 | Operations Home + Unified Work Queue | TASK-098 | Locked Operations and split-view Work Queue UX integrated with canonical/read projections |
| `TASK-100` | P0 | Case Workspace + Timeline + Context + Resolution | TASK-099 | Primary Helpdesk workspace, reply/internal note separation, diagnose/action/resolve drawers |
| `TASK-101` | P0 | Asset 360 + User 360 | TASK-098, TASK-100 | Operational asset/user context, Agent/software/maintenance/lifecycle views |
| `TASK-102` | P0 | Monitoring + Alert Investigation + Case Handoff | TASK-098, TASK-100 | Monitoring overview, alert triage, impact/correlation, create/link Incident flow |
| `TASK-103` | P0 | Automation + Action Center + UNKNOWN Safety UX | TASK-098, TASK-100, TASK-102 | Recommendation/execution/conflict/approval UX with strict UNKNOWN semantics |
| `TASK-104` | P1 | Inventory + Replacement + Procurement Lifecycle | TASK-098, TASK-100, TASK-101 | Replacement, inventory reservation, procurement, receipt, invoice/contract operational views |
| `TASK-105` | P0 | Self-Service Portal + Knowledge Experience | TASK-098, TASK-100, TASK-102 | Mobile-first portal, guided request, known issue, requester-safe timeline, knowledge deflection |
| `TASK-106` | P1 | Reports + Governance + Admin UX | TASK-098, TASK-101, TASK-102, TASK-103, TASK-104 | Reporting/governance/admin IA and representative operational screens |
| `TASK-107` | P0 | Cross-Domain UX Integration + Accessibility + Responsive Hardening | TASK-099..TASK-106 | End-to-end state/context preservation, permission behavior, partial failures, keyboard/a11y/responsive QA |
| `TASK-108` | P0 | Phase 6 UI Integration Gate | TASK-107 | Verify locked UI acceptance scenarios against design spec; no new feature work |

Only the next READY task should have a detailed task contract generated. Do not pre-implement later tasks from the roadmap.

---

# 4. Vertical-Slice Build Order

The implementation order is deliberately workflow-first:

```text
Slice A
Foundation
→ Operations
→ Work Queue
→ Case

Slice B
Case
↔ Asset/User
↔ Monitoring
↔ Automation

Slice C
Portal
→ Request
→ Operator Case
→ Resolve
→ Portal

Slice D
Case
→ Replacement
→ Inventory
→ Procurement

Slice E
Reports
→ Governance
→ Admin

Gate
→ Cross-domain/a11y/responsive/integration verification
```

Do not build a large set of static pages before the first operator vertical slice is interactive.

---

# 5. Backend Projection Policy

Before adding a UI-only aggregation endpoint, Codex must inspect existing query APIs. Prefer reuse where one or a few canonical requests are sufficient.

When a locked screen otherwise requires many unrelated round trips or client-side business reconstruction, add a narrow permission-aware read projection/BFF endpoint.

Allowed examples:

```text
operations home projection
work queue projection
case workspace projection
asset workspace projection
monitoring workspace projection
automation review projection
self-service request projection
```

Projection requirements:

- explicit tenant scope;
- canonical authorization on the server;
- no duplicate source of truth;
- no canonical mutation through generic projection writes;
- return canonical/action availability/blocker information when that avoids duplicating business rules in the frontend;
- no CSS/color/icon instructions from backend.

---

# 6. Routing Baseline

Operator routes should follow a coherent structure equivalent to:

```text
/operations
/work
/work/:kind/:id
/assets
/assets/:id
/users/:id
/monitoring
/monitoring/alerts/:id
/automation
/automation/executions/:id
/inventory
/procurement
/procurement/requests/:id
/procurement/rfq/:id
/procurement/orders/:id
/procurement/receipts/:id
/procurement/invoices/:id
/reports
/governance
/admin
```

Portal routes are separate:

```text
/portal
/portal/requests/new
/portal/requests/:id
/portal/devices
/portal/knowledge
```

Exact route names may adapt to existing API/resource terminology, but navigation semantics from the design spec are locked.

---

# 7. Definition of Done for UI Tasks

Each UI task must satisfy all applicable items:

- route renders through the shared shell;
- keyboard and visible-focus behavior is functional;
- loading, empty, error and normal states exist where applicable;
- unauthorized actions are not offered as normal executable UI;
- disabled actions explain temporary prerequisites where useful;
- tenant context is explicit and correctly propagated;
- no internal requester-hidden data leaks to portal projections;
- no business transition is implemented via generic direct state mutation;
- no `UNKNOWN` automation retry path is introduced;
- responsive behavior meets the task's target width(s);
- tests cover the task's core interaction/state behavior;
- typecheck/lint/build/tests pass for changed scope;
- implementation report names any backend projection/API introduced.

---

# 8. Phase 6 Integration Scenarios

`TASK-108` will verify at minimum:

```text
P01 End user submits a network issue without choosing ITSM priority.
P02 Monitoring alert creates/links Incident with preserved impact/context.
P03 Operator sees urgent work, previews, claims and opens it without losing queue state.
P04 Case shows User + Asset + Monitoring + SLA context on one surface.
P05 Diagnose → recommendation → governed execution → verification is understandable.
P06 UNKNOWN is distinct from FAILED and offers no automatic retry.
P07 Resolve updates operator context and requester-safe portal state.
P08 Device replacement starts from Case and reserves compatible stock without repeated context entry.
P09 No-stock replacement hands off to Procurement with source context preserved.
P10 Unauthorized software shows policy/approval/exception context before controlled action.
P11 Invoice exception clearly presents PO vs Receipt vs Invoice.
P12 Partial Monitoring/Agent dependency failure does not collapse unrelated Case work.
P13 Permission/persona changes alter visible navigation/actions without weakening backend enforcement.
P14 Core operator views remain usable at 1280px and portal primary flows at ~390px mobile.
```

---

# 9. Stop Conditions

Codex must stop and report rather than invent when:

```text
- a required action has no canonical backend command/contract;
- two normative specs conflict materially;
- server authorization cannot support the requested visibility boundary;
- a read projection would need to own mutable business state;
- a UI flow would require changing UNKNOWN/retry/approval semantics;
- a task would expand into an unrelated release/deployment effort.
```

Use the repository-standard `SPEC_CONFLICT` / `SCOPE_DEPENDENCY` reporting protocol.
