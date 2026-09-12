# IDENTITY + SSO + RBAC + USER LIFECYCLE + OFFBOARDING WORKFLOW SPEC
## Execution-Level Workflow Design

**Version:** 0.1  
**Status:** Draft for implementation  
**Parent:** `MASTER_WORKFLOW_MAP.md`  
**Depends on:**  
- `HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`
- `SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md`
- `PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`

**Scope:** Identity Provider Integration, SSO, Directory Sync, SCIM/LDAP/AD, User Lifecycle, Department/Manager/Location Sync, RBAC, Role Mapping, Permission Evaluation, Session Management, Joiner/Mover/Leaver, Offboarding, Asset Return, License Reclaim, Access Revocation, Clearance, Audit Trail

---

# 1. Mục tiêu

Tài liệu này chuẩn hóa chuỗi:

```text
Identity Provider
→ User Sync
→ Organization Context
→ Role Mapping
→ SSO
→ RBAC
→ Asset / License / Service Context
→ Joiner / Mover / Leaver
→ Offboarding
→ Asset Return
→ License Reclaim
→ Access Revocation
→ Clearance
```

Mục tiêu chính:

- Identity là nguồn context cho toàn hệ thống;
- không tạo user thủ công trùng với directory nếu có nguồn chuẩn;
- SSO phải tách khỏi authorization;
- RBAC phải giải thích được tại sao user có quyền;
- department, manager, location và employment state phải sync được;
- Joiner/Mover/Leaver phải kích hoạt workflow downstream tự động;
- offboarding không chỉ disable account mà phải thu hồi asset, license và access;
- hỗ trợ nhiều nguồn identity nhưng có precedence rõ ràng;
- mọi thay đổi quyền và role phải audit được;
- tránh mất quyền hoặc dư quyền khi user đổi vị trí;
- không lưu secrets/credentials thô trong audit/log.

---

# 2. Core Entities

```text
USER
IDENTITY
IDENTITY PROVIDER
DIRECTORY
DIRECTORY ACCOUNT
EMPLOYMENT RECORD
DEPARTMENT
TEAM
MANAGER RELATION
LOCATION
SITE
JOB ROLE
BUSINESS ROLE
SYSTEM ROLE
PERMISSION
ROLE BINDING
GROUP
GROUP MEMBERSHIP
ACCESS POLICY
SESSION
AUTHENTICATION EVENT
SSO CONNECTION
SCIM CONNECTION
LDAP/AD CONNECTION
SERVICE ACCOUNT
APP ENTITLEMENT
ACCESS REQUEST
ACCESS REVIEW
OFFBOARDING CASE
CLEARANCE TASK
ASSET ASSIGNMENT
LICENSE ASSIGNMENT
AUDIT TRAIL
```

---

# 3. Identity Source Types

Hệ thống có thể tích hợp:

```text
Active Directory
LDAP
Microsoft Entra ID
Google Workspace
OIDC Provider
SAML Provider
SCIM Provider
HRIS
Manual Local Directory
API Import
CSV Import
```

Không phải source nào cũng là source-of-truth cho mọi field.

---

# 4. Source-of-Truth Precedence

Ví dụ policy:

```text
Employment Status → HRIS
Primary Email → IdP
Department → HRIS
Manager → HRIS
Location → HRIS/Directory
Display Name → IdP
System Role → Internal RBAC
Asset Assignment → AssetOps
License Assignment → AssetOps
```

Nếu conflict:

```text
show source
show last sync
do not silently overwrite critical internal fields
```

---

# 5. User Identity Model

```yaml
user:
  id:
  external_ids:
  username:
  primary_email:
  display_name:
  employment_status:
  department:
  manager:
  job_title:
  location:
  business_unit:
  cost_center:
  start_date:
  end_date:
  identity_source:
  status:
```

---

# 6. User Status

```text
PRE_HIRE
ACTIVE
SUSPENDED
LEAVE
TERMINATING
TERMINATED
ARCHIVED
```

Không dùng login_enabled như user lifecycle duy nhất.

---

# 7. WF-ID01 — Initial User Sync

## Trigger

```text
SYNC.USER_CREATED
SCIM.USER_CREATED
DIRECTORY.USER_DETECTED
HRIS.NEW_HIRE
```

## Flow

