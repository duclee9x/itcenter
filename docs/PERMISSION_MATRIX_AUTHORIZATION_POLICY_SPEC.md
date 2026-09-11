# PERMISSION MATRIX + AUTHORIZATION POLICY SPEC
## IT Operations Hub — RBAC, Scope, High-Risk Control, and Policy Evaluation

**Version:** 0.1  
**Status:** Foundation Draft  
**Parent:** `API_COMMAND_CONTRACT_SPEC.md`  
**Depends on:**  
- `IDENTITY_SSO_RBAC_USER_LIFECYCLE_OFFBOARDING_WORKFLOW.md`
- `APPROVAL_SLA_AUTOMATION_RULES_ENGINE_WORKFLOW.md`
- `DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`

**Purpose:** Define implementable permission codes, role-to-permission mapping, resource scopes, deny rules, temporary privilege elevation, service-account authorization, high-risk action controls, re-authentication requirements, approval gates, row-level access, and explainable authorization decisions.

---

# 1. Mục tiêu

Tài liệu này biến mô hình RBAC tổng quát thành ma trận quyền có thể triển khai trực tiếp.

Chuỗi authorization chuẩn:

```text
Authenticated Principal
→ Resolve Role Bindings
→ Resolve Scope
→ Resolve Resource Context
→ Evaluate Deny Rules
→ Evaluate Grants
→ Evaluate High-Risk Controls
→ Re-auth / MFA / Approval if required
→ ALLOW / DENY
```

Mục tiêu:

- quyền được định nghĩa theo action cụ thể;
- role không đồng nghĩa với toàn quyền;
- scope theo Site/Department/Team/Service/Asset Class;
- deny rule có precedence rõ;
- high-risk action cần policy gate riêng;
- temporary privilege tự hết hạn;
- service account có least privilege;
- mọi quyết định quyền đều explainable;
- UI có thể preflight nhưng backend luôn re-check;
- row-level access không phụ thuộc frontend filter;
- automation principal không bypass authorization.

---

# 2. Core Entities

```text
USER
SERVICE_ACCOUNT
GROUP
ROLE
PERMISSION
ROLE_PERMISSION
ROLE_BINDING
RESOURCE_SCOPE
AUTHORIZATION_POLICY
DENY_POLICY
TEMPORARY_GRANT
DELEGATION
APPROVAL_REQUEST
SESSION
AUTHENTICATION_CONTEXT
AUTHORIZATION_DECISION
ACCESS_REVIEW
```

---

# 3. Permission Naming Convention

Pattern:

```text
resource.action
```

Examples:

```text
asset.read
asset.create
asset.assign
asset.transfer
asset.retire
asset.dispose

ticket.read
ticket.create
ticket.assign
ticket.resolve

incident.declare_major
incident.resolve

network.discovery.run
network.vlan.change

software.deploy
license.assign
license.reclaim

procurement.approve
invoice.approve_exception

rbac.manage
report.export_sensitive
```

Không dùng permission mơ hồ:

```text
asset.admin
everything.write
superuser.action
```

trừ system-only internal capability.

---

# 4. Action Categories

Chuẩn hóa action:

```text
read
list
create
update
delete
assign
transfer
approve
reject
execute
retry
cancel
export
import
manage
configure
publish
sign
archive
retire
dispose
reclaim
```

---

# 5. Resource Scope Types

Permission có thể gắn scope:

```text
GLOBAL
ORGANIZATION
BUSINESS_UNIT
DEPARTMENT
SITE
WAREHOUSE
TEAM
SERVICE
ASSET_CLASS
PROJECT
COST_CENTER
SELF
OWNED
ASSIGNED
```

---

# 6. Scope Evaluation

Example:

```text
Role = Asset Admin
Permission = asset.transfer
Scope = Hanoi Site
```

Then:

```text
Asset.current_site = Hanoi
→ ALLOW

Asset.current_site = HCM
→ DENY
```

---

# 7. Scope Combination

Multiple bindings may combine:

```text
UNION
```

Example:

```text
Site Hanoi
+
Site HCM
```

→ access both.

Deny rules may override union.

---

# 8. Deny Precedence

Recommended:

```text
Explicit Deny
> Temporary Restriction
> Explicit Grant
> Role Grant
> Default Role
```

---

# 9. Default Deny

If no matching permission:

```text
DENY
```

