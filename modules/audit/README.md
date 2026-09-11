# audit

Owner: Audit/Platform. Feature: FOUNDATION; Workflow: PLATFORM-BOOTSTRAP; Task: TASK-000.

Purpose: append-only audit evidence, separate from operator timeline.

Entities: Audit record, relation, evidence link.

Tables: `audit` schema — audit_events, audit_event_relations, audit_evidence_links.

Commands: no public business command. AuditPort.append binds to the caller transaction; unique record ID prevents duplicates.

Queries: no module HTTP routes in TASK-000.

Events produced/consumed: none; no business facts are fabricated.

Permissions: audit.read. Registration does not grant access.

Dependencies: domain-neutral packages and local module layers. Other modules use public application contracts; only composition roots select infrastructure adapters.

Runbook: [foundation ownership](../../docs/runbooks/task000-foundations.md).
