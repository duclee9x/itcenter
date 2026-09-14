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
asset.reactivate
replacement.create_candidate
replacement.review
data_wipe.execute

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
invoice.read
invoice.create
invoice.update
invoice.submit
invoice.match
invoice.approve
invoice.reject
credit_note.read
credit_note.create
credit_note.update
credit_note.submit
credit_note.apply
credit_note.reject

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
software.deployment.read
software.deployment.cancel
software.retry_deployment
software.remove
artifact.read
artifact.publish
artifact.revoke
software.exception.resolve
software.inventory.read
software.exception.read
software.exception.manage
software.exception.approve
software.removal.manage
```

Artifact approval may require Security Reviewer.

Inventory and exception reads are tenant-scoped. Temporary exceptions and
uninstall-profile approval require `software.exception.approve` plus a
distinct approved Approval-domain decision. Removal execution requires
`software.removal.manage`; this permission never bypasses the approved
symbolic profile, classification, asset-risk, inventory, and Agent lease
checks.

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

`license.assign` also governs `LICENSE.CANCEL_ASSIGNMENT`; it does not grant
permission to reclaim an activated or suspended assignment.

Procurement approval remains separate.

---

# 27. Procurement Operator

Allow:

```text
procurement.request.read
rfq.read
rfq.create
rfq.update
rfq.issue
rfq.close
rfq.cancel
rfq.award
quotation.create
quotation.update
quotation.submit
quotation.withdraw
quotation.evaluate
quotation.read
supplier.read
supplier.select
po.read
po.create
po.update
po.issue
po.hold
po.cancel
po.amend
po.close
goods_receipt.read
invoice.read
invoice.create
invoice.update
invoice.submit
invoice.match
credit_note.read
credit_note.create
credit_note.update
credit_note.submit
```

Cannot self-approve above configured policy.

---

# 28. Procurement Approver

Allow:

```text
procurement.approve
approval.decide
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
invoice.match
invoice.approve
invoice.reject
credit_note.read
credit_note.apply
credit_note.reject
payment_reference.update
financial_report.read
```

No asset/network operational write.

---

# 30. Contract Owner

Allow:

```text
contract.read
contract.create
contract.update
contract.execute
contract.lifecycle
contract.amend
contract.renew
contract.terminate
commercial_document.read
commercial_document.write
commercial_document.finalize
```

Approval decisions remain under `approval.decide`. Contract permissions are
tenant/resource scoped. A Contract command permission does not grant approval
decision authority or broaden resource scope.

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
automation.activate_high_risk
automation.disable
automation.intent.read
automation.intent.resolve
```

High-risk activation requires an approved, version/context-bound approval
request in addition to the command permission. `automation.activate_high_risk`
does not grant action execution. TASK-090 does not execute actions.

Action Intents are visible only within tenant/resource scope through
`automation.intent.read`. The Automation Principal's permissions for the
proposed target action are checked explicitly; the rule or its owner cannot
borrow permissions from the principal who authored or activated the rule.
Approval decisions continue to require the Approval Engine's
`approval.decide` permission.

`execution.retry` is reserved for TASK-091 execution operators and is not a
TASK-090 rule-management permission. TASK-091 separately applies target-domain
permissions and rechecks approval, scope and kill-switch eligibility before
executing an intent.

TASK-091 v1 also defines the separate operator permission
`execution.cancel`, scoped to the tenant/resource and execution. It permits
cancellation only before authenticated Agent acceptance is proven; it does
not grant Agent action execution or bypass pre-dispatch rechecks. Ambiguous
delivery/acceptance is not cancellable and becomes `UNKNOWN`.
`execution.retry` is allowed only with explicit reconciliation evidence,
reason, expected version and idempotency; it creates a new attempt and
rechecks current policy, capability, principal authorization/resource scope,
approval, conflict, target and kill switch. Both permissions are separate
from Rule authoring, policy administration and `automation.intent.resolve`.

