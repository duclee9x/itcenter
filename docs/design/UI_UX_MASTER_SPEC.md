# IT Operations Hub — UI/UX Master Specification

**Status:** DESIGN_LOCKED / IMPLEMENTATION_AUTHORIZED  
**Authority:** Normative UI/UX contract for Phase 6 frontend implementation  
**Backend baseline:** TASK-097 CODE_COMPLETE / VERIFIED  
**Scope:** Operator application + end-user self-service portal  
**Non-goal:** Change canonical domain rules, state machines, authorization, automation safety, or release/deployment semantics.

---

# 1. Product Design Principles

The frontend must organize work by **human operational intent**, not by backend module taxonomy.

Primary operator loop:

```text
Work arrives
→ understand context
→ decide
→ act
→ verify
→ close
```

The normal Helpdesk path is:

```text
Operations Home
→ Work Queue
→ Case Workspace
→ Action / Verification / Resolution
```

The UI must not require a normal operator to jump repeatedly among Ticket, Incident, Asset, Monitoring and Automation merely to understand one issue.

Non-negotiable rules:

1. **Do not create a new canonical `Case` domain entity solely because the UI uses the name Case Workspace.** Case Workspace is a presentation/read-model concept over existing canonical records.
2. **Do not merge independent Asset dimensions** such as lifecycle, operational state, health, assignment, warranty, compliance and risk into one mega-status.
3. **Do not bypass RBAC, approval, state machines, idempotency or canonical command paths to reduce clicks.**
4. **Do not turn recommendations into execution unless the canonical backend says execution is available.**
5. **Do not retry automation outcome `UNKNOWN` automatically.** `UNKNOWN` means outcome cannot safely be determined, not `FAILED`.
6. **Do not duplicate source of truth.** UI aggregation/read models are allowed; canonical domain ownership is unchanged.
7. **Do not ask users to re-enter context the system already knows** (requester, tenant, assigned asset, source case, location, related alert, etc.) unless a deliberate override is required.
8. **One human responsibility should normally map to one actionable Work Queue item.** Historical evidence remains visible after attention moves elsewhere.
9. **Daily operational objects are not navigation items merely because they exist in the backend.** Do not expose ActionIntent, ExecutionAttempt, RuleRevision, Inbox, Outbox, Correlation, etc. as ordinary sidebar modules.
10. **The backend remains the authority for available actions.** Frontend must not infer business permissions from role-name string checks.

---

# 2. Information Architecture

## 2.1 Operator application

```text
Daily
├─ Operations
└─ Work Queue

Operate
├─ Assets
├─ Monitoring
└─ Automation

Lifecycle
├─ Inventory
└─ Procurement

Knowledge
└─ Knowledge

Insights
├─ Reports
└─ Governance        # permission-dependent

System
└─ Admin             # permission-dependent
```

Do not create top-level sidebar entries for RFQ, Quotation, PO, Invoice, Contract, Alert, Rule Revision, Execution Attempt, etc. Those are reached from the appropriate workspace.

## 2.2 End-user portal

The portal has a separate shell and information architecture:

```text
Home
My Requests
My Devices
Knowledge
```

Do not reuse the operator sidebar and hide items with CSS.

---

# 3. Application Shell

Desktop operator baseline:

```text
Primary frame: 1440 × 1000
Global header: 64px
Expanded sidebar: 224px
Collapsed sidebar: 72px
Main content horizontal padding: 24px
Usable content width at 1440: 1168px
```

Global header contains:

- product identity
- global search / command entry
- `+ Create`
- notifications
- explicit current tenant context
- current user

Tenant behavior:

- protected human API calls still require explicit tenant context according to canonical backend rules;
- the application shell owns the current explicitly selected tenant and attaches it to calls;
- do not repeatedly ask the user for tenant per action;
- do not invent server-side tenant inference.

Sidebar is permission-aware. Features the user cannot access should generally be absent rather than shown as a wall of disabled entries.

---

# 4. Shared Visual System

## 4.1 Visual character

