# DATABASE + STORAGE BOUNDARY SPEC
## IT Operations Hub — Persistence, Consistency, Retention, and Data Placement Standard

**Version:** 0.1  
**Status:** Foundation Draft  
**Parent:** `ERROR_RETRY_IDEMPOTENCY_STANDARD.md`  
**Depends on:**  
- `DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `API_COMMAND_CONTRACT_SPEC.md`
- `STATE_MACHINE_MASTER_SPEC.md`

**Purpose:** Define where each category of data lives, which storage system owns canonical state, transaction boundaries, strong vs eventual consistency, partitioning, retention, archival, search indexing, cache strategy, object storage usage, time-series storage, event broker responsibilities, backup/restore, and scaling boundaries.

---

# 1. Mục tiêu

Tài liệu này trả lời câu hỏi:

```text
Dữ liệu nào lưu ở đâu?
Dữ liệu nào là canonical?
Dữ liệu nào chỉ là projection?
Dữ liệu nào cần transaction mạnh?
Dữ liệu nào chấp nhận eventual consistency?
Dữ liệu nào cần time-series?
Dữ liệu nào nên ở object storage?
Dữ liệu nào được cache?
Dữ liệu nào cần search index?
Dữ liệu nào cần archive?
```

Mục tiêu:

- tránh biến một database thành nơi chứa mọi thứ;
- tránh duplicate source-of-truth;
- tránh lưu telemetry khối lượng lớn trong OLTP database;
- đảm bảo các workflow quan trọng có strong consistency;
- tách read model khỏi canonical write model;
- định nghĩa rõ retention / archive / backup;
- tránh search index trở thành nguồn dữ liệu chuẩn;
- tránh cache gây stale-write;
- hỗ trợ scale dần từ MVP đến enterprise;
- giữ kiến trúc implementation-agnostic nhưng đủ cụ thể để triển khai.

---

# 2. Logical Storage Layers

Recommended architecture:

```text
                         ┌──────────────────────┐
                         │   Application APIs   │
                         └──────────┬───────────┘
                                    │
                  ┌─────────────────┼──────────────────┐
                  │                 │                  │
          ┌───────▼───────┐ ┌──────▼───────┐ ┌───────▼────────┐
          │ Relational DB │ │ Search Index │ │ Cache / KV     │
          │ Canonical OLTP│ │ Read/Search  │ │ Ephemeral      │
          └───────┬───────┘ └──────────────┘ └────────────────┘
                  │
       ┌──────────┼───────────┐
       │          │           │
┌──────▼─────┐ ┌──▼────────┐ ┌▼────────────────┐
│ Event Bus  │ │ Object    │ │ Time-Series /   │
│            │ │ Storage   │ │ Observability    │
└────────────┘ └───────────┘ └─────────────────┘
```

---

# 3. Recommended Technology Classes

Logical classes:

```text
Relational OLTP:
PostgreSQL or equivalent

Search:
OpenSearch / Elasticsearch / Meilisearch / equivalent

Cache / Distributed KV:
Redis / Valkey / equivalent

Event Broker:
Kafka / NATS / RabbitMQ / equivalent

Object Storage:
S3-compatible / MinIO / cloud object storage

Time-Series:
Prometheus-compatible TSDB / ClickHouse / VictoriaMetrics / Timescale / equivalent
```

This spec does not force a specific product.

---

# 4. Storage Ownership Principle

Mỗi dữ liệu phải thuộc một trong các nhóm:

```text
CANONICAL
DERIVED
CACHE
OBSERVATION
BINARY
EVENT
ARCHIVE
```

---

# 5. Canonical Data

Canonical data là:

```text
business truth
transactional
owned by one domain
```

Examples:

```text
User
Asset
Assignment
Ticket
Incident
Approval
PO
Invoice
Contract
License Entitlement
```

Primary storage:

```text
Relational OLTP
```

---

# 6. Derived Data

Derived data:

```text
read models
search documents
metrics
attention views
workspace projections
```

Can be rebuilt from canonical state/events.

Examples:

```text
Asset Workspace projection
Operations Overview
Search index
License Compliance summary
Service Health view
```

---

# 7. Cache Data

Cache:

```text
non-authoritative
short-lived
rebuildable
```

Examples:

```text
authorization decision cache
lookup cache
session metadata
hot dashboard fragments
short-lived workflow context
```

---

# 8. Observation Data

Observation data:

```text
what external/telemetry source observed
```

Examples:

```text
CPU usage
Agent heartbeat
Network discovery
IP/MAC observation
Software inventory snapshot
```

Observation must not automatically overwrite canonical state.

---

# 9. Binary Data

Binary data:

```text
PDF
photo
artifact package
scan report
invoice file
certificate
attachment
```

Primary storage:

```text
Object Storage
```

Metadata lives in relational DB.

---

# 10. Event Data

Event data:

```text
Domain Events
Integration Events
Audit Events
Outbox/Inbox
```

Primary roles:

```text
Event Broker
+
Relational event/audit tables
+
Archive if required
```

---

# 11. Relational OLTP Boundary

Store in relational DB:

```text
users
roles
role_bindings

