# AUDIT + NETWORK DISCOVERY + VLAN + TOPOLOGY WORKFLOW SPEC
## Execution-Level Workflow Design

**Version:** 0.1  
**Status:** Draft for implementation  
**Parent:** `MASTER_WORKFLOW_MAP.md`  
**Depends on:**  
- `HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`
- `MAINTENANCE_WARRANTY_REPLACEMENT_DISPOSAL_WORKFLOW.md`

**Scope:** Physical Audit, Inventory Verification, QR/Barcode Audit, Agent-based Audit, Network Discovery, Unknown Device Detection, IP/MAC Correlation, VLAN Validation, Switch/Port Mapping, Site/Floor/Room/Network Topology, Network Exceptions, Reconciliation, Change Integration

---

# 1. Mục tiêu

Tài liệu này chuẩn hóa cách hệ thống xác minh:

```text
EXPECTED STATE
vs
OBSERVED STATE
```

cho cả tài sản vật lý và trạng thái mạng.

Nguồn quan sát có thể là:

```text
QR / Barcode Scan
Agent Inventory
SNMP
ICMP
ARP
MAC Address Table
LLDP/CDP
Switch/Controller API
DHCP
DNS
Manual Verification
Import/API
```

Mục tiêu:

- biết tài sản thực tế đang ở đâu;
- biết ai đang sử dụng;
- biết thiết bị đang kết nối mạng nào;
- ánh xạ Asset ↔ IP ↔ MAC ↔ VLAN ↔ Switch ↔ Port ↔ Site/Floor/Room;
- phát hiện Unknown Device;
- phát hiện Asset Missing;
- phát hiện sai vị trí, sai owner, sai VLAN, sai port;
- không tạo duplicate asset từ discovery;
- phân biệt observation với source-of-truth;
- mọi mismatch phải đi qua Exception Resolution;
- mọi thay đổi mạng có rủi ro phải liên kết Change;
- topology phải được xây từ dữ liệu thật và có freshness/confidence.

---

# 2. Core Entities

```text
AUDIT
AUDIT SCOPE
AUDIT SESSION
AUDIT OBSERVATION
AUDIT EXCEPTION
ASSET
USER
LOCATION
SITE
BUILDING
FLOOR
ROOM
RACK
NETWORK DEVICE
NETWORK INTERFACE
IP ADDRESS
MAC ADDRESS
SUBNET
VLAN
VRF
SWITCH
SWITCH PORT
ACCESS POINT
WIRELESS CLIENT
ROUTER
FIREWALL
GATEWAY
DHCP LEASE
DNS RECORD
NETWORK OBSERVATION
DISCOVERY JOB
DISCOVERY SOURCE
TOPOLOGY NODE
TOPOLOGY EDGE
NETWORK EXCEPTION
CHANGE REQUEST
MOVEMENT
AGENT
DOCUMENT
AUDIT TRAIL
```

---

# 3. Source-of-Truth Principle

Không coi mọi discovery result là dữ liệu chuẩn ngay lập tức.

Mỗi field nên có:

```yaml
observed_value:
  value:
  source:
  observed_at:
  confidence:
  freshness:
  verified:
```

Ví dụ:

```text
Asset Location expected = Floor 4
Agent network = 10.20.4.42
Switch port mapping = SW-F2-01/Gi1/0/12
Physical scan = Floor 2
```

Hệ thống phải tạo mismatch thay vì tự động ghi đè tất cả.

---

# 4. Confidence Levels

```text
HIGH
MEDIUM
LOW
UNKNOWN
```

Ví dụ:

```text
QR Scan by authenticated auditor → HIGH
Agent authenticated inventory → HIGH
Switch MAC table mapping → MEDIUM/HIGH
ARP only → MEDIUM
DNS name guess → LOW
Manual free-text import → configurable
```

Confidence có thể ảnh hưởng auto-resolution.

---

# 5. Freshness Model

Mỗi source có timestamp riêng:

```text
agent_last_seen
snmp_last_poll
mac_table_observed_at
dhcp_lease_at
physical_scan_at
audit_verified_at
```

Không được dùng stale data như current state.

Ví dụ:

```text
Switch Port:
Observed 21 days ago
STALE
```

---

# 6. Physical Location Model

```text
Organization
↓
Country/Region
↓
Site
↓
Building
↓
Floor
↓
Room
↓
Rack / Zone / Desk / Warehouse Bin
```

Ví dụ:

```text
Vietnam
└─ Hanoi HQ
   └─ Building A
      └─ Floor 4
         └─ Marketing Zone
            └─ Desk MKT-042
```

Asset location phải reference entity, không chỉ lưu text.

---

# 7. Network Topology Model

```text
Site
↓
VRF
↓
Subnet
↓
VLAN
↓
Switch / AP / Router
↓
Port / Radio
↓
Asset / Client
```

Một Asset có thể có nhiều interface:

```text
Ethernet MAC
Wi-Fi MAC
Management interface
Virtual interface
```

---

# 8. WF-AUD01 — Create Audit

## Trigger

```text
Scheduled Audit
Quarterly Inventory
Compliance Request
Warehouse Cycle Count
Site Move
User Offboarding
Post-Incident Verification
Manual Audit
```

## Audit Scope

Có thể chọn:

```text
Site
Building
Floor
Room
Warehouse
Department
Asset Type
Asset Risk
Asset Value
Owner
Random Sample
```

---

# 9. Audit Session

State:

```text
DRAFT
PLANNED
IN_PROGRESS
PAUSED
RECONCILING
COMPLETED
CANCELLED
```

Object:

```yaml
audit:
  id:
  type:
  scope:
  expected_assets:
  methods:
  owner:
  auditors:
  started_at:
  due_at:
  status:
```

---

# 10. Expected Inventory Snapshot

Khi Audit bắt đầu:

```text
Take Expected Snapshot
```

Snapshot nên immutable theo audit version.

Ví dụ:

```text
AST-0042
Expected Owner = Nguyễn Văn An
Expected Location = Floor 4
Expected Serial = PF3X...
Expected Lifecycle = In Use
```

Nếu master data thay đổi giữa audit, vẫn giữ expected snapshot để giải thích discrepancy.

---

# 11. Audit Observation Sources

## QR / Barcode

```text
Scan Location
↓
Scan Asset
↓
Observe physical presence
```

## Agent

```text
Agent heartbeat
Logged-in user
Hostname
IP/MAC
Hardware inventory
```

## Network

```text
MAC table
ARP
DHCP
Switch port
Wireless controller
```

## Manual

```text
Auditor confirms/records condition
```

---

# 12. WF-AUD02 — QR Audit

Recommended pattern:

```text
Scan Floor/Room
↓
Scan Asset 1
↓
Scan Asset 2
↓
Scan Asset N
↓
Confirm Batch
```

Observation:

```yaml
audit_observation:
  asset_id:
  observed_location:
  observed_by:
  method: QR
  timestamp:
  condition:
  notes:
```

---

# 13. QR Validation

Nếu QR resolve:

```text
Known Asset
→ compare
```

Nếu QR không resolve:

```text
Unknown Tag
→ investigate
```

Nếu Asset belongs elsewhere:

```text
LOCATION_MISMATCH
```

Nếu Asset already scanned elsewhere in same audit:

```text
DUPLICATE_OBSERVATION
```

---

# 14. WF-AUD03 — Agent-assisted Audit

Agent có thể xác minh:

```text
Asset alive
Logged-in user
IP/MAC
Hostname
OS
Last Seen
```

Nhưng Agent không nhất thiết chứng minh physical room chính xác.

Do đó:

```text
Agent presence != physical location proof
```

trừ khi network mapping đủ tin cậy.

---

# 15. WF-AUD04 — Reconciliation

Sau khi thu thập:

```text
Expected
↓
Observed
↓
Compare
```

Possible results:

```text
VERIFIED
LOCATION_MISMATCH
OWNER_MISMATCH
SERIAL_MISMATCH
ASSET_MISSING
UNKNOWN_ASSET
DUPLICATE_ASSET
DATA_MISMATCH
CONDITION_EXCEPTION
NETWORK_MISMATCH
```

---

# 16. Audit Exception Object

