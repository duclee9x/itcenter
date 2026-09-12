# SOFTWARE CATALOG + ARTIFACT REPOSITORY + LICENSE WORKFLOW SPEC
## Execution-Level Workflow Design

**Version:** 0.1  
**Status:** Draft for implementation  
**Parent:** `MASTER_WORKFLOW_MAP.md`  
**Depends on:**  
- `HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`
- `MAINTENANCE_WARRANTY_REPLACEMENT_DISPOSAL_WORKFLOW.md`

**Scope:** Software Catalog, Approved Software, Artifact Repository, Package Intake, Security Scan, Versioning, Deployment, Install/Uninstall, Agent Execution, Software Discovery, Unauthorized Software, License Entitlement, Assignment, Installation, Usage, Reclaim, Expiry, Renewal, Compliance

---

# 1. Mục tiêu

Tài liệu này chuẩn hóa toàn bộ luồng phần mềm và license theo chuỗi:

```text
Software Request
→ Catalog Check
→ License Check
→ Approval
→ Artifact Selection
→ Security Validation
→ Deployment
→ Agent Install
→ Verification
→ License Assignment
→ Usage Tracking
```

và:

```text
Agent Inventory
→ Software Discovery
→ Approved?
├─ YES → Track
└─ NO  → Compliance Exception
          → Remove / Approve / Exception
```

cùng với:

```text
Entitlement
vs
Assignment
vs
Installation
vs
Usage
→ Compliance / Optimization / Reclaim / Renewal
```

Mục tiêu chính:

- chỉ triển khai phần mềm đã được kiểm soát;
- không để Helpdesk tự tải installer từ nguồn không xác định;
- Artifact phải có version, checksum, signature và security status;
- license phải tách rõ quyền sử dụng, gán, cài đặt và mức sử dụng thực tế;
- hỗ trợ software request và self-service có kiểm soát;
- Agent chịu trách nhiệm thực thi và báo kết quả;
- phần mềm trái phép phải tạo compliance exception;
- license không dùng phải được reclaim;
- license sắp hết phải được quản lý trước khi hết hạn;
- giữ đầy đủ audit trail.

---

# 2. Core Entities

```text
SOFTWARE PRODUCT
SOFTWARE VERSION
SOFTWARE CATALOG ITEM
SOFTWARE POLICY
SOFTWARE PROFILE
SOFTWARE INSTALLATION
SOFTWARE USAGE
SOFTWARE REQUEST
SOFTWARE EXCEPTION

ARTIFACT
ARTIFACT VERSION
ARTIFACT SOURCE
ARTIFACT REPOSITORY
ARTIFACT SCAN
SIGNATURE
CHECKSUM
DEPLOYMENT PACKAGE
INSTALL SCRIPT
UNINSTALL SCRIPT

LICENSE PRODUCT
LICENSE ENTITLEMENT
LICENSE POOL
LICENSE ASSIGNMENT
LICENSE CONSUMPTION
LICENSE USAGE
LICENSE CONTRACT
LICENSE RENEWAL
LICENSE EXCEPTION

ASSET
USER
DEPARTMENT
AGENT
REQUEST
APPROVAL
CHANGE
INCIDENT
DOCUMENT
AUDIT TRAIL
```

---

# 3. Software Classification

Software nên được phân loại:

```text
APPROVED
RESTRICTED
PROHIBITED
UNKNOWN
DEPRECATED
RETIRED
```

## APPROVED

Có thể cài theo policy.

## RESTRICTED

Cần approval hoặc điều kiện đặc biệt.

## PROHIBITED

Không được cài trừ explicit exception.

## UNKNOWN

Chưa được review.

## DEPRECATED

Không nên cài mới; có migration path.

## RETIRED

Không còn được sử dụng.

---

# 4. Software Catalog Item

```yaml
software_catalog_item:
  id:
  product_name:
  vendor:
  category:
  classification:
  owner:
  support_team:
  approved_versions:
  latest_approved_version:
  supported_os:
  supported_asset_classes:
  license_required:
  install_method:
  uninstall_method:
  security_rating:
  user_visible:
  self_service_allowed:
  approval_policy:
  retirement_date:
```

---

# 5. Software Profile

Profile dùng để chuẩn hóa nhóm phần mềm theo:

```text
Department
Role
Asset Type
Security Level
Location
Project
```

Ví dụ:

```text
Developer Profile:
- VPN Client
- VS Code
- Git
- Docker Desktop
- Browser
- Endpoint Agent
```

Profile có thể được áp dụng khi:

```text
Asset Preparation
User Onboarding
Role Change
Replacement
Re-provisioning
```

---

# 6. Artifact Repository Model

Artifact Repository lưu:

