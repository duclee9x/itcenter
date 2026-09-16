# TASK-098 — Frontend Foundation + Design System + Operator Shell

## 1. Task Metadata

```yaml
task_id: TASK-098
feature_id: UI-FOUNDATION
workflow_id: UI-SHELL
phase: P6
priority: P0
status: NOT_STARTED
owner_domain: frontend/platform-ui
```

---

# 2. Objective

Create the Phase 6 frontend foundation in `apps/web` and implement the shared operator shell/design-system primitives needed by all later UI tasks, without changing canonical backend domain semantics.

The result must be a runnable React/Vite application with:

- operator app shell;
- permission-aware navigation structure;
- explicit tenant context plumbing;
- frontend API/query foundation;
- route framework;
- locked design tokens and shared primitives;
- standard loading/empty/error patterns;
- accessibility baseline;
- tests sufficient to prove the foundation is reusable for TASK-099 onward.

Do **not** implement Operations Home, Work Queue or Case Workspace feature logic in this task beyond route placeholders required to verify shell/navigation behavior.

---

# 3. Required Specifications

Codex must read before editing:

```text
AGENTS.md
CURRENT_TASK.md
tasks/CODEX_UI_TASK_REGISTRY.md
docs/design/UI_UX_MASTER_SPEC.md
docs/design/PHASE6_UI_IMPLEMENTATION_ROADMAP.md
CODEX_TASK_TEMPLATE.md
package.json
```

Then inspect the existing repository for authentication, tenant, API response/error and authorization contracts relevant to a browser client. Read only the needed canonical specs, including as applicable:

```text
API_COMMAND_CONTRACT_SPEC.md
PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md
ERROR_RETRY_IDEMPOTENCY_STANDARD.md
IDENTITY_SSO_RBAC_USER_LIFECYCLE_OFFBOARDING_WORKFLOW.md
BACKEND_REPOSITORY_MODULE_STRUCTURE_SPEC.md
```

If exact filenames/locations differ, discover them rather than inventing substitutes.

---

# 4. In Scope

- Create `apps/web` as an npm workspace React + TypeScript + Vite application.
- Configure the root workspace scripts needed to lint/typecheck/build/test the frontend without breaking existing backend commands.
- Add React Router routing foundation.
- Add TanStack Query client/provider foundation.
- Add Tailwind CSS and accessible primitive strategy consistent with the design spec.
- Add Lucide icons or the chosen single icon package.
- Implement design tokens for semantic colors, typography, spacing, radii, surfaces, borders and focus states.
- Implement operator `AppShell` with:
  - 64px global header;
  - 224px expanded / 72px collapsed sidebar;
  - grouped navigation from the locked IA;
  - global search placeholder/entry surface;
  - `+ Create` placeholder control;
  - notifications placeholder;
  - current user surface;
  - explicit current tenant surface.
- Implement route placeholders for the locked operator destinations so navigation can be exercised without feature implementation.
- Implement permission-aware navigation adapter that consumes capability/permission data from frontend state/API contracts rather than hard-coded role-name checks.
- Implement frontend API client foundation with explicit tenant header propagation according to canonical backend contract.
- Implement standardized server error mapping infrastructure without hiding canonical errors.
- Implement shared primitives/patterns required now:
  - `PageHeader`
  - `EntityHeader`
  - `StatusChip`
  - `PriorityChip`
  - `SLAIndicator`
  - `SavedViewBar`
  - `FilterBar`
  - `SplitView`
  - `QuickPreview` shell
  - `ContextPanel` shell
  - `ActionDrawer`
  - `EvidenceDrawer`
  - `ConfirmDialog`
  - `SummaryMetric`
  - `EmptyState`
  - `SectionError`
  - `Skeleton`
- Implement standard drawer sizing and overlay layering rules.
- Implement standard keyboard/focus behavior for shell/sidebar/drawer/dialog interactions.
- Add representative Storybook-like local component showcase only if it can be done without adding a separate heavy platform; otherwise use a simple internal development route/test harness.
- Add frontend unit/component tests for the foundation.
- Update frontend documentation/run instructions.

---

# 5. Out of Scope

- Operations Home business data/attention logic (TASK-099).
- Work Queue implementation (TASK-099).
- Case Workspace (TASK-100).
- Asset/User screens (TASK-101).
- Monitoring screens (TASK-102).
- Automation screens (TASK-103).
- Inventory/Procurement screens (TASK-104).
- Self-service portal feature implementation (TASK-105).
- Reports/Governance/Admin feature implementation (TASK-106).
- New canonical domain entities.
- New business state transitions.
- New authorization rules.
- New automation retry behavior.
- Any release/deployment work not necessary to run/build/test `apps/web` locally.
- Editing `AGENTS.md`.

