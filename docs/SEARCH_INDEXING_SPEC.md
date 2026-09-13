# SEARCH + INDEXING SPEC
## IT Operations Hub — Global Search, Entity Discovery, Ranking, and Index Governance

**Version:** 0.1  
**Status:** Foundation Draft  
**Parent:** `DATABASE_STORAGE_BOUNDARY_SPEC.md`  
**Depends on:**  
- `DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `API_COMMAND_CONTRACT_SPEC.md`
- `PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `REPORTING_KPI_OPERATIONS_OVERVIEW_WORK_QUEUE_WORKFLOW.md`

**Purpose:** Define global search, entity indexing, exact and fuzzy lookup, ranking, filtering, autocomplete, IP/MAC/serial search, duplicate detection, RBAC-aware result filtering, index freshness, reindexing, search projections, observability, and fallback behavior.

---

# 1. Mục tiêu

Search trong IT Operations Hub không chỉ là ô tìm kiếm text.

Nó phải hỗ trợ operator tìm nhanh:

```text
Asset
User
Ticket
Incident
Problem
Change
PO
Invoice
Contract
Software
License
IP
MAC
Hostname
Serial
Asset Tag
Location
Service
Knowledge
```

và đi thẳng tới đúng context để hành động.

Chuỗi chuẩn:

```text
User Query
→ Query Normalization
→ Permission Scope
→ Entity Candidate Search
→ Ranking
→ Exact/Fuzzy Matching
→ Result Enrichment
→ Authorized Results
→ Navigation / Action
```

Mục tiêu:

- exact lookup phải rất nhanh;
- serial/IP/MAC/asset tag có ưu tiên cao;
- fuzzy search hữu ích nhưng không lấn át exact match;
- search không bypass RBAC;
- search index không trở thành source-of-truth;
- index freshness phải đo được;
- có reindex/rebuild strategy;
- search hỗ trợ duplicate detection;
- autocomplete nhẹ, nhanh và permission-aware;
- query syntax không quá phức tạp cho end user.

---

# 2. Search Types

System supports:

```text
GLOBAL_SEARCH
ENTITY_SEARCH
EXACT_LOOKUP
FUZZY_SEARCH
AUTOCOMPLETE
FILTERED_SEARCH
RELATIONSHIP_SEARCH
DUPLICATE_DETECTION
KNOWLEDGE_SEARCH
OPERATIONAL_SEARCH
```

---

# 3. Global Search Principle

Global search should answer:

```text
"I know something about the thing I need, help me find it."
```

Examples:

```text
AST-0042
Dell 7420
SN-92AX11
192.168.10.45
A4:5E:60:11:22:33
Nguyễn Văn An
TCK-2031
VPN lỗi
INV-2026-0182
Adobe
```

---

# 4. Search Result Entity Types

Core searchable types:

```text
ASSET
USER
TICKET
INCIDENT
PROBLEM
CHANGE
SERVICE
LOCATION
NETWORK_DEVICE
IP_ADDRESS
MAC_ADDRESS
SOFTWARE_PRODUCT
LICENSE_ENTITLEMENT
PURCHASE_ORDER
INVOICE
CONTRACT
DOCUMENT
KNOWLEDGE_ARTICLE
WORK_ITEM
```

---

# 5. Search Index Is a Read Model

Search index is:

```text
derived
rebuildable
eventually consistent
```

It must not be used as final authority for:

```text
current owner
invoice uniqueness
asset assignment eligibility
license availability
authorization
state transition
```

---

# 6. Search Document Model

Canonical search document:

```yaml
search_document:
  document_id:
  entity_type:
  entity_id:
  tenant_id:
  organization_id:
  display_code:
  title:
  subtitle:
  aliases:
  keywords:
  searchable_text:
  exact_terms:
  filter_fields:
  security_scope:
  status:
  updated_at:
  source_version:
  indexed_at:
```

---

# 7. Search Security Metadata

Each document should include enough for early filtering:

```yaml
security_scope:
  tenant_id:
  organization_id:
  site_ids:
  department_ids:
  team_ids:
  visibility:
  confidentiality:
```

Final API authorization may still re-check sensitive resources.

---

# 8. Exact Terms

Fields that should support exact lookup:

```text
asset_code
asset_tag
serial_number
ticket_code
incident_code
problem_code
change_code
po_code
invoice_number
contract_code
email
IP
MAC
hostname
document_code
```

---

# 9. Exact Match Priority

Ranking order recommendation:

```text
1. Exact display code
2. Exact asset tag
3. Exact serial
4. Exact IP/MAC
5. Exact email/username
6. Exact hostname
7. Exact title/name
8. Prefix match
9. Fuzzy match
10. Full-text relevance
```

---

# 10. Search Query Normalization

Normalize:

```text
trim whitespace
lowercase for case-insensitive fields
Unicode normalization
Vietnamese diacritic normalization for secondary matching
MAC formatting
IP canonicalization
serial punctuation normalization where safe
```

---

# 11. Vietnamese Search

Support:

```text
Nguyễn Văn An
Nguyen Van An
```

as related matches.

But original diacritic exact match should rank higher.

---

# 12. Serial Number Normalization

Preserve original:

```text
SN-AB12-34
```

Normalized shadow term may be:

```text
SNAB1234
```

Use carefully because punctuation may be meaningful for some vendors.

---

# 13. MAC Normalization

All variants should match same device:

```text
A4:5E:60:11:22:33
A4-5E-60-11-22-33
a45e60112233
```

Canonical internal representation:

```text
a45e60112233
```

Display original standardized format.

---

# 14. IP Search

Support:

```text
IPv4 exact
IPv6 exact
CIDR search
subnet filter
```

Examples:

```text
192.168.10.45
10.20.0.0/16
```

---

# 15. Hostname Search

Support:

```text
exact FQDN
short hostname
prefix
```

Example:

```text
pc-hn-042
pc-hn-042.corp.local
```

---

# 16. Asset Search Fields

Indexed:

```text
asset_code
asset_tag
serial
manufacturer
model
category
hostname
assigned user
location
IP
MAC
lifecycle
health
```

Search result card:

```text
AST-0042
Dell Latitude 7420
Assigned: Nguyễn Văn An
Hanoi / Floor 4
Health: Warning
```

---

# 17. User Search Fields

Indexed:

```text
display_name
email
username
employee code
department
manager
site
assigned asset codes
```

Sensitive fields should not be indexed unless needed.

---

# 18. Ticket Search Fields

Indexed:

```text
ticket_code
summary
description
requester
asset
service
category
resolution
```

Internal notes may require restricted index or be excluded from general search.

---

# 19. Incident Search Fields

Indexed:

```text
incident_code
title
service
site
affected assets
affected users count
root cause summary
resolution summary
```

---

# 20. Procurement Search Fields

PO:

```text
po_code
supplier
requester
contract
line description
```

Invoice:

```text
invoice_number
supplier
PO
amount
```

Sensitive financial fields permission-filtered.

---

# 21. Software Search Fields

```text
product name
vendor
aliases
version
classification
artifact name
```

---

# 22. Knowledge Search Fields

```text
title
symptoms
keywords
service
body
tags
resolution steps
```

Knowledge search should prioritize:

```text
symptom relevance
service context
article quality
freshness
```

---

# 23. Autocomplete

Autocomplete should search a smaller optimized index.

Targets:

```text
asset code
user
ticket code
service
location
software
```

Latency target:

```text
sub-200ms where feasible
```

---

# 24. Autocomplete Guardrail

Do not run expensive full-text fuzzy search on every keystroke.

Use:

```text
prefix
edge-ngram
small result limit
```

---

# 25. Minimum Query Length

For broad text autocomplete:

```text
2–3 characters
```

Exact structured values like IP/MAC may activate sooner.

---

# 26. Search Ranking Signals

Possible ranking:

```text
Exactness
Field importance
Entity type priority
Recency
Operational relevance
User context
Open/active state
Relationship proximity
```

---

# 27. Entity Type Priority

Operational context may prioritize:

```text
Ticket
Incident
Asset
User
```

over archived documents for same term.

But exact entity code always wins.

---

# 28. Open-State Boost

Example:

```text
TCK-2042 OPEN
```

can rank above old closed related ticket for symptom search.

---

# 29. Contextual Boosting

From Asset Workspace:

```text
search "VPN"
```