```text
MSI
EXE
PKG
DMG
DEB
RPM
ZIP
Container Image
Script
Internal Binary
Configuration Bundle
```

Mỗi artifact version phải có:

```yaml
artifact:
  id:
  software_product:
  version:
  filename:
  source:
  checksum:
  signature:
  size:
  uploaded_by:
  uploaded_at:
  scan_status:
  approval_status:
  install_command:
  uninstall_command:
  silent_flags:
  reboot_required:
  supported_os:
  notes:
```

---

# 7. Artifact Source Types

```text
Vendor Official
Internal Build
Approved Mirror
Package Repository
Manual Upload
CI/CD Pipeline
```

Không nên coi Manual Upload là trusted mặc định.

---

# 8. WF-SW01 — Artifact Intake

## Trigger

```text
ARTIFACT.UPLOADED
CI_PIPELINE.PUBLISHED
VENDOR.VERSION_AVAILABLE
```

## Flow

```text
Artifact Received
↓
Identify Software Product
↓
Extract Metadata
↓
Calculate Checksum
↓
Verify Signature
↓
Security Scan
↓
Policy Evaluation
↓
Approve / Reject / Quarantine
```

---

# 9. Artifact Validation

Bắt buộc kiểm tra tùy policy:

```text
Checksum
Digital Signature
Publisher
Malware Scan
Static Analysis
Known Vulnerability Scan
File Type
Version
Source Trust
```

Result:

```text
PASS
FAIL
QUARANTINE
NEEDS_REVIEW
```

---

# 10. Artifact Checksum

Recommended:

```text
SHA-256
```

Checksum phải immutable cho artifact version.

Nếu cùng version nhưng checksum thay đổi:

```text
ARTIFACT.INTEGRITY_MISMATCH
```

Không silently replace binary.

---

# 11. Signature Verification

Nếu vendor package có signature:

```text
Verify signer
Verify certificate chain
Verify timestamp
Verify signature integrity
```

Possible:

```text
VALID
INVALID
UNSIGNED
UNKNOWN
```

UNSIGNED không nhất thiết block nếu internal policy cho phép, nhưng phải explicit.

---

# 12. Security Scan

Scan có thể gồm:

```text
Malware
Known CVE
Secrets
Suspicious behavior
Package dependency risk
Container image vulnerabilities
```

State:

```text
PENDING
PASSED
FAILED
WAIVED
```

Nếu waived:

```text
approver
reason
expiry
```

bắt buộc.

---

# 13. Artifact Approval

Chỉ artifact `APPROVED` mới được dùng trong production deployment nếu policy yêu cầu.

Approval có thể dựa trên:

```text
software classification
vendor trust
risk
security scan
target scope
```

---

# 14. Artifact Version Lifecycle

```text
DRAFT
SCANNING
REVIEW
APPROVED
ACTIVE
DEPRECATED
REVOKED
RETIRED
```

Nếu artifact bị phát hiện nguy hiểm:

```text
REVOKED
```

và có thể tạo removal campaign.

---

# 15. WF-SW02 — Publish Software to Catalog

Sau khi artifact approved:

```text
Artifact Approved
↓
Link Software Product
↓
Mark Approved Version
↓
Update Catalog
↓
Define Eligibility
↓
Define Approval Policy
↓
Publish
```

Catalog không nhất thiết public cho end user.

---

# 16. Software Request Sources

```text
Self-Service Portal
Helpdesk
Manager
Onboarding
Role Change
Project Request
Automation
```

---

# 17. WF-SW03 — Software Installation Request

## Trigger

```text
SOFTWARE.INSTALL_REQUESTED
```

## Context Enrichment

```text
User
Asset
OS
Current installed software
Catalog eligibility
License requirement
License availability
Department policy
Security policy
Asset health
Agent status
```

---

# 18. Software Request Decision Table

| Condition | Action |
|---|---|
| Software not in catalog | Route to Software Review |
| Prohibited | Reject unless exception path |
| Restricted | Approval required |
| Approved + no license needed | Deploy if eligible |
| Approved + license available | Reserve license then deploy |
| Approved + no license available | Queue / procurement / reject |
| Asset unsupported | Reject or suggest alternative |
| Agent offline | Wait / Helpdesk work item |
| Existing same version | Return already compliant |
| Existing newer approved version | No downgrade unless policy allows |

---

# 19. Eligibility Rules

Software có thể giới hạn theo:

```text
OS
Architecture
Asset Class
Department
Role
Security Zone
Country
License Pool
```

Ví dụ:

```text
CAD Software
→ Engineering only
```

---

# 20. Approval Engine

Approval có thể dựa trên:

```text
Software classification
Cost
License scarcity
Security risk
Department
Manager approval
Software owner approval
```