```text
Receive External User
↓
Normalize Identity
↓
Match Existing User
↓
Conflict Check
↓
Create/Link User
↓
Sync Organization Context
↓
Evaluate Role Mapping
↓
Create Joiner Tasks if applicable
```

---

# 8. User Matching

Priority:

```text
trusted external ID
employee ID
verified email
username + source
manual review
```

Không match chỉ theo display name.

---

# 9. Duplicate User Prevention

Nếu:

```text
same employee_id
or same trusted external identity
```

→ link to existing user.

Nếu ambiguous:

```text
Identity Review Queue
```

Không auto-merge.

---

# 10. Field Sync Rules

Mỗi field có:

```yaml
field_sync:
  source:
  authoritative:
  overwrite_allowed:
  last_synced_at:
```

Ví dụ:

```text
Department
source = HRIS
authoritative = true
```

---

# 11. Sync Conflict

Nếu internal value khác source authoritative:

```text
source wins
```

Nếu internal field được manual-lock:

```text
manual override
→ reason
→ expiry
→ audit
```

---

# 12. Sync Failure

Event:

```text
SYNC.USER_FAILED
```

Store:

```text
source
user
field
error
retry_count
last_attempt
```

Retry có backoff.

Nếu nhiều user fail:

```text
Directory Integration Work Item
```

---

# 13. SSO Architecture Principle

Phân biệt:

```text
Authentication = Who are you?
Authorization = What may you do?
```

SSO xác thực identity.

RBAC quyết định quyền trong AssetOps.

Không map trực tiếp "SSO successful" = "full access".

---

# 14. Supported SSO

```text
OIDC
SAML 2.0
LDAP bind
AD federation
```

Prefer modern federation where possible.

---

# 15. WF-ID02 — User Login via SSO

Flow:

```text
User opens App
↓
Select/Resolve IdP
↓
Redirect to IdP
↓
Authenticate
↓
Receive Assertion/Token
↓
Validate
↓
Resolve User
↓
Check User Status
↓
Resolve Role Bindings
↓
Evaluate Permissions
↓
Create Session
↓
Load Personalized Workspace
```

---

# 16. Token / Assertion Validation

Check:

```text
issuer
audience
signature
expiry
nonce/state
clock skew
subject
tenant/domain if applicable
```

Không tin token chỉ vì parse được.

---

# 17. Login Decision Table

| Condition | Action |
|---|---|
| Valid identity + Active user | Allow |
| Valid identity + PRE_HIRE | Optional limited onboarding access |
| Valid identity + SUSPENDED | Deny unless policy |
| Valid identity + TERMINATED | Deny |
| Unknown user + JIT allowed | Create provisional user |
| Unknown user + JIT disabled | Deny + Identity Review |
| IdP unavailable | Apply fallback policy |
| Token invalid | Deny + audit |

---

# 18. Just-in-Time Provisioning

Nếu JIT enabled:

```text
SSO Identity
↓
Validate Domain/Tenant
↓
Create Provisional User
↓
Map Basic Role
↓
Require background sync
```

JIT user không nên tự nhận privileged role chỉ từ group claim nếu policy chưa approve.

---

# 19. Session Model

```yaml
session:
  id:
  user:
  created_at:
  last_activity:
  expires_at:
  source_ip:
  device_context:
  auth_method:
  risk:
```

---

# 20. Session Controls

Configurable:

```text
idle timeout
absolute timeout
reauth for sensitive action
concurrent session policy
logout all sessions
```

Sensitive actions có thể yêu cầu re-auth:

```text
high-risk permission change
security override
data wipe approval
privileged network change
```

---

# 21. Authentication Events

```text
AUTH.LOGIN_SUCCESS
AUTH.LOGIN_FAILED
AUTH.LOGOUT
AUTH.SESSION_EXPIRED
AUTH.MFA_REQUIRED
AUTH.SUSPICIOUS_LOGIN
```

---

# 22. RBAC Model

RBAC gồm:

```text
User
→ Role Binding
→ Role
→ Permissions
→ Resource Scope
```

Không chỉ:

```text
user.is_admin = true
```

---

# 23. Role Types

## Business Role

Ví dụ:

```text
Employee
Manager
Auditor
Procurement Approver
```

## System Role

Ví dụ:

```text
Helpdesk L1
Helpdesk L2
Asset Admin
Network Operator
Software Admin
License Admin
Incident Manager
Problem Manager
Change Manager
System Admin
```

---

# 24. Permission Model

Permission nên là action cụ thể:

```text
asset.read
asset.assign
asset.transfer
asset.retire
ticket.read
ticket.assign
incident.declare_major
network.change_vlan
software.deploy
license.assign
contract.lifecycle
contract.amend
commercial_document.finalize
rbac.manage
```

---

# 25. Resource Scope

Permission có thể giới hạn theo:

```text
Organization
Business Unit
Department
Site
Warehouse
Service
Asset Class
Cost Center
```

Ví dụ:

```text
asset.read
scope = Hanoi Site
```

---

# 26. Role Binding

```yaml
role_binding:
  principal:
  role:
  scope:
  source:
  valid_from:
  valid_until:
  reason:
```

Source:

```text
Manual
Directory Group
SCIM Group
Policy
Approval
Temporary Elevation
```

---

# 27. Group-to-Role Mapping

Ví dụ:

```text
AAD Group: IT-Helpdesk
→ Role: Helpdesk L1

AAD Group: Network-Team
→ Role: Network Operator
```

Mapping phải versioned.

---

# 28. Role Mapping Precedence

Có thể:

```text
Explicit Deny
> Explicit Grant
> Group Mapping
> Default Role
```

Policy tùy hệ thống.

---

# 29. Effective Permission Evaluation

Khi user thao tác:

```text
Collect Role Bindings
↓
Apply Scope
↓
Apply Deny Rules
↓
Apply Temporary Grants
↓
Evaluate Resource
↓
Allow / Deny
```

---

# 30. Explainable Authorization

Admin cần xem:

```text
Why can Nguyễn Văn A transfer this asset?
```

System trả:

```text
Role = Asset Admin
Source = Group IT-Asset-Admins
Scope = Hanoi Site
Permission = asset.transfer
```

---

# 31. Permission Denial Feedback

End user:

```text
You do not have permission for this action.
```

Admin/operator detail:

```text
missing permission
required scope
policy reference
```

Không leak sensitive role structure cho user bình thường nếu policy hạn chế.

---

# 32. Temporary Privilege Elevation

Use cases:

```text
Emergency Incident
Short-term project
Vendor support
Change implementation
```

Flow:

```text
Request Elevated Role
↓
Approval
↓
Time-limited Binding
↓
Auto Expire
↓
Audit
```

---

# 33. Privilege Expiry

Temporary role bắt buộc:

```text
valid_until
```

Expired:

```text
ROLE_BINDING.EXPIRED
```

Không giữ quyền vô thời hạn.

---

# 34. Break-glass Access

Emergency privileged account:

```text
strong auth
restricted use
high audit
short session
alert security
post-review
```

Không dùng làm admin account thường ngày.

---

# 35. Service Accounts

Service account model:

```yaml
service_account:
  id:
  owner:
  purpose:
  permissions:
  scope:
  credential_rotation:
  expiry:
  last_used:
```

Không gắn service account như normal employee user.

---

# 36. Service Account Guardrails

Must:

```text
have owner
have purpose
least privilege
rotation policy
usage audit
```

Dormant service accounts:

```text
review / disable
```

---

# 37. Joiner / Mover / Leaver Model

```text
JOINER
User starts

MOVER
Department/Role/Location changes

LEAVER
Employment ends
```

Đây là lifecycle chính của user.

---

# 38. WF-JML01 — Joiner

Trigger:

```text
HRIS.NEW_HIRE
SCIM.USER_CREATED
MANUAL.ONBOARDING_REQUEST
```

Flow:

```text
Pre-hire User
↓
Department/Manager/Location
↓
Role Mapping
↓
Access Profile
↓
Asset Need
↓
Software Profile
↓
License Need
↓
Start Date
↓
Activate
```

---

# 39. Pre-Hire State

Có thể tạo user trước start date:

```text
status = PRE_HIRE
```

Cho phép:

```text
prepare asset
reserve license
schedule onboarding
```

Không cho full app access trước start date nếu policy không cho.

---

# 40. Joiner Tasks

Có thể tự tạo:

```text
Asset Reservation
Laptop Preparation
Software Profile
License Assignment
Access Requests
Welcome/Orientation Tasks
```