```yaml
audit_exception:
  id:
  audit_id:
  asset_id:
  type:
  expected:
  observed:
  evidence:
  confidence:
  severity:
  suggested_actions:
  status:
```

State:

```text
OPEN
INVESTIGATING
WAITING_CONFIRMATION
RESOLVED
ACCEPTED_EXCEPTION
FALSE_POSITIVE
```

---

# 17. Location Mismatch Flow

Example:

```text
EXPECTED
Floor 4

OBSERVED
Floor 2
```

Actions:

```text
Update Asset Location
Request Return
Create Movement Investigation
Accept Temporary Exception
```

Nếu Update Location:

```text
Asset Location updated
Movement created
Audit Exception resolved
Timeline event created
Audit Trail written
```

Không bắt operator sang Assignment module.

---

# 18. Owner Mismatch Flow

Example:

```text
Expected User = Nguyễn Văn A
Observed Logged-in User = Trần Văn B
```

Không tự động đổi owner chỉ dựa trên login session.

Decision:

```text
Temporary use?
Shared device?
Actual transfer?
Credential misuse?
```

Actions:

```text
Confirm Assignment Transfer
Mark Shared Device
Ignore transient session
Investigate
```

---

# 19. Missing Asset Flow

Nếu Asset không được quan sát:

```text
Expected Asset
↓
No QR
No Agent
No Network Signal
```

Không lập tức kết luận mất.

Flow:

```text
Check Last Seen
↓
Check Movement
↓
Check Repair
↓
Check Transfer
↓
Check User
↓
Second Verification
```

Nếu vẫn không tìm thấy:

```text
ASSET.MISSING
→ Risk escalation
→ Investigation
```

---

# 20. Unknown Asset Flow

Một asset/device được thấy nhưng không có record:

```text
Observed Unknown
↓
Collect Evidence
↓
Try Match Existing Asset
```

Match keys:

```text
Serial
MAC
Hostname
Vendor
Model
User
Location
```

Actions:

```text
Link Existing Asset
Create Asset
Mark Temporary/Guest
Ignore by Policy
Security Investigation
```

Không auto-create Asset nếu confidence thấp.

---

# 21. Audit Completion

Audit chỉ `COMPLETED` khi:

```text
all observations collected
AND
all critical exceptions resolved/accepted
```

Có thể cho phép close với exceptions nhưng phải explicit:

```text
Completed with Exceptions
```

---

# 22. Audit Documents

Có thể sinh:

```text
Audit Plan
Expected Inventory Snapshot
Audit Result
Exception Report
Missing Asset Report
Correction Report
Sign-off
```

---

# 23. WF-N01 — Network Discovery Job

Trigger:

```text
Scheduled
Manual
New Subnet
New Site
Post-change
Unknown Device Investigation
```

Discovery scope:

```text
Subnet
VLAN
Site
IP Range
Switch
Wireless Controller
VRF
```

---

# 24. Discovery Sources

```text
SNMP
ICMP
ARP
MAC Address Table
LLDP/CDP
DHCP
DNS
Agent
Controller API
Firewall API
Switch API
Cloud API
```

Mỗi source phải lưu:

```text
source_type
credential/profile
started_at
finished_at
success/failure
coverage
```

---

# 25. Credential Security

Discovery credentials phải:

```text
stored securely
scoped minimally
rotatable
audited
```

Không lưu plaintext credentials trong workflow/log.

---

# 26. WF-N02 — Device Discovery

Flow:

```text
Discovery Scope
↓
Probe
↓
Device Responds
↓
Collect Identity
↓
Normalize
↓
Match Existing Entity
```

Collect:

```text
IP
MAC
Hostname
Vendor
Model
OS
SNMP sysName
Serial if available
Interfaces
Neighbor data
Switch Port
VLAN
Last Seen
```

---

# 27. Device Matching

Matching priority:

```text
Agent Asset ID
Serial Number
Known MAC
Network Device Serial
Management IP
Hostname + MAC
Other heuristic
```

Result:

```text
MATCHED_HIGH
MATCHED_MEDIUM
AMBIGUOUS
UNMATCHED
```

AMBIGUOUS không được auto-link.

---

# 28. Unknown Device Detection

Event:

```text
NETWORK.UNKNOWN_DEVICE
```

