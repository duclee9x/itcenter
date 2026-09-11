export type { AuditPort, AuditRecord } from "./application/ports.js";
export { PostgresAudit } from "./infrastructure/postgres-audit.js";
export { AuditQuery } from "./application/query.js";
export type { AuditSummary } from "./application/query.js";
export const permissions = [
  { code: "audit.read", resource_type: "audit", action: "read" },
] as const;