```text
Enterprise
Modern
Quiet
Information-rich
Exception-first
```

Avoid dashboard rainbow, heavy gradients, giant consumer-style cards, excessive shadows, excessive animation and chart walls.

## 4.2 Semantic colors

Color represents meaning, not entity type:

- Critical / destructive → red semantic token
- Warning / SLA risk → orange semantic token
- Attention / review → amber semantic token
- Healthy / success → green semantic token
- Informational / active → blue semantic token
- Neutral / inactive → gray semantic token

Never rely on color alone; status needs text and/or icon.

Use semantic design tokens, not scattered raw colors.

## 4.3 Typography

```text
Major metric      30/36 600
Page title        26/32 600
Entity title      22/28 600
Section title     16/22 600
Row title         14/20 500
Body              14/20 400
Metadata          12/18 400
Button            14/20 500
```

Use tabular numerals for SLA, duration, counts and commercial amounts where scanning benefits.

## 4.4 Spacing and controls

Base spacing: 4px.

```text
4  micro
8  compact
12 control
16 normal
24 section
32 large
48 page separation
```

```text
Card radius       8px
Control radius    6px
Primary button    36px high
Large CTA         40px high
Input/select      36px high
Icon button       36×36
Operator nav row  40px
```

Cards normally use border rather than shadow. Shadows are reserved for popovers, drawers, modal and command palette.

## 4.5 Action hierarchy

Use only:

- Primary
- Secondary
- Ghost
- Danger (destructive consequence only)

A surface normally has one primary CTA at a time.

Confirmation friction is consequence-driven:

```text
low consequence    → immediate / light confirmation
medium consequence → short review
high consequence   → detailed consequence review + reason
```

Do not replace every action with generic `Are you sure?` dialogs.

---

# 5. Shared Components

Required shared component vocabulary:

```text
AppShell
PortalShell
PageHeader
EntityHeader
SavedViewBar
FilterBar
SplitView
WorkItemRow
QuickPreview
ContextPanel
StatusChip
PriorityChip
SLAIndicator
UserMiniCard
AssetMiniCard
AlertCard
RecommendationCard
ExecutionCard
Timeline
TimelineEvent
ActionDrawer
EvidenceDrawer
ConfirmDialog
SummaryMetric
AttentionList
EmptyState
SectionError
Skeleton
```

Create domain-specific components only when the semantic structure is genuinely different, e.g. `QuotationComparison`, `InvoiceMatchSummary`, `AssetLifecycle`, `NetworkMap`, `RuleConditionBuilder`.

Do not recreate near-identical cards/buttons/tables per feature.

---

# 6. Operations Home

Purpose: answer **“What needs my attention now?”**, not provide BI reporting.

Desktop layout at 1440:

```text
4 summary cards: 280px each, 16px gaps
Main row: Needs Attention 744px + 16px gap + Environment Health 408px
Secondary row: 576px + 16px + 576px
```

Required summary cards:

- My work
- Critical now
- SLA risk
- Waiting

Every summary card is clickable and opens the Work Queue or relevant operational view with an equivalent filter.

`Needs Attention` displays only approximately 5–7 actionable items, ranked by operational urgency, not simple `created_at` ordering.

Example attention types:

- P1/critical case
- unhandled critical alert
- SLA at risk/breached
- automation conflict / `UNKNOWN`
- approval requiring the current user
- important asset/procurement work requiring human action

Environment Health summarizes Asset, Agent and Monitoring health. Do not fill the page with donut charts.

Secondary areas:

- Automation requiring attention
- Upcoming / expiring lifecycle items
- Recent important activity (business-relevant events only)

Normal infrastructure heartbeats, polling, metrics scraping and raw audit noise do not appear here.

Partial dependency failure must degrade only the affected section where possible.

---

# 7. Work Queue

Purpose: unified actionable queue for human responsibilities without erasing domain semantics.

Default views:

```text
My work
Unassigned
Critical
SLA risk
Waiting
Automation
Team queue
All work
```

Desktop split at 1440:

```text
Queue list: 700px
Gap: 16px
Quick Preview: 452px
Row height: 76px
```