Never implicit allow.

---

# 10. Core Roles

Recommended baseline roles:

```text
END_USER
HELPDESK_L1
HELPDESK_L2
INCIDENT_MANAGER
PROBLEM_MANAGER
CHANGE_MANAGER
ASSET_OPERATOR
ASSET_ADMIN
WAREHOUSE_OPERATOR
MAINTENANCE_TECHNICIAN
MAINTENANCE_MANAGER
AUDITOR
NETWORK_OPERATOR
NETWORK_ADMIN
SOFTWARE_ADMIN
LICENSE_ADMIN
PROCUREMENT_OPERATOR
PROCUREMENT_APPROVER
FINANCE_REVIEWER
CONTRACT_OWNER
IDENTITY_ADMIN
SECURITY_ADMIN
REPORT_VIEWER
REPORT_ADMIN
AUTOMATION_ADMIN
SYSTEM_ADMIN
```

---

# 11. End User Permission Matrix

| Permission | Default |
|---|---|
| `ticket.create` | Allow |
| `ticket.read` | Own only |
| `ticket.reply` | Own only |
| `request.create` | Allow |
| `request.cancel` | Own + allowed states |
| `asset.read` | Assigned assets only |
| `knowledge.read` | Public/internal user audience |
| `software.request` | Allow if eligible |
| `asset.return.confirm` | Own assignments |
| `notification.preference.update` | Self |
| `approval.read` | Own initiated requests only |
| `report.read` | Deny by default |

---

# 12. Helpdesk L1 Permission Matrix

| Permission | Scope |
|---|---|
| `ticket.read` | Team/Site |
| `ticket.assign` | Team |
| `ticket.update` | Team |
| `ticket.resolve` | Standard tickets |
| `ticket.reopen` | Allowed |
| `asset.read` | Support scope |
| `asset.health.read` | Support scope |
| `agent.action.safe` | Approved actions only |
| `incident.read` | Support scope |
| `incident.create` | Yes |
| `incident.declare_major` | No |
| `software.deploy` | No direct unrestricted |
| `asset.dispose` | Deny |
| `network.vlan.change` | Deny |

---

# 13. Helpdesk L2 Permission Matrix

Additional over L1:

```text
ticket.escalate
incident.create
incident.correlate
agent.action.controlled
maintenance.create
software.retry_deployment
knowledge.draft
```

Still denied:

```text
asset.dispose
network.vlan.change
rbac.manage
procurement.approve
```

---

# 14. Incident Manager

Allow:

```text
incident.read
incident.update
incident.declare_major
incident.assign
incident.mark_restored
incident.resolve
incident.communication.publish
incident.child_link
problem.create_candidate
```

Conditional:

```text
change.create
```

Denied by default:

```text
change.approve
network.execute_high_risk
```

---

# 15. Problem Manager

Allow:

```text
problem.read
problem.create
problem.update
problem.publish_workaround
problem.mark_known_error
problem.resolve
knowledge.publish_candidate
change.request
```

---

# 16. Change Manager

Allow:

```text
change.read
change.assess
change.approve
change.schedule
change.close
change.emergency_review
```

Separation may require:

```text
change.approve != change.implement
```

for high-risk changes.

---

# 17. Asset Operator

Allow:

```text
asset.read
asset.reserve
asset.assign
asset.transfer
asset.request_return
asset.receive_return
movement.create
handover.generate
```

Denied:

```text
asset.retire
asset.dispose
asset.manual_cost_override
```

unless separately granted.

---

# 18. Asset Admin

Allow:

```text
asset.create
asset.update_master
asset.assign
asset.transfer
asset.return
asset.retire
asset.audit_correct
asset.tag.manage
asset.bulk_update_safe
```

High-risk:

```text
asset.dispose
asset.force_state
```

require extra controls.

---

# 19. Warehouse Operator

Allow:

```text
goods_receipt.create
goods_receipt.confirm
stock.putaway
stock.reserve
stock.issue
stock.return
stock.reconcile
asset.read
asset.tag
```

Conditional:

```text
stock.manual_adjustment
```

requires reason / approval above threshold.

---

# 20. Maintenance Technician

Allow:

```text
maintenance.read
maintenance.start_diagnosis
maintenance.update_diagnosis
maintenance.start_repair
maintenance.record_part
maintenance.verify
maintenance.complete
asset.read
warranty.read
```