Object:

```yaml
unknown_device:
  mac:
  ip:
  hostname:
  vendor:
  switch:
  port:
  vlan:
  first_seen:
  last_seen:
  confidence:
```

Actions:

```text
Identify
Link to Asset
Create Asset
Mark Guest
Mark Infrastructure
Block/Quarantine
Ignore by Policy
```

---

# 29. Unknown Device Risk

Risk tăng nếu:

```text
restricted VLAN
server VLAN
management VLAN
unknown vendor
persistent presence
multiple IPs
spoofing indicators
policy violation
```

Security integration có thể tạo Incident.

---

# 30. WF-N03 — IP/MAC Reconciliation

System duy trì observation history:

```text
Asset
↔ Interface
↔ MAC
↔ IP
↔ VLAN
↔ Switch Port
```

Không overwrite history.

Ví dụ:

```text
09:00 MAC A → IP 10.20.4.42 → SW01/Gi1/0/10
15:00 MAC A → IP 10.20.4.87 → SW01/Gi1/0/15
```

---

# 31. Dynamic IP Handling

DHCP IP thay đổi là bình thường.

Do đó Asset identity không được phụ thuộc IP.

Track:

```text
current_ip
historical_ips
dhcp_lease
observed_at
```

---

# 32. MAC Address Changes

Có thể do:

```text
new NIC
dock
Wi-Fi randomization
VM
spoofing
```

System phải distinguish.

Policy:

```text
known secondary MAC → normal
new persistent MAC → review
rapid MAC changes → anomaly
```

---

# 33. WF-N04 — VLAN Validation

Expected VLAN có thể đến từ:

```text
Asset policy
Device class
Department
Site
Security zone
Network profile
```

Observed VLAN:

```text
switch port
wireless controller
DHCP/network telemetry
```

Compare:

```text
Expected VLAN
vs
Observed VLAN
```

---

# 34. VLAN Mismatch Flow

Example:

```text
Asset = Corporate Laptop
Expected VLAN = 20 Corporate
Observed VLAN = 30 Guest
```

Decision:

```text
intentional?
temporary?
recent approved change?
wrong port config?
NAC fallback?
user connected guest Wi-Fi?
```

Actions:

```text
Correct VLAN
Create Change Request
Accept Temporary Exception
Investigate Network
Notify User
```

---

# 35. Change Integration

Không auto-change network config nếu action có rủi ro.

Rule:

```text
Low-risk pre-approved action
→ Standard Change / Automation

Production/network infrastructure change
→ Normal Change

Active outage requiring urgent fix
→ Emergency Change
```

---

# 36. VLAN Change Verification

After implementation:

```text
Port/VLAN changed
↓
Rediscover
↓
Verify observed VLAN
↓
Verify connectivity
↓
Verify service health
↓
Resolve exception
```

---

# 37. VLAN Object

```yaml
vlan:
  id:
  vlan_number:
  name:
  site:
  vrf:
  subnet:
  purpose:
  security_zone:
  owner:
  allowed_asset_classes:
  status:
```

---

# 38. VLAN Lifecycle

```text
PLANNED
ACTIVE
DEPRECATED
RETIRED
```

Retired VLAN không được assign mới.

---

# 39. Subnet / IPAM Integration

Subnet object:

```yaml
subnet:
  cidr:
  site:
  vlan:
  vrf:
  gateway:
  dns:
  dhcp:
  reserved_ranges:
  owner:
```

IPAM cần phân biệt:

```text
static
DHCP
reserved
available
conflict
unknown
```

---

# 40. IP Conflict Detection

Trigger:

```text
same IP observed from multiple MACs
```

Flow:

```text
Detect Conflict
↓
Confirm freshness
↓
Identify DHCP/static sources
↓
Determine impact
↓
Create Network Exception
```

Actions:

```text
Release lease
Correct static config
Quarantine
Investigate
```

---

# 41. Switch Port Mapping

Port object:

```yaml
switch_port:
  switch:
  port:
  admin_state:
  oper_state:
  vlan:
  mode:
  poe:
  macs:
  neighbor:
  description:
  location:
```

Asset relationship:

```text
Asset → MAC → Switch Port
```

---

# 42. Port Movement Detection

Event:

```text
NETWORK.PORT_CHANGED
```

Có thể bình thường nếu laptop di chuyển.

Risk thấp với endpoint, cao hơn với:

```text
server
camera
network appliance
fixed infrastructure
```

---

# 43. LLDP/CDP Topology

Use:

```text
Network Device A
↓ LLDP/CDP
Network Device B
```

Create edge:

```yaml
topology_edge:
  from_node:
  from_port:
  to_node:
  to_port:
  source:
  observed_at:
  confidence:
```

---

# 44. Topology Node Types

```text
SITE
BUILDING
FLOOR
ROOM
RACK
ROUTER
FIREWALL
SWITCH
ACCESS_POINT
SERVER
ENDPOINT
SERVICE
VLAN
SUBNET
```

---

# 45. Physical + Logical Topology

System cần hỗ trợ 2 lớp:

## Physical

```text
Building
→ Floor
→ Room
→ Rack
→ Switch
→ Port
→ Asset
```

## Logical

```text
Service
→ Network Zone
→ VLAN
→ Subnet
→ Gateway
→ Asset
```

Không gộp tất cả thành một sơ đồ khó đọc.

---

# 46. Site/Floor Operational View

Ví dụ Floor 4:

```text
83 Users
112 Assets
4 Switches
6 APs
VLAN 20 / 30 / 40
3 Offline Agents
2 Open Incidents
1 Audit Exception
```

Click entity mở đúng context.

---

# 47. Topology Health Overlay

Có thể overlay:

```text
Healthy
Warning
Critical
Unknown
```

Ví dụ:

```text
Core Switch Critical
↓
Affected:
3 VLANs
4 APs
52 Assets
2 Services
```

Topology phục vụ correlation, không chỉ visualization.

---

# 48. Dependency Correlation

Nếu upstream device lỗi:

```text
Core Switch Down
↓
48 endpoints unreachable
```

Correlation Engine:

```text
parent failure explains child failures
```

Không tạo 48 Incident riêng.

---

# 49. Network Discovery vs Monitoring

Discovery trả lời:

```text
What exists?
Where is it connected?
How is it related?
```

Monitoring trả lời:

```text
Is it healthy now?
```

Không trộn hai khái niệm.

---

# 50. Network Discovery Schedule

Policy ví dụ:

```text
critical infrastructure: every 15 min
switch MAC tables: every 5 min
endpoint subnet discovery: hourly
full site inventory: daily
```

Tần suất phải configurable.

---

# 51. Discovery Failure

Nếu job fail:

```text
DISCOVERY.JOB_FAILED
```

Không xóa topology cũ ngay.

Mark:

```text
data stale
source unavailable
```

Escalate nếu vượt threshold.

---

# 52. Observation Aging

Nếu device không còn thấy:

```text
Last Seen Aging
```

Không lập tức delete.

Possible states:

```text
ACTIVE
STALE
MISSING
RETIRED
```

---

# 53. Auto-resolution Rules

Có thể auto-resolve mismatch nếu:

```text
source confidence HIGH
AND
policy allows
AND
change is low risk
```

Ví dụ:

```text
Agent confirms hostname changed
→ update hostname automatically
```

Không auto-resolve:

```text
Owner transfer
Restricted VLAN change
Asset disposal
High-value location correction
```

---

# 54. Network Exception Object

```yaml
network_exception:
  id:
  type:
  asset:
  expected:
  observed:
  source:
  confidence:
  severity:
  related_change:
  related_incident:
  status:
```

Types:

```text
UNKNOWN_DEVICE
VLAN_MISMATCH
IP_CONFLICT
PORT_MISMATCH
TOPOLOGY_MISMATCH
DEVICE_MISSING
UNAPPROVED_NETWORK_DEVICE
```

---

# 55. Exception State Machine

```text
OPEN
↓
INVESTIGATING
├─ WAITING_CHANGE
├─ WAITING_USER
├─ WAITING_NETWORK_TEAM
└─ WAITING_APPROVAL
↓
RESOLVED
```

Alternative:

```text
ACCEPTED_EXCEPTION
FALSE_POSITIVE
```