---

# 41. Access Profile

Theo:

```text
Department
Job Role
Location
Employment Type
Project
```

Ví dụ:

```text
Marketing Employee Profile:
- Self-service portal
- Standard SaaS
- VPN
- Marketing license pool
- Standard laptop profile
```

---

# 42. WF-JML02 — Mover

Trigger:

```text
USER.DEPARTMENT_CHANGED
USER.ROLE_CHANGED
USER.LOCATION_CHANGED
MANAGER_CHANGED
```

Flow:

```text
Detect Change
↓
Compare Old vs New Context
↓
Re-evaluate Roles
↓
Re-evaluate Access
↓
Re-evaluate Asset Policy
↓
Re-evaluate Software/License
↓
Create Required Tasks
```

---

# 43. Department Change Example

```text
Finance → Engineering
```

System may:

```text
remove Finance app role
add Engineering app role
review current license assignments
review current asset specification
review location/network policy
```

Không tự thu hồi mọi thứ ngay nếu grace period/policy yêu cầu review.

---

# 44. Location Change

Example:

```text
Hanoi → HCM
```

Potential downstream:

```text
Asset Transfer
Warehouse/Site change
Network/VLAN profile change
Local software/profile
Manager change
Access scope change
```

---

# 45. Manager Change

Update:

```text
approval routing
escalation path
offboarding owner
asset request approver
```

Không nên hardcode manager vào open workflow nếu approval đã captured; use workflow policy.

---

# 46. Role Drift Detection

Periodic review:

```text
Current Roles
vs
Expected Roles from policy
```

Possible:

```text
EXPECTED
EXTRA_PRIVILEGE
MISSING_PRIVILEGE
UNKNOWN_SOURCE
```

---

# 47. WF-ID03 — Access Review

Scheduled:

```text
Quarterly
Semiannual
Annual
High-risk monthly
```

Review:

```text
Privileged Roles
Temporary Access
Dormant Accounts
Service Accounts
Sensitive Scopes
```

Decision:

```text
Keep
Remove
Reduce Scope
Expire
Investigate
```

---

# 48. User Access Review Object

```yaml
access_review:
  user:
  role:
  scope:
  source:
  last_used:
  reviewer:
  decision:
  evidence:
```

---

# 49. Dormant Account Detection

Criteria configurable:

```text
no login > N days
inactive employee
no assigned work
stale external account
```

Do not auto-delete.

Action:

```text
review
suspend
archive
```

---

# 50. WF-JML03 — Leaver / Offboarding

Triggers:

```text
AUTHORITATIVE.TERMINATION_REQUEST
HRIS.END_DATE_REACHED
MANUAL.OFFBOARDING
```

Flow:

```text
Create Offboarding Case (INITIATED)
↓
Capture pre_offboarding_user_state and termination request reference
↓
OFFBOARDING.START
↓
Offboarding Case → IN_PROGRESS
User Lifecycle → TERMINATING through its own validated transition
↓
Disable Interactive Access
↓
Find Assets
↓
Find Licenses
↓
Find App Entitlements
↓
Find Temporary Roles
↓
Find Service Ownership
↓
Create Clearance Tasks
↓
Collect / Reclaim
↓
Verify
↓
Set TERMINATED
```

---

# 51. Offboarding Timing

Support:

```text
Immediate termination
Scheduled future termination
End-of-day termination
Graceful contractor end
```

Critical security termination:

```text
disable access first
then downstream collection
```

---

# 52. Offboarding Context Collection

System finds:

```text
Assigned Assets
Temporary Loans
Software Licenses
SaaS Seats
System Roles
Privileged Access
Open Approvals
Open Tickets
Owned Contracts
Owned Services
Service Accounts owned
Pending Changes
Documents requiring transfer
```

---

# 53. Access Revocation Order

Possible policy:

```text
1. Interactive login
2. Privileged roles
3. VPN/remote access
4. SaaS sessions
5. API tokens
6. Temporary grants
7. Device certificates
```

Order configurable based on security risk.

---

# 54. Asset Return Integration

Offboarding:

```text
Find Assigned Assets
↓
Create Return Tasks
↓
Notify User/Manager
↓
Receive
↓
Inspect
↓
Close Assignment
```

Leverages existing Asset Return workflow.