Cannot:

```text
approve high repair cost
retire asset
approve vendor quote
```

unless separate role.

---

# 21. Maintenance Manager

Additional:

```text
maintenance.approve_cost
maintenance.assign_vendor
maintenance.close_exception
replacement.create_candidate
replacement.review
```

---

# 22. Auditor

Allow:

```text
audit.create
audit.start
audit.record_observation
audit.read
audit.exception.create
audit.exception.resolve_low_risk
report.audit.read
asset.read
```

No direct unrestricted mutation of Asset master.

Correction should use controlled command.

---

# 23. Network Operator

Allow:

```text
network.read
network.discovery.run
network.exception.resolve
network.unknown_device.link
network.topology.read
network.port.read
network.vlan.read
change.create
```

No direct production VLAN execution by default.

---

# 24. Network Admin

Additional:

```text
network.vlan.change
network.port.configure
network.device.manage
network.quarantine.execute
```

High-risk actions require:

```text
Change
Approval
Re-auth
```

depending policy.

---

# 25. Software Admin

Allow:

```text
software.catalog.manage
software.request.review
software.deploy
software.remove
artifact.read
artifact.publish
artifact.revoke
software.exception.resolve
```

Artifact approval may require Security Reviewer.

---

# 26. License Admin

Allow:

```text
license.read
license.entitlement.manage
license.pool.manage
license.assign
license.reclaim
license.compliance.resolve
license.renewal.prepare
```

Procurement approval remains separate.

---

# 27. Procurement Operator

Allow:

```text
procurement.request.read
rfq.create
rfq.send
quotation.record
supplier.read
supplier.select
po.draft
po.issue_after_approval
goods_receipt.read
invoice.read
```

Cannot self-approve above configured policy.

---

# 28. Procurement Approver

Allow:

```text
procurement.approve
po.approve
supplier_exception.approve
```

Scope:

```text
cost center
amount limit
business unit
```

---

# 29. Finance Reviewer

Allow:

```text
invoice.read
invoice.match.read
invoice.approve_exception
payment_reference.update
financial_report.read
```

No asset/network operational write.

---

# 30. Contract Owner

Allow:

```text
contract.read
contract.review
contract.start_renewal
contract.renewal_decide
contract.coverage.manage
```

Final commercial approval may require Procurement/Finance.

---

# 31. Identity Admin

Allow:

```text
user.read
identity.sync.manage
group.mapping.manage
role_binding.read
access_request.review
session.revoke
external_user.manage
service_account.manage
```

High-risk:

```text
role_binding.privileged_grant
rbac.manage
```

may require Security Admin or dual approval.

---

# 32. Security Admin

Allow:

```text
security.exception.review
privileged_access.approve
break_glass.review
unknown_device.quarantine
software.prohibited.override
session.revoke
service_account.review
audit.security.read
```

---

# 33. Reporting Viewer

Allow:

```text
report.read
metric.read
dashboard.read
```

restricted by resource scope.

---

# 34. Reporting Admin

Additional:

```text
metric_definition.manage
report_definition.manage
report_schedule.manage
```

Does not automatically gain underlying sensitive data access.

---

# 35. Automation Admin

Allow:

```text
automation.rule.read
automation.rule.create
automation.rule.edit
automation.simulate
automation.activate_low_risk
automation.disable
execution.retry
```

High-risk activation requires approval.

---

# 36. System Admin

System Admin is platform administration, not automatic business omnipotence.

Allow:

```text
system.configure
integration.manage
tenant.manage
rbac.manage
```

Business actions may still require business approval depending policy.

---

# 37. Permission Catalog — Asset

```text
asset.read
asset.list
asset.create
asset.update_master
asset.reserve
asset.assign
asset.transfer
asset.request_return
asset.receive_return
asset.retire
asset.dispose
asset.force_state
asset.tag.manage
asset.export
asset.bulk_update_safe
asset.audit_correct
```

---

# 38. Permission Catalog — Helpdesk

```text
ticket.read
ticket.create
ticket.assign
ticket.update
ticket.change_priority
ticket.request_info
ticket.resolve
ticket.reopen
ticket.merge
ticket.link_incident
ticket.export
```

---

# 39. Permission Catalog — Incident

```text
incident.read
incident.create
incident.assign
incident.correlate
incident.declare_major
incident.update
incident.mark_restored
incident.resolve
incident.communication.publish
```

