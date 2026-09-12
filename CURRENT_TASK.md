# CURRENT TASK

Task: `TASK-072` — Purchase Order + Approval + Amendment

Task contract: `GENERATE_ON_READY` (not generated; TASK-072 is blocked)

Readiness: `BLOCKED`

Status: `NOT_STARTED`

Dependencies TASK-036 and TASK-071 are `CODE_COMPLETE`. Registry reconciliation
found a genuine `SPEC_CONFLICT`: the Purchase Order workflow does not define a
normative transition/command matrix, approval-request linkage and
required-versus-conditional approval behavior, or a complete lifecycle event
contract. No TASK-072 implementation has started.

Last completed task: `TASK-071` — RFQ + Quotation + Supplier Selection
(`CODE_COMPLETE`; commit recorded separately).

Do not begin TASK-072 until its Purchase Order lifecycle and approval rules
are made normative.