`automation.intent.resolve` is a human permission requiring tenant/resource
scope, reason, expected version and idempotency. It allows explicit selection
of compatible intents after conflict review; it cannot override policy DENY,
required approval, current kill-switch state or target-domain permission.

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
asset.reactivate
asset.force_state
asset.tag.manage
asset.export
asset.bulk_update_safe
asset.audit_correct
```

Replacement and wipe actions:

```text
replacement.create_candidate
replacement.review
data_wipe.execute
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
software.inventory.read
software.exception.read
software.exception.manage
software.exception.approve
software.removal.manage

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
rfq.read
rfq.create
rfq.update
rfq.issue
rfq.close
rfq.cancel
rfq.award
quotation.create
quotation.update
quotation.submit
quotation.withdraw
quotation.evaluate
quotation.read
supplier.read
supplier.create
supplier.update
supplier.approve
supplier.status.change
supplier.block
supplier.select
po.create
po.issue
po.amend
po.read
po.update
po.hold
po.cancel
po.close
goods_receipt.read
goods_receipt.create
goods_receipt.update
goods_receipt.post
goods_receipt.cancel
invoice.read
invoice.match
invoice.approve
```

The RFQ/Quotation command-to-permission mapping is normative:

| Command | Permission |
|---|---|
| `RFQ.CREATE` | `rfq.create` |
| `RFQ.UPDATE_DRAFT` | `rfq.update` |
| `RFQ.ISSUE` | `rfq.issue` |
| `RFQ.CLOSE_SUBMISSIONS`, `RFQ.CLOSE_NO_AWARD` | `rfq.close` |
| `RFQ.CANCEL` | `rfq.cancel` |
| `RFQ.AWARD` | `rfq.award` |
| `QUOTATION.CREATE` | `quotation.create` |
| `QUOTATION.UPDATE_DRAFT` | `quotation.update` |
| `QUOTATION.SUBMIT` | `quotation.submit` |
| `QUOTATION.WITHDRAW` | `quotation.withdraw` |
| `QUOTATION.DISQUALIFY` | `quotation.evaluate` |
| Parent `RFQ.AWARD` quotation decisions | `rfq.award` |
| Parent `RFQ.CLOSE_NO_AWARD` quotation decisions | `rfq.close` |
| Parent `RFQ.CANCEL` quotation voiding | `rfq.cancel` |

RFQ and Quotation queries require `rfq.read` and `quotation.read` respectively
and remain tenant/resource scoped.

Every command remains subject to tenant/resource authorization and scope.
Where supplier-facing principals are enabled, quotation creation, draft
updates, submission and withdrawal are additionally restricted to the
principal's own `supplier_id`. `rfq.award` does not bypass the separately
configured approval policy.

Supplier authorization is action-specific. `supplier.select` permits
selection/use in the explicitly authorized procurement workflow; it does not
grant Supplier master mutation. Do not define or use a broad
`supplier.manage` permission.

| Command | Permission |
|---|---|
| `SUPPLIER.CREATE` | `supplier.create` |
| `SUPPLIER.UPDATE_PROFILE` | `supplier.update` |
| `SUPPLIER.APPROVE`, `SUPPLIER.MARK_PREFERRED`, `SUPPLIER.REMOVE_PREFERRED` | `supplier.approve` |
| `SUPPLIER.SUSPEND`, `SUPPLIER.RESUME`, `SUPPLIER.DEACTIVATE`, `SUPPLIER.REACTIVATE` | `supplier.status.change` |
| `SUPPLIER.BLOCK`, `SUPPLIER.UNBLOCK` | `supplier.block` |

All grants remain subject to tenant isolation and resource scope. The backend
rechecks permission and scope on every command. A caller that may block or
unblock a Supplier does not thereby gain profile-edit or approval rights.

The Purchase Order permission catalog is:

```text
po.read
po.create
po.update
po.issue
po.hold
po.cancel
po.amend
po.close
```

Normative command mapping:

| Command | Permission |
|---|---|
| `PO.CREATE` | `po.create` |
| `PO.UPDATE_DRAFT` | `po.update` |
| `PO.ISSUE` | `po.issue` |
| `PO.HOLD`, `PO.RESUME` | `po.hold` |
| `PO.CANCEL` | `po.cancel` |
| `PO.AMEND` | `po.amend` |
| `PO.CLOSE`, `PO.CLOSE_REMAINDER` | `po.close` |
| PO reads | `po.read` |
| Approval request decisions | `approval.decide` |

Approval is not a PO permission and `po.issue` does not imply approval-decision
authority. The previous draft identifiers `po.draft`,
`po.issue_after_approval` and `po.approve` are not normative permissions.
Every command also requires tenant/resource scope authorization.

The Goods Receipt permission catalog and command mapping are:

```text
goods_receipt.read
goods_receipt.create
goods_receipt.update
goods_receipt.post
goods_receipt.cancel
```

| Command | Permission |
|---|---|
| `GOODS_RECEIPT.CREATE` | `goods_receipt.create` |
| `GOODS_RECEIPT.UPDATE_DRAFT` | `goods_receipt.update` |
| `GOODS_RECEIPT.POST` | `goods_receipt.post` |
| `GOODS_RECEIPT.CANCEL` | `goods_receipt.cancel` |
| Goods Receipt queries | `goods_receipt.read` |

All Goods Receipt commands are tenant/resource scoped. No broad
`procurement.manage` permission is defined. Permission to post a Goods
Receipt does not grant Asset mutation; downstream asset registration is
executed through the Asset-owned application command.

The TASK-074 Invoice and Credit Note permission catalogs are:

```text
invoice.read
invoice.create
invoice.update
invoice.submit
invoice.match
invoice.approve
invoice.reject

