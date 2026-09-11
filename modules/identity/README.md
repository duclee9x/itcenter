# identity

Owner: Identity/Security. Feature: FOUNDATION; Workflow: PLATFORM-BOOTSTRAP; Task: TASK-000.

Purpose: canonical identity data and authentication integration boundary.

Entities: User, ExternalIdentity, Role, Permission, RoleBinding.

Tables: `identity` schema — users, external_identities, roles, permissions, role_permissions, role_bindings.

Commands: no public business command. Permission catalog registration is an explicit internal seed action; stable code is its idempotency key.

Queries: no module HTTP routes in TASK-000.

Events produced/consumed: none; no business facts are fabricated.

Permissions: operation.read (Platform bootstrap), user.read, role_binding.read, rbac.manage. Registration does not grant access.

Dependencies: domain-neutral packages and local module layers. Other modules use public application contracts; only composition roots select infrastructure adapters.

Runbook: [foundation ownership](../../docs/runbooks/task000-foundations.md).