Codex must not expand scope without reporting `SCOPE_DEPENDENCY`.

---

# 6. Current Repository Context

Known baseline at task creation:

```text
- TASK-097 is CODE_COMPLETE / VERIFIED.
- Existing deployables: apps/api, apps/worker, apps/agent-gateway.
- No frontend application exists under apps/ at task creation.
- Repository uses npm workspaces and Node >=22.
- Root verification already includes format/lint/typecheck/build/backend test layers.
- Canonical backend business capabilities through Phase 5 already exist.
```

Codex must inspect current branch state before editing and reconcile any drift.

---

# 7. Frontend Architecture Rules

Use the Phase 6 decision from `PHASE6_UI_IMPLEMENTATION_ROADMAP.md`:

```text
apps/web
React
TypeScript
Vite
React Router
TanStack Query
Tailwind CSS
accessible Radix/shadcn-style primitives where useful
Lucide icons
```

Do not replace the framework stack silently.

The frontend must be a consumer of the existing API/domain contracts, not a second business-rule engine.

---

# 8. Operator Shell Layout Contract

Desktop baseline:

```text
Frame: 1440 × 1000
Header: 64px
Sidebar expanded: 224px
Sidebar collapsed: 72px
Main horizontal padding: 24px
```

Navigation groups:

```text
Daily
- Operations
- Work Queue

Operate
- Assets
- Monitoring
- Automation

Lifecycle
- Inventory
- Procurement

Knowledge
- Knowledge

Insights
- Reports
- Governance

System
- Admin
```

`Governance` and `Admin` must be capability/permission-aware.

Portal navigation is not implemented in this task, but the architecture must not prevent a separate `PortalShell` later.

---

# 9. Tenant and Authorization Boundary

The frontend must not infer canonical permissions from labels such as `ADMIN` or `HELPDESK`.

Implement a frontend representation suitable for server-provided capabilities/permissions and use it to decide what to present.

Rules:

- backend remains authorization authority;
- current tenant is explicit application context;
- protected browser API requests attach the selected tenant according to the existing contract (e.g. `X-Tenant-ID` if canonical spec confirms it);
- no server-side silent tenant inference is introduced;
- do not expose an action merely because the client thinks a role allows it if canonical capability data says otherwise;
- do not treat hiding a button as security enforcement.

If existing `/me` or equivalent contracts do not expose sufficient tenant/capability context for the locked shell, stop and report the minimum read-projection dependency rather than inventing identity semantics.

---

# 10. API Client Foundation

Implement a single browser API client layer that supports:

- API base URL configuration;
- authenticated browser request mode consistent with canonical OIDC/session contract;
- explicit tenant propagation;
- request correlation headers only if existing specs require/allow them;
- typed JSON response helpers;
- canonical error decoding;
- abort/cancellation support;
- no generic retry of unsafe mutation commands;
- integration with TanStack Query for queries/invalidation.

Do not add mutation retry defaults that could violate command/idempotency semantics.

---

# 11. Design Tokens

Implement semantic tokens equivalent to:

```text
--status-critical
--status-warning
--status-attention
--status-success
--status-info
--status-neutral

--surface-page
--surface-card
--surface-raised
--surface-selected

--border-default
--border-strong

--text-primary
--text-secondary
--text-muted
```

Add spacing/radius/typography/focus tokens from `UI_UX_MASTER_SPEC.md`.

Do not hard-code domain entity colors.

---

# 12. Shared Component Contracts

At minimum, components implemented by TASK-098 must expose reusable APIs and support the locked semantics.

Examples:

```text
StatusChip
- label
- semantic tone
- icon optional
- never color-only

PriorityChip
- canonical/display priority
- compact presentation

SLAIndicator
- remaining/breached display
- semantic risk presentation

ActionDrawer
- standard header/body/sticky-footer layout
- sizes: quick preview ~456, resolve ~520, action/diagnose ~560, evidence ~640 via shared sizing tokens

SectionError
- message
- optional freshness/last-success info
- retry action

EmptyState
- explanatory title/body
- optional useful CTA
```

Do not put feature-specific business logic in primitives.

---

# 13. Route Placeholders

Provide operator route placeholders for at least:

```text
/operations
/work
/assets
/monitoring
/automation
/inventory
/procurement
/knowledge
/reports
/governance
/admin
```

Each placeholder must render through the same shell and clearly identify that the feature is scheduled for a later Phase 6 task.

Do not implement fake business data solely to make placeholders look complete.

---

# 14. Accessibility

Applicable acceptance baseline:

- semantic landmarks (`header`, `nav`, `main`);
- keyboard reachable sidebar/header controls;
- visible focus;
- accessible drawer/dialog focus trap and focus return;
- labels for icon-only universal controls;
- no color-only status primitives;
- reduced-motion friendly transitions;
- no flashing critical state.