---

# 40. Permission Catalog — Problem

```text
problem.read
problem.create
problem.update
problem.publish_workaround
problem.mark_known_error
problem.request_change
problem.resolve
```

---

# 41. Permission Catalog — Change

```text
change.read
change.create
change.assess
change.approve
change.schedule
change.implement
change.verify
change.rollback
change.close
change.emergency_execute
```

---

# 42. Permission Catalog — Maintenance

```text
maintenance.read
maintenance.create
maintenance.start_diagnosis
maintenance.update_diagnosis
maintenance.request_part
maintenance.assign_vendor
maintenance.start_repair
maintenance.verify
maintenance.complete
maintenance.approve_cost
```

---

# 43. Permission Catalog — Audit

```text
audit.read
audit.create
audit.start
audit.record_observation
audit.exception.resolve
audit.complete
audit.export
```

---

# 44. Permission Catalog — Network

```text
network.read
network.discovery.run
network.topology.read
network.exception.resolve
network.unknown_device.link
network.unknown_device.quarantine
network.vlan.read
network.vlan.change
network.port.configure
network.device.manage
```

---

# 45. Permission Catalog — Software / Artifact

```text
software.read
software.request
software.request.review
software.catalog.manage
software.deploy
software.remove
software.exception.resolve

artifact.read
artifact.upload
artifact.scan.review
artifact.approve
artifact.revoke
```

---

# 46. Permission Catalog — License

```text
license.read
license.entitlement.manage
license.pool.manage
license.assign
license.reclaim
license.exception.approve
license.renewal.prepare
license.export
```

---

# 47. Permission Catalog — Procurement

```text
procurement.read
procurement.request.create
procurement.request.review
procurement.approve
rfq.create
quotation.record
supplier.select
po.create
po.approve
po.issue
po.amend
invoice.read
invoice.match.resolve
invoice.approve_exception
```

---

# 48. Permission Catalog — Contract

```text
contract.read
contract.create
contract.update
contract.approve
contract.start_renewal
contract.renew
contract.terminate
contract.export
```

---

# 49. Permission Catalog — Identity / RBAC

```text
user.read
user.update_non_authoritative
session.revoke
group.mapping.manage
role.read
role.manage
role_binding.read
role_binding.grant
role_binding.revoke
role_binding.privileged_grant
service_account.manage
access_review.manage
```

---

# 50. Permission Catalog — Reporting

```text
metric.read
metric_definition.manage
report.read
report.create
report.schedule
report.export
report.export_sensitive
dashboard.manage
```

---

# 51. High-Risk Action Registry

Actions classified high-risk:

```text
asset.dispose
asset.force_state
network.vlan.change
network.unknown_device.quarantine
change.emergency_execute
artifact.approve
artifact.revoke
role_binding.privileged_grant
service_account.manage_credential
report.export_sensitive
invoice.approve_exception_large
contract.terminate
data_wipe.execute
```

---

# 52. High-Risk Control Matrix

| Action | Re-auth | MFA | Approval | Reason | Change Required |
|---|---:|---:|---:|---:|---:|
| Asset Dispose | Yes | Optional | Yes | Yes | No |
| Data Wipe | Yes | Yes | Yes | Yes | Sometimes |
| VLAN Change | Yes | Yes | Yes | Yes | Yes |
| Emergency Change | Yes | Yes | Yes | Yes | Emergency |
| Privileged Role Grant | Yes | Yes | Yes | Yes | No |
| Artifact Approve | Optional | Optional | Security/Owner | Yes | No |
| Sensitive Export | Yes | Optional | Policy-based | Yes | No |
| Contract Terminate | Yes | Optional | Yes | Yes | No |

---

# 53. Re-authentication

Sensitive action can require session freshness:

```text
last strong auth <= N minutes
```

If stale:

```text
REAUTH_REQUIRED
```

---

# 54. MFA Step-up

Policy may require stronger auth for:

```text
privileged grant
network change
data wipe
financial exception
break-glass
```

---

# 55. Approval Gate

Authorization result can be:

```text
ALLOW
DENY
ALLOW_IF_APPROVED
ALLOW_IF_REAUTH
ALLOW_IF_MFA
ALLOW_IF_CHANGE
```

---

# 56. Authorization Decision Object