assets
assignments
movements
locations

tickets
incidents
problems
changes

maintenance
warranty
replacement
retirement

audit definitions/exceptions

software catalog
license entitlement

procurement
supplier
PO
invoice
contract

approval
SLA
automation definitions

work items

document metadata

outbox/inbox
audit metadata
```

---

# 12. Do Not Store in Core OLTP at High Volume

Avoid storing raw high-frequency:

```text
CPU every 10s
memory every 10s
network latency samples
packet loss samples
every agent heartbeat
every switch MAC poll
every discovery raw payload
```

in main transactional DB.

---

# 13. OLTP Transaction Requirements

Strong local transaction required for operations such as:

```text
Asset Assignment
Asset Return
Reservation
License Assignment
Invoice Creation
PO Version Update
Approval Decision
State Transition
```

---

# 14. Strong Consistency Matrix

| Operation | Strong Consistency |
|---|---|
| One active primary assignment per asset | Required |
| Reservation conflict | Required |
| License hard-cap allocation | Required |
| Duplicate invoice prevention | Required |
| Approval decision | Required |
| PO amendment/version | Required |
| Asset lifecycle transition | Required |
| Ticket assignment | Preferred |
| Search result | Not required |
| Dashboard metrics | Not required |
| Notification delivery | Not required |

---

# 15. Eventual Consistency Matrix

Acceptable for:

```text
Search index
Asset Workspace projection
Dashboard
KPI
Notification
Global timeline
Status page
Analytics
```

---

# 16. Canonical vs Projection Rule

Example:

```text
Asset canonical current owner
```

must come from:

```text
Asset/Assignment domain
```

Asset Workspace may cache/project it.

If projection differs:

```text
canonical wins
```

---

# 17. Database Deployment Models

## MVP

```text
One PostgreSQL cluster
Multiple logical schemas
```

Example:

```text
identity
asset
helpdesk
incident
maintenance
network
software
procurement
control
```

## Scale-up

```text
same cluster
separate databases/schemas
```

## Enterprise

```text
domain-owned databases
```

only when scaling/ownership requires.

---

# 18. Recommended MVP Strategy

Do not start with database-per-microservice if team size does not justify it.

Preferred initial:

```text
PostgreSQL
+
schema-per-domain
+
strict application ownership
```

Benefits:

```text
simple operations
local transactions
easier migrations
lower infrastructure cost
```

---

# 19. Logical Ownership Even in Shared DB

Even if same PostgreSQL:

```text
asset-service
```

owns:

```text
asset.*
```

Other services must not directly mutate those tables.

---

# 20. Cross-Domain SQL Reads

For MVP:

```text
read-only joins may be temporarily acceptable
```

but preferred long-term:

```text
read model
API
projection
```

Writes across domains remain prohibited.

---

# 21. Schema Naming

Recommended:

```text
identity.*
asset.*
helpdesk.*
incident.*
problem_change.*
maintenance.*
audit.*
network.*
software.*
license.*
procurement.*
contract.*
communication.*
control.*
reporting.*
platform.*
```

---

# 22. Common Platform Tables

`platform` schema can contain:

```text
outbox_events
inbox_events
idempotency_records
operation_registry
integration_maps
```

Use carefully to avoid central coupling.

---

# 23. Object Storage Boundary

Use object storage for:

```text
Documents
Attachments
Invoices
Contracts
Photos
Audit Evidence
Data Wipe Evidence
Artifact Packages
Generated Reports
Exports
```

---

# 24. Object Metadata

Relational metadata:

```yaml
object_metadata:
  id:
  object_key:
  bucket:
  checksum_sha256:
  size_bytes:
  mime_type:
  created_at:
  retention_class:
  encryption_state:
```

---

# 25. Object Storage Naming

Do not use user filenames as canonical object key.

Example:

```text
tenant/org/document/{document_id}/{version_id}
```

Filename stored as metadata.

---

# 26. Object Immutability

For:

```text
signed documents
invoice originals
audit evidence
wipe certificate
artifact version
```

object content should be immutable.

New version:

```text
new object key
```

---

# 27. Object Integrity

Every important object:

```text
checksum
```

Prefer:

```text
SHA-256
```

Verify on:

```text
upload
download where needed
artifact execution
archive restore
```

---

# 28. Large File Upload

Flow:

```text
API creates upload session
↓
Client uploads directly to object storage
↓
Storage completes
↓
API validates checksum/size
↓
Document version activated
```

---

# 29. Malware Scanning Boundary

New uploaded file:

```text
QUARANTINE
↓
Scan
↓
SAFE / BLOCKED
```

Do not expose unsafe attachment before scan.

---

# 30. Artifact Repository Boundary

Software artifact binaries:

```text
Object Storage
```

Metadata:

```text
Relational DB
```

Security scan report:

```text
Object Storage + indexed metadata
```

---

# 31. Time-Series Storage Boundary

Use for:

```text
CPU
Memory
Disk
Temperature
Latency
Packet Loss
Availability Samples
Agent Heartbeats
Interface Metrics
```

---

# 32. Time-Series Retention

Example tiers:

```text
Raw high resolution: 7–30d
Downsampled: 90–180d
Aggregated: 1–3y
```

Configurable.

---

# 33. Downsampling

Example:

```text
10s samples
→ 1m aggregate
→ 1h aggregate
```

Retain:

```text
min
max
avg
p95
count
```

where useful.

---

# 34. Operational State Projection

Do not query raw TSDB for every asset list row.

Maintain:

```text
asset_current_health
agent_last_seen
service_current_health
```

as current-state projections.

---

# 35. Monitoring Event Boundary

Raw metrics:

```text
TSDB
```

Threshold/anomaly event:

```text
Event Bus
```

Operational incident:

```text
Relational DB
```

---

# 36. Network Observation Storage

High-volume raw discovery:

```text
Observation Store / Time-Series / Columnar
```

Current network mapping projection:

```text
Relational/read model
```

Canonical expected network config:

```text
Relational DB
```

---

# 37. Software Inventory Storage

Latest normalized software inventory:

```text
Relational projection
```

Store report metadata and normalized inventory observations append-only in
Software-owned relational tables. Keep the latest present/removed installation
projection tenant-scoped. Do not treat an incomplete inventory report as proof
that software is absent. Historical archival may later move to compressed
observation storage without changing Software's canonical current projection.

Historical scan snapshots:

```text
Compressed observation storage / columnar / object archive
```

---

# 38. Search Index Boundary

Index:

```text
Asset Code
Asset Tag
Serial
Hostname
User
Email
Ticket
Incident
PO
Invoice
Contract
Software
IP
MAC
Knowledge
```

---

# 39. Search Is Not Canonical

Never use search index to:

```text
verify invoice uniqueness
approve command
validate current asset owner
perform lifecycle transition
```

---

# 40. Search Document Example

```yaml
search_document:
  type: ASSET
  id:
  display_code:
  title:
  aliases:
  tags:
  searchable_text:
  site_id:
  state:
  updated_at:
```

---

# 41. Search Projection Update

Canonical transaction:

```text
DB commit
↓
Domain Event
↓
Search Indexer
```

If search index fails:

```text
business transaction remains committed
```

---

# 42. Search Rebuild

Must support:

```text
full rebuild
```

from canonical database/event stream.

---

# 43. Cache Boundary

Good cache targets:

```text
static lookup tables
permission evaluation
session metadata
rate limits
short-lived search suggestions
reference data
```

---

# 44. Cache Must Not Own Business State

Do not store only in cache:

```text
approval decision
assignment
invoice
ticket state
license allocation
```

---

# 45. Cache Invalidation

Triggers:

```text
role change
user suspension
asset update
scope change
policy update
```

Event-driven invalidation recommended.

---

# 46. Cache TTL

Use TTL even with explicit invalidation.

Examples:

```text
Authorization cache: minutes
Reference lookup: 5–30m
Dashboard fragments: seconds/minutes
```

---

# 47. Distributed Lock Usage

Use sparingly.

Prefer:

```text
DB unique constraint
optimistic concurrency
queue partitioning
```

Distributed lock only where truly necessary.

---

# 48. Redis Lock Guardrail

Do not use Redis lock as sole guarantee for:

```text
financial uniqueness
one active assignment
license hard cap
```

Database invariant still required.

---

# 49. Event Broker Boundary

Event Broker handles:

```text
Domain Events
Integration Events
Projection Updates
Async Workflow Signals
```

Do not use event broker as permanent business database.

---

# 50. Broker Delivery Semantics

Assume:

```text
at-least-once
```

Consumer:

```text
Inbox
Idempotency
```

---

# 51. Broker Retention

Example:

```text
Domain event topics: 7–30d+
Audit stream: longer where needed
High-volume observation event: shorter
```

Long-term business history should not depend solely on broker retention.

---

# 52. Event Archive

For important domain events:

```text
append-only event table
or
object archive
```

may preserve beyond broker TTL.

---

# 53. Audit Storage Boundary

Audit logs require:

```text
append-only semantics
tamper resistance
long retention
restricted access
```

Primary:

```text
Relational append-only
```

Optional:

```text
immutable object archive
```

---

# 54. Audit vs Operational Logs

Audit:

```text
business/security evidence
```

Operational logs:

```text
debugging/observability
```

Do not mix retention/access policies.

---

# 55. Application Log Storage

Application logs belong in:

```text
log aggregation platform
```

Examples:

```text
Loki
OpenSearch
Elastic
```

not business relational tables.

---

# 56. Tracing Storage

Distributed traces:

```text
Tempo
Jaeger
OpenTelemetry backend
```

separate from business data.

---

# 57. Metrics Storage

Service/platform metrics:

```text
Prometheus-compatible TSDB
```

Business KPI:

```text
Reporting store / relational/columnar
```

---

# 58. Reporting Storage

For moderate scale:

```text
PostgreSQL read replica / materialized views
```

At larger scale:

```text
analytics/columnar warehouse
```

Examples:

```text
ClickHouse
BigQuery
Snowflake
Redshift
```

implementation-dependent.

---

# 59. Reporting Must Not Load OLTP Excessively

Heavy reports should use:

```text
read replica
materialized view
analytics store
```

not large live joins on production write path.

---

# 60. Read Replica Usage

Good for:

```text
reporting
large exports
historical queries
```

Not for:

```text
critical command validation
```

because replica may lag.

---

# 61. Replica Lag Awareness

Read response may include:

```text
data_as_of
replica_lag
freshness
```

---

# 62. Materialized Views

Good candidates:

```text
asset_current_summary
license_compliance_summary
operations_attention
daily_sla_metrics
vendor_performance
```

---

# 63. Read Model Rebuildability

Every derived read model should answer:

```text
Can we rebuild it?
From which sources?
How long will it take?
```

---

# 64. Data Retention Classes

Recommended:

```text
EPHEMERAL
SHORT
STANDARD
LONG
REGULATED
IMMUTABLE
```

---

# 65. Example Retention Mapping

| Data | Class |
|---|---|
| Cache | EPHEMERAL |
| Raw telemetry | SHORT |
| Operational logs | SHORT/STANDARD |
| Ticket | LONG |
| Asset history | LONG |
| Audit trail | REGULATED |
| Financial document | REGULATED |
| Signed document | IMMUTABLE |
| Artifact package | LONG/IMMUTABLE |
| Search index | Rebuildable |

---

# 66. Archive Principle

Archive when:

```text
rarely accessed
large
must retain
```

Move to cheaper storage while preserving index/reference.

---

# 67. Archive Candidates

```text
old audit events
old tickets
closed incidents
old network observations
old metric snapshots
document versions
historical inventory snapshots
```

---

# 68. Archive Pointer

Relational record may keep:

```yaml
archive_reference:
  storage_class:
  object_key:
  checksum:
  archived_at:
```

---

# 69. Restore from Archive

Restore flow:

```text
Request
→ Authorization
→ Retrieve Object
→ Verify Checksum
→ Temporary Restore
→ Audit Access
```

---

# 70. Backup Strategy

Relational DB:

```text
full backup
incremental/WAL
point-in-time recovery
```

Object Storage:

```text
versioning
replication
lifecycle policy
```

Search:

```text
snapshot optional
or rebuild
```

Cache:

```text
usually rebuildable
```

---

# 71. RPO / RTO Classes

Suggested:

```text
TIER_0
TIER_1
TIER_2
TIER_3
```

---

# 72. Tier Examples

## TIER_0

```text
Identity authorization
Asset assignment
Incident
Approval
```

Low RPO / low RTO.

## TIER_1

```text
Tickets
Maintenance
Procurement
```

## TIER_2

```text
Search
Reporting
Timeline projection
```

## TIER_3

```text
Cache
rebuildable analytics
```

---

# 73. Backup Restore Testing

Backups are incomplete without restore tests.

Test:

```text
DB restore
point-in-time recovery
object restore
cross-reference integrity
```

---

# 74. Database Migration Strategy

Use migration tooling with:

```text
version
checksum
forward migration
compatibility window
```

---

# 75. Zero/Low Downtime Migration

Preferred pattern:

```text
Expand
→ Deploy compatible code
→ Backfill
→ Switch reads/writes
→ Contract
```

---

# 76. Schema Migration Guardrail

Do not:

```text
drop column immediately
rename required field in-place
block large table with long migration
```

without staged rollout.

---

# 77. Partitioning Strategy

Large tables candidates:

```text
audit_events
domain_events
network_observations
metric_snapshots
notification_deliveries
application audit logs
```

Partition by:

```text
time
tenant
or both
```

---

# 78. Time Partitioning

Example:

```text
monthly partitions
```

Useful for:

```text
retention
archive
vacuum
query pruning
```

---

# 79. Tenant Partitioning

For large multi-tenant deployment:

```text
tenant hash/list partition
```

may be useful.

Do not over-partition early.

---

# 80. Table Growth Management

Monitor:

```text
rows/day
GB/day
index growth
vacuum
dead tuples
partition count
```

---

# 81. Index Strategy

Indexes should follow real query patterns.

Examples:

```text
work_items(state, owner_team_id, due_at)
tickets(state, team_id, priority)
assets(current_location_id, lifecycle_state)
audit_events(entity_type, entity_id, timestamp)
```

---

# 82. Avoid Over-indexing

Too many indexes:

```text
slow writes
more storage
more maintenance
```

Review unused indexes.

---

# 83. Full Text Search Boundary

Do not implement heavy global full-text across dozens of tables in OLTP if dedicated search exists.

---

# 84. JSON Storage Boundary

Use JSON for:

```text
snapshots
rule definitions
external raw metadata
flexible technical attributes
```

Avoid JSON for:

```text
core relationships
state
owner
amount
site
permission
```

---

# 85. EAV Guardrail

Avoid generic Entity-Attribute-Value for core asset data.

Use:

```text
typed columns
model/spec JSON for flexible attributes
```

EAV only for truly dynamic extension fields if needed.

---

# 86. Custom Fields

Recommended:

```text
custom_field_definition
custom_field_value
```

scoped by entity type.

Custom fields must not replace core canonical fields.

---

# 87. Multi-Tenancy Storage Models

Options:

```text
Shared DB + tenant_id
Schema per tenant
Database per tenant
```

---

# 88. Recommended Starting Multi-Tenant Model

If needed:

```text
Shared DB
+
tenant_id
+
row-level authorization
+
scoped unique indexes
```

---

# 89. Tenant Unique Constraints

Example:

```text
UNIQUE(tenant_id, asset_code)
UNIQUE(tenant_id, ticket_code)
UNIQUE(tenant_id, supplier_id, invoice_number)
```

---

# 90. Database Row-Level Security

Optional defense-in-depth:

```text
PostgreSQL RLS
```

for tenant isolation.

Application authorization still required.

---

# 91. Encryption at Rest

Required for:

```text
relational storage
object storage
backup
```

---

# 92. Encryption in Transit

Required:

```text
TLS
```

for:

```text
DB
broker
object storage
search
cache
service-to-service
```

---

# 93. Field-Level Encryption

Consider for:

```text
sensitive integration secrets
sensitive identity fields
regulated data
```

But secrets should normally live in Secret Manager.

---

# 94. Secret Storage Boundary

Secrets belong in:

```text
Vault / KMS / Secret Manager
```

DB stores:

```text
secret_ref
```

not raw credential.

---

# 95. Search Security

Search documents must include access/filter fields:

```text
tenant_id
site_id
department_id
visibility
```

Search results still require authorization validation.

---

# 96. Search Result Leakage Guardrail

Do not index secret/sensitive fields unless necessary.

Search snippets must respect permissions.

---

# 97. Object Access Security

Use:

```text
short-lived signed URLs
```

or authenticated proxy.

Do not expose permanent public URLs for confidential documents.

---

# 98. Signed URL Expiry

Short enough for risk.

Example:

```text
5–15 minutes
```

configurable.

---

# 99. Data Lineage

Important derived values should record:

```text
source
source_timestamp
calculation_version
```

Examples:

```text
health score
replacement score
license compliance
KPI
```

---

# 100. Current-State Projection Freshness

Projection should expose:

```text
updated_at
source_version
freshness_state
```

---

# 101. Freshness States

```text
CURRENT
STALE
DEGRADED
UNKNOWN
```

---

# 102. Projection Lag Monitoring

Metrics:

```text
consumer lag
last applied event
projection age
rebuild status
```

---

# 103. Data Synchronization with External Systems

Use:

```text
integration map
sync cursor
source timestamp
sync status
```

---

# 104. Sync Conflict Storage

Store:

```yaml
sync_conflict:
  entity_type:
  entity_id:
  field:
  canonical_value:
  incoming_value:
  source:
  detected_at:
  resolution:
```

---

# 105. External Raw Payload

Raw external payload may be stored:

```text
temporarily
```

for debugging/audit.

Retention should be limited and sensitive data minimized.

---

# 106. Import Staging Area

Bulk import:

```text
staging table
```

then:

```text
validate
normalize
dedupe
commit canonical
```

Do not insert raw CSV rows directly into canonical tables.

---

# 107. Data Reconciliation Store

Useful for:

```text
Network Discovery
Identity Sync
License SaaS Sync
ERP Sync
```

Keep:

```text
expected
observed
decision
```

---

# 108. Warehouse Stock Storage

Serialized assets:

```text
Asset records
```

Consumable/non-serialized inventory may use:

```text
stock_item
stock_balance
stock_transaction
```

Do not model every consumable as Asset unless needed.

---

# 109. Ledger Pattern

Use append-only ledger for:

```text
stock movement
license consumption where appropriate
financial-like allocation
```

Current balance:

```text
projection
```

---

# 110. Stock Balance Consistency

Update balance with:

```text
transactional ledger entry
```

Avoid manual direct balance edit.

---

# 111. License Capacity Storage

For hard-cap licenses:

```text
entitlement quantity
active assignments
reservation
```

Need transaction/locking strategy.

---

# 112. License Allocation Constraint

Possible implementation:

```text
serializable transaction
advisory lock
allocation counter
```

depending scale.

---

# 113. Invoice Duplicate Constraint

Must exist at DB level:

```text
UNIQUE(tenant_id, supplier_id, invoice_number)
```

---

# 114. Assignment Constraint

For one-primary-assignment asset:

```text
partial unique index
```

Example:

```text
UNIQUE(asset_id)
WHERE state IN ('ASSIGNED','PENDING_RETURN')
AND assignment_type='PRIMARY'
```

---

# 115. Reservation Constraint

Prevent simultaneous active reservation via:

```text
unique active reservation
```

or transactional check.

---

# 116. Outbox Storage

`outbox_events` belongs in same DB transaction as domain mutation.

Partition/cleanup after publish based on retention policy.

---

# 117. Inbox Storage

Consumer inbox may use:

```text
consumer-local DB
```

preferred.

Not one central global inbox unless architecture requires.

---

# 118. Idempotency Storage

Prefer near owning service/API boundary.

High-risk/business keys may require durable DB storage.

---

# 119. Operation Registry

Long-running operations:

```text
operation_registry
```

Relational state:

```text
QUEUED
RUNNING
WAITING
SUCCEEDED
FAILED
```

Detailed logs can go elsewhere.

---

# 120. Scheduler Storage

Durable schedules:

```text
retry
workflow wake-up
SLA threshold
approval timeout
```

must persist in durable store.

Do not rely on in-memory timers.

---

# 121. Event Sourcing Boundary

Full event sourcing is not required.

Recommended:

```text
state-based relational model
+
append-only domain events
```

Use event sourcing only where justified.

---

# 122. Why Not Full Event Sourcing Everywhere

Because it increases:

```text
operational complexity
schema evolution complexity
debugging burden
projection dependencies
```

without enough benefit for every domain.

---

# 123. Audit Event Immutability

Audit event should not be updated in place.

Correction:

```text
new audit event
```

---

# 124. Financial Data Integrity

Commercial data such as:

```text
PO
Invoice
Contract
```

must preserve:

```text
version
original values
amendments
approvals
```

No destructive overwrites.

---

# 125. Document Version Integrity

Signed version:

```text
immutable
```

New change:

```text
new version
```

---

# 126. Knowledge Storage

Knowledge article content:

```text
Relational metadata
+
text/content store
+
search index
```

Version history required.

---

# 127. Knowledge Search

Search index supports:

```text
title
body
tags
service
symptoms
```

Canonical article content remains outside search index.

---

# 128. Reporting Data Mart

At larger scale, create data mart:

```text
fact_ticket
fact_incident
fact_asset_state
fact_maintenance
fact_license_usage
fact_procurement
```

Dimensions:

```text
time
site
department
service
asset_type
vendor
```

---

# 129. Slowly Changing Dimensions

For historical reporting:

```text
department
manager
site
asset model
```

may require SCD strategy.

---

# 130. Historical KPI Integrity

Report should answer:

```text
what was true then?
```

not recompute all past results using current dimension values blindly.

---

# 131. Export Storage

Large report/export:

```text
object storage
```

with:

```text
expiry
access control
download audit
```

---

# 132. Export Expiry

Generated exports should auto-expire.

Example:

```text
24h
7d
```

depending sensitivity.

---

# 133. Data Residency

If needed, organization/tenant may define:

```text
allowed region
backup region
object region
```

Architecture should leave room for this.

---

# 134. Disaster Recovery

Critical stores require:

```text
replication
backup
restore procedure
runbook
```

---

# 135. DR Dependency Order

Recommended restore order:

```text
1. Identity/Auth dependencies
2. Relational canonical DB
3. Event Broker / Outbox publishing
4. Object Storage
5. Workflow/Scheduler
6. Search
7. Reporting
8. Cache
```

---

# 136. Rebuildable vs Non-Rebuildable

## Non-rebuildable / critical

```text
canonical relational data
signed document originals
financial records
audit records
```

## Rebuildable

```text
search index
cache
many read models
dashboard projections
```

---

# 137. Restore Verification

After restore verify:

```text
foreign key integrity
outbox/inbox state
event lag
document checksum
search rebuild
scheduler timers
```

---

# 138. Data Deletion

Deletion must respect:

```text
retention
legal/compliance
audit
financial rules
```

Core asset/ticket/history usually archived rather than deleted.

---

# 139. User Privacy Deletion

Where legally/policy required:

```text
anonymize personal fields
```

while preserving audit/business integrity where allowed.

---

# 140. Referential Anonymization

Example:

```text
terminated user display_name
```

may be anonymized while keeping:

```text
immutable user surrogate ID
```

for historical relation.

---

# 141. Storage Cost Tiers

Possible:

```text
HOT
WARM
COLD
ARCHIVE
```

---

# 142. Hot Data

Examples:

```text
open tickets
active incidents
current assets
recent observations
```

---

# 143. Warm Data

Examples:

```text
closed tickets last 12m
historical maintenance
recent audit history
```

---

# 144. Cold Data

Examples:

```text
old telemetry
old audit evidence
old reports
```

---

# 145. Storage Capacity Planning

Track:

```text
DB growth/day
TSDB ingestion rate
Object GB/month
Search index size
Broker throughput
Cache memory
```

---

# 146. Capacity Forecast

Forecast:

```text
30d
90d
1y
```

based on actual ingestion.

---

# 147. High-Cardinality Guardrail

Avoid excessive label cardinality in TSDB.

Bad:

```text
ticket_id as Prometheus label
user_id as metric label
```

Use logs/analytics instead.

---

# 148. Search Index Cardinality

Ensure shard/index strategy reflects:

```text
tenant
data volume
document type
```

Do not create one index per tiny tenant by default.

---

# 149. Broker Topic Explosion Guardrail

Avoid:

```text
topic per asset
topic per user
```

Use logical domain topics and partition keys.

---

# 150. Database Connection Management

Use:

```text
connection pooling
```

Set:

```text
max pool
timeouts
```

Avoid every microservice opening excessive connections.

---

# 151. Read/Write Separation

At scale:

```text
primary for writes
replica for read-heavy reporting
```

Command validation always uses authoritative source.

---

# 152. Query Timeout

Set statement/query timeout for:

```text
interactive API
reporting
background jobs
```

Different workloads should have different limits.

---

# 153. Workload Isolation

Separate pools/queues for:

```text
interactive OLTP
reporting
imports
maintenance jobs
```

---

# 154. Vacuum / Maintenance

For PostgreSQL-like systems monitor:

```text
autovacuum
bloat
long transactions
dead tuples
index health
```

---

# 155. Long Transaction Guardrail

Avoid long-running DB transactions around:

```text
external API calls
human approval
agent job
network change
```

Use workflow state instead.

---

# 156. Cross-Service Transaction Guardrail

Do not use distributed XA transaction for normal workflows.

Use:

```text
local transaction
events
saga
compensation
```

---

# 157. Transactional Boundary Example — Asset Assignment

Within Asset domain:

```text
assignment
reservation close
asset current owner
movement
outbox
```

same local transaction.

Outside:

```text
notification
document generation
search
reporting
```

async.

---

# 158. Transactional Boundary Example — Procurement Receipt

Local:

```text
goods receipt
receipt lines
received serials
outbox
```

Asset creation may be:

```text
same domain/local transaction
```

or async if separate service, depending deployment.

---

# 159. Transactional Boundary Example — Invoice

Local:

```text
invoice
invoice lines
duplicate constraint
match state
outbox
```

External ERP payment state:

```text
eventual sync
```

---

# 160. Data Consistency Checker

Periodic consistency checks:

```text
assignment vs asset current owner
license assignment vs entitlement
PO received quantities
disposed asset vs active agent
terminated user vs role binding
document metadata vs object existence
```

---

# 161. Orphan Detection

Detect:

```text
document metadata without object
object without metadata
assignment without asset
search doc without canonical record
stale projection
```

---

# 162. Repair Strategy

Derived data:

```text
rebuild
```

Canonical data:

```text
controlled correction workflow
```

---

# 163. Storage Health Monitoring

Monitor:

```text
DB availability
replica lag
broker lag
object errors
search health
cache hit rate
TSDB ingestion delay
disk usage
partition growth
backup status
```

---

# 164. Storage Work Queue

Actionable issues:

```text
backup failed
replica lag critical
search index stale
object corruption
broker DLQ growth
partition nearing capacity
```

create Work Item.

---

# 165. MVP Storage Architecture

Recommended:

```text
PostgreSQL
Redis/Valkey
S3-compatible Object Storage
Prometheus-compatible TSDB
Search engine optional initially
Event Broker
```

---

# 166. MVP Simplification

Can initially keep:

```text
search
read projections
reporting
```

in PostgreSQL if scale is modest.

But contracts should preserve future separation.

---

# 167. MVP PostgreSQL Domains

Suggested schemas:

```text
identity
asset
helpdesk
incident
maintenance
control
communication
platform
```

Add others incrementally.

---

# 168. Phase 2 Storage

Add:

```text
dedicated search
network observation store
software inventory history store
analytics read replica
```

---

# 169. Phase 3 Storage

Add when justified:

```text
analytics warehouse
separate domain databases
multi-region DR
large-scale event archive
cold storage lifecycle
```

---

# 170. Storage Decision Checklist

Before choosing a store for data:

```text
Is it canonical?
Does it require transaction?
How often written?
How often queried?
How much volume?
Is full-text search needed?
Is time-range aggregation needed?
Is binary?
Can it be rebuilt?
What retention?
What RPO/RTO?
What security class?
```

---

# 171. Storage Boundary Quick Matrix

| Data | Primary Store | Canonical? |
|---|---|---:|
| Asset | Relational | Yes |
| Ticket | Relational | Yes |
| Assignment | Relational | Yes |
| Monitoring Metrics | TSDB | Observation |
| Agent Heartbeat | TSDB / current projection | Observation |
| Network Raw Discovery | Observation/Columnar | Observation |
| Current Network Mapping | Relational projection | Derived |
| Documents | Object Storage | Binary canonical |
| Document Metadata | Relational | Yes |
| Artifact Binary | Object Storage | Yes |
| Search Document | Search Index | No |
| Dashboard KPI | Reporting store | Derived |
| Cache | Redis/KV | No |
| Domain Events | Broker + archive | Event |
| Audit Events | Append-only relational/archive | Yes |
| Application Logs | Log backend | No |
| Traces | Trace backend | No |

---

# 172. Guardrails

System must not:

1. Use search index as source-of-truth.
2. Use cache as source-of-truth.
3. Store high-frequency telemetry in core OLTP by default.
4. Store large binaries directly in main relational tables.
5. Allow read replica to validate irreversible commands.
6. Create cross-domain distributed DB transactions for normal workflows.
7. Allow other domains to write another domain's tables directly.
8. Keep critical timers only in memory.
9. Keep business history only in broker retention.
10. Hard-delete regulated/signed/financial history casually.
11. Store raw secrets in relational DB when secret manager is available.
12. Let object storage file replace immutable signed version in-place.
13. Let stale projection overwrite canonical state.
14. Over-partition/over-shard prematurely.
15. Make every read query hit every service synchronously.
16. Run heavy reporting directly on OLTP write path without limits.
17. Treat backup as valid without restore testing.
18. Keep raw imported data indefinitely without retention policy.
19. Let derived inconsistency be "fixed" by manually editing projection.
20. Add a new storage technology without clear workload justification.

---

# 173. Recommended Next Spec

Sau Database + Storage Boundary, tài liệu tiếp theo nên là:

```text
SEARCH + INDEXING SPEC
```

để chuẩn hóa:

```text
global search
entity indexing
autocomplete
filtering
ranking
RBAC-aware search
IP/MAC/serial lookup
fuzzy matching
duplicate detection
index freshness
reindex
search observability
```

---

# 174. Definition of Done

Database + Storage Boundary Spec đạt yêu cầu khi:

- Canonical vs derived vs cache vs observation được phân biệt.
- Relational OLTP boundary rõ.
- Object Storage boundary rõ.
- Time-Series boundary rõ.
- Search boundary rõ.
- Cache boundary rõ.
- Event Broker boundary rõ.
- Strong vs eventual consistency có matrix.
- MVP shared-DB strategy và scale-out path rõ.
- Transaction boundaries được định nghĩa.
- Backup/RPO/RTO/restore principle rõ.
- Retention/archive/storage tiering rõ.
- Partition/index/read-replica guidance rõ.
- Multi-tenancy/isolation/encryption guidance rõ.
- Projection freshness và rebuild strategy rõ.
- High-volume observation data không làm nghẽn OLTP.
- Storage guardrails chống over-engineering và data ownership violation được khóa.
