import type { Permission } from "../domain/model.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";

export async function assertActiveLicenseUser(input: {
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
// Platform permission needed by the bootstrap operation query; no grant is implied.
export const permissions: readonly Permission[] = [
  { code: "asset.create", resource_type: "asset", action: "create" },
  {
    code: "asset.lifecycle.change",
    resource_type: "asset",
    action: "lifecycle.change",
  },
  { code: "asset.retire", resource_type: "asset", action: "retire" },
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
  { code: "role_binding.read", resource_type: "role_binding", action: "read" },
  { code: "rbac.manage", resource_type: "rbac", action: "manage" },
  { code: "agent.enroll", resource_type: "agent", action: "enroll" },
  { code: "incident.create", resource_type: "incident", action: "create" },
  { code: "incident.update", resource_type: "incident", action: "update" },
  {
    code: "incident.correlate",
    resource_type: "incident",
    action: "correlate",
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
  {
    code: "maintenance.manage",
    resource_type: "maintenance",
    action: "manage",
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
];