A Work Queue row contains only the information needed to decide whether to open it:

- source type icon + canonical ID
- title
- priority / severity where relevant
- requester / asset context
- SLA or due information
- assignment
- latest/attention reason when needed

Do not turn every row into a metadata dump.

Row click selects and opens Quick Preview; it does not immediately navigate away. `Open workspace` opens full work context.

Recommended default presentation ranking:

```text
critical unresolved
→ SLA breached
→ SLA at risk
→ blocked / unknown / conflict
→ assigned actionable
→ waiting requiring my response
→ normal work
```

This ranking is presentation-only and must not rewrite canonical priority.

Bulk actions are limited to low-risk actions such as assignment/team/tag/acknowledgement where canonical semantics allow. Do not bulk resolve, approve, execute automation, replace assets or perform destructive operations.

Queue navigation state (view/filter/sort/scroll/selection) must be preserved when opening a workspace and returning.

---

# 8. Case Workspace

`Case Workspace` is a UI concept, not a new domain aggregate.

Purpose: allow normal Helpdesk work to remain on one surface.

Desktop split at 1440:

```text
Main timeline/work: 800px
Gap: 16px
Context Panel: 352px
```

Sticky entity header must immediately show:

- canonical record ID
- concise title
- priority/severity and SLA when applicable
- current human-readable state
- team/assignee
- requester
- primary asset
- location where useful
- maximum ~4 top-level controls

Primary controls normally resolve to:

```text
Assign / ownership
Diagnose
Take action
Resolve / domain equivalent
```

Action availability comes from canonical backend capability/state/authorization, not frontend inference.

## 8.1 Timeline-first

Default main area is business-relevant Timeline, not a giant Details form.

Timeline may contain:

- requester messages
- Helpdesk notes/replies
- monitoring correlation
- asset changes relevant to the case
- recommendations
- execution summaries
- approvals
- SLA/business state changes
- linked work/procurement milestones

Do not dump database/audit/log events into the primary timeline.

Internal vs requester-visible communication must be visually and semantically distinct. `Reply to user` and `Internal note` are separate modes, not a tiny hidden privacy checkbox.

## 8.2 Context Panel

Context sections:

- User
- Asset
- Monitoring
- Network
- SLA
- Related

Keep context concise; allow opening the full entity only when deeper investigation is needed.

## 8.3 Diagnostics

`Diagnose` opens a drawer aggregating current evidence such as Agent connectivity, network status, monitoring signals, recent changes and previous related incidents. It does not create a new canonical workflow by itself.

## 8.4 Actions and recommendations

Recommendation presentation order:

```text
What action?
Why?
Expected outcome
Risk
Approval requirement
Target
```

Technical IDs and rule internals are behind `View evidence`.

## 8.5 Resolution

Resolve uses a compact drawer containing only missing decisions, e.g. resolution summary, outcome, optional root cause where canonical contract supports it, notify requester, optional knowledge suggestion.

Do not ask again for resolver, requester, asset, related alerts or timestamps the platform already owns.

If resolution is blocked by canonical prerequisites, present the actual blocking condition before submission.

---

# 9. Asset 360 and User 360

## 9.1 Asset 360

Asset 360 is an operational entity view, not a giant inventory form.

Header surfaces:

- identity/model
- current assignee/location
- Operational
- Health
- Agent
- important lifecycle/compliance context
- contextual actions

Keep these dimensions independent:

```text
Lifecycle
Operational
Health
Assignment
Warranty
Compliance
Risk
```

Default sections/tabs:

```text
Activity
Monitoring
Software
Maintenance
Lifecycle
Details
```

`Details` contains lower-frequency inventory fields grouped by identity, hardware, OS, network interfaces, acquisition and custom attributes.

Asset page needs a compact `Current attention` area for active alerts, open work, compliance, Agent or warranty issues.

## 9.2 User 360

User 360 is a Helpdesk operational profile, not an HR record.

Surface:

- active lifecycle/access summary
- department/location
- assigned assets
- open work
- access context relevant to support
- software/license context
- operational lifecycle impacts such as offboarding work

Do not expose unrelated HR/private fields.

---

# 10. Monitoring and Alerts

Monitoring must avoid raw-event overload.

Conceptual separation:

```text
Signal → Alert → Incident/Case
```

Do not create a Ticket/Incident for every signal.

Monitoring workspace default views:

```text
Overview
Active alerts
Assets impacted
History
```

Overview emphasizes:

- critical/warning alert counts
- impacted assets/users where known
- offline/degraded resources
- `Needs Action`
- recently recovered items

Alert investigation is impact-first:

- severity/title
- scope/location/network
- affected users/assets
- correlated signals
- first/latest observation
- related Incident/Case
- available canonical actions

If an Alert is already handled by an Incident and has no independent human responsibility, it should not remain as a duplicate Work Queue item.

Creating Incident from Alert must prefill known impact/context/signals instead of opening an empty form.

Recovered monitoring state does **not** automatically resolve the Incident unless canonical backend rules do so.

Raw metrics/payloads are behind Technical Evidence.

---

# 11. Automation and Action Center

Automation workspace is a control center for items requiring human decision, not the only place automation can be used. Recommendations also appear inline in Case/Asset/Monitoring where context exists.

Views:

```text
Overview
Needs review
Executions
Rules
History
```

Primary attention categories:

- conflict
- approval required
- execution `UNKNOWN`
- definite failure requiring response
- policy decision/review

Success/routine execution should not flood Work Queue.

## 11.1 `UNKNOWN`

`UNKNOWN` is a first-class state:

```text
Command dispatched
Acknowledgement missing / outcome cannot be safely determined
Automatic retry disabled
```

Never label it `Failed` or silently retry.

Late Agent evidence is attached/reconciled according to backend semantics; the frontend must not invent a new attempt or change canonical outcome by itself.

## 11.2 Conflict

Conflict UI explains the competing governed actions, why they conflict and the backend-provided available decisions. It does not auto-pick a winner unless canonical rules do so.

## 11.3 Rules

Rule management is permission-restricted and not the default Automation page. Human-readable rule purpose/conditions/action/safety appear before technical definition/revision detail.

---

# 12. Inventory and Procurement

Top-level navigation is only `Inventory` and `Procurement`, not every procurement record type.

## 12.1 Inventory

Default views:

```text
Overview
Available
Reserved
In transit
Low stock
Movements
```

Inventory is availability-first:

- item/asset class
- available quantity/assets
- warehouse
- reservation
- low-stock attention

When opened from Case replacement, source case/user/required asset class must carry forward automatically.

Replacement flow with stock:

```text
Case
→ Replace device
→ compatible inventory
→ Reserve
→ Pick
→ Handover
→ Assignment updated
```

Operator should not need to leave Case merely to see progress.

## 12.2 Procurement

Default views:

```text
Overview
Requests
Sourcing
Orders
Receiving
Invoices
Contracts
```

Lifecycle presentation:

```text
Need
→ Purchase Request
→ Approval
→ RFQ / sourcing
→ Quotation comparison
→ Purchase Order
→ Goods Receipt
→ Asset registration
→ Invoice matching
→ Contract/lifecycle
```

Do not assume every request uses every stage; render canonical reality.

Quotation comparison must compare commercial facts and **must not choose or label a winner by itself**.

Goods Receipt clearly displays ordered/received/remaining and serialized validation where applicable.

Invoice UI explains three-way match as:

```text
PO      — what was ordered
Receipt — what was received
Invoice — what supplier billed
```

Do not replace domain-specific exception actions with a generic `Resolve` button.

---

# 13. Self-Service Portal and Knowledge

Portal is mobile-first and deliberately simpler than operator UI.

Home entry:

```text
How can we help?
```

Common categories may include Computer, Network, Account, Software, Device and Other, subject to canonical request capabilities.

Guided intake principles:

- propose known primary asset
- prefill known location/user
- do not ask for Asset ID/hostname/IP when the system knows it
- do not ask users to choose ITSM Priority P1–P4
- ask human impact questions only when useful
- suggest relevant knowledge without blocking support submission

Known major issue behavior:

- when canonical incident/correlation data indicates an existing shared issue, offer the user a clear path to follow it;
- allow `My issue is different` rather than hard-blocking support;
- do not create duplicate requests unnecessarily.

User-facing status language is simplified (e.g. Received, Being worked on, Waiting for you, Scheduled, Resolved, Closed) while canonical states remain unchanged.

Portal request detail shows only requester-visible timeline entries. Never fetch a full internal Case and rely on CSS to hide internal notes; enforce visibility at the server/read-model boundary.

Knowledge:

- end-user articles
- internal Helpdesk articles/runbooks
- restricted content

Knowledge is optional assistance, not a barrier to filing support.

---

# 14. Reports, Governance and Admin

Boundaries:

```text
Operations  → What needs action now?
Reports     → What has happened over time?
Governance  → What policy/review/compliance work needs attention?
Audit       → Who did what, when, to which entity?
Admin       → How is the system configured?
```

## Reports

Report areas include Helpdesk/SLA, Assets/Agent coverage, Monitoring, Automation, Inventory, Procurement, Licenses/Lifecycle. Prefer a small number of meaningful line/bar/progress charts and textual values. Clicking a KPI/segment should drill into actual records where practical.

Do not create employee performance rankings from operational workload metrics unless separate governance explicitly defines it.

## Governance

Areas may include Reviews, Audit, Software Policy, License Compliance, Access governance, Contracts and Exceptions.

Do not invent a universal compliance score when canonical data does not define one.

## Admin

System configuration only:

```text
Organization
People & Identity
Roles & Permissions
Locations
Network
Agent Management
Software Catalog
Integrations
Notifications
Branding
System
```

Daily Ticket/Asset/Incident records do not move into Admin.

OIDC UI must not expose secrets. Local authorization remains canonical even when external identity exists.

---

# 15. Interaction Standards

## 15.1 Split views

Use list + preview for high-volume triage:

- Work Queue
- Active Alerts
- Automation Reviews

At smaller widths, preview becomes a drawer.

## 15.2 Drawers

Standard widths:

```text
Quick Preview    456px
Resolve          520px
Diagnose/Action  560px
Evidence         640px
```

Drawer structure:

```text
Header 64px
Scrollable body
Sticky footer ~72px
```

Avoid deeply nested overlays.

## 15.3 Loading / empty / error

Use section skeletons rather than full-screen spinners after app initialization.

Empty states explain both why the view is empty and the useful next action.

Partial dependency failure degrades only the affected area whenever the primary workflow can continue.

## 15.4 Notifications

Toast is for transient acknowledgement such as `Assigned to you`; important failures/outcomes remain visible in the relevant surface.

Requester notifications are limited to meaningful requester-facing changes, not internal assignment, monitoring heartbeats or rule evaluations.

---

# 16. Responsive and Accessibility

Operator:

```text
>=1440 full layout
1280 standard layout
~1024 collapsed sidebar / narrower context
768 tablet list + drawer
<768 simplified operator workflows only
```

The end-user portal is mobile-first.

Minimum accessibility baseline:

- WCAG AA contrast
- semantic HTML
- keyboard navigation
- visible focus
- status not color-only
- screen-reader labels/status announcements
- reduced-motion support
- real table semantics for actual tabular data

Critical alerts must never blink.

---

# 17. Canonical Read-Model / BFF Rule

The UI may need aggregation endpoints/read models so one screen does not issue many scattered requests.

Examples of allowed presentation projections:

```text
operations home projection
work queue projection
case workspace projection
asset workspace projection
monitoring workspace projection
automation review projection
self-service request projection
```

Rules:

1. A projection is **not** a new source of truth.
2. It may aggregate canonical data but must preserve domain ownership.
3. It must enforce tenant and authorization boundaries on the server side.
4. It may expose canonical `availableActions` / blockers / attention reasons so frontend does not reimplement business rules.
5. It must not return styling instructions such as `color: orange`; presentation mapping belongs to the frontend.
6. It must not invent canonical state transitions.