may boost:

```text
tickets
knowledge
software
incidents
```

related to that asset/user/service.

---

# 30. Search Context Input

Optional:

```yaml
context:
  user_id:
  asset_id:
  service_id:
  site_id:
  current_screen:
```

Used only for ranking/filtering, not permission bypass.

---

# 31. Fuzzy Search

Use for:

```text
misspellings
name variations
model name
knowledge title
```

Example:

```text
Latitute 7420
```

→ Dell Latitude 7420.

---

# 32. Fuzzy Search Guardrail

Do not fuzzy-match:

```text
invoice amount
IP
MAC
asset code
ticket code
```

unless fallback after exact/prefix failure.

---

# 33. Typo Tolerance

Recommended:

```text
short token <4 chars → strict
long token → small edit distance
```

Avoid overly broad matches.

---

# 34. Synonyms

Useful controlled synonyms:

```text
notebook ↔ laptop
pc ↔ desktop
wifi ↔ wireless
vpn ↔ remote access
```

Synonym management should be curated.

---

# 35. Acronym Expansion

Examples:

```text
PO → Purchase Order
SN → Serial Number
NIC → Network Interface
```

Context-aware to avoid ambiguity.

---

# 36. Stop Words

Knowledge search may use stop words.

Exact operational fields should not.

---

# 37. Search Filters

Common filters:

```text
entity_type
state
site
department
team
service
category
owner
assignee
date range
risk
health
```

---

# 38. Facets

Useful facets:

```text
Entity Type
Site
State
Category
Team
Service
```

Facets must respect RBAC-filtered result set.

---

# 39. Search Sorting

Options:

```text
relevance
recently updated
created date
priority
risk
```

Exact code search should not be overridden by manual sort unless user chooses.

---

# 40. Pagination

Use cursor-based pagination for large result sets.

Search cursor should bind:

```text
query
filters
sort
authorization context
```

---

# 41. Global Search API

Recommended:

```text
GET /search
```

Parameters:

```text
q
types
site_id
state
limit
cursor
```

---

# 42. Search Response

```yaml
data:
  - type:
    id:
    display_code:
    title:
    subtitle:
    highlights:
    score:
    updated_at:
meta:
  next_cursor:
  query_time_ms:
  index_freshness:
```

---

# 43. Search Highlighting

Highlight only safe fields.

Do not expose:

```text
internal note
restricted contract clause
security evidence
```

in snippet unless authorized.

---

# 44. RBAC-aware Search

Search pipeline:

```text
Query
↓
Tenant Filter
↓
Resource Scope Filter
↓
Search
↓
Optional Final Authorization Check
↓
Return
```

---

# 45. Search Result Leakage Prevention

Even existence of a resource may be sensitive.

Unauthorized documents should not return:

```text
title
code
count
snippet
```

unless policy explicitly allows metadata visibility.

---

# 46. Count Leakage

Facets/counts must also respect permissions.

Do not show:

```text
127 confidential incidents
```

to unauthorized users.

---

# 47. Self Scope Search

End user searches:

```text
"My tickets"
```

should only return:

```text
own tickets
assigned assets
public knowledge
```

---

# 48. Team Scope Search

Helpdesk team can search within permitted:

```text
site/team/service
```

---

# 49. Sensitive Field Index Segregation

Options:

```text
exclude
separate field with access control
separate index
```

depending search engine capability.

---

# 50. Duplicate Detection Principle

Search index can assist candidate detection.

Final duplicate decision must be verified against canonical DB.

---

# 51. Asset Duplicate Detection

Signals:

```text
serial exact
asset tag exact
agent ID exact
MAC overlap
hostname similarity
manufacturer/model
purchase record
```

---

# 52. Asset Duplicate Score

Example:

```text
Serial exact          +60
Agent ID exact        +50
MAC exact             +35
Hostname exact        +20
Model exact           +10
Same PO               +10
```

Thresholds configurable.

---

# 53. User Duplicate Detection

Signals:

```text
external identity exact
employee ID exact
email exact
username
name + department
```

External identity/employee ID should dominate.

---

# 54. Invoice Duplicate Detection

Primary:

```text
supplier + invoice number exact
```

Secondary candidate signals:

```text
same supplier
same amount
same date
same PO
```