---

# 56. Work Queue Integration

Only actionable items go to operator.

Examples:

```text
12 Audit Exceptions
3 Unknown Devices
2 VLAN Mismatches
1 IP Conflict
5 Missing Assets
```

Raw discovery data không đẩy hết vào Work Queue.

---

# 57. Asset Workspace Integration

Asset Workspace network context:

```text
Current IP
MAC(s)
VLAN
Subnet
Switch
Port
Site/Floor
Last Seen
Agent
Network Exceptions
Recent Network History
```

Deep network detail có thể mở drawer/context.

---

# 58. Audit + Network Combined Verification

Ví dụ:

```text
AST-0042
Expected Location: Floor 4

QR Scan:
Floor 2

Network:
SW-F2-01 Port 12

Agent:
IP 10.20.2.42

Confidence:
High
```

System có thể đề xuất:

```text
"Asset likely moved to Floor 2"
[Update Location]
[Investigate]
```

---

# 59. Wrong Location Auto-evidence

Multiple signals:

```text
QR location
switch port location
Wi-Fi AP location
agent subnet
```

Confidence score tăng nếu đồng thuận.

Ví dụ:

```text
QR = Floor 2
Switch = Floor 2
Subnet = Floor 2
→ Confidence 98%
```

---

# 60. Wi-Fi Location

Wi-Fi mapping có thể dùng:

```text
AP association
Controller data
Site/Floor mapping
```

Không claim desk-level precision nếu source không hỗ trợ.

---

# 61. Network Device Lifecycle

Network devices cũng là Assets.

Ví dụ Switch:

```text
Asset
+ Network Device
+ Monitoring Target
+ Topology Node
```

Không tạo duplicate records riêng rẽ.

---

# 62. Unknown Network Device → Asset Creation

Flow:

```text
Unknown Device
↓
Identify Manufacturer/Model
↓
Check Serial/MAC
↓
Search Asset DB
```

Nếu không có:

```text
Create Asset Draft
↓
Require minimal verification
↓
Assign Asset Class
↓
Link Network Identity
```

Không auto-create full production Asset từ one-off ARP hit.

---

# 63. Network Change Audit Trail

Mọi network action phải lưu:

```text
who
what
when
device
port
before
after
reason
change_id
verification
```

Example:

```text
SW-F4-01/Gi1/0/12
VLAN 30 → VLAN 20
Change CHG-2042
```

---

# 64. Audit Trail for Corrections

Example:

```text
Action: Correct Asset Location
Asset: AST-0042

Before:
Floor 4

Observed:
Floor 2

Evidence:
QR Audit + Switch Port Mapping

After:
Floor 2

Movement:
MOV-9912

Actor:
asset.admin
```

---

# 65. Generated Events

## Audit

```text
AUDIT.CREATED
AUDIT.STARTED
AUDIT.OBSERVATION_RECORDED
AUDIT.ASSET_VERIFIED
AUDIT.LOCATION_MISMATCH
AUDIT.OWNER_MISMATCH
AUDIT.ASSET_MISSING
AUDIT.UNKNOWN_ASSET
AUDIT.DATA_MISMATCH
AUDIT.EXCEPTION_RESOLVED
AUDIT.COMPLETED
```

## Network

```text
DISCOVERY.JOB_STARTED
DISCOVERY.JOB_COMPLETED
DISCOVERY.JOB_FAILED
NETWORK.DEVICE_DISCOVERED
NETWORK.UNKNOWN_DEVICE
NETWORK.IP_CHANGED
NETWORK.MAC_CHANGED
NETWORK.IP_CONFLICT
NETWORK.VLAN_MISMATCH
NETWORK.PORT_CHANGED
NETWORK.TOPOLOGY_CHANGED
NETWORK.DEVICE_STALE
NETWORK.DEVICE_MISSING
```

---

# 66. Downstream Workflow Mapping

```text
Missing Asset
→ Asset Investigation / Security

Unknown Device
→ Asset Creation / Security Review

VLAN Mismatch
→ Change Management

Critical Network Device Down
→ Incident / Root Incident

Wrong Location
→ Movement Correction

Owner Mismatch
→ Assignment Review

Unsupported/Old Network Device
→ Replacement Workflow

Discovery Credential Failure
→ Operations / Security
```