If the API needed by a screen does not exist, Phase 6 tasks may add a permission-aware read projection or adapter. Any proposed canonical mutation/domain-rule expansion must stop as `SCOPE_DEPENDENCY` or `SPEC_CONFLICT` rather than being silently invented.

---

# 18. Key End-to-End Flows

The implemented UI must preserve context across these journeys:

```text
User request
→ enrichment
→ Work Queue
→ Case
→ diagnosis
→ governed action
→ verification
→ resolution
→ requester confirmation
```

```text
Monitoring alert
→ impact/correlation
→ create/link Incident
→ Case
→ remediation
→ monitoring recovery
→ verification
```

```text
Device failure
→ Case
→ Replace device
→ Inventory
→ Reserve/Handover
→ Assignment
→ Resolve
```

```text
Device failure + no stock
→ Case
→ Procurement Request
→ RFQ/Quotation/PO
→ Goods Receipt
→ Asset registration
→ Reservation/Handover
```

```text
Unauthorized software
→ detection
→ Work Queue
→ policy context
→ approval/exception
→ controlled uninstall
→ verification
```

```text
Execution UNKNOWN
→ human review
→ evidence
→ investigate connectivity / create governed follow-up
# never automatic retry
```

---

# 19. Interaction Targets

These are UX targets, not backend rules:

```text
Open urgent assigned work from Home           1–2 interactions
Claim unassigned work                         1
Triage queue item                             1
Open full Case                                +1
Reply requester                               1–2
Add internal note                             1–2
Start diagnosis                               1
Run safe recommended action                   ~2
Resolve normal case                           <=2
Create Incident from Alert                    <=2
Reserve replacement from Case                 2–3
Start procurement when no stock               <=2
End user submit basic support request          ~4 major interactions
End user reply to Helpdesk                    1–2
```

Do not reduce high-consequence operations to one-click merely to meet these targets.

---

# 20. Visual Baseline for Core Vertical Slice

At 1440px operator width:

```text
Operations Home
- four 280×112 summary cards
- Needs Attention 744px
- Environment Health 408px

Work Queue
- list 700px
- gap 16px
- preview 452px
- row 76px

Case Workspace
- main work/timeline 800px
- gap 16px
- context 352px
```

Case composer is sticky at the bottom of the main work column. Entity header, timeline toolbar and context panel should remain usable during long scrolls.

---

# 21. Acceptance Standard

The UI is not complete merely because routes render.

A compliant implementation must demonstrate all of the following:

1. An operator can identify critical work immediately from Operations Home.
2. Work Queue supports rapid triage without page hopping.
3. Case Workspace exposes requester + asset + monitoring + SLA context without requiring separate pages for routine work.
4. Requester reply and internal note cannot be confused.
5. Alert → Incident/Case handoff preserves impact/context and avoids duplicate entry.
6. Recommendations explain Why / Risk / Approval before execution.
7. `UNKNOWN` is visibly different from `FAILED` and has no automatic retry path.
8. Asset replacement can begin from Case and preserve Case context.
9. Inventory → Procurement handoff does not ask for already-known context.
10. End-user portal never asks for ITSM internals such as priority/assignment group when unnecessary.
11. Internal events/notes are never exposed to requester read models.
12. Navigation/actions are permission-aware while backend remains enforcement authority.
13. Partial service failure does not unnecessarily collapse unrelated workspaces.
14. Keyboard/focus/accessibility baseline is functional.
15. Core views remain usable at 1280px desktop width and specified portal mobile width.
16. Shared status/action/component semantics are consistent across domains.

---

# 22. Implementation Authority

This document is the normative design source for Phase 6.

If Codex discovers an implementation constraint that would require changing a locked design rule or canonical backend semantic, it must report:

```text
SPEC_CONFLICT:
```

or:

```text
SCOPE_DEPENDENCY:
```

with the smallest proposed resolution. It must not silently redesign the product.