But DB unique constraint is authoritative.

---

# 55. Ticket Duplicate Detection

Signals:

```text
same requester
same asset
same service
similar symptom
same time window
same known/root incident
```

Result:

```text
suggest link/merge
```

Do not silently merge based only on text similarity.

---

# 56. Incident Correlation Search

Search/correlation may use:

```text
service
site
topology dependency
monitor signature
asset group
time window
```

This is beyond simple text relevance.

---

# 57. Knowledge Deflection Search

User issue text:

```text
"VPN báo certificate expired"
```

Search:

```text
symptom
service
known error
article
```

Return:

```text
top relevant article
known outage
safe self-service action
```

---

# 58. Search Across Relationships

Example query:

```text
"assets assigned to Nguyễn Văn An"
```

Initial implementation may use structured filter after entity resolution.

Long-term:

```text
natural-language query parser
```

optional.

---

# 59. Structured Shortcuts

Support patterns:

```text
user:an
site:hanoi
state:critical
type:asset
ip:10.0.0.5
mac:a45e60112233
```

Optional advanced operator syntax.

---

# 60. Search Parser Guardrail

Do not create full arbitrary query language exposed to end users initially.

Keep syntax simple and safe.

---

# 61. Search by QR/Barcode

QR scan resolves exact:

```text
asset_id
asset_tag
document_id
```

Prefer direct lookup, not fuzzy search.

---

# 62. Search by Serial Scanner

Barcode/serial scanner input should:

```text
exact lookup first
```

and offer candidate creation if unknown.

---

# 63. Unknown Device Search

Network observation:

```text
MAC/IP/hostname
```

searches:

```text
Assets
Agent records
Historical network mappings
Audit observations
```

to identify candidate.

---

# 64. Historical Search

Some queries need history:

```text
Which asset had IP 10.0.1.4 last week?
Who had AST-0042 before?
```

Search index alone may not suffice.

Route to:

```text
historical query service
```

or indexed history.

---

# 65. Historical Network Lookup

Recommended indexed fields:

```text
mac
ip
asset_id
valid_from
valid_to
```

for recent history.

Deep history can query archive/analytics.

---

# 66. Archived Record Search

Archived records can remain searchable with:

```text
archived=true
```

and lower ranking.

---

# 67. Deleted/Anonymized Records

Search index must remove/update promptly after:

```text
legal deletion
anonymization
permission revocation
```

---

# 68. Index Update Flow

Canonical:

```text
Domain Transaction
↓
Domain Event
↓
Search Indexer
↓
Upsert Document
```

---

# 69. Index Delete Flow

When resource no longer searchable:

```text
Domain Event
→ delete/tombstone index document
```

---

# 70. Tombstone

For eventual delivery safety:

```yaml
tombstone:
  entity_type:
  entity_id:
  deleted_at:
  source_version:
```

Prevents stale older event from recreating removed doc.

---

# 71. Source Version

Search document stores:

```text
source_version
```

Indexer ignores event older than current indexed version.

---

# 72. Out-of-order Event Handling

Example:

```text
v18 arrives
then v17
```

Indexer:

```text
ignore v17
```

if source_version known.

---

# 73. Index Freshness

Track:

```text
last_event_at
indexed_at
lag_seconds
```

---

# 74. Freshness States

```text
CURRENT
DELAYED
STALE
REBUILDING
FAILED
```

---

# 75. Search API Freshness Metadata

Return:

```yaml
meta:
  index_state:
  lag_seconds:
```

especially for operator/admin search.

---

# 76. Search Fallback

If search engine unavailable:

```text
exact lookup fallback to canonical DB
```

for:

```text
asset code
ticket code
serial
IP where indexed relationally
```

Do not attempt full fuzzy fallback with expensive DB scans.

---

# 77. Degraded Search UX

Show:

```text
Search is degraded.
Exact lookups are still available.
```

Operator can continue critical work.

---

# 78. Reindex Strategy

Two modes:

```text
FULL_REINDEX
PARTIAL_REINDEX
```

---

# 79. Full Reindex

Flow:

```text
Create new index version
↓
Backfill from canonical data
↓
Catch up events
↓
Validate
↓
Alias switch
↓
Retire old index
```