Ví dụ:

```text
Free Approved App
→ no approval

Paid Standard App
→ Manager

Restricted Security Tool
→ Security + IT
```

---

# 21. WF-SW04 — Deployment Job

Flow:

```text
Request Approved
↓
Select Approved Artifact
↓
Reserve License if required
↓
Create Deployment Job
↓
Agent Pre-check
↓
Download
↓
Checksum Verify
↓
Signature Verify
↓
Install
↓
Post-check
↓
Report Result
```

---

# 22. Agent Pre-check

Check:

```text
Agent online
OS supported
Disk space
Battery/power condition
Network connectivity
Conflicting process
Pending reboot
Maintenance window
```

Nếu pre-check fail:

```text
do not install
→ report reason
```

---

# 23. Download Security

Agent phải:

```text
download via trusted channel
validate checksum
validate signature where applicable
reject mismatched artifact
```

Không chạy binary nếu integrity fail.

---

# 24. Install Execution

Agent records:

```text
command
start time
end time
exit code
stdout summary
stderr summary
reboot required
```

Không expose secrets trong log.

---

# 25. Install Verification

Install thành công chỉ khi:

```text
installer exit success
AND
software detected
AND
expected version matches
```

Có thể thêm:

```text
service running
process exists
health check pass
license activation pass
```

---

# 26. Deployment States

```text
QUEUED
PRECHECK
DOWNLOADING
VERIFYING_ARTIFACT
INSTALLING
POSTCHECK
SUCCESS
FAILED
CANCELLED
WAITING_REBOOT
```

---

# 27. Reboot Handling

Nếu reboot cần thiết:

```text
immediate
deferred
user scheduled
maintenance window
```

Không tự reboot production/server endpoint nếu policy không cho phép.

---

# 28. Install Failure Handling

Flow:

```text
Install Failed
↓
Collect Error
↓
Retry Allowed?
├─ YES → Retry
└─ NO → Human Work Item
```

Retry phải giới hạn.

---

# 29. Rollback

Nếu package hỗ trợ:

```text
Install fails
or
health regression
↓
Rollback
```

Rollback có thể:

```text
uninstall new version
restore previous version
restore config
```

---

# 30. Software Deployment Campaign

Support:

```text
Pilot
10%
25%
50%
100%
```

Stop conditions:

```text
failure rate threshold
incident spike
health degradation
security issue
```

---

# 31. Change Management Integration

Deployment cần Change khi:

```text
large production rollout
business-critical software
infrastructure software
server-side deployment
security control update
high-risk version upgrade
```

Endpoint low-risk approved app có thể là Standard Change hoặc no explicit Change theo policy.

---

# 32. WF-SW05 — Software Inventory Discovery

Agent định kỳ gửi:

```text
Software Product
Version
Publisher
Install Date
Install Scope
Package Identifier
```

Normalize về Software Product.

---

# 33. Software Normalization

Cùng sản phẩm có thể xuất hiện dưới nhiều tên:

```text
Google Chrome
Chrome
Google Chrome x64
```

Normalize thành:

```text
Product = Google Chrome
Version = ...
```

---

# 34. Unknown Software

Nếu không match catalog:

```text
classification = UNKNOWN
```

Flow:

```text
Unknown Software
↓
Fingerprint
↓
Search Catalog
↓
Vendor Identification
↓
Policy Evaluation
```

---

# 35. WF-SW06 — Unauthorized Software Detection

Trigger:

```text
SOFTWARE.UNAUTHORIZED_DETECTED
```

Condition:

```text
Installed software classification = PROHIBITED
OR
UNKNOWN after grace/review
OR
RESTRICTED without approval
```

Agent inventory is stored as append-only Software-owned observations and a
tenant-scoped normalized current installation projection. Product matching is
exact after Unicode normalization, against product name, product code, or an
explicit catalog alias; ambiguous matches remain `UNKNOWN`. The default
unknown-software grace period is 72 hours from first receipt. `PROHIBITED` is
actionable immediately; `RESTRICTED` is actionable unless an unexpired
approved exception exists. Only a complete validated inventory report may
establish that an installation is absent.

---

# 36. Unauthorized Software Decision

Actions:

```text
Remove Automatically
Request Approval
Create Exception
Mark False Positive
Ignore by Policy
Security Investigation
```

An actionable decision is retained as a Software Exception and referenced by
one Work Item. Approval requests use the Approval domain with the exception as
source. A temporary exception requires a distinct approval decision, owner,
reason, and expiry. Expiry is re-evaluated on the next inventory report.

---

# 37. Auto Removal Policy

Auto-uninstall chỉ khi:

```text
software clearly prohibited
uninstall command approved
low operational risk
no known business dependency
```