```yaml
authorization_decision:
  decision_id:
  principal_id:
  action:
  resource_type:
  resource_id:
  scope_matches:
  roles:
  deny_rules:
  grant_rules:
  high_risk_controls:
  result:
  reason_code:
  evaluated_at:
```

---

# 57. Explainability Example

Question:

```text
Why can User A transfer Asset AST-0042?
```

Answer:

```text
ALLOW
Permission: asset.transfer
Role: Asset Admin
Binding source: Group IT-ASSET-ADMINS
Scope: Hanoi Site
Asset site: Hanoi
No deny rule matched
```

---

# 58. Denial Example

```text
DENY
Permission: network.vlan.change
User role: Network Operator
Required role capability: Network Admin
```

---

# 59. Temporary Elevation

Flow:

```text
Request Temporary Role
↓
Reason
↓
Scope
↓
Duration
↓
Approval
↓
Binding Created
↓
Auto Expire
```

---

# 60. Temporary Grant Object

```yaml
temporary_grant:
  id:
  principal_id:
  role_id:
  scope_type:
  scope_id:
  valid_from:
  valid_until:
  approval_request_id:
  reason:
```

---

# 61. Maximum Duration

Examples:

```text
Emergency elevated role: 4h
Project elevated role: 7d
Vendor support access: 1d
```

Configurable.

---

# 62. Break-glass Access

Break-glass requirements:

```text
named account or controlled emergency identity
strong authentication
limited scope
short duration
mandatory reason
immediate security notification
post-use review
```

---

# 63. Break-glass Guardrail

Cannot be:

```text
default admin login
shared everyday credential
unlogged
non-expiring
```

---

# 64. Service Account Authorization

Service account must have:

```text
owner
purpose
permissions
scope
credential rotation
expiry/review date
```

---

# 65. Service Account Role Binding

Prefer dedicated role:

```text
Integration-Ticket-Writer
Monitoring-Event-Writer
ERP-Invoice-Importer
```

not:

```text
System Admin
```

---

# 66. Automation Principal

Automation executes under:

```text
AUTOMATION:<rule-id>
```

or controlled system principal.

Permission must be explicit.

Rule cannot gain permission just because creator had it.

---

# 67. Delegated Approval vs Delegated Permission

Important distinction:

```text
Approval delegation
≠
Role/permission delegation
```

Manager can delegate approval without giving full manager role.

---

# 68. SELF Scope

Examples:

```text
ticket.read SELF
asset.read ASSIGNED
notification.preference.update SELF
```

---

# 69. OWNED Scope

Resource has business owner:

```text
contract.owner_user_id
service.owner_user_id
```

Permission may allow:

```text
contract.read OWNED
```

---

# 70. ASSIGNED Scope

Examples:

```text
ticket.update ASSIGNED
work_item.resolve ASSIGNED
```

---

# 71. Team Scope

```text
ticket.read TEAM
work_item.read TEAM
incident.read TEAM
```

Team membership resolved from Identity domain.

---

# 72. Site Scope

Common for:

```text
asset
network
warehouse
helpdesk
maintenance
```

---

# 73. Department Scope

Common for:

```text
user requests
license pool
procurement
reporting
```

---

# 74. Service Scope

Useful for:

```text
incident
change
problem
SLA
report
```

---

# 75. Resource Inheritance

Example:

```text
Asset belongs to Room
Room belongs to Site
```

Site-scoped permission applies through hierarchy.

Need efficient path resolution.

---

# 76. Multi-scope Evaluation

Example permission binding:

```text
Network Operator
Site = Hanoi
Service = Corporate LAN
```

Policy defines:

```text
AND
```

or:

```text
OR
```

Explicit in binding model.

---

# 77. Row-Level Access

Backend query must apply:

```text
organization scope
site scope
department scope
self/team scope
```

Do not rely on UI hiding rows.

---

# 78. Column / Field-Level Restriction

Some fields need stronger permission:

```text
purchase_cost
salary-related identity data
security evidence
contract value
vendor banking reference
```

Example:

```text
asset.read
```

does not imply:

```text
asset.cost.read
```

---

# 79. Sensitive Field Permissions

Examples:

```text
asset.cost.read
contract.financial.read
invoice.financial.read
identity.sensitive.read
security.evidence.read
```

---

# 80. Export Permissions

Reading on screen:

```text
report.read
```