Avoid deleting live index first.

---

# 80. Partial Reindex

Target:

```text
entity type
tenant
date range
specific IDs
```

---

# 81. Reindex Consistency

During rebuild:

```text
dual-write via event stream
or
backfill + replay from checkpoint
```

---

# 82. Search Index Versioning

Index schema version:

```text
asset-search-v3
```

Alias:

```text
asset-search-current
```

---

# 83. Search Mapping Evolution

Breaking analyzer/mapping changes:

```text
new index
reindex
alias switch
```

not risky in-place changes.

---

# 84. Search Analyzer Strategy

Different field types:

```text
keyword exact
text analyzed
edge-ngram
normalized identifiers
```

---

# 85. Identifier Fields

Use keyword/non-analyzed:

```text
asset_code
serial_normalized
mac_normalized
ip
ticket_code
invoice_number
```

---

# 86. Text Fields

Analyzed:

```text
title
summary
description
knowledge body
model name
```

---

# 87. Search Boost Example

```text
asset_code^10
asset_tag^9
serial^9
hostname^7
assigned_user^5
model^3
description^1
```

Actual weights tuned via usage data.

---

# 88. Ranking Evaluation

Build benchmark query set:

```text
AST-0042
Nguyen Van An
192.168.1.10
Dell 7420
VPN certificate
INV-8821
```

Expected top results defined.

---

# 89. Search Relevance Metrics

Track:

```text
Top-1 success
Top-3 success
Zero-result rate
Search abandonment
Result click-through
Query reformulation
```

---

# 90. Zero-result Handling

If no result:

```text
suggest alternative
check exact normalized variants
offer broader search
```

Example:

```text
No asset found for serial XYZ.
Search network observations?
```

---

# 91. Query Reformulation

Potential:

```text
"Did you mean..."
```

for text names/model.

Avoid changing structured identifiers automatically.

---

# 92. Recent Search

Optional per user:

```text
recent queries
recent entities
```

Store limited and privacy-aware.

---

# 93. Search Favorites

Operator can pin:

```text
asset
service
site
saved search
```

---

# 94. Saved Search

Example:

```text
type:asset
site:hanoi
health:critical
```

Saved as filter definition, not raw backend DSL.

---

# 95. Operational Saved Searches

Examples:

```text
Critical Hanoi Assets
Unauthorized Software
Unknown Devices
Warranty <30d
```

Could surface in Work Queue/Operations Overview.

---

# 96. Search-to-Action

Search result should navigate directly to:

```text
Asset Workspace
Ticket Workspace
Incident Workspace
User Context
PO Detail
```

not generic list page first.

---

# 97. Search Result Actions

Simple result actions may include:

```text
Open
Assign
Copy ID
Open Ticket
View Timeline
```

Permission-aware.

---

# 98. Search Query Logging

Log:

```text
query
result count
latency
selected result
```

with privacy controls.

---

# 99. Search Privacy

Avoid storing raw sensitive user query forever.

Use retention and redaction.

---

# 100. Search Security Monitoring

Detect unusual behavior:

```text
high-volume enumeration
serial scanning
user directory scraping
cross-scope repeated queries
```

---

# 101. Search Rate Limiting

Separate limits for:

```text
interactive search
autocomplete
API bulk search
integration lookup
```

---

# 102. Bulk Lookup API

Useful:

```text
POST /search/lookup
```

Input:

```yaml
items:
  - type: serial
    value: ...
  - type: mac
    value: ...
```

Return per-item exact/candidate matches.

---

# 103. Bulk Lookup Use Cases

```text
CSV import validation
warehouse receiving
network discovery reconciliation
audit reconciliation
license inventory matching
```

---

# 104. Duplicate Candidate API

Example:

```text
POST /duplicates/assets/detect
```

Input:

```text
serial
mac
hostname
model
```

Output:

```text
candidate list
score
reasons
```

---

# 105. Duplicate Candidate Explainability

Example:

```text
Candidate AST-0042
Score: 92
Reasons:
- Serial exact
- MAC exact
- Same model
```

---

# 106. Duplicate Decision

Final actions:

```text
LINK
MERGE
KEEP_SEPARATE
CREATE_NEW
```

with audit.

---