Không auto-remove software mơ hồ.

The Software domain stores only an approved symbolic uninstall profile, never
an arbitrary shell command or URL. Automatic dispatch is allowed only for
`PROHIBITED` software, an approved profile with explicit no-business-dependency
attestation, and a low-risk asset with a recent enrolled Agent. Otherwise the
exception stays actionable for an authorized operator. Agent success remains
`REMOVAL_PENDING` until a later complete inventory proves absence.

---

# 38. Compliance Exception

```yaml
software_exception:
  id:
  software:
  asset:
  user:
  reason:
  risk:
  detected_at:
  status:
  approved_until:
  approver:
```

State:

```text
OPEN
WAITING_APPROVAL
APPROVED_TEMPORARY
REMOVAL_PENDING
RESOLVED
```

---

# 39. Software Exception Expiry

Temporary approval phải có:

```text
expiry
review date
owner
```

Khi hết hạn:

```text
re-evaluate
→ remove / renew exception
```

---

# 40. Software Usage Tracking

Nếu agent hoặc SaaS API hỗ trợ:

```text
last used
usage frequency
active minutes
active users
```

Usage data phải có privacy policy rõ.

Mục tiêu:

```text
optimize license
detect unused software
```

không phải theo dõi người dùng quá mức.

---

# 41. License Model

Phải tách rõ:

```text
ENTITLEMENT
Doanh nghiệp có quyền dùng bao nhiêu

ASSIGNMENT
License đang gán cho ai/asset nào

INSTALLATION
Phần mềm thực tế đang cài ở đâu

USAGE
Ai đang thực sự sử dụng
```

---

# 42. License Types

Có thể hỗ trợ:

```text
Per User
Per Device
Concurrent
Subscription
Perpetual
Site License
Enterprise Agreement
Named User
Floating
Core/CPU based
Server Instance
```

---

# 43. License Entitlement Object

```yaml
license_entitlement:
  id:
  product:
  license_type:
  quantity:
  purchased_at:
  valid_from:
  valid_until:
  contract:
  supplier:
  cost_summary: # derived from immutable CostProvenance/CostAllocation records
  renewal:
  restrictions:
```

Entitlement effectiveness is derived from its contractual validity window; it
is not the License Assignment state machine and is not the compliance state:

```text
NOT_YET_VALID: now < valid_from
ACTIVE:        valid_from <= now AND (valid_until IS NULL OR now < valid_until)
EXPIRED:       valid_until IS NOT NULL AND now >= valid_until
```

All boundaries use UTC instants and the validity interval is half-open
`[valid_from, valid_until)`. A null `valid_until` represents an entitlement
without a contractual end date. Reads may expose this derived value as
`effective_state`; it is not a manually mutable entitlement state. Renewal is
an explicit, versioned change to contractual terms. The previous and new terms
must remain in append-only entitlement history. Expiration is the validity
window ending, not a manual lifecycle command; any `LICENSE.EXPIRED` fact is
keyed to the entitlement term/version so it can be emitted once per term.

License Entitlement financial history is held in immutable CostProvenance /
CostAllocation records, not by overwriting `cost` on the entitlement. Link
canonical Contract/ContractVersion, PO line, Invoice line and applied Credit
Note sources where applicable. Preserve source amount/currency and effective
commercial period. Renewal creates new period/source provenance and never
rewrites predecessor Contract or entitlement-period cost history. Cost
attaches primarily to the Entitlement or Pool/commercial entitlement unit;
assignment and seat use do not change commercial cost. Entitlement cost fields
are derived read-model summaries.

The `UNKNOWN`, `COMPLIANT`, `AT_RISK`, `OVERUSED`, `UNDERUSED`, and `EXPIRED`
values in the License Compliance State section are a separate calculated
compliance projection. They do not override or mutate entitlement effectiveness.

---

# 44. License Pool

Có thể chia theo:

```text
Department
Country
Business Unit
Project
Contract
```

Ví dụ:

```text
Adobe Pool - Marketing
100 seats
```

---

# 45. WF-L01 — Assign License

Trigger:

```text
Software Request Approved
Manual Assignment
Onboarding
Role Change
```

Flow:

```text
Check Entitlement
↓
Check Available Seat
↓
Reserve
↓
Assign User/Asset
↓
Deploy Software
↓
Verify Activation
```

---

# 46. License Assignment State

```text
RESERVED
ASSIGNED
ACTIVE
SUSPENDED
RECLAIM_PENDING
RECLAIMED
EXPIRED
CANCELLED
```

An unactivated `ASSIGNED` License may be cancelled only through the explicit
`LICENSE.CANCEL_ASSIGNMENT` command and then no longer consumes capacity.
`ACTIVE` and `SUSPENDED` assignments must follow reclaim; a cancelled
assignment record and its history remain retained.