---

# 55. License Reclaim Integration

Offboarding:

```text
Find User Licenses
↓
ASSIGNED → LICENSE.CANCEL_ASSIGNMENT
ACTIVE/SUSPENDED → LICENSE.RECLAIM
Terminal/non-capacity states → no-op
↓
Release Named User License
↓
Unassign Device Licenses as needed
↓
Update Pools
```

If cancellation or reclaim fails, the offboarding case retains an actionable
License cleanup failure and cannot mark License clearance complete. Committed
License history is retained.

---

# 56. Software/Access Cleanup

Can trigger:

```text
Uninstall restricted software
remove certificates
remove VPN profile
remove business app access
```

based on policy.

---

# 57. Ownership Transfer

Before termination complete:

```text
Contracts owned
Services owned
Change ownership
Knowledge ownership
Service account ownership
Automation ownership
```

must be transferred if required.

---

# 58. Open Workflow Reassignment

Find:

```text
Open Tickets
Approvals
Changes
Problems
Procurement Requests
Maintenance Orders
```

Reassign to:

```text
Manager
Team
Replacement Owner
```

---

# 59. Offboarding Clearance Tasks

Example:

```text
Identity Access Revoked
Assets Returned
Licenses Reclaimed
Open Work Reassigned
Service Ownership Transferred
Privileged Access Removed
Security Review Complete
```

---

# 60. Offboarding Case State

```text
INITIATED
IN_PROGRESS
BLOCKED
READY_TO_CLOSE
CANCELLATION_PENDING
COMPLETED
CANCELLED
```

The Offboarding Case and User Lifecycle are independent state machines.
Persist `pre_offboarding_user_state` before the User Lifecycle transition to
`TERMINATING`; each transition is explicit, versioned and validated by Identity.

Normal transitions:

```text
INITIATED → START → IN_PROGRESS
IN_PROGRESS → blocking failure → BLOCKED
BLOCKED → RESUME → IN_PROGRESS
IN_PROGRESS → MARK_READY → READY_TO_CLOSE
READY_TO_CLOSE → COMPLETE → COMPLETED
```

Cancellation transitions:

```text
INITIATED → OFFBOARDING.CANCEL → CANCELLED
  only when no compensation is required

IN_PROGRESS | BLOCKED | READY_TO_CLOSE
  → OFFBOARDING.REQUEST_CANCEL
  → CANCELLATION_PENDING
CANCELLATION_PENDING
  → OFFBOARDING.COMPLETE_CANCELLATION
  → CANCELLED
```

When User Lifecycle is `TERMINATING`, cancellation requires withdrawal or
cancellation of the authoritative termination request. Successful cancellation
may restore `TERMINATING` to `pre_offboarding_user_state` only through an
explicit validated Identity transition. Offboarding cancellation never restores
a `TERMINATED` User; use `USER.REACTIVATE` / REHIRE.

`OFFBOARDING.CANCEL` is allowed only from `INITIATED` when no compensation is
required. Later cancellation uses `OFFBOARDING.REQUEST_CANCEL` followed by
`OFFBOARDING.COMPLETE_CANCELLATION` after recovery is complete or explicitly
policy-waived.

After side effects begin, retain their history and execute compensating or
recovery actions. `CANCELLATION_PENDING` remains until each required recovery
action succeeds or an authorized policy records `WAIVED` /
`ACCEPTED_EXCEPTION`. Completed data wipe or disposal is irreversible and
requires recovery/manual exception work. Do not delete or rewrite action history.

`READY_TO_CLOSE` requires all mandatory tasks succeeded or policy-approved
waived, no unresolved blockers, a valid authoritative termination request and
no pending cancellation. `COMPLETED` requires canonical User Lifecycle
`TERMINATED`, observed or produced by the normative finalization flow.
`COMPLETED` and `CANCELLED` are terminal; `COMPLETED → CANCELLED` is forbidden.

All state-changing commands enforce expected version, idempotency, permission,
reason, audit, outbox and correlation ID where applicable. `COMPLETE` and
`OFFBOARDING.REQUEST_CANCEL` serialize on the same Offboarding Case version;
exactly one may win and a stale competing command must receive a version
conflict. If one command changes both the case and User Lifecycle, it validates
both aggregate versions and commits both explicit Identity transitions
atomically.