does not automatically allow:

```text
report.export_sensitive
```

---

# 81. Download / Document Permission

Document access evaluated by:

```text
document type
linked entity
confidentiality
user scope
```

---

# 82. Signed Document Access

Example:

```text
Handover document
```

accessible to:

```text
assigned user
Asset Admin
authorized Helpdesk
Auditor
```

---

# 83. Permission Check API

Internal:

```text
POST /authorization/evaluate
```

Input:

```yaml
principal:
action:
resource:
context:
```

Output:

```yaml
result:
reason:
requirements:
```

---

# 84. Batch Authorization

For list UI:

```text
POST /authorization/evaluate-batch
```

Use carefully to avoid N+1 permission calls.

Prefer policy-aware query filtering.

---

# 85. UI Action Hints

Read API may include:

```yaml
allowed_actions:
  - asset.transfer
  - asset.request_return
```

for UX convenience.

These hints are not security enforcement.

---

# 86. Preflight Authorization

For action drawer:

```text
Can this user perform action?
Will approval be required?
Will reauth be required?
```

Final command always re-evaluates.

---

# 87. Access Review

Periodic review targets:

```text
Privileged roles
Temporary grants
Service accounts
External users
Sensitive scopes
Break-glass identities
```

---

# 88. Access Review Decision

```text
KEEP
REVOKE
REDUCE_SCOPE
EXPIRE
INVESTIGATE
```

---

# 89. Role Drift

Expected:

```text
Role based on current job/department
```

Observed:

```text
Current bindings
```

Mismatch types:

```text
EXTRA
MISSING
STALE
UNKNOWN_SOURCE
```

---

# 90. Joiner Role Assignment

Default role assignment:

```text
Department
Job Role
Location
Employment Type
```

Privileged role:

```text
never automatic unless explicitly approved policy
```

---

# 91. Mover Role Re-evaluation

Department/location/job change triggers:

```text
recalculate expected bindings
remove obsolete
add requested
review privileged
```

---

# 92. Leaver Access Revocation

Termination:

```text
disable login
revoke sessions
expire temporary roles
remove privileged bindings
revoke external access
disable service ownership delegation
```

---

# 93. External User Policy

External/vendor user:

```text
sponsor required
expiry required
limited default role
restricted scope
MFA recommended/required
```

---

# 94. Permission Audit Events

Generated:

```text
RBAC.ROLE_CREATED
RBAC.ROLE_UPDATED
RBAC.BINDING_CREATED
RBAC.BINDING_REVOKED
RBAC.TEMPORARY_GRANT_CREATED
RBAC.TEMPORARY_GRANT_EXPIRED
RBAC.PRIVILEGED_GRANT_APPROVED
RBAC.AUTHORIZATION_DENIED
RBAC.BREAK_GLASS_USED
```

---

# 95. Authorization Logging

Log every high-risk decision.

For low-risk reads, sampling/configuration may apply to avoid excessive volume.

---

# 96. Denied Action Monitoring

Track:

```text
repeated denied privileged actions
cross-scope access attempts
external account misuse
expired token attempts
```

Potential Security work item if threshold exceeded.

---

# 97. Permission Versioning

Role definitions and policy rules are versioned.

Running session may:

```text
re-evaluate on each sensitive command
```

rather than trust old session role snapshot.

---

# 98. Cache Strategy

Permission cache allowed for performance.

Must invalidate on:

```text
role binding change
user suspension
termination
scope change
temporary expiry
```

---

# 99. Session Claim Strategy

Token may contain coarse claims:

```text
user_id
tenant_id
basic group hints
```

Do not encode entire long-lived authorization model into token if rapid revocation is required.

---

# 100. Multi-tenant Guardrail

Tenant boundary checked before all resource-scope checks.

Cross-tenant access:

```text
DENY
```

unless explicit platform-admin workflow.

---

# 101. System Admin Cross-Tenant Access

If needed:

```text
explicit support session
reason
time limit
customer/tenant context
full audit
```

not silent unrestricted access.

---

# 102. Permission Test Matrix

Every permission should have tests for:

```text
allow correct role
deny missing role
deny wrong scope
deny expired grant
deny terminated user
allow temporary approved grant
require approval if configured
require reauth if high-risk
```

---

# 103. Example — Asset Transfer

User:

```text
Role = Asset Operator
Scope = Hanoi Site
```