# 107. Merge Guardrail

Do not auto-merge canonical entities solely based on fuzzy score.

Human review or strong deterministic rule required.

---

# 108. Entity Merge History

If merge occurs:

```text
old IDs remain aliases
redirect to survivor
audit merge
```

---

# 109. Alias Indexing

Search old asset/user aliases:

```text
legacy asset code
old hostname
old email
```

can resolve current entity.

---

# 110. Alias Expiry

Some aliases permanent:

```text
old asset code
```

Some temporary:

```text
old email
```

Policy-based.

---

# 111. Search by Relationship

Examples:

```text
tickets for AST-0042
assets assigned to user X
incidents affecting service Y
contracts covering software Z
```

Prefer dedicated filtered APIs/read models for complex relation search.

---

# 112. Graph Search Boundary

Full graph traversal is optional.

Do not force graph database solely for basic entity relationships.

Use:

```text
relational joins
read models
topology index
```

first.

---

# 113. Network Topology Search

Support:

```text
switch
port
VLAN
subnet
IP
MAC
asset
```

and direct navigation among them.

---

# 114. Search Result Freshness Risk

Critical action from search result:

```text
open canonical entity
```

before command.

Never execute irreversible action directly from stale search document state.

---

# 115. Indexing Failure

If indexing one document fails:

```text
retry
```

then:

```text
Search Index DLQ
```

---

# 116. Search Index DLQ

Record:

```text
entity
source version
error
attempts
```

Supports replay after mapping/data fix.

---

# 117. Search Reconciliation Job

Periodic:

```text
canonical entity count
vs
index count
```

plus sampled version comparison.

---

# 118. Orphan Search Document

If index doc has no canonical record:

```text
delete/tombstone
```

after verification.

---

# 119. Missing Search Document

If canonical entity absent from index:

```text
reindex entity
```

---

# 120. Search Health Metrics

Track:

```text
query latency p50/p95/p99
index lag
zero-result rate
error rate
reindex duration
DLQ size
index size
document count
```

---

# 121. Search SLO

Example:

```text
Exact lookup p95 < 300ms
Global search p95 < 800ms
Index freshness < 60s
```

Tune based on deployment.

---

# 122. Search Index Capacity

Monitor:

```text
documents
storage
shards
segment count
heap
query concurrency
index rate
```

---

# 123. Sharding Strategy

Avoid premature oversharding.

Start by:

```text
entity family
tenant where justified
```

Scale based on volume.

---

# 124. Multi-Tenant Indexing

Options:

```text
shared index with tenant field
index per large tenant
hybrid
```

Recommended default:

```text
shared index + strict tenant filter
```

---

# 125. Search Backup

Search index is rebuildable.

Snapshot optional for faster recovery.

Canonical source remains elsewhere.

---

# 126. Search DR

After disaster:

```text
restore cluster
or
rebuild from canonical
```

Priority lower than canonical OLTP.

---

# 127. Search Schema Registry

Each entity index mapping should define:

```yaml
index_schema:
  entity_type:
  version:
  fields:
  analyzers:
  exact_fields:
  filters:
  security_fields:
  owner:
```

---

# 128. Search Owner

Recommended:

```text
platform/search team
```

Schema content ownership remains with domain teams.

---

# 129. Indexing Contract per Domain

Domain team must define:

```text
which fields searchable
which exact
which filterable
which sensitive
which aliases
which update events
```

---

# 130. Search Event Subscription Matrix

Examples:

```text
ASSET.CREATED
ASSET.STATE_CHANGED
ASSET.ASSIGNED
ASSET.TRANSFERRED

USER.CREATED
USER.UPDATED

TICKET.CREATED
TICKET.STATE_CHANGED

INCIDENT.CREATED
INCIDENT.STATE_CHANGED

SOFTWARE.INSTALLED
LICENSE.ASSIGNED

PO.CREATED
INVOICE.SUBMITTED
INVOICE.MATCH_EVALUATED
INVOICE.APPROVED
INVOICE.REJECTED
CREDIT_NOTE.SUBMITTED
CREDIT_NOTE.APPLIED
CONTRACT.CREATED
```

---

# 131. Full Rebuild Source

Prefer:

```text
canonical DB snapshot
+
event catch-up
```