credit_note.read
credit_note.create
credit_note.update
credit_note.submit
credit_note.apply
credit_note.reject
```

| Command | Permission |
|---|---|
| `INVOICE.CREATE` | `invoice.create` |
| `INVOICE.UPDATE_DRAFT` | `invoice.update` |
| `INVOICE.CANCEL` (DRAFT only) | `invoice.update` |
| `INVOICE.SUBMIT` | `invoice.submit` |
| `INVOICE.REEVALUATE_MATCH` | `invoice.match` |
| `INVOICE.APPROVE` | `invoice.approve` |
| `INVOICE.REJECT` | `invoice.reject` |
| Invoice queries | `invoice.read` |
| `CREDIT_NOTE.CREATE` | `credit_note.create` |
| `CREDIT_NOTE.UPDATE_DRAFT` | `credit_note.update` |
| `CREDIT_NOTE.CANCEL` (DRAFT only) | `credit_note.update` |
| `CREDIT_NOTE.SUBMIT` | `credit_note.submit` |
| `CREDIT_NOTE.APPLY` | `credit_note.apply` |
| `CREDIT_NOTE.REJECT` | `credit_note.reject` |
| Credit Note queries | `credit_note.read` |

The two DRAFT-only `CANCEL` commands remain explicit lifecycle commands. They
use the existing draft-mutation permission because they operate only on
unsubmitted drafts; they are not generic status updates. Do not introduce
`invoice.cancel` or `credit_note.cancel` for TASK-074. A future cancellation
or reversal after submission/approval is a materially different financial
operation and requires its own command, permission and compensating/reversal
rules.

Approval decisions continue to require the Approval Engine permission
`approval.decide`; invoice command permission does not grant approval-decision
authority. `INVOICE_MATCH_EXCEPTION` is a linked Approval Request purpose, not
a broad Invoice permission. Every command remains tenant/resource scoped.
Do not use `procurement.manage` or legacy `invoice.approve_exception` as the
normative command permission.

---

# 48. Permission Catalog — Contract

```text
contract.read
contract.create
contract.update
contract.execute
contract.lifecycle
contract.amend
contract.renew
contract.terminate

commercial_document.read
commercial_document.write
commercial_document.finalize
```

Normative command mapping:

```text
CONTRACT.CREATE
  → contract.create
CONTRACT.UPDATE_DRAFT
CONTRACT.SUBMIT_FOR_SIGNATURE
CONTRACT.RECALL_SIGNATURE
CONTRACT.CANCEL (unexecuted only)
  → contract.update
CONTRACT.RECORD_EXECUTION
  → contract.execute
CONTRACT.ACTIVATE
CONTRACT.EXPIRE
CONTRACT.HOLD
CONTRACT.RESUME
  → contract.lifecycle
CONTRACT.AMEND
  → contract.amend
RENEWAL.*
  → contract.renew
CONTRACT.TERMINATE
  → contract.terminate
Commercial document upload/version creation
  → commercial_document.write
Commercial document finalization
  → commercial_document.finalize
Document reads/download references
  → commercial_document.read
```

Every permission remains tenant/resource scoped. Approval decisions use the
existing Approval Engine permission (`approval.decide`); the command
permission does not grant decision authority. Do not replace these granular
permissions with `contract.manage`.

---

# 49. Permission Catalog — Identity / RBAC

```text
user.read
user.update_non_authoritative
identity.offboard
identity.offboard.cancel
identity.offboard.exception
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