Asset:

```text
AST-0042
Current Site = Hanoi
Target Site = HCM
```

Evaluation:

```text
asset.transfer = granted for Hanoi
cross-site transfer policy = approval required
target HCM outside normal scope
```

Result:

```text
ALLOW_IF_APPROVED
```

Approval:

```text
Asset Admin HCM + Hanoi
```

---

# 104. Example — VLAN Change

User:

```text
Role = Network Admin
Scope = Hanoi
```

Action:

```text
network.vlan.change
```

Resource:

```text
SW-HN-01
```

Result:

```text
Permission = granted
High-risk = true
Change required = true
MFA required = true
Re-auth required = true
```

Final:

```text
ALLOW_IF_CHANGE_AND_MFA
```

---

# 105. Example — Privileged Role Grant

Identity Admin attempts:

```text
grant Security Admin to User B
```

Policy:

```text
role_binding.privileged_grant
```

requires:

```text
Security approval
MFA
reason
expiry if temporary
```

Cannot self-approve.

---

# 106. Example — Sensitive Report Export

Manager can view:

```text
License Cost Dashboard
```

but export includes detailed user assignments.

Requires:

```text
report.export_sensitive
```

If absent:

```text
view allowed
export denied
```

---

# 107. Example — Automation Action

Rule wants:

```text
network.vlan.change
```

Automation principal only has:

```text
network.discovery.run
```

Result:

```text
DENY
→ Human Fallback
```

Rule owner permission does not matter.

---

# 108. Guardrails

System must not:

1. Treat role name as permission check.
2. Use frontend hiding as authorization.
3. Allow implicit permissions not declared in catalog.
4. Let privileged roles auto-provision without explicit policy.
5. Let temporary grants lack expiry.
6. Allow service account without owner/purpose.
7. Let automation inherit creator privileges.
8. Let SSO login imply authorization.
9. Ignore tenant boundary before resource scope.
10. Allow high-risk actions without configured step-up controls.
11. Let user self-approve privileged grant when SoD forbids it.
12. Cache authorization beyond revocation/expiry without invalidation.
13. Expose sensitive fields because resource read permission exists.
14. Let export permission equal screen-view permission automatically.
15. Give System Admin automatic business approval authority.
16. Allow external users employee-equivalent default access.
17. Lose reason/audit for manual override and privileged action.

---

# 109. MVP Role Set

Minimum roles for initial deployment:

```text
END_USER
HELPDESK_L1
HELPDESK_L2
ASSET_OPERATOR
ASSET_ADMIN
INCIDENT_MANAGER
NETWORK_OPERATOR
SOFTWARE_ADMIN
LICENSE_ADMIN
PROCUREMENT_OPERATOR
PROCUREMENT_APPROVER
IDENTITY_ADMIN
REPORT_VIEWER
SYSTEM_ADMIN
```

---

# 110. MVP Permission Set

Minimum permissions:

```text
ticket.read
ticket.create
ticket.assign
ticket.resolve

asset.read
asset.assign
asset.transfer
asset.request_return
asset.receive_return

incident.read
incident.create
incident.declare_major
incident.resolve

maintenance.read
maintenance.create

network.read
network.discovery.run

software.read
software.request
software.deploy

license.read
license.assign
license.reclaim

procurement.read
procurement.request.create
procurement.approve

approval.read
approval.decide

work_item.read
work_item.assign
work_item.resolve

report.read

rbac.manage
system.configure
```

---

# 111. Definition of Done

Permission Matrix + Authorization Policy đạt yêu cầu khi:

- Permission codes chuẩn hóa theo resource.action.
- Core roles có ma trận rõ.
- Scope types được định nghĩa.
- Default deny hoạt động.
- Explicit deny precedence rõ.
- High-risk action registry tồn tại.
- Re-auth/MFA/approval/change gate rõ.
- Temporary privilege có expiry.
- Break-glass có strict audit.
- Service account có owner + least privilege.
- Automation principal có permission riêng.
- Sensitive-field và export permissions tách khỏi basic read.
- Row-level filtering thực thi ở backend.
- Joiner/Mover/Leaver cập nhật quyền đúng lifecycle.
- Access Review và Role Drift được hỗ trợ.
- Authorization decisions explainable.
- Permission changes có audit events.
- MVP roles/permissions được xác định.