---

# 61. Clearance Completion

Offboarding only complete when all required controls pass.

Example:

```text
No Active Login
No Privileged Role
No Outstanding Tracked Asset
No Active Named License
No Owned Critical Service
No Active Temporary Access
```

---

# 62. Missing Asset During Offboarding

If asset not returned:

```text
Offboarding Case = BLOCKED or Completed with Exception
```

depending policy.

Create:

```text
Missing Asset Exception
Manager Escalation
Security/Finance workflow if needed
```

Không tự mark asset Disposed.

---

# 63. User Archive

After retention period:

```text
ACTIVE RECORD
→ ARCHIVED
```

Do not delete audit history.

Keep references required by:

```text
asset history
ticket history
approvals
documents
security audit
```

---

# 64. Rehire Scenario

If terminated user returns:

```text
New Employment Event
↓
Match Existing Archived Identity
↓
Reactivate or create new employment linkage
↓
Do not blindly restore old permissions
↓
Re-run Joiner Policy
```

---

# 65. Contractor Expiry

Contractor account should have:

```text
valid_until
sponsor/manager
```

Before expiry:

```text
T-14
T-7
T-1
```

notify sponsor.

If not extended:

```text
Offboarding
```

---

# 66. External/Vendor Access

Use:

```text
External User
Sponsor
Scope
Expiry
MFA requirement
Restricted role
```

Do not give standard employee role by default.

---

# 67. Orphaned Identity Detection

Examples:

```text
Directory account exists but no internal User
Internal User exists but directory account missing
Active role binding with terminated user
Service account without owner
```

Create Identity Exception.

---

# 68. Identity Exception Object

```yaml
identity_exception:
  id:
  type:
  user:
  source:
  expected:
  observed:
  severity:
  status:
  owner:
```

Types:

```text
DUPLICATE_IDENTITY
ORPHAN_ACCOUNT
ROLE_DRIFT
SYNC_FAILURE
EXPIRED_EXTERNAL_USER
UNOWNED_SERVICE_ACCOUNT
TERMINATED_USER_ACTIVE_ACCESS
```

---

# 69. Identity Work Queue

Actionable items only:

```text
Sync Failed
Duplicate Identity
Role Drift
Terminated User with Access
Orphan Account
Service Account without Owner
External Access Expiring
```

Raw sync success không tạo Work Item.

---

# 70. SCIM Group Sync

Possible:

```text
SCIM Group
→ Internal Group
→ Role Mapping
```

Need:

```text
group create/update/delete
membership add/remove
mapping audit
```

---

# 71. Group Deletion Guardrail

Nếu source group bị xóa:

```text
do not instantly delete internal role definitions
```

Instead:

```text
remove/expire bindings sourced from group
retain audit
flag mapping stale
```

---

# 72. LDAP/AD Sync

Sync may include:

```text
users
groups
department
manager
office/location
disabled state
```

Need incremental sync if possible.

---

# 73. Multi-IdP

Organization may have:

```text
Employee IdP
Vendor IdP
Subsidiary IdP
```

Routing based on:

```text
email domain
tenant
organization
user type
```

---

# 74. Enterprise SSO Branding

Login page may show:

```text
Company Logo
Company Name
Approved IdP Buttons
Security Notice
Support Link
```

Branding must not change authentication logic.

---

# 75. RBAC + Asset Context

Example:

```text
Helpdesk L1
scope = Hanoi

Can:
view/triage Hanoi user tickets
view Hanoi assets
run approved remediation

Cannot:
retire assets
change VLAN
approve procurement
```

---

# 76. RBAC + Sensitive Actions

High-risk actions may need:

```text
permission
AND
approval
AND/OR
reauthentication
```

Examples:

```text
Data Wipe
Asset Disposal
VLAN Change
Role Grant
Contract Approval
```

---

# 77. Policy Decision Object

For audit:

```yaml
authorization_decision:
  user:
  action:
  resource:
  roles:
  scope:
  policy:
  result:
  timestamp:
```

Not every low-level read needs persisted event if too noisy; policy configurable.

---

# 78. Access Request

Users/managers may request:

```text
Role
Application
Privileged Scope
Temporary Access
```

Flow:

```text
Request
↓
Eligibility
↓
Approval
↓
Grant
↓
Expiry/Review
```

