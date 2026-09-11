# CHANNEL INTEGRATION + ENTERPRISE BRANDING + NOTIFICATION + COMMUNICATION WORKFLOW SPEC
## Execution-Level Workflow Design

**Version:** 0.1  
**Status:** Draft for implementation  
**Parent:** `MASTER_WORKFLOW_MAP.md`  
**Depends on:**  
- `HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `PROBLEM_CHANGE_KNOWLEDGE_WORKFLOW.md`
- `IDENTITY_SSO_RBAC_USER_LIFECYCLE_OFFBOARDING_WORKFLOW.md`

**Scope:** Self-Service Portal, Email, Teams, Slack, Mobile, API/Webhook, Inbound Message Routing, Outbound Notifications, Major Incident Communication, Notification Preferences, Deduplication, Escalation, Enterprise Branding, Templates, Multi-tenant/Organization Branding, Delivery Tracking, Communication Audit Trail

---

# 1. Mục tiêu

Tài liệu này chuẩn hóa toàn bộ cách người dùng và operator giao tiếp với hệ thống qua nhiều kênh nhưng vẫn đi vào một workflow thống nhất.

Nguyên tắc cốt lõi:

```text
Channel
→ Identity Resolution
→ Intent Classification
→ Context Enrichment
→ Unified Request / Event
→ Workflow
→ Response
→ Channel Delivery
```

Mục tiêu:

- không tạo workflow riêng biệt cho từng channel;
- cùng một user/ticket có thể tiếp tục hội thoại qua nhiều channel mà không tạo duplicate;
- Portal, Email, Teams, Slack, Mobile, API đều đi vào cùng Ticket/Request model;
- outbound notification có priority, preference, deduplication và escalation;
- Major Incident communication phải nhất quán;
- Enterprise Branding áp dụng thống nhất cho portal, email, PDF, notification và login experience;
- không để notification spam operator;
- mọi inbound/outbound communication đều audit được;
- secrets/webhook tokens không xuất hiện trong log;
- support template versioning, localization và organization-specific branding.

---

# 2. Core Entities

```text
CHANNEL
CHANNEL CONNECTION
CHANNEL ACCOUNT
CONVERSATION
MESSAGE
MESSAGE THREAD
INBOUND MESSAGE
OUTBOUND MESSAGE
DELIVERY
DELIVERY RECEIPT
USER
TICKET
REQUEST
INCIDENT
ROOT INCIDENT
NOTIFICATION
NOTIFICATION POLICY
NOTIFICATION PREFERENCE
ESCALATION POLICY
COMMUNICATION TEMPLATE
TEMPLATE VERSION
BRANDING PROFILE
ORGANIZATION
TENANT
WEBHOOK ENDPOINT
WEBHOOK DELIVERY
API CLIENT
SUBSCRIPTION
AUDIT TRAIL
```

---

# 3. Supported Channels

```text
SELF_SERVICE_PORTAL
EMAIL
MICROSOFT_TEAMS
SLACK
MOBILE_APP
SMS
PUSH_NOTIFICATION
API
WEBHOOK
CHATBOT
```

SMS/Push có thể optional theo deployment.

---

# 4. Unified Channel Principle

Không tạo:

```text
Email Ticket
Slack Ticket
Portal Ticket
Teams Ticket
```

như các loại nghiệp vụ khác nhau.

Thay vào đó:

```text
Ticket
└─ source_channel
└─ conversation_thread
└─ message history
```

Channel chỉ là transport/context.

---

# 5. Message Model

```yaml
message:
  id:
  direction:
  channel:
  external_message_id:
  conversation_id:
  sender:
  recipients:
  subject:
  body:
  attachments:
  sent_at:
  received_at:
  delivery_status:
  visibility:
  related_ticket:
  related_incident:
```

Visibility:

```text
PUBLIC_TO_REQUESTER
INTERNAL_NOTE
SYSTEM
PRIVATE_OPERATOR
```

---

# 6. Conversation Thread

Một ticket có thể có nhiều message nhưng một conversation context.

```text
Ticket TCK-2042
├─ Email message 1
├─ Portal reply
├─ Teams reply
└─ Helpdesk response
```

System phải preserve:

```text
sender
channel
timestamp
visibility
external reference
```

---

# 7. WF-CH01 — Inbound Portal Request

Flow:

```text
User logs in
↓
Portal identifies user
↓
User selects request type or enters description
↓
Optional Asset selected automatically
↓
Submit
↓
Intent Classification
↓
Context Enrichment
↓
Create/Link Ticket
↓
Confirmation
```

Portal ưu tiên structured inputs khi hữu ích nhưng không bắt user điền quá nhiều field.

---

# 8. Portal Home Experience

User-facing entry points:

```text
I need help
Request a service
My devices
My tickets
Knowledge
Announcements / Service Status
```

Không expose module names nội bộ như:

```text
CMDB
Problem
Change
SNMP
Correlation
```

---

# 9. WF-CH02 — Inbound Email

Trigger:

```text
EMAIL.RECEIVED
```

Flow:

```text
Receive Email
↓
Validate Sender
↓
Resolve Identity
↓
Detect Existing Thread
↓
Parse Subject/Body
↓
Extract Attachments
↓
Classify Intent
↓
Create or Update Ticket
```

---

# 10. Email Thread Matching

Priority:

```text
ticket reference in reply headers
provider thread ID
ticket number in subject
message-id / in-reply-to
trusted correlation token
```

Không match chỉ theo subject text.

---

# 11. Email Duplicate Prevention

Use:

```text
external_message_id
provider_message_id
message_hash
```

Nếu mail gateway retry:

```text
do not append duplicate message
```

---

# 12. Unknown Email Sender

Nếu sender không map được:

```text
EXTERNAL / UNKNOWN
```

Policy options:

```text
Reject
Create Unverified Request
Send verification link
Route Identity Review
Allow external support channel
```

---

# 13. Email Attachment Handling

Check:

```text
file type
size
malware scan
content policy
```

Unsafe attachment:

```text
quarantine
do not expose directly
```

---

# 14. WF-CH03 — Teams / Slack Inbound

Possible entry:

```text
Bot DM
App message
Channel shortcut
Message action
Adaptive card / modal
```

Flow:

```text
User sends request
↓
Resolve platform identity
↓
Map to internal User
↓
Collect minimal context
↓
Create/Link Ticket
↓
Return Ticket ID + status
```

---

# 15. Teams/Slack Identity Mapping

Use:

```text
provider user ID
tenant/workspace ID
verified email
SSO mapping
```

Do not rely only on display name.

---

# 16. Channel Bot Interaction

Bot nên support:

```text
Create Ticket
Check Ticket Status
Approve/Reject Request
Run Approved Self-Service Action
Search Knowledge
Report Service Outage
```

Không expose high-risk admin actions nếu channel security không phù hợp.

---

# 17. WF-CH04 — API Request Inbound

API clients có thể:

```text
create request
create incident
update ticket
push monitoring event
query status
```

Require:

```text
authentication
authorization
rate limit
idempotency key
request validation
```

---

# 18. API Idempotency

Example:

```text
Idempotency-Key: external-request-123
```

Retry:

```text
same key + same payload
→ same result
```

Do not create duplicate tickets/events.

---

# 19. Webhook Inbound

Webhook endpoint needs:

```text
signature validation
source validation
replay protection
timestamp tolerance
rate limiting
schema validation
```

---

# 20. WF-CH05 — Channel Intent Classification

Possible classes:

```text
INCIDENT
SERVICE_REQUEST
ACCESS_REQUEST
SOFTWARE_REQUEST
ASSET_REQUEST
QUESTION
APPROVAL_RESPONSE
STATUS_QUERY
UNKNOWN
```

If confidence low:

```text
Needs Triage
```

Do not silently force incorrect category.

---

# 21. Context Enrichment

After message arrives:

```text
Identity
Asset
Service
Location
Agent
Monitoring
Recent Tickets
Known Incident
Knowledge
```

Same enrichment pipeline regardless of channel.

---

# 22. Cross-Channel Continuity

User can:

```text
create via Teams
reply via Email
check via Portal
```

System keeps one ticket.

Requires:

```text
identity mapping
thread mapping
ticket reference
message audit
```

---

# 23. Cross-Channel Duplicate Rule

If same user reports same issue within time window:

```text
same user
same asset/service
same symptom
same active root incident
```

System should:

```text
link/update existing
or
offer merge
```

not silently create duplicates.

---

# 24. Outbound Notification Model

Notification is an intent:

```yaml
notification:
  id:
  event:
  audience:
  priority:
  template:
  channel_policy:
  dedupe_key:
  related_entity:
  status:
```

Then delivery engine decides channel.

---

# 25. Notification Priorities

```text
CRITICAL
ACTION_REQUIRED
IMPORTANT
INFORMATIONAL
DIGEST
```

Examples:

## CRITICAL

```text
Major outage
Security critical
Failed emergency change
```

## ACTION_REQUIRED

```text
Approval
Asset return
Audit exception
License decision
```

## IMPORTANT

```text
SLA risk
Warranty expiring
Maintenance overdue
```

## INFORMATIONAL

```text
Ticket assigned
Software installed
Asset transfer completed
```

## DIGEST

```text
Daily summary
Weekly health
Monthly compliance
```

---

# 26. Notification Audience Resolution

Possible recipients:

```text
Requester
Assignee
Team
Manager
Service Owner
Incident Manager
Affected Users
Approver
Asset Owner
Contract Owner
Security Team
```

---

# 27. Channel Selection Policy

Example:

```text
CRITICAL
→ Push + Teams/Slack + Email

ACTION_REQUIRED
→ Preferred interactive channel + Email fallback

INFORMATIONAL
→ User preference

DIGEST
→ Email/Portal
```

---

# 28. User Notification Preferences

Users may configure:

```text
Email
Teams/Slack
Push
Digest frequency
Quiet Hours
```

But mandatory security/critical notifications may override preferences per policy.

---

# 29. Quiet Hours

Configurable:

```text
start
end
timezone
priority bypass
```

Example:

```text
Informational notification
→ defer

P1 incident
→ bypass
```

---

# 30. Notification Deduplication

Dedup key examples:

```text
ticket:{id}:assigned:{version}
incident:{id}:major_update:{sequence}
asset:{id}:warranty:{threshold}
approval:{id}:reminder:{day}
```

Do not send repeated identical messages.

---

# 31. Notification Rate Limiting

Prevent storms:

```text
max per user per time window
max per incident
batch similar alerts
```

Example:

```text
48 assets affected by same outage
→ 1 Major Incident notification
```

not 48 alerts.

---

# 32. Notification Suppression

Suppress if:

```text
child event linked to Root Incident
maintenance window
duplicate state
user already acknowledged
workflow closed
```

Suppression must be auditable.

---

# 33. Escalation Policy

Escalation can depend on:

```text
priority
SLA
acknowledgement
business hours
team
service criticality
```

Example:

```text
P1
T+0 → On-call
T+10m no ack → Team Lead
T+20m → Incident Manager
T+30m → Service Owner
```

---

# 34. Acknowledgement

Some notifications require ACK.

```text
ACK_REQUIRED
```

Track:

```text
sent_at
ack_at
ack_by
channel
```

---

# 35. Reminder Policy

Action-required reminder:

```text
Initial
T+N
T+2N
Final escalation
```

Stop reminders after:

```text
action completed
request cancelled
workflow closed
```

---

# 36. Delivery Status

```text
QUEUED
SENT
DELIVERED
READ
FAILED
BOUNCED
ACKNOWLEDGED
```

Not all channels support every state.

---

# 37. Delivery Fallback

If primary channel fails:

```text
Teams delivery failed
↓
Email fallback
```

Critical notification may use multiple channels simultaneously.

---

# 38. WF-COM01 — Ticket Communication

Ticket updates to user should communicate meaningful state.

Examples:

```text
Received
Assigned
Need Information
Waiting Vendor
Resolved
Reopened
```

Do not notify every internal state transition.

---

# 39. Internal vs Public Notes

Operators need explicit separation:

```text
Reply to User
Internal Note
```

Internal note must never be delivered to requester.

---

# 40. Mention / Collaboration

Internal operators may:

```text
@mention team/user
```

Creates internal notification, not public ticket reply.

---

# 41. WF-COM02 — Major Incident Communication

When Major Incident declared:

```text
Identify Affected Audience
↓
Initial Notice
↓
Periodic Updates
↓
Recovery Notice
↓
Resolution Notice
```

---

# 42. Major Incident Initial Message

Should include:

```text
what is affected
who may be affected
when it started
current status
workaround if any
next update time
```

Avoid unverified root-cause claims.

---

# 43. Major Incident Update Cadence

Example:

```text
P1 → every 30 min
P2 → every 60 min
```

Configurable.

If no new information:

```text
send "investigation continues" only if cadence policy requires
```

---

# 44. Root Incident Child Ticket Communication

When user creates ticket for known outage:

```text
Ticket linked to Root Incident
↓
User receives:
"We are aware of this issue. Your ticket is linked to INC-2042."
```

No need for technician to send manual duplicate response.

---

# 45. Resolution Communication

Resolution message should include:

```text
service restored
resolution time
what user should do
whether action is required
support link
```

Technical RCA may be internal or separate postmortem.

---

# 46. Status Page Integration

Optional external/internal status page:

```text
Incident
→ Status Component
→ Degraded / Outage / Operational
```

Not every internal incident should publish externally.

---

# 47. Service Subscription

Users may subscribe to:

```text
VPN
Email
ERP
Network Site
Application
```

Then receive relevant incident notifications.

---

# 48. Enterprise Branding Profile

```yaml
branding_profile:
  organization:
  display_name:
  logo:
  favicon:
  primary_theme:
  portal_title:
  support_name:
  support_email:
  footer_text:
  legal_links:
  document_header:
  document_footer:
  email_header:
  email_footer:
  login_background:
```

---

# 49. Branding Scope

Can apply by:

```text
Organization
Tenant
Business Unit
Portal
Document Type
Channel
```

Example:

```text
Parent company
Subsidiary A
Subsidiary B
```

can have different brand profiles.

---

# 50. Branding Does Not Affect Logic

Branding changes:

```text
appearance
text
logo
templates
```

not:

```text
permissions
workflow rules
SSO trust
approval policy
```

---

# 51. Template Engine

Templates used for:

```text
Email
Teams/Slack Cards
Push
Portal Confirmation
PDF Documents
Major Incident Updates
Approval Requests
Reminders
```

---

# 52. Template Variables

Example:

```text
{{user.display_name}}
{{ticket.id}}
{{asset.asset_tag}}
{{incident.status}}
{{approval.url}}
{{company.name}}
```

Variables must be allowlisted.

---

# 53. Template Versioning

```text
DRAFT
REVIEW
ACTIVE
RETIRED
```

Published template should have immutable version.

Workflow references:

```text
template_id
template_version
```

for audit.

---

# 54. Template Localization

Support:

```text
vi-VN
en-US
...
```

Fallback:

```text
user locale
→ organization default
→ system default
```

---

# 55. Template Security

Do not expose:

```text
internal notes
security tokens
raw secrets
private RCA
sensitive asset data
```

unless audience authorized.

---

# 56. Branding + Document Integration

Generated documents inherit:

```text
logo
company info
header/footer
signature block
document numbering style
```

from active Branding Profile.

---

# 57. WF-NOT01 — Approval Notification

Flow:

```text
Approval Required
↓
Resolve Approver
↓
Send Interactive Notification
↓
Approver Opens Secure Context
↓
Approve / Reject
↓
Workflow Continues
```

---

# 58. Interactive Approval Security

Never approve solely by clicking an unverified external link if policy requires authentication.

Prefer:

```text
authenticated portal
signed action token with expiry
SSO re-auth for high-risk approvals
```

---

# 59. Approval Delegation

If approver unavailable:

```text
delegation
backup approver
manager escalation
```

Delegation must have:

```text
scope
validity
audit
```

---

# 60. WF-NOT02 — SLA Notification

At thresholds:

```text
70%
90%
100%
```

Possible:

```text
assignee reminder
team lead escalation
service owner notification
```

Do not notify requester about internal SLA countdown unless policy chooses.

---

# 61. WF-NOT03 — Asset Return Notification

Flow:

```text
Return Required
↓
Initial Notice
↓
Reminder
↓
Due
↓
Overdue
↓
Manager Escalation
```

Message includes:

```text
asset
due date
return location
instructions
contact
```

---

# 62. WF-NOT04 — Warranty / Contract / License Expiry

Threshold-based notifications:

```text
120d
90d
60d
30d
7d
```

But avoid sending every threshold to every role.

Routing example:

```text
120d → Owner
60d → Owner + Manager
30d → Procurement/Finance
7d → Escalation
```

---

# 63. Daily Operations Digest

Could include:

```text
P1/P2 open
SLA at risk
Offline agents
Maintenance overdue
Audit exceptions
Unknown devices
Warranty/license/contract expiry
Pending approvals
```

Personalized by role.

---

# 64. End-of-Day Handover Digest

For shift teams:

```text
Open Critical Work
Recently Escalated
Waiting Vendor
Waiting User
Failed Automation
Pending Major Incident
```

---

# 65. Channel Health Monitoring

Each integration has state:

```text
HEALTHY
DEGRADED
FAILED
AUTH_EXPIRED
RATE_LIMITED
```

Need:

```text
last_success
last_failure
error rate
queue backlog
```

---

# 66. Channel Failure Workflow

Example:

```text
Teams integration failed
↓
Retry
↓
Still failed
↓
Mark DEGRADED
↓
Fallback to Email for critical
↓
Create Integration Work Item
```

---

# 67. OAuth / Token Expiry

For Teams/Slack/email API connections:

```text
token expiry
refresh failure
permission revoked
```

Event:

```text
CHANNEL.AUTH_EXPIRED
```

Notify integration admin.

---

# 68. Webhook Outbound

Use for external systems.

Delivery includes:

```text
event type
event id
timestamp
entity reference
payload version
signature
```

---

# 69. Webhook Retry

Policy:

```text
exponential backoff
max attempts
dead-letter queue
```

Do not retry forever.

---

# 70. Webhook Idempotency

Each delivery includes:

```text
event_id
delivery_id
```

Consumer can deduplicate.

---

# 71. Dead Letter Queue

Failed outbound deliveries after retries:

```text
DLQ
```

Operator can:

```text
inspect
retry
discard with reason
```

---

# 72. Subscription Model

External integrations may subscribe to:

```text
ticket.created
incident.major
asset.assigned
asset.returned
license.expiring
audit.exception
```

Need permission validation.

---

# 73. API/Webhook Permission Scope

Example:

```text
ticket.read
ticket.write
incident.read
asset.read
notification.receive
```

Least privilege.

---

# 74. Channel Audit Trail

Record:

```text
inbound/outbound
channel
external message id
sender
recipient
timestamp
delivery status
related entity
template version
```

Do not log secrets.

---

# 75. Communication Retention

Message retention may differ from:

```text
ticket retention
audit retention
chat platform retention
```

Policy configurable.

---

# 76. Attachment Retention

Attachments linked to:

```text
ticket
incident
message
document
```

Need:

```text
malware scan
retention
access control
```

---

# 77. Privacy / Data Minimization

Outbound message only includes data needed for recipient.

Example:

```text
Asset return reminder
```

does not need:

```text
internal health score
purchase cost
security findings
```

---

# 78. Channel-Specific Formatting

Same notification intent can render as:

```text
Email HTML
Teams Card
Slack Block
Push Text
Portal Banner
```

Business logic remains same.

---

# 79. Portal Announcement

Can publish:

```text
Planned Maintenance
Known Outage
Service Update
Policy Notice
```

Audience by:

```text
site
department
service
role
organization
```

---

# 80. Planned Maintenance Communication

Flow:

```text
Change Scheduled
↓
Affected Audience
↓
Pre-notice
↓
Reminder
↓
Maintenance Start
↓
Completion / Extension
```

---

# 81. Notification Acknowledgement for Operators

Critical operator notification may require:

```text
ACK
```

If no ACK:

```text
escalate
```

---

# 82. User Response Handling

Inbound reply can change workflow.

Examples:

```text
"Đã ổn"
→ close/resolution confirmation