---

# 67. Permissions

## Auditor

```text
create audit
scan assets
record observations
view expected state
```

## Asset Admin

```text
resolve asset/location exceptions
approve corrections
```

## Network Operator

```text
run discovery
manage topology
resolve network exceptions
propose VLAN changes
```

## Network Admin

```text
execute approved network changes
manage VLAN/subnet definitions
```

## Security

```text
investigate unknown/restricted devices
quarantine/block by policy
```

## Viewer

```text
read topology
read audit results
```

---

# 68. Approval Rules

Approval có thể yêu cầu cho:

```text
high-value asset location correction
restricted VLAN change
network device blocking
manual topology override
mass asset correction
manual IPAM adjustment
```

Không cần approval cho every verified low-risk observation.

---

# 69. Bulk Operations

Support:

```text
bulk QR audit
bulk verify
bulk location correction
bulk exception assignment
bulk network discovery
bulk VLAN compliance check
bulk topology refresh
```

Per-entity audit trail vẫn bắt buộc.

---

# 70. Notification Rules

## Immediate

```text
Unknown device in restricted network
Critical IP conflict
Core topology device missing
```

## Action Required

```text
Audit exception
VLAN mismatch
Missing asset
Discovery job repeatedly failing
```

## Informational

```text
Audit completed
Topology refresh completed
```

Không notify mỗi discovered endpoint.

---

# 71. SLA / Timers

Có thể cấu hình:

```text
Audit due date
Exception resolution SLA
Missing asset escalation time
Unknown device investigation SLA
VLAN mismatch SLA
Discovery freshness threshold
```

---

# 72. Metrics / KPI

## Audit

```text
Inventory Accuracy
Verified Rate
Missing Asset Rate
Wrong Location Rate
Exception Resolution Time
Audit Completion Time
```

## Discovery

```text
Discovery Coverage
Matched Device Rate
Unknown Device Count
Topology Freshness
Discovery Failure Rate
```

## Network Compliance

```text
VLAN Compliance Rate
IP Conflict Count
Unauthorized Device Count
Port Mismatch Rate
```

---

# 73. Idempotency

Examples:

```text
audit_observation:{audit_id}:{asset_id}:{observation_version}
discovery:{job_id}:{device_fingerprint}
network_exception:{type}:{entity}:{active_window}
topology_edge:{from}:{from_port}:{to}:{to_port}
```

Retry không tạo duplicate:

```text
Audit Exception
Unknown Device
Topology Edge
VLAN Mismatch
IP Conflict
```

---

# 74. Duplicate Prevention

Không được có:

```text
Asset A
Network Device A
Agent Asset A
```

là ba records không liên quan nếu thực chất cùng thiết bị.

Resolution hierarchy:

```text
Existing Asset
↓
Attach Agent identity
↓
Attach Network identity
↓
Attach Topology role
```

---

# 75. Manual Override

Manual override được phép nhưng phải:

```text
show observed value
show current value
require reason
record actor
record expiry if temporary
```

Không silently overwrite discovery.

---

# 76. Topology Manual Pinning

Có thể pin:

```text
rack position
logical service relationship
uplink relation
```

nhưng phải đánh dấu:

```text
MANUAL
```

vs:

```text
DISCOVERED
```

Nếu conflict:

```text
TOPOLOGY_MISMATCH
```

---

# 77. End-to-End Example — Quarterly Audit

```text
Audit Q3 Floor 4 starts
↓
Expected = 112 assets
↓
Auditor scans rooms
↓
103 verified
↓
4 location mismatches
↓
2 missing
↓
3 assets found but unexpected
↓
Agent + network discovery enrich results
↓
2 of 4 location mismatches confirmed by switch mapping
↓
Asset Admin updates locations
↓
Movements created
↓
1 missing asset found in Repair
↓
1 remains missing → investigation
↓
3 unexpected assets matched to Floor 3 records
↓
Corrections completed
↓
Audit closed with 1 open high-risk exception
```

---

# 78. End-to-End Example — Unknown Device