---

# 79. Privileged Access Request

Must include:

```text
reason
scope
duration
target system
approver
```

Optional:

```text
change/incident reference
```

---

# 80. Joiner Example

```text
HRIS creates employee Nguyễn Văn An
Start date = 15/09
Department = Engineering
Location = Hanoi
↓
User created PRE_HIRE
↓
Engineering profile evaluated
↓
Laptop reservation created
↓
Developer software profile prepared
↓
Git/VPN access requested
↓
Start date arrives
↓
Identity status ACTIVE
↓
SSO allowed
↓
Default roles active
↓
Asset handover completed
```

---

# 81. Mover Example

```text
User moves Finance → Engineering
↓
Directory sync detects department change
↓
Role diff calculated
↓
Finance-specific access marked for removal
↓
Engineering role/access requested
↓
License review
↓
Current laptop checked against Engineering profile
↓
Additional software deployed
↓
Manager approval route updated
↓
Timeline/audit updated
```

---

# 82. Offboarding Example

```text
HRIS termination effective 18:00
↓
At 18:00:
User → TERMINATING
Interactive SSO disabled
Privileged roles removed
VPN access revoked
↓
System finds:
Laptop AST-0042
Adobe license
Git access
2 open approvals
1 service ownership
↓
Return Task created
License reclaim initiated
Approvals reassigned
Service ownership transferred
↓
Laptop returned next day
↓
All clearance checks PASS
↓
User → TERMINATED
↓
Identity retained for audit
```

---

# 83. Emergency Termination Example

```text
Security termination now
↓
Disable SSO sessions immediately
↓
Revoke privileged access
↓
Revoke VPN/tokens
↓
Remote device control if policy
↓
Create Asset Return/Security Tasks
↓
Notify limited authorized stakeholders
```

---

# 84. Generated Events

## Identity

```text
USER.CREATED
USER.UPDATED
USER.ACTIVATED
USER.SUSPENDED
USER.TERMINATING
USER.TERMINATED
USER.ARCHIVED
USER.DEPARTMENT_CHANGED
USER.LOCATION_CHANGED
USER.MANAGER_CHANGED
USER.ROLE_CHANGED
```

## Auth

```text
AUTH.LOGIN_SUCCESS
AUTH.LOGIN_FAILED
AUTH.SESSION_REVOKED
AUTH.IDP_UNAVAILABLE
```

## RBAC

```text
ROLE.BINDING_CREATED
ROLE.BINDING_UPDATED
ROLE.BINDING_EXPIRED
ROLE.BINDING_REVOKED
ACCESS.REQUESTED
ACCESS.APPROVED
ACCESS.REJECTED
ACCESS.REVIEW_DUE
ROLE.DRIFT_DETECTED
```

## Sync

```text
SYNC.USER_CREATED
SYNC.USER_UPDATED
SYNC.USER_FAILED
SYNC.GROUP_UPDATED
SYNC.CONFLICT_DETECTED
```

## Offboarding

```text
OFFBOARDING.CREATED
OFFBOARDING.STARTED
OFFBOARDING.ACCESS_REVOKED
OFFBOARDING.ASSET_RETURN_REQUIRED
OFFBOARDING.LICENSE_RECLAIM_REQUIRED
OFFBOARDING.BLOCKED
OFFBOARDING.RESUMED
OFFBOARDING.READY_TO_CLOSE
OFFBOARDING.CANCELLATION_REQUESTED
OFFBOARDING.CANCELLED
OFFBOARDING.COMPLETED
```

---

# 85. Downstream Workflow Mapping

```text
New Hire
→ Asset Reservation / Assignment

New Hire
→ Software Profile / License

Department Change
→ Role Re-evaluation

Location Change
→ Asset Transfer / Network Policy

Role Change
→ Software/License Review

Termination
→ Asset Return

Termination
→ License Reclaim

Termination
→ Access Revocation

Terminated User with Asset Missing
→ Security / Asset Exception
```

---

# 86. Notification Rules

## End User

```text
Account activated
Access request approved/rejected
Temporary access expiring
Asset return required
```

## Manager

```text
Approval required
External access expiring
Offboarding blocked
Asset not returned
```

## Admin/Security

```text
Terminated user still has access
Orphan account
Role drift
Break-glass usage
Sync failure
```

