# CURRENT TASK

Task: `TASK-074` — Invoice + Duplicate Protection + 3-Way Match

Task specification: not implementation-ready; detailed contract generation is
pending normative spec reconciliation.

Readiness: `BLOCKED`

Status: `NOT_STARTED`

Blocker: `SPEC_GAP / PLANNING_REQUIRED`. Existing Invoice workflow does not
fully define matching tolerances, approval request requirements and version
binding, duplicate invoice-number normalization, partial/over-invoice
concurrency, credit-note lifecycle, or resolution paths compatible with
immutable POSTED Goods Receipts and the post-receipt PO amendment restriction.
Do not implement runtime behavior or invent these rules until the contract is
normative.

Dependencies TASK-072 and TASK-073 are `CODE_COMPLETE`. TASK-073-R1 completed
the Goods Receipt contract; TASK-073 implementation and PostgreSQL E2E
verification are complete in
`tasks/TASK-073_GOODS_RECEIPT_ASSETIZATION_PARTIAL_RECEIPT.md`.

Last completed task: `TASK-073` — Goods Receipt + Asset Registration + Partial
Receipt (`CODE_COMPLETE`).

Last completed remediation: `TASK-073-R1` — Goods Receipt + Partial Receipt +
PO Receipt Integration Contract (`CODE_COMPLETE`, specification only); see
`tasks/TASK-073-R1_GOODS_RECEIPT_PARTIAL_RECEIPT_PO_INTEGRATION_CONTRACT.md`.