---

# 15. Responsive Baseline

TASK-098 must establish shell behavior for:

```text
>=1440 full operator layout
1280 standard operator layout
~1024 collapsed sidebar / reduced content
768 tablet foundation
```

Feature-specific mobile behavior comes later.

At minimum verify the shell does not overflow/break at 1280 and 1024 widths.

---

# 16. Error / Loading Foundation

Provide reusable support for:

```text
Loading
Empty
Partial failure
Full-page failure
Stale/freshness notice
```

Do not make a full-screen spinner the default for ordinary route data loading after application startup.

---

# 17. Required Tests

## Unit / Component

```text
[ ] semantic status components render label + non-color cue
[ ] sidebar renders locked groups
[ ] unauthorized/capability-hidden destinations are omitted
[ ] current tenant context is visible and request helper propagates tenant according to canonical contract
[ ] sidebar collapse/expand works
[ ] ActionDrawer focus is trapped and returned correctly
[ ] ConfirmDialog is keyboard operable
[ ] SectionError exposes retry affordance
```

## Routing

```text
[ ] each locked operator destination route renders through shared AppShell
[ ] unknown route has a coherent not-found experience
[ ] navigation preserves shell state
```

## Responsive

```text
[ ] 1440 shell geometry matches design baseline
[ ] 1280 remains usable
[ ] ~1024 collapses sidebar / remains usable
```

## Build/Repository Integration

```text
[ ] existing backend typecheck/build/tests are not broken by workspace changes
[ ] frontend typecheck/build/test commands run successfully
```

---

# 18. Acceptance Criteria

1. `apps/web` exists and is a runnable React/Vite TypeScript workspace application.
2. The operator shell matches the locked 64px header / 224px sidebar information architecture and uses the Phase 6 navigation groups.
3. Shell remains usable at 1440, 1280 and approximately 1024 widths.
4. Navigation visibility is driven by a capability/permission abstraction rather than role-name string checks.
5. Current tenant is explicit in shell/client state and protected API requests propagate tenant context according to the canonical backend contract.
6. Shared design tokens and the required primitive/pattern components are implemented and reused by route placeholders.
7. Status components are semantic and accessible, not color-only.
8. Standard drawer/dialog focus behavior works with keyboard and returns focus to the trigger.
9. Loading/empty/partial-error/full-error patterns exist as reusable components.
10. No canonical backend domain entity, state transition, approval rule or automation retry behavior is changed.
11. No `AGENTS.md` changes are included.
12. Root/backend verification remains green for changes introduced by this task, and frontend-specific tests/build pass.
13. A concise implementation report records packages added, scripts changed, architecture decisions, tests run and any projection/API dependency discovered.

---

# 19. Verification Commands

Codex must inspect actual package scripts after changes and run the applicable repository commands.

At minimum, expect to run equivalent categories:

```text
npm run format:check
npm run lint
npm run typecheck
npm run build
frontend unit/component tests
existing repository test layers affected by workspace/config changes
```

Do not skip failures as "unrelated" without proving they pre-existed and recording evidence.

---

# 20. Codex Execution Protocol

```text
1. Inspect working tree and current commit.
2. Read AGENTS.md and this task.
3. Read UI_UX_MASTER_SPEC and PHASE6_UI_IMPLEMENTATION_ROADMAP.
4. Inspect auth/tenant/API contracts needed by the browser shell.
5. Report a concise implementation plan before editing.
6. Implement only TASK-098.
7. Do not touch unrelated user modifications, especially AGENTS.md.
8. Run verification.
9. Fix regressions introduced by this task.
10. Write tasks/TASK-098_IMPLEMENTATION_REPORT.md.
11. Reconcile tasks/CODEX_UI_TASK_REGISTRY.md and CURRENT_TASK.md only if acceptance criteria pass.
12. Do not start TASK-099 in the same execution.
```

---

# 21. Required Completion Report

Create `tasks/TASK-098_IMPLEMENTATION_REPORT.md` with:

```markdown
## Implementation Report

### Status
IMPLEMENTED / PARTIAL / BLOCKED

### Frontend Architecture
- ...

### Files Changed
- ...

### Dependencies Added
- ...

### Routes / Shell
- ...

### API / Tenant / Permission Integration
- ...

### Shared Components / Tokens
- ...

### Tests Run
- command: result

### Remaining Gaps
- ...

### Scope Dependencies
- none / ...

### Spec Conflicts
- none / ...

### Assumptions
- none / ...
```

If `IMPLEMENTED`, update the UI task registry so TASK-098 is `CODE_COMPLETE` and derive TASK-099 readiness, then update `CURRENT_TASK.md` to point to the next READY task. Do not generate/implement TASK-099 unless separately instructed after reconciliation.