rather than relying solely on retained broker history.

---

# 132. Rebuild Checkpoint

Store:

```text
source snapshot time
last event offset/version
```

---

# 133. Search Indexer Idempotency

Upsert key:

```text
entity_type + entity_id
```

Ignore older source_version.

---

# 134. Search and Soft Delete

Archived entity:

```text
archive flag
lower rank
```

Hard-deleted/anonymized entity:

```text
remove or redact fields
```

---

# 135. Search and Retention

Expired knowledge/report/document may remain discoverable only if policy allows.

---

# 136. Search and Compliance

Sensitive legal/security records may be:

```text
not globally indexed
```

and only searchable through specialized scoped interface.

---

# 137. Search by Natural Language

Optional future:

```text
"show laptops in Hanoi with expired warranty"
```

should translate to structured query.

Must:

```text
show interpreted filters
```

before applying high-impact workflow.

---

# 138. Natural Language Guardrail

Never convert free text directly into destructive command.

Search/natural-language result is read/navigation only unless user explicitly confirms action.

---

# 139. Knowledge Semantic Search

Optional vector/semantic search may improve KB relevance.

But:

```text
keyword/exact search remains
```

and semantic index is derived.

---

# 140. Vector Search Boundary

Good for:

```text
knowledge
ticket similarity
problem candidate similarity
```

Not necessary for:

```text
serial
IP
MAC
invoice number
asset code
```

---

# 141. Vector Security

Embeddings/index must respect same access scope as source content.

Do not embed confidential data into unrestricted shared vector index.

---

# 142. Vector Freshness

Article/update event:

```text
recompute embedding
```

Old embedding should be replaced/versioned.

---

# 143. Search Quality Review

Periodically review:

```text
top failed queries
zero-result queries
wrong top result
duplicate synonyms
stale aliases
```

---

# 144. Query Analytics Feedback Loop

Use anonymous/authorized analytics to improve:

```text
synonyms
boost weights
autocomplete
field coverage
```

---

# 145. Search Failure Work Queue

Create actionable Work Item only for:

```text
index stale beyond threshold
reindex failed
DLQ growing
permission filter failure
search cluster unavailable
```

---

# 146. Search Degradation Priority

Critical exact lookups should have fallback.

Full fuzzy/semantic search may be degraded without blocking operations.

---

# 147. MVP Search Scope

Implement first:

```text
Asset
User
Ticket
Incident
Service
Location
Software
IP
MAC
Serial
Asset Tag
```

Features:

```text
exact
prefix
basic full-text
filters
RBAC
autocomplete
```

---

# 148. MVP Storage Choice

For small deployment:

```text
PostgreSQL full-text + trigram
```

may be enough initially.

Architecture must still keep:

```text
Search API abstraction
```

so dedicated search engine can be introduced later.

---

# 149. Phase 2

Add:

```text
Dedicated search engine
Fuzzy ranking
Facets
Cross-domain global search
Duplicate candidate scoring
Historical IP/MAC search
```

---

# 150. Phase 3

Add:

```text
Semantic KB search
Natural language filters
Advanced incident similarity
Graph-aware ranking
Search personalization
```

---

# 151. Search Decision Checklist

Before indexing a field:

```text
Is it useful for lookup?
Is it sensitive?
Exact or text?
Filterable?
Sortable?
How often changes?
Does it need history?
Can user scope filter it?
```

---

# 152. Guardrails

System must not:

1. Use search index as canonical state.
2. Execute irreversible commands based solely on stale search result.
3. Return unauthorized entity existence or counts.
4. Fuzzy-match structured identifiers before exact lookup.
5. Auto-merge canonical records based only on fuzzy similarity.
6. Store secrets in search index.
7. Index internal notes into general user search without access policy.
8. Depend on UI filters for RBAC.
9. Use expensive full-text search for every autocomplete keystroke.
10. Rebuild by deleting live index before replacement is ready.
11. Allow out-of-order older events to overwrite newer indexed state.
12. Keep search documents after legal deletion/anonymization.
13. Create one index/shard per tiny tenant by default.
14. Treat vector search as replacement for exact identifiers.
15. Expose backend-specific DSL directly to ordinary users.
16. Hide search freshness during degraded operation.
17. Let search analytics retain sensitive raw queries indefinitely.