---

# 47. License Consumption

Consumption phụ thuộc type.

Examples:

```text
Per User:
1 active user assignment = 1 consumed

Per Device:
1 assigned device = 1 consumed

Concurrent:
consumption = peak active sessions

Site:
not individual count-based
```

Không dùng một logic cho mọi license.

---

# 48. WF-L02 — License Compliance Calculation

Calculate:

```text
Entitled
Assigned
Installed
Active Usage
```

Example:

```text
Adobe Creative Cloud

Entitled: 100
Assigned: 92
Installed: 105
Active: 78
```

Potential findings:

```text
13 installations not mapped to assignment
5 possible unauthorized installs
22 potentially reclaimable licenses
```

---

# 49. License Compliance States

```text
COMPLIANT
AT_RISK
OVERUSED
UNDERUSED
EXPIRED
UNKNOWN
```

---

# 50. WF-L03 — License Overuse

Trigger:

```text
LICENSE.OVERUSED
```

Flow:

```text
Detect Overuse
↓
Identify Assignments
↓
Identify Installations
↓
Check Actual Usage
↓
Find Exceptions
```

Actions:

```text
Reclaim
Remove Unauthorized Install
Purchase More
Approve Temporary Overuse
Correct Inventory Data
```

---

# 51. Reclaim Candidate

Criteria:

```text
not used > N days
user disabled
asset retired
software uninstalled
duplicate assignment
role changed
```

---

# 52. WF-L04 — License Reclaim

Flow:

```text
Reclaim Candidate
↓
Check User/Business Need
↓
Notify if required
↓
Unassign License
↓
Optionally Uninstall Software
↓
Verify
↓
Return Seat to Pool
```

---

# 53. Offboarding Integration

When:

```text
USER.TERMINATED
```

System:

```text
Find License Assignments
↓
ASSIGNED → LICENSE.CANCEL_ASSIGNMENT
ACTIVE/SUSPENDED → LICENSE.RECLAIM
Terminal/non-capacity states → no-op
↓
Unassign device licenses
↓
Remove tokens/access
↓
Update pools
```

If cancellation or reclaim fails, offboarding retains an actionable License
clearance failure and cannot mark License cleanup complete.

---

# 54. Asset Retirement Integration

When:

```text
ASSET.RETIRED
```

System:

```text
Find device-based licenses
↓
Reclaim
↓
Remove software where needed
↓
Update entitlement usage
```

---

# 55. WF-L05 — License Expiry Watch

Scheduled thresholds:

```text
120 days
90 days
60 days
30 days
7 days
```

These configured thresholds govern License Entitlement expiry only. They do
not define Contract notice or renewal-alert thresholds. Contract alerts use
the explicit Contract-specific trigger rules in the Procurement/Contract
workflow.

Context:

```text
Current consumption
Usage trend
Business criticality
Renewal cost
Alternative software
Contract terms
```

---

# 56. Renewal Decision

Options:

```text
RENEW_SAME
RENEW_REDUCED
RENEW_INCREASED
MIGRATE_ALTERNATIVE
DO_NOT_RENEW
NEGOTIATE
```

---

# 57. Renewal Recommendation

Example:

```text
Entitled: 200
Assigned: 182
Active last 90d: 124
Peak concurrent: 98

Recommendation:
Renew 150 instead of 200
```

Must explain basis.

---

# 58. Contract Integration

Track:

```text
Supplier
Agreement
Start/End
Auto-renewal
Notice period
True-up terms
Support included
Price
Currency
```

---

# 59. SaaS License Integration

Nếu provider API available:

```text
sync users
sync assigned seats
sync active status
sync usage
```

Reconciliation:

```text
Internal License Assignment
vs
Vendor SaaS Assignment
```

---

# 60. Offline / Air-gapped License

System phải hỗ trợ license không thể sync online.

Evidence có thể:

```text
Manual activation record
License file
Dongle
Server license manager
```

---

# 61. License Document Types

```text
Purchase Order
Invoice
License Certificate
Contract
Renewal Quote
Vendor Statement
True-up Report
```

---

# 62. Artifact Repo Access Control

Roles:

## Artifact Maintainer

```text
upload
metadata edit
submit review
```

## Security Reviewer

```text
scan review
approve waiver
```

## Software Owner

```text
approve version
publish catalog item
```

## Deployment Operator

```text
deploy approved artifacts only
```

---

# 63. License Permissions

## Helpdesk

```text
view availability
assign approved license
reclaim low-risk license
```

## Software/License Admin

```text
manage entitlement
manage pools
resolve compliance
```

## Manager

```text
approve paid software
```

## Procurement/Finance

