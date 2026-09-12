# Procurement

Owner: Procurement. Feature: F-039. Workflow: WF-P01. Task: TASK-070.

Canonical data: Supplier master and Procurement Requests/lines. Supplier state
changes use the normative lifecycle command map in `domain/supplier.ts`; the
Procurement Request vertical slice creates `DRAFT` requests and submits them
with expected-version checks. Supplier profile and lifecycle changes share a
version and append-only history. Tax identifiers and banking references are
stored as protected fields and omitted from public DTOs and event/audit
snapshots.

Persistence and HTTP wiring are selected by the API composition root. The
module does not write another domain's tables. Requester verification is
delegated to Identity's application contract; source and organizational IDs
remain tenant-scoped references without cross-domain foreign keys.