---

# 153. Recommended Next Spec

Sau Search + Indexing, tài liệu tiếp theo nên là:

```text
AUDIT LOG + TIMELINE DATA MODEL SPEC
```

để chuẩn hóa:

```text
audit-grade event
operator timeline
before/after
actor
reason
evidence
correlation
immutability
retention
redaction
timeline projection
cross-domain history
```

---

# 154. Definition of Done

Search + Indexing Spec đạt yêu cầu khi:

- Search index được xác định là read model.
- Exact identifiers có ranking ưu tiên cao nhất.
- Asset/User/Ticket/Incident/IP/MAC/Serial lookup được chuẩn hóa.
- Fuzzy search và Vietnamese normalization có rule.
- RBAC-aware search và count/facet filtering rõ.
- Duplicate detection có explainable scoring.
- Auto-merge bị cấm nếu chỉ dựa vào fuzzy score.
- Index update/reindex/versioning/tombstone rõ.
- Freshness/lag được đo và expose.
- Search fallback khi engine lỗi được định nghĩa.
- Search observability/SLO rõ.
- MVP PostgreSQL search và scale-out path sang dedicated engine rõ.
- Semantic/vector search chỉ là optional derived layer.
- Search guardrails chống stale action, data leakage và over-engineering được khóa.

---

# 155. TASK-061 PostgreSQL Implementation Profile

The current PostgreSQL-backed implementation indexes only P3 canonical
sources available in this repository:

```text
ASSET, USER, TICKET, INCIDENT, NETWORK_DEVICE,
SOFTWARE_PRODUCT, LICENSE_ENTITLEMENT
```

Search documents are refreshed from canonical records after committed source
events or through a tenant-scoped, bounded UUID-keyset reindex command. The
worker uses the inbox for deduplication, rereads the current source row, fences
updates by source version, records deletion/visibility tombstones, and stores
retry attempts with capped exponential backoff. Procurement entities and
other not-yet-implemented sources are not indexed by this profile.

The query API filters by tenant and supported entity type/state/site before
authorization. It ranks normalized exact identifiers first, followed by code
prefix, title prefix, bounded trigram similarity, full text and substring
matches. Unicode/diacritic normalization supports Vietnamese secondary
matching; IP, MAC and safe structured serial forms normalize separators.
Autocomplete uses a prefix-only query and returns at most ten authorized
results. Result pages use keyset cursors bound to normalized query, type and
filter set, sort, tenant and principal; authorization is reevaluated for every
page. Results expose only the approved display fields and safe highlights; no
counts or facets are returned.

When the projection is unavailable, the API performs only bounded exact
lookups in canonical relational tables (at most ten candidate IDs per source
type). It applies the same state/site filters, cursor ordering and owning
resource authorization. Fuzzy and broad text fallback is prohibited. Freshness
metadata reports current, delayed, stale, rebuilding, failed or degraded
operation, including lag when available.

---

# TASK-093 Knowledge Recommendation Retrieval Contract

Knowledge recommendation reuses TASK-061 retrieval/index infrastructure; it
does not create another search engine. Search candidates are discovery only:
before presentation, validate the canonical TASK-037 article is the current
`PUBLISHED` version and re-check tenant, audience, `knowledge.read`, resource
scope, applicability and availability. Exclude draft, in-review, archived,
withdrawn, superseded and otherwise unavailable versions. A stale index result
must not be shown after it becomes ineligible.

Apply authorization/audience filters before returning any display data.
Unauthorized articles must not leak through title, snippet, count, score,
tags, rank, existence, facets or errors. End-user recommendations require
governed end-user-safe audience; operator-only content is excluded. TASK-061
fuzzy/full-text relevance may aid candidate discovery/ranking but is not
strong correlation evidence and cannot bypass canonical eligibility.

On projection failure, use only TASK-061's bounded exact canonical fallback
where explicitly allowed, with identical tenant/resource authorization. If
safe retrieval is unavailable, return `NO_RECOMMENDATION`; do not query
unrelated canonical tables or block Ticket intake. Recommendation profile
scoring and the maximum-three end-user result limit are defined by TASK-093,
not by the general operator Search contract.