```text
manage renewal/cost/docs
```

---

# 64. Software Request User Experience

User flow:

```text
Portal
↓
Software Catalog
↓
Search App
↓
Select
↓
System shows:
- eligible?
- approval needed?
- license available?
- expected install time?
↓
Request
```

Nếu self-service:

```text
Approved + License Available
→ Auto Deploy
```

---

# 65. Software Request Status

User chỉ cần thấy:

```text
Requested
Waiting Approval
Approved
Installing
Installed
Failed
Rejected
```

Không cần thấy raw agent logs.

---

# 66. Agent Deployment Result

Internal detail:

```text
Asset
Artifact
Checksum
Agent Version
Command
Exit Code
Verification
Duration
Error Summary
```

---

# 67. Package Dependency

Artifact có thể phụ thuộc:

```text
runtime
framework
driver
certificate
configuration
another package
```

Dependency graph phải được resolve trước install.

---

# 68. Conflicting Software

Software catalog có thể định nghĩa:

```text
conflicts_with
```

Ví dụ:

```text
VPN Client A conflicts with VPN Client B
```

Flow:

```text
Requested install
↓
Conflict detected
↓
Uninstall old?
Approval?
Migration?
```

---

# 69. Version Compliance

Policy có thể:

```text
minimum version
required version
blocked versions
grace period
```

Example:

```text
Chrome < v140
→ Outdated
```

---

# 70. WF-SW07 — Outdated Software Remediation

Flow:

```text
Agent Inventory
↓
Compare Version Policy
↓
Outdated
↓
Auto Update / Campaign / Exception
```

---

# 71. Vulnerable Software Remediation

Trigger:

```text
CVE affects installed version
```

Flow:

```text
Identify affected assets
↓
Risk prioritize
↓
Approved patched artifact?
├─ YES → Deploy
└─ NO → Mitigation / Exception
```

High-risk remediation may integrate Change.

---

# 72. Artifact Revocation

If artifact later found malicious/broken:

```text
Artifact = REVOKED
↓
Find all installations
↓
Create Removal/Rollback Campaign
↓
Block future installs
↓
Notify relevant teams
```

---

# 73. Repository Retention

Do not delete old artifact immediately if:

```text
rollback may require it
active assets still depend on it
legal/audit retention applies
```

Possible:

```text
ACTIVE
ARCHIVED
RETIRED
PURGED
```

---

# 74. Repository Integrity

Scheduled job:

```text
recalculate checksum
verify storage integrity
verify metadata
```

If mismatch:

```text
ARTIFACT.INTEGRITY_MISMATCH
→ quarantine
```

---

# 75. Software Removal Workflow

Trigger:

```text
Unauthorized
User offboarding
License reclaim
Software retirement
Security issue
Manual request
```

Flow:

```text
Removal Requested
↓
Check Dependency
↓
Approval if needed
↓
Agent Uninstall
↓
Verify Removed
↓
Reclaim License
↓
Update Inventory
```

---

# 76. Software Retirement

Software product lifecycle:

```text
ACTIVE
DEPRECATED
RETIRED
```

Retirement plan:

```text
Stop New Installs
↓
Notify Owners
↓
Provide Replacement
↓
Migration Campaign
↓
Remove Remaining Installs
↓
Retire Artifact
```

---

# 77. Exception Handling

Software/License exceptions need:

```text
reason
scope
owner
risk
approval
expiry
review date
```

Không có permanent exception không review nếu policy không cho phép.

---

# 78. Unified Asset Timeline

Example:

```text
09/09 09:00 SOFTWARE REQUEST
VS Code requested by Nguyễn Văn An

09/09 09:01 POLICY
Software approved for Developer profile

09/09 09:02 DEPLOYMENT
Artifact vscode-1.99.msi selected

09/09 09:03 AGENT
Checksum verified

09/09 09:04 INSTALL
Installation successful

09/09 09:05 VERIFY
Version 1.99 detected

09/09 09:05 REQUEST
Request completed
```

---

# 79. Unified User Timeline

Could include:

```text
Software requested
License assigned
Software installed
License reclaimed
Software removed
```

---

# 80. Generated Events

## Software

