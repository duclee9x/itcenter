import type { Permission } from "../domain/model.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";

export async function assertActiveUser(input: {
  tx: Transaction;
  userId: string;
}) {
  const result = await input.tx.query(
    `SELECT id FROM identity.users
      WHERE tenant_id=$1 AND id=$2 AND employment_status='ACTIVE'
        AND archived_at IS NULL`,
    [input.tx.tenantId, input.userId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Active user was not found in this tenant.",
    );
  return true;
}

export async function assertActiveLicenseUser(input: {
  tx: Transaction;
  userId: string;
}) {
  return assertActiveUser(input);
}
// Platform permission needed by the bootstrap operation query; no grant is implied.
export const permissions: readonly Permission[] = [
  { code: "asset.read", resource_type: "asset", action: "read" },
  {
    code: "asset.scoring.read",
    resource_type: "asset",
    action: "scoring.read",
  },
  {
    code: "asset.scoring.recalculate",
    resource_type: "asset",
    action: "scoring.recalculate",
  },
  {
    code: "asset.scoring.manage_policy",
    resource_type: "asset_replacement_policy",
    action: "manage",
  },
  {
    code: "asset.acquisition.verify",
    resource_type: "asset",
    action: "acquisition.verify",
  },
  {
    code: "asset.cost_evidence.read",
    resource_type: "asset_cost_evidence",
    action: "read",
  },
  {
    code: "goods_receipt.asset_provenance.read",
    resource_type: "goods_receipt_asset_provenance",
    action: "read",
  },
  {
    code: "goods_receipt.read",
    resource_type: "goods_receipt",
    action: "read",
  },
  {
    code: "goods_receipt.create",
    resource_type: "goods_receipt",
    action: "create",
  },
  {
    code: "goods_receipt.update",
    resource_type: "goods_receipt",
    action: "update",
  },
  {
    code: "goods_receipt.post",
    resource_type: "goods_receipt",
    action: "post",
  },
  {
    code: "goods_receipt.cancel",
    resource_type: "goods_receipt",
    action: "cancel",
  },
  { code: "ticket.read", resource_type: "ticket", action: "read" },
  { code: "incident.read", resource_type: "incident", action: "read" },
  {
    code: "incident.asset_link",
    resource_type: "incident",
    action: "asset_link",
  },
  {
    code: "incident.asset_history.read",
    resource_type: "incident_asset_history",
    action: "read",
  },
  {
    code: "monitoring.asset_reliability.read",
    resource_type: "monitoring_asset",
    action: "reliability.read",
  },
  { code: "warranty.read", resource_type: "warranty", action: "read" },
  { code: "software.read", resource_type: "software", action: "read" },
  { code: "license.read", resource_type: "license", action: "read" },
  { code: "search.reindex", resource_type: "search", action: "reindex" },
  { code: "asset.create", resource_type: "asset", action: "create" },
  {
    code: "asset.lifecycle.change",
    resource_type: "asset",
    action: "lifecycle.change",
  },
  { code: "asset.retire", resource_type: "asset", action: "retire" },
  { code: "asset.dispose", resource_type: "asset", action: "dispose" },
  { code: "asset.reactivate", resource_type: "asset", action: "reactivate" },
  {
    code: "replacement.create_candidate",
    resource_type: "replacement",
    action: "create_candidate",
  },
  {
    code: "replacement.review",
    resource_type: "replacement",
    action: "review",
  },
  { code: "data_wipe.execute", resource_type: "data_wipe", action: "execute" },
  { code: "asset.receive", resource_type: "asset", action: "receive" },
  { code: "asset.reserve", resource_type: "asset", action: "reserve" },
  { code: "asset.assign", resource_type: "asset", action: "assign" },
  { code: "asset.transfer", resource_type: "asset", action: "transfer" },
  {
    code: "asset.request_return",
    resource_type: "asset",
    action: "request_return",
  },
  {
    code: "asset.receive_return",
    resource_type: "asset",
    action: "receive_return",
  },
  { code: "ticket.create", resource_type: "ticket", action: "create" },
  { code: "ticket.assign", resource_type: "ticket", action: "assign" },
  { code: "ticket.update", resource_type: "ticket", action: "update" },
  { code: "ticket.resolve", resource_type: "ticket", action: "resolve" },
  { code: "ticket.reopen", resource_type: "ticket", action: "reopen" },
  { code: "work_item.resolve", resource_type: "work_item", action: "resolve" },
  {
    code: "monitoring.event.write",
    resource_type: "monitoring_event",
    action: "write",
  },
  { code: "session.revoke", resource_type: "session", action: "revoke" },
  {
    code: "authorization.evaluate",
    resource_type: "authorization",
    action: "evaluate",
  },
  { code: "operation.read", resource_type: "operation", action: "read" },
  { code: "user.read", resource_type: "user", action: "read" },
  {
    code: "identity.offboard",
    resource_type: "offboarding_case",
    action: "manage",
  },
  {
    code: "identity.offboard.cancel",
    resource_type: "offboarding_case",
    action: "cancel",
  },
  {
    code: "identity.offboard.exception",
    resource_type: "offboarding_case",
    action: "exception",
  },
  { code: "role_binding.read", resource_type: "role_binding", action: "read" },
  { code: "rbac.manage", resource_type: "rbac", action: "manage" },
  { code: "agent.enroll", resource_type: "agent", action: "enroll" },
  { code: "agent.restart", resource_type: "agent", action: "restart" },
  {
    code: "automation.intent.read",
    resource_type: "action_intent",
    action: "read",
  },
  {
    code: "execution.retry",
    resource_type: "action_execution",
    action: "retry",
  },
  {
    code: "execution.cancel",
    resource_type: "action_execution",
    action: "cancel",
  },
  { code: "incident.create", resource_type: "incident", action: "create" },
  { code: "incident.update", resource_type: "incident", action: "update" },
  {
    code: "incident.correlate",
    resource_type: "incident",
    action: "correlate",
  },
  {
    code: "incident.correlation.read",
    resource_type: "incident_correlation",
    action: "read",
  },
  {
    code: "incident.correlation.link",
    resource_type: "incident",
    action: "correlation.link",
  },
  {
    code: "incident.correlation.review",
    resource_type: "incident",
    action: "correlation.review",
  },
  {
    code: "incident.correlation.detach",
    resource_type: "incident",
    action: "correlation.detach",
  },
  {
    code: "incident.declare_major",
    resource_type: "incident",
    action: "declare_major",
  },
  {
    code: "incident.communicate",
    resource_type: "incident",
    action: "communicate",
  },
  { code: "sla.manage", resource_type: "sla", action: "manage" },
  { code: "approval.create", resource_type: "approval", action: "create" },
  { code: "approval.decide", resource_type: "approval", action: "decide" },
  { code: "problem.manage", resource_type: "problem", action: "manage" },
  { code: "change.manage", resource_type: "change", action: "manage" },
  { code: "knowledge.manage", resource_type: "knowledge", action: "manage" },
  { code: "knowledge.read", resource_type: "knowledge", action: "read" },
  {
    code: "knowledge.read.operator",
    resource_type: "knowledge",
    action: "read.operator",
  },
  {
    code: "knowledge.recommendation.use",
    resource_type: "knowledge_recommendation",
    action: "use",
  },
  {
    code: "knowledge.recommendation.review",
    resource_type: "knowledge_recommendation",
    action: "review",
  },
  {
    code: "knowledge.feedback.submit",
    resource_type: "knowledge_recommendation",
    action: "feedback.submit",
  },
  { code: "service.read", resource_type: "service", action: "read" },
  { code: "service.manage", resource_type: "service", action: "manage" },
  { code: "platform.read", resource_type: "platform", action: "read" },
  { code: "platform.manage", resource_type: "platform", action: "manage" },
  {
    code: "service_environment.read",
    resource_type: "service_environment",
    action: "read",
  },
  {
    code: "service_environment.manage",
    resource_type: "service_environment",
    action: "manage",
  },
  {
    code: "maintenance.manage",
    resource_type: "maintenance",
    action: "manage",
  },
  {
    code: "maintenance.read",
    resource_type: "maintenance",
    action: "read",
  },
  { code: "audit.start", resource_type: "audit", action: "start" },
  {
    code: "audit.record_observation",
    resource_type: "audit",
    action: "record_observation",
  },
  {
    code: "audit.exception.resolve",
    resource_type: "audit_exception",
    action: "resolve",
  },
  {
    code: "network.discovery.run",
    resource_type: "network_discovery",
    action: "run",
  },
  {
    code: "network.topology.read",
    resource_type: "network_topology",
    action: "read",
  },
  { code: "network.read", resource_type: "network_exception", action: "read" },
  {
    code: "network.exception.resolve",
    resource_type: "network_exception",
    action: "resolve",
  },
  {
    code: "network.unknown_device.link",
    resource_type: "network_exception",
    action: "link",
  },
  {
    code: "network.vlan.change",
    resource_type: "network_vlan_change",
    action: "change",
  },
  { code: "supplier.read", resource_type: "supplier", action: "read" },
  { code: "supplier.select", resource_type: "supplier", action: "select" },
  { code: "supplier.create", resource_type: "supplier", action: "create" },
  { code: "supplier.update", resource_type: "supplier", action: "update" },
  { code: "supplier.approve", resource_type: "supplier", action: "approve" },
  {
    code: "supplier.status.change",
    resource_type: "supplier",
    action: "status.change",
  },
  { code: "supplier.block", resource_type: "supplier", action: "block" },
  { code: "po.read", resource_type: "purchase_order", action: "read" },
  { code: "po.create", resource_type: "purchase_order", action: "create" },
  { code: "po.update", resource_type: "purchase_order", action: "update" },
  { code: "po.issue", resource_type: "purchase_order", action: "issue" },
  { code: "po.hold", resource_type: "purchase_order", action: "hold" },
  { code: "po.cancel", resource_type: "purchase_order", action: "cancel" },
  { code: "po.amend", resource_type: "purchase_order", action: "amend" },
  { code: "po.close", resource_type: "purchase_order", action: "close" },
  {
    code: "procurement.request.read",
    resource_type: "procurement_request",
    action: "read",
  },
  {
    code: "procurement.request.create",
    resource_type: "procurement_request",
    action: "create",
  },
  {
    code: "procurement.request.review",
    resource_type: "procurement_request",
    action: "review",
  },
  { code: "rfq.read", resource_type: "rfq", action: "read" },
  { code: "rfq.create", resource_type: "rfq", action: "create" },
  { code: "rfq.update", resource_type: "rfq", action: "update" },
  { code: "rfq.issue", resource_type: "rfq", action: "issue" },
  { code: "rfq.close", resource_type: "rfq", action: "close" },
  { code: "rfq.cancel", resource_type: "rfq", action: "cancel" },
  { code: "rfq.award", resource_type: "rfq", action: "award" },
  { code: "quotation.read", resource_type: "quotation", action: "read" },
  { code: "quotation.create", resource_type: "quotation", action: "create" },
  { code: "quotation.update", resource_type: "quotation", action: "update" },
  { code: "quotation.submit", resource_type: "quotation", action: "submit" },
  {
    code: "quotation.withdraw",
    resource_type: "quotation",
    action: "withdraw",
  },
  {
    code: "quotation.evaluate",
    resource_type: "quotation",
    action: "evaluate",
  },
];