`identity.offboard` authorizes initiation, start, resume, readiness marking and
completion of a tenant-scoped Offboarding Case. `identity.offboard.cancel`
authorizes direct cancellation from `INITIATED`, cancellation requests,
completion of recovery, and the explicit validated restoration from
`TERMINATING` to `pre_offboarding_user_state` when all cancellation conditions
are satisfied. Neither permission permits reactivating a `TERMINATED` User.
`identity.offboard.exception` is required to waive or accept an offboarding
recovery/clearance exception and requires an evidence reference and reason.

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

Search results use each source domain's read permission (`asset.read`,
`ticket.read`, `incident.read`, `user.read`, `network.topology.read`,
`software.read`, or `license.read`) and its resource scope. `search.reindex` is
reserved for authorized operators rebuilding the derived search projection;
it grants no read access to business resources.

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
approval.decide (when purpose is INVOICE_MATCH_EXCEPTION)
contract.terminate
data_wipe.execute
```

---

# 52. High-Risk Control Matrix

| Action | Re-auth | MFA | Approval | Reason | Change Required |
|---|---:|---:|---:|---:|---:|
| Asset Dispose | Yes | Optional | Yes | Yes | No |
| Asset Reactivate | Policy-based | Optional | Internal-reuse policy | Yes | No |
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

Automation evaluation/execution resolves an explicit service identity of type
`SYSTEM_AUTOMATION` (or the equivalent canonical service-principal model).
It is tenant-bound, is not a human or Rule-author impersonation, and has no
implicit administrator or wildcard privileges. A principal's action grants
are evaluated by the existing AuthorizationPort and canonical grant model,
including tenant and resource scope. A Rule's creator/publisher/activator
permissions never confer action authority.

Automation executes under:

```text
AUTOMATION:<rule-id>
```

or controlled system principal.

Permission must be explicit.

Rule cannot gain permission just because creator had it.

### TASK-090-R1 Action Policy Administration and Principal Grants

Tenant Action Policy is a separate decision from Authorization. Both an
explicit active tenant policy and a valid scoped `SYSTEM_AUTOMATION` grant
are required; missing policy defaults to `DENY`. Policy decisions are
`DENY`, `ALLOW` or `REQUIRE_APPROVAL`; approval cannot bypass principal
authorization, tenant/resource scope, conflict or kill switch.

Policy administration requires distinct tenant-scoped permissions:

```text
automation.policy.read
automation.policy.create
automation.policy.update
automation.policy.activate
```

These do not grant Rule management or action execution. Principal grants must
identify tenant, service principal, action permission/capability, resource
scope, active/validity and audit metadata. No implicit `*`, admin, superuser,
all-tenant or all-resource grant is allowed. Use the existing
AuthorizationPort; do not introduce a parallel scope evaluator. See the
normative [TASK-090-R1 contract](../tasks/TASK-090-R1_AUTOMATION_ACTION_POLICY_SYSTEM_PRINCIPAL_AUTHORIZATION_CONTRACT.md).

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

## TASK-092 Incident Correlation Permissions

Use distinct tenant/resource-scoped permissions for correlation reads and
mutations:

```text
incident.correlation.read
incident.correlation.link
incident.correlation.review
incident.correlation.detach
```

Automatic correlation uses an explicit `SYSTEM_CORRELATION` principal with
`incident.correlation.link`; authorized human reviewers use
`incident.correlation.review`; explicit detach requires
`incident.correlation.detach`. Manual attach requires the applicable
correlation link/review authority and resource scope. Existing
`incident.correlate` remains the TASK-033 baseline and grants none of these
new permissions by implication. Do not use broad `incident.admin` or wildcard
authority. AuthorizationPort validates tenant before resource scope;
cross-tenant candidate identity/scores must not be disclosed.

---

## TASK-093 Knowledge Recommendation Permissions

Define/adapt `knowledge.recommendation.use`,
`knowledge.recommendation.review` and `knowledge.feedback.submit`. Recommendation
use/review does not grant Knowledge read access: every candidate and exact
version still requires canonical `knowledge.read` equivalent, tenant/resource
scope and audience authorization. Feedback is scoped to actor and
recommendation session/item. End-user recommendation returns only explicitly
governed end-user-safe audience content; operator-only Knowledge is denied.
These permissions do not grant authoring or publishing and cannot disclose
inaccessible title, snippet, count, score, tags, rank or existence.

## TASK-093-R2A Reference and Knowledge Read Permissions

Register `service.read/manage`, `platform.read/manage` and
`service_environment.read/manage` as separate permissions. Register
`knowledge.read` as the narrow runtime Knowledge read permission and
`knowledge.read.operator` for operator-audience reads where the authorization
model requires a distinct capability. Preserve `knowledge.manage` for
authoring/governance. Permission registration does not grant these permissions
to roles automatically; existing role bindings are not broadened by this
foundation. Recommendation use never bypasses read authorization or explicit
audience classification.

TASK-093-R2 makes `knowledge.read` a runtime read capability independent of
`knowledge.manage`. `knowledge.read` permits only otherwise eligible
`END_USER_SAFE` published Knowledge within tenant/resource scope.
`knowledge.read.operator` permits published `OPERATOR_ONLY` Knowledge only
where separately granted operator scope allows it. A read permission cannot
override audience classification, and audience classification cannot grant
read permission. Search candidates are subject to the same checks.

## TASK-094 Asset Scoring Permissions

Register narrow capabilities equivalent to `asset.scoring.read`,
`asset.scoring.recalculate` and `asset.scoring.manage_policy`. Assessment
reads require same-tenant Asset read scope; recalculation is a separate
explicit command permission. Useful-life policy management is restricted to
authorized Asset policy administrators. `SYSTEM_ASSET_SCORING` is an explicit
tenant-scoped principal with only required Asset scoring, domain evidence
query and narrow TASK-059 candidate-create grants. Never grant wildcard,
tenantless, Asset-owner impersonation or general administrator authority.
Incident, Monitoring, Maintenance and Procurement query permissions remain
owned and enforced by those domains; approval does not substitute for
authorization.

TASK-094 runtime provisions `SYSTEM_ASSET_SCORING` per tenant and uses only
explicit resource-scoped grants for scoring, Asset evidence reads and the
TASK-059 candidate recommendation command. Provisioning is fail-closed; no
default role receives these grants and GLOBAL/TENANT/wildcard grants are
rejected for this principal type. Human recalculation, policy management and
acquisition-date verification use their separate user permissions.

TASK-094-R2 uses least-privilege capabilities: Maintenance classification
changes require `maintenance.manage`; completed Asset-history reads require
`maintenance.read` against a tenant-scoped Maintenance resource through the
`AuthorizationPort`; candidate recommendations require
`replacement.create_candidate` against the same-tenant Asset through TASK-059
authorization; recovery state changes require `identity.offboard` (plus
existing exception permission for waiver). Permission catalog registration
does not grant roles. The scoring System principal is not introduced or
granted by R2. No wildcard or implicit authorization is added.

TASK-094-R3 registers (without granting any role) `incident.asset_link`,
`incident.asset_history.read`, `monitoring.asset_reliability.read` and
`warranty.read`. Incident link and history commands/queries, Monitoring Asset
reliability reads and Warranty state reads use tenant-scoped
`AuthorizationPort` checks. The aggregate Incident history query uses its
narrow resource type rather than pretending the Asset ID is an Incident ID.
Internal scheduled
Warranty projection is restricted to the tenant-bound worker context and does
not create a general-purpose system grant. No wildcard permission is used.

## TASK-095 Reporting authorization

`metric.read` authorizes the governed KPI catalog/current/history subject to
tenant and resource scope. `report.export` is additionally required for
aggregate CSV. KPI-009 requires a narrow Procurement cost-read capability;
TASK-095 runtime must reuse an existing equivalent or register
`procurement.cost.read`, never require `procurement.manage` for an aggregate.
Metric access does not grant underlying Ticket, Incident, Asset or Procurement
record access: drill-down rechecks that domain's read permission and returns no
unauthorized IDs, titles, snippets or counts. No cross-tenant analytics,
schedule-delivery or custom-formula permission exists in v1.

Legacy SLA target-purpose classification requires the narrow
`sla.target_purpose.manage` permission scoped to the same-tenant `sla_target`.
Reading governed KPI aggregates does not grant this configuration permission.
The Reporting system principal, if used for KPI-004, receives only tenant-
scoped SLA outcome read access and never target-purpose mutation.

The implemented Reporting routes use `metric.read` for catalog/current
results, additionally `report.read` for history and `report.export` for CSV.
KPI-009 requires `procurement.cost.read`. Each contribution row is separately
authorized using its owning-domain read permission; denied rows are omitted
without returning their identifiers or metadata. The internal worker uses
only the active tenant's `SYSTEM_REPORTING` principal and its explicit
capability allow-list.

### TASK-096 recommendation access

`recommendation.read` grants access to the recommendation aggregation
interface only. Every item additionally requires owning-source authorization:
Incident read for correlation review; TASK-093/Knowledge read, audience and
resource eligibility for Knowledge guidance; and Asset/TASK-059 candidate read
for replacement review. `recommendation.interact` grants only actor-scoped
`VIEWED`, `DISMISSED` and `OPENED_SOURCE` metadata writes. It grants no
Incident review/attach, Knowledge mutation, Asset/TASK-059 disposition,
approval, Work Queue mutation or Automation execution. All checks are
tenant/resource scoped; denial fails closed without revealing source metadata.

TASK-096-R2 source reads use the existing narrow capabilities: Incident
correlation feed access requires `incident.correlation.read` and each returned
Incident/Root is checked with `incident.read`; replacement-source access
requires `asset.read` plus `asset.scoring.read`, including resource-scoped
checks for each Asset. No correlation mutation or `replacement.create_candidate`
permission is granted by these read adapters. Unauthorized records are
omitted without returning their source identifiers or explanations.

TASK-096 feed/detail/history requires `recommendation.read`; interaction requires `recommendation.interact`. Each source adapter rechecks narrow Incident, Knowledge/session/audience or Asset/scoring read permissions. The scoped `SYSTEM_RECOMMENDATION` worker also requires explicit tenant grants for reconciliation and source reads; wildcard and tenantless principals are invalid.

# 112. RELEASE-001-R1 — OIDC Principal and Local Authorization

OIDC authenticates an external identity; platform authorization remains canonical local RBAC. A validated user is resolved by exact issuer + subject to a local IdentityLink, then checked against current User state and an active platform TenantMembership for the explicitly requested tenant. Missing link, inactive principal, missing membership, missing permission or resource denial is denied; a valid token alone grants no application permissions.

Do not convert access-token `roles`, `groups`, `tenant_id`, organization or other vendor claims directly into local roles, memberships or permissions. External group-to-role synchronization may run only through its separately versioned Identity provisioning contract and creates explicit local role bindings; request authorization uses those local bindings and policies. Role, membership, scope and user-state revocation must be observed on the next protected request, or through a bounded cache with explicit version invalidation. No indefinite permission cache is allowed.

System/client tokens require an explicit issuer + subject/client registration to a canonical tenant-scoped SystemPrincipal. The resulting principal receives only its pre-existing explicit local grants. It cannot impersonate a human or obtain wildcard, cross-tenant or administrator access from token claims.

Initial administrator bootstrap is a trusted control-plane operation for a specified issuer/subject, local user, tenant and local admin role. It is allowed only if no active local human currently has canonical `rbac.manage` in any active tenant and a durable singleton completion marker is absent. Both conditions are checked and the marker, IdentityLink and initial local grant are written atomically; the marker makes bootstrap one-time even if the initial administrator is later removed. It is not a public route, default password or cross-tenant grant. Emergency access uses an explicitly mapped external OIDC identity with IdP-side strong MFA and audited, narrow local scope. RELEASE-001 v1 does not add local-password break-glass.

### RELEASE-001-R2 — tenant selection and membership authorization

For every protected tenant-scoped request, `X-Tenant-ID` is the one required
requested-context selector. It grants no access. Authentication resolves the
external IdentityLink first; the selected tenant must then resolve to one
ACTIVE TenantMembership bound to the tenant-local User/SystemPrincipal before
local RBAC and resource-scope evaluation. No sole-membership/default/token
claim fallback is allowed. Missing selector is a 400; malformed or duplicate
selector is a 400; no active membership is a safe 403 that does not disclose
whether the tenant exists. Token tenant/org/group claims do not create
membership or permissions. Revocation of one membership takes effect on the
next authorization evaluation and does not revoke other tenant bindings.

Provisioning/link and membership grant/revoke are separate Identity-owned,
authorized operations with actor, tenant, reason, idempotency, concurrency
and audit controls. `recommendation.read`, `metric.read`, service identity or
any other permission does not bypass tenant membership. See the normative
[RELEASE-001-R2 contract](release/items/RELEASE-001-R2_EXPLICIT_TENANT_CONTEXT_MEMBERSHIP_FOUNDATION.md).