```text
SOFTWARE.REQUESTED
SOFTWARE.APPROVAL_REQUIRED
SOFTWARE.APPROVED
SOFTWARE.REJECTED
SOFTWARE.INSTALL_STARTED
SOFTWARE.INSTALLED
SOFTWARE.INSTALL_FAILED
SOFTWARE.DEPLOYMENT_CAMPAIGN_CREATED
SOFTWARE.DEPLOYMENT_CAMPAIGN_STARTED
SOFTWARE.DEPLOYMENT_CAMPAIGN_PAUSED
SOFTWARE.DEPLOYMENT_CAMPAIGN_RESUMED
SOFTWARE.DEPLOYMENT_CAMPAIGN_ADVANCED
SOFTWARE.DEPLOYMENT_CAMPAIGN_COMPLETED
SOFTWARE.DEPLOYMENT_CAMPAIGN_STOPPED
SOFTWARE.DEPLOYMENT_JOB_QUEUED
SOFTWARE.DEPLOYMENT_JOB_CLAIMED
SOFTWARE.DEPLOYMENT_JOB_RETRIED
SOFTWARE.DEPLOYMENT_PRECHECK_COMPLETED
SOFTWARE.DEPLOYMENT_ARTIFACT_VERIFIED
SOFTWARE.INSTALLATION_REPORTED
SOFTWARE.INSTALLATION_VERIFIED
SOFTWARE.DEPLOYMENT_FAILED
SOFTWARE.DEPLOYMENT_SECURITY_FAILURE
SOFTWARE.UNAUTHORIZED_DETECTED
SOFTWARE.REMOVAL_REQUESTED
SOFTWARE.REMOVED
SOFTWARE.VERSION_OUTDATED
SOFTWARE.VULNERABLE_DETECTED
SOFTWARE.RETIRED
```

## Artifact

```text
ARTIFACT.UPLOADED
ARTIFACT.CHECKSUM_CREATED
ARTIFACT.SIGNATURE_VALIDATED
ARTIFACT.SCAN_REVIEW_REQUIRED
ARTIFACT.SCAN_PASSED
ARTIFACT.SCAN_FAILED
ARTIFACT.APPROVED
ARTIFACT.REJECTED
ARTIFACT.ACTIVATED
ARTIFACT.RESTRICTED
ARTIFACT.REVOKED
ARTIFACT.INTEGRITY_MISMATCH
```

## Software Catalog

```text
SOFTWARE.CATALOG_ITEM_CREATED
SOFTWARE.VERSION_CREATED
SOFTWARE.CLASSIFICATION_CHANGED
SOFTWARE.CATALOG_VISIBILITY_CHANGED
SOFTWARE.CATALOG_VERSION_PUBLISHED
SOFTWARE.CATALOG_VERSION_WITHDRAWN
```

## License

```text
LICENSE.ENTITLEMENT_CREATED
LICENSE.RESERVED
LICENSE.RESERVATION_RELEASED
LICENSE.ASSIGNED
LICENSE.ASSIGNMENT_CANCELLED
LICENSE.ACTIVATED
LICENSE.SUSPENDED
LICENSE.RECLAIM_PENDING
LICENSE.RECLAIMED
LICENSE.USAGE_OBSERVED
LICENSE.OVERUSED
LICENSE.UNDERUSED
LICENSE.EXPIRING
LICENSE.EXPIRED
LICENSE.RENEWED
LICENSE.COMPLIANCE_EXCEPTION
```

---

# 81. Downstream Workflow Mapping

```text
Software Request needs approval
→ Approval Engine

No license available
→ Procurement / License Renewal

High-risk deployment
→ Change Management

Install failure
→ Helpdesk Work Queue

Unauthorized software
→ Compliance / Security

Vulnerable software
→ Incident / Change / Security

User terminated
→ Offboarding

Asset retired
→ License Reclaim

Artifact security failure
→ Security Review
```

---

# 82. Notifications

## User-facing

```text
Request submitted
Approval needed
Approved
Install scheduled
Installed
Failed
Rejected
```

## Operator

```text
Artifact scan failed
License overuse
Unauthorized software
Deployment campaign failure
License expiry
```

Do not notify every successful inventory sync.

---

# 83. SLA / Timers

Configurable:

```text
Software approval SLA
Install SLA
Deployment retry window
License reclaim grace
License renewal notice
Exception expiry
Artifact review SLA
```

---

# 84. Metrics / KPI

## Software

```text
Approved Software Coverage
Unauthorized Software Count
Install Success Rate
Mean Deployment Time
Outdated Version Count
Vulnerable Installation Count
```

## Artifact

```text
Scan Failure Rate
Artifact Approval Time
Revoked Artifact Count
Integrity Failure Count
```

## License

```text
License Utilization
Overuse Count
Unused Seat Count
Reclaim Rate
Renewal Savings
Cost per Active User
Expired License Exposure
```

---

# 85. Idempotency

Examples:

```text
software_request:{user}:{asset}:{product}:{request_version}
deployment:{asset}:{artifact_version}:{job_id}
license_assignment:{license_pool}:{principal}:{version}
reclaim:{assignment_id}:{operation_version}
artifact:{product}:{version}:{checksum}
```

Retry không tạo duplicate:

```text
Install Request
Deployment Job
License Assignment
Reclaim
Artifact Version
```

---

# 86. Duplicate Prevention

Không được có:

```text
Chrome
Google Chrome
Chrome x64
```

thành ba Software Product nếu normalization xác định cùng sản phẩm.

Không được có 2 active license assignments giống nhau cho cùng principal nếu license model không cho phép.

---

# 87. Guardrails

Hệ thống không được:

1. Deploy artifact chưa approved nếu policy yêu cầu approval.
2. Chạy artifact checksum mismatch.
3. Silently replace binary cùng version nhưng checksum khác.
4. Auto-remove unknown software khi chưa đủ confidence.
5. Gán license vượt entitlement mà không exception.
6. Đếm installation = entitlement usage cho mọi license type.
7. Reclaim license nhưng mất lịch sử assignment.
8. Mark install success chỉ từ exit code.
9. Tự reboot production asset không có policy.
10. Public internal/restricted software cho mọi user.
11. Cho Agent tải installer từ arbitrary URL ngoài approved source.
12. Cho exception không có owner/expiry nếu policy yêu cầu.
13. Xóa artifact cũ khi còn cần rollback.
14. Dùng IP/hostname làm principal license duy nhất nếu assignment thực tế theo user/asset.
15. Log secrets/token/license keys ở plaintext.
16. Cho revoked artifact tiếp tục deploy mới.
17. Renew license chỉ dựa vào assigned count mà không xem usage.

---

# 88. End-to-End Example — User Requests Photoshop

```text
User opens Software Catalog
↓
Requests Adobe Photoshop
↓
System checks:
User = Marketing
Asset = Windows Laptop
Software = Approved Restricted
License Pool = 3 seats available
↓
Manager approval required
↓
Approved
↓
1 license reserved
↓
Approved artifact selected
↓
Agent pre-check PASS
↓
Artifact downloaded
↓
Checksum/signature PASS
↓
Install
↓
Version detected
↓
License activated
↓
License Assignment ACTIVE
↓
Request completed
```

---

# 89. End-to-End Example — Unauthorized Torrent Client

```text
Agent inventory detects TorrentClient
↓
Catalog classification = PROHIBITED
↓
Compliance Exception created
↓
Policy allows auto-remove
↓
Approved uninstall command executed
↓
Agent verifies removed
↓
Compliance restored
↓
Asset timeline updated
```

---

# 90. End-to-End Example — License Optimization

```text
Adobe entitlement = 100
↓
Assigned = 94
↓
Active usage last 90d = 71
↓
18 users inactive >90d
↓
Reclaim candidates created
↓
Managers review
↓
14 seats reclaimed
↓
Next renewal recommendation = 85 seats
↓
Estimated saving calculated
```

---

# 91. End-to-End Example — Vulnerable Artifact Revocation

```text
VPN Client v6.2.0 vulnerability announced
↓
Artifact marked REVOKED
↓
Future deployment blocked
↓
System finds 182 installations
↓
v6.2.1 already approved
↓
Change / Deployment Campaign created
↓
Pilot 10 devices
↓
Verification PASS
↓
Rollout 100%
↓
Old version removed
↓
Compliance restored
```

---

# 92. End-to-End Example — Install Failure

```text
User requests VS Code
↓
Approved + no license required
↓
Deployment starts
↓
Agent pre-check PASS
↓
Download PASS
↓
Checksum PASS
↓
Install exit code failure
↓
Retry once
↓
Still fails
↓
Helpdesk Work Item created with:
- asset
- artifact
- exit code
- logs summary
↓
Technician resolves dependency issue
↓
Re-run deployment
↓
Install PASS
```

---

# 93. Definition of Done

Cụm workflow này đạt yêu cầu khi:

- Software Catalog phân loại Approved/Restricted/Prohibited/Unknown/Deprecated/Retired.
- Catalog hỗ trợ profile theo role/department/asset.
- Artifact Repository có version/checksum/signature/source/security scan.
- Artifact approval/revocation hoạt động.
- Software request kiểm tra eligibility + approval + license.
- Agent deployment có pre-check, integrity verify, install, post-check.
- Install success có actual software verification.
- Campaign rollout hỗ trợ pilot và stop condition.
- Agent inventory normalize software names.
- Unauthorized software tạo compliance exception.
- Software exception có owner/expiry.
- License model tách Entitlement/Assignment/Installation/Usage.
- Hỗ trợ nhiều license type.
- Overuse/underuse/reclaim/expiry/renewal có workflow.
- Offboarding/retirement reclaim license.
- Renewal recommendation dựa trên actual usage.
- Artifact and license actions có permissions, timers, notifications, idempotency.
- Unified Timeline phản ánh request/deployment/license history.