"Vẫn lỗi"
→ reopen

"Không phải máy này"
→ context correction

"Không cần nữa"
→ cancel request if allowed
```

---

# 83. Reply Intent Safety

Do not execute destructive/high-risk action from free-text reply without explicit confirmation/auth.

Example:

```text
"Xóa máy đi"
```

must not directly trigger disposal.

---

# 84. Approval via Chat

Could support:

```text
Approve
Reject
Need More Info
```

but only if channel identity and authorization are trusted.

---

# 85. Chatbot Knowledge Flow

```text
User asks question
↓
Identify intent
↓
Search Knowledge
↓
Present answer
↓
Solved?
├─ YES → end
└─ NO → create ticket with transcript
```

---

# 86. Chatbot Escalation

When creating ticket:

```text
attach conversation transcript
attach attempted articles
attach detected asset/service
```

User should not repeat everything.

---

# 87. Major Incident Chat Channel

Optional:

```text
Root Incident
→ Auto-create incident room/channel
→ Add responders
→ Pin status
→ Capture key updates
```

But chat room does not replace Incident record.

---

# 88. Communication Source-of-Truth

Incident record remains authoritative.

Chat/Slack/Teams messages are collaboration evidence/context.

Important decisions should be written back to Incident/Change timeline.

---

# 89. Notification Preference Exceptions

Mandatory notifications may include:

```text
Security Incident
Legal/Compliance Notice
Asset Return
Critical Major Incident
```

Policy decides if user can opt out.

---

# 90. Escalation Suppression

Do not escalate if:

```text
acknowledged
work completed
approval superseded
incident resolved
user no longer affected
```

---

# 91. Template Preview / Test

Admin should be able to:

```text
preview
send test
validate variables
```

before activation.

---

# 92. Template Fallback

If template rendering fails:

```text
use safe fallback template
log rendering error
```

Do not drop critical notification.

---

# 93. Branding Asset Integrity

Uploaded logo/image should have:

```text
validation
size limit
safe content
version
```

Branding assets should not contain executable content.

---

# 94. Multi-Organization Branding

If platform serves multiple business entities:

```text
Request context
→ Organization
→ Branding Profile
→ Template Locale
```

---

# 95. Generated Events

## Channels

```text
CHANNEL.CONNECTED
CHANNEL.DEGRADED
CHANNEL.FAILED
CHANNEL.AUTH_EXPIRED
CHANNEL.RECOVERED
MESSAGE.RECEIVED
MESSAGE.SENT
MESSAGE.DELIVERY_FAILED
```

## Notifications

```text
NOTIFICATION.CREATED
NOTIFICATION.QUEUED
NOTIFICATION.SENT
NOTIFICATION.DELIVERED
NOTIFICATION.FAILED
NOTIFICATION.ACKNOWLEDGED
NOTIFICATION.SUPPRESSED
NOTIFICATION.ESCALATED
```

## Communication

```text
COMMUNICATION.MAJOR_INCIDENT_STARTED
COMMUNICATION.MAJOR_INCIDENT_UPDATED
COMMUNICATION.MAJOR_INCIDENT_RESOLVED
ANNOUNCEMENT.PUBLISHED
```

## Branding/Templates

```text
BRANDING.UPDATED
TEMPLATE.CREATED
TEMPLATE.APPROVED
TEMPLATE.ACTIVATED
TEMPLATE.RETIRED
```

---

# 96. Downstream Workflow Mapping

```text
Portal/Email/Chat Incident
→ Helpdesk Workflow

