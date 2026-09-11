// Feature: FOUNDATION; Workflow: PLATFORM-BOOTSTRAP; Task: TASK-000.
// Immutable data contracts only. Lifecycle commands and RBAC policies belong to TASK-001.
export interface User {
  readonly id: string;
  readonly tenant_id: string;
  readonly display_code: string;
  readonly username: string;
  readonly display_name: string;
  readonly employment_status: string;
  readonly version: number;
}
export interface ExternalIdentity {
  readonly id: string;
  readonly user_id: string;
  readonly provider_id: string;
  readonly external_subject: string;
}
export interface Role {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
}
export interface Permission {
  readonly code: string;
  readonly resource_type: string;
  readonly action: string;
}
export interface RoleBinding {
  readonly id: string;
  readonly tenant_id: string;
  readonly principal_id: string;
  readonly role_id: string;
  readonly scope_type: string;
  readonly scope_id: string;
}