Không notify mỗi successful directory sync.

---

# 87. SLA / Timers

Configurable:

```text
Identity sync frequency
Joiner readiness deadline
Access request SLA
Temporary role expiry
Access review cycle
Offboarding completion SLA
Asset return deadline
External access expiry
Service account review cycle
```

---

# 88. Metrics / KPI

## Identity

```text
Directory Sync Success Rate
Orphan Identity Count
Duplicate Identity Count
Time to Provision
Time to Deprovision
```

## RBAC

```text
Privileged User Count
Role Drift Count
Temporary Access Count
Expired Access Removed On Time
Access Review Completion Rate
```

## Offboarding

```text
Access Revocation Time
Asset Return Completion Time
License Reclaim Completion
Blocked Offboarding Count
Terminated Users with Active Access
```

---

# 89. Idempotency

Examples:

```text
user_sync:{source}:{external_user_id}:{version}
role_binding:{principal}:{role}:{scope}:{source}
offboarding:{user}:{employment_termination_id}
access_request:{requester}:{target}:{permission}:{version}
session_revoke:{user}:{termination_event}
```

Retry không tạo duplicate:

```text
User
Role Binding
Offboarding Case
Access Request
Clearance Task
```

---

# 90. Duplicate Prevention

Không được có:

```text
same employee
→ multiple active users
```

nếu trusted external ID giống nhau.

Không tự merge nếu:

```text
same email but different authoritative identities
```

without review.

---

# 91. Audit Trail

Mọi action quan trọng lưu:

```text
who
what
when
source
before
after
reason
role
scope
related workflow
```

Ví dụ:

```text
Role Binding Removed
User: Nguyễn Văn A
Role: Finance Approver
Source: Department Change
Before: Finance
After: Engineering
Actor: System Policy
```

---

# 92. Security Guardrails

Hệ thống không được:

1. Cho SSO success = full authorization.
2. Grant privileged role chỉ từ untrusted claim.
3. Auto-merge identities chỉ theo display name.
4. Xóa user record làm mất audit history.
5. Giữ temporary access vô thời hạn.
6. Cho terminated user giữ active privileged role.
7. Log tokens/passwords/secrets plaintext.
8. Cho service account không có owner.
9. Restore old permissions blindly khi rehire.
10. Allow manual override without reason/audit.
11. Ignore role drift indefinitely.
12. Let external/vendor users inherit employee default role.
13. Silent role change without event/audit.
14. Complete offboarding while required clearance remains unresolved unless policy allows exception.
15. Remove all access before ownership transfer where that would orphan critical services unless emergency security policy requires immediate revocation.

---

# 93. Operational Guardrails

Hệ thống không được:

1. Tạo Joiner task trùng khi sync retry.
2. Reassign asset owner chỉ vì department changed.
3. Remove license immediately if grace/review policy applies.
4. Close offboarding while tracked asset return is unresolved without explicit exception.
5. Hardcode manager approvals if org hierarchy is dynamic.
6. Assume location from login IP alone.
7. Delete role definition because source group disappeared.
8. Treat stale directory data as current without freshness marker.
9. Allow local manual users to bypass IdP policy if SSO-only mode enabled.
10. Archive user before downstream workflows complete.

---

# 94. Definition of Done

Cụm workflow này đạt yêu cầu khi:

- User sync hỗ trợ authoritative source precedence.
- Duplicate identity prevention hoạt động.
- Sync conflict và manual override có audit.
- SSO hỗ trợ OIDC/SAML và token/assertion validation.
- Authentication tách khỏi authorization.
- Session controls và revoke hoạt động.
- RBAC hỗ trợ role + permission + scope.
- Group-to-role mapping có source và version.
- Authorization explainable.
- Temporary access có expiry.
- Service account có owner/purpose/review.
- Joiner tạo được asset/software/license/access tasks.
- Mover re-evaluate role/access/asset/software.
- Access review và role drift detection hoạt động.
- Offboarding thu hồi access + asset + license + ownership.
- Emergency termination path tồn tại.
- Rehire không restore quyền cũ tự động.
- External/vendor access có sponsor + expiry.
- Identity Work Queue chỉ chứa actionable exceptions.
- Permissions, notification, SLA, idempotency và audit trail đầy đủ.