Major Incident
→ Communication Workflow

Approval Notification
→ Approval Engine

Asset Return Reminder
→ Asset Return Workflow

Contract Expiry
→ Procurement/Contract Renewal

Channel Failure
→ Integration Operations

Chatbot Failure
→ Helpdesk Ticket
```

---

# 97. Permissions

## End User

```text
create request
reply
view own ticket
set non-mandatory notification preferences
```

## Helpdesk

```text
public reply
internal note
send manual notification
```

## Incident Manager

```text
publish major incident update
control stakeholder communication
```

## Communication Admin

```text
manage templates
manage channel routing
```

## Branding Admin

```text
manage branding profile
```

## Integration Admin

```text
configure channel credentials
webhooks
API clients
```

---

# 98. Notification Permissions

Operators should not arbitrarily broadcast to all users.

Broadcast scope may require:

```text
incident manager
communication admin
approved audience
```

---

# 99. Metrics / KPI

## Channels

```text
Inbound Message Volume
Channel Availability
Delivery Success Rate
Channel Failure Rate
Average Processing Delay
```

## Notifications

```text
Delivery Rate
Bounce Rate
Acknowledgement Time
Escalation Rate
Suppression Rate
Duplicate Prevention Count
```

## Helpdesk Communication

```text
First Response Time
User Response Time
Reopen After Resolution
Cross-Channel Continuity Rate
```

## Major Incident

```text
Time to First Communication
Update Cadence Compliance
Affected User Reach
Acknowledgement Rate
```

---

# 100. Idempotency

Examples:

```text
message:{channel}:{external_message_id}
notification:{event}:{recipient}:{version}
webhook_delivery:{event_id}:{endpoint}
approval_response:{approval}:{actor}:{version}
announcement:{incident}:{update_sequence}
```

Retry không tạo duplicate communication.

---

# 101. Guardrails

Hệ thống không được:

1. Tạo ticket mới cho mỗi channel reply nếu thread đã tồn tại.
2. Match email thread chỉ theo subject.
3. Gửi internal note cho end user.
4. Spam user bằng child alerts khi đã có Root Incident.
5. Gửi confidential data qua channel không phù hợp.
6. Cho unauthenticated chat action approve high-risk request.
7. Log webhook secret/token plaintext.
8. Retry webhook vô hạn.
9. Dùng branding config để thay đổi authorization/workflow logic.
10. Cho template truy cập arbitrary internal fields.
11. Gửi notification đã obsolete sau workflow closure.
12. Broadcast toàn công ty không qua permission.
13. Tự đóng incident từ free-text reply mơ hồ.
14. Mất message history khi user đổi channel.
15. Bỏ qua channel failure cho critical notification mà không fallback.
16. Cho user opt-out mandatory legal/security notices nếu policy không cho phép.
17. Tạo duplicate Major Incident updates do retry.

---

# 102. End-to-End Example — Ticket via Teams, Continue via Email

```text
User sends Teams message:
"VPN không vào được"
↓
Teams identity maps to Nguyễn Văn An
↓
Asset AST-0042 auto-resolved
↓
Ticket TCK-2042 created
↓
Helpdesk replies via Ticket Workspace
↓
Response delivered to Teams
↓
User later replies from email
↓
Email thread resolves ticket reference
↓
Message appended to same TCK-2042
↓
No duplicate ticket
```

---

# 103. End-to-End Example — Major Incident

```text
Monitoring detects Hanoi WAN outage
↓
Root Incident INC-3002
↓
Affected users identified
↓
Initial notification:
Teams + Email + Portal Banner
↓
Child user tickets auto-linked
↓
Incident Manager sends update every 30 min
↓
WAN recovered
↓
5-minute stability verification
↓
Resolution notification
↓
Portal banner removed
↓
Status page restored
```

---

# 104. End-to-End Example — Approval

```text
User requests paid software
↓
Manager approval required
↓
Notification sent via Teams
↓
Manager clicks Approve
↓
SSO-authenticated approval context opens
↓
Approval recorded
↓
Software workflow continues
↓
User notified installation scheduled
```

---

# 105. End-to-End Example — Channel Failure

```text
Teams API token expires
↓
CHANNEL.AUTH_EXPIRED
↓
Teams channel marked DEGRADED
↓
Critical notifications fallback to Email
↓
Integration Admin notified
↓
Token renewed
↓
Health check PASS
↓
Channel = HEALTHY
```

---

# 106. End-to-End Example — Asset Return Reminder

```text
Offboarding creates Asset Return Task
↓
T-3 days reminder via Email + Portal
↓
T-1 day Teams reminder
↓
Due date passes
↓
User has not returned device
↓
Manager escalation
↓
Asset received
↓
All future reminders suppressed
```

---

# 107. Definition of Done

Cụm workflow này đạt yêu cầu khi:

- Portal/Email/Teams/Slack/API đi vào unified request model.
- Cross-channel thread continuity hoạt động.
- Inbound duplicate prevention hoạt động.
- Channel identity mapping tin cậy.
- Notification có priority, audience, preference, fallback.
- Deduplication + suppression + rate limit hoạt động.
- Escalation/acknowledgement có policy.
- Root Incident suppress child alert spam.
- Major Incident communication có cadence.
- Public vs Internal message tách rõ.
- Approval via channel có authentication.
- Webhook có signature, retry, DLQ, idempotency.
- Channel health/failure có monitoring và fallback.
- Enterprise Branding tách khỏi business logic.
- Template có version, localization, audience safety.
- Generated documents/email/portal dùng đúng branding profile.
- Notification/message audit trail đầy đủ.
- Metrics, permissions, retention, privacy guardrails được hỗ trợ.