```text
Discovery sees MAC 00:11:22...
↓
IP 10.10.40.91
↓
VLAN 40 Server
↓
Switch SW-DC-02 Port Gi1/0/22
↓
No Asset match
↓
Unknown Device HIGH risk
↓
Security Work Item created
↓
Operator checks switch port
↓
Device identified as new monitoring appliance
↓
PO/serial verified
↓
Existing receiving record found
↓
Network identity linked to Asset
↓
Unknown Device resolved
```

---

# 79. End-to-End Example — Wrong VLAN

```text
Corporate laptop AST-0042
↓
Expected VLAN 20
↓
Observed VLAN 30
↓
Switch Port = SW-F4-02/Gi1/0/14
↓
No approved change exists
↓
Network Exception created
↓
Network Operator finds misconfigured access port
↓
Normal/Standard Change created per policy
↓
Port VLAN 30 → 20
↓
Rediscovery
↓
Connectivity PASS
↓
Exception resolved
↓
Asset timeline updated
```

---

# 80. End-to-End Example — Topology Root Cause

```text
48 endpoints unreachable
↓
6 APs unreachable
↓
Discovery/Monitoring sees same upstream switch
↓
Core Switch SW-HN-01 offline
↓
Topology dependency is candidate evidence (TASK-051 freshness applies)
↓
TASK-092 scores and explains candidate Root relationships
↓
FRESH shared failure-domain evidence may contribute strong correlation
↓
AUTO_LINK only if the versioned threshold and unambiguous-candidate guards pass;
otherwise REVIEW_REQUIRED (topology alone never auto-creates a Root)
↓
Preserve child endpoint Incidents and their evidence; no suppression/deletion
↓
Network team repairs switch
↓
Topology + Monitoring recover
↓
Root Incident resolved
```

---

# 81. Guardrails

The former topology example does not authorize Root creation by itself.
TASK-092 v1 requires a deterministic shared canonical source key and at least
two eligible non-root Incidents before automatic Root creation. Topology
evidence and freshness are consumed from TASK-051; TASK-092 defines no second
topology TTL.

Hệ thống không được:

1. Tự ghi đè Asset source-of-truth từ một observation confidence thấp.
2. Tạo duplicate Asset cho mỗi discovered MAC/IP.
3. Dùng IP làm Asset identity chính.
4. Kết luận Asset Missing chỉ từ một source.
5. Kết luận physical location chỉ từ stale network data.
6. Tự đổi Owner chỉ vì logged-in user khác.
7. Tự thay VLAN production không qua policy/Change.
8. Delete topology vì discovery job tạm thời lỗi.
9. Hiển thị stale topology như realtime mà không cảnh báo.
10. Tạo Work Item cho mọi raw discovery event.
11. Mất history IP/MAC/Port khi current value thay đổi.
12. Cho manual override không có reason/audit.
13. Gộp Physical Topology và Logical Topology thành một graph không phân lớp.
14. Close Audit mà không thể hiện unresolved exceptions.
15. Block Unknown Device tự động nếu không có explicit security policy.

---

# 82. Definition of Done

Cụm workflow này đạt yêu cầu khi:

- Audit có expected snapshot immutable.
- QR/Agent/Network/Manual đều có thể tạo observations.
- Observation có source, confidence, freshness.
- Reconciliation tạo đúng exception.
- Wrong Location có thể resolve inline và tạo Movement.
- Missing Asset có second verification.
- Unknown Asset/Device không auto-create duplicate.
- Network Discovery hỗ trợ nhiều data sources.
- Device matching có confidence và ambiguity handling.
- Asset ↔ IP ↔ MAC ↔ VLAN ↔ Switch ↔ Port được liên kết.
- Dynamic IP không phá Asset identity.
- VLAN policy có expected vs observed.
- Network change liên kết Change Management.
- IP conflict có workflow.
- LLDP/CDP có thể tạo topology edges.
- Physical và Logical topology tách rõ.
- Topology được dùng cho incident correlation.
- Discovery failure không xóa dữ liệu cũ ngay.
- Asset Workspace hiển thị network context.
- Work Queue chỉ nhận actionable exceptions.
- Permissions, SLA, notifications, idempotency và audit trail đầy đủ.
