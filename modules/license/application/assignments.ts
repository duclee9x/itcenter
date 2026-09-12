import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

const seatTypesByPrincipal = {
  USER: ["PER_USER", "NAMED_USER"],
  ASSET: ["PER_DEVICE", "SERVER_INSTANCE"],
} as const;

function uuid(value: string, field: string) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  return value;
}

function sanitizeReason(value: string) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 2000 ||
    /(?:password|access[_ -]?token|secret|api[_ -]?key|license[_ -]?key)\s*[:=]\s*\S+/i.test(
      value,
    )
  )
    throw new ApplicationError("VALIDATION_ERROR", "reason is invalid.");
  return value.trim();
}

async function history(input: {
  tx: Transaction;
  table: "assignment_history" | "reservation_history";
  idField: "assignment_id" | "reservation_id";
  id: string;
  version: number;
  action: string;
  snapshot: Record<string, unknown>;
  actorId: string;
  reason: string;
}) {
  await input.tx.query(
    `INSERT INTO license.${input.table}
       (id,tenant_id,${input.idField},entity_version,action,snapshot,actor_id,reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.id,
      input.version,
      input.action,
      JSON.stringify(input.snapshot),
      input.actorId,
      sanitizeReason(input.reason),
    ],
  );
}

async function reserveAvailableSeat(input: {
  tx: Transaction;
  productId: string;
  principalType: "USER" | "ASSET";
  principalId: string;
  deploymentTargetId?: string;
  existingReservation?: { id: string; version: number };
  actorId: string;
  reason: string;
}) {
  const types = seatTypesByPrincipal[input.principalType];
  const entitlements = await input.tx.query(
    `SELECT e.id,e.quantity,e.current_term_version,e.version,t.valid_from,t.valid_until
       FROM license.license_entitlements e
       JOIN license.entitlement_terms t
         ON t.tenant_id=e.tenant_id AND t.entitlement_id=e.id
        AND t.term_version=e.current_term_version
       LEFT JOIN license.license_pools p
         ON p.tenant_id=e.tenant_id AND p.id=e.pool_id
      WHERE e.tenant_id=$1 AND e.software_product_id=$2
        AND e.license_type=ANY($3::text[])
        AND t.valid_from<=now() AND (t.valid_until IS NULL OR t.valid_until>now())
        AND (e.pool_id IS NULL OR p.state='ACTIVE')
      ORDER BY t.valid_until NULLS LAST,e.created_at,e.id
      FOR UPDATE OF e`,
    [input.tx.tenantId, input.productId, types],
  );
  for (const entitlement of entitlements.rows) {
    if (input.deploymentTargetId && input.principalType === "ASSET") {
      const assigned = await input.tx.query(
        `SELECT id FROM license.assignments WHERE tenant_id=$1 AND entitlement_id=$2
          AND principal_type='ASSET' AND principal_id=$3
          AND state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING') LIMIT 1`,
        [input.tx.tenantId, entitlement.id, input.principalId],
      );
      if (assigned.rowCount)
        return {
          id: null,
          entitlement_id: String(entitlement.id),
          deployment_target_id: input.deploymentTargetId,
          asset_id: input.principalId,
          state: "ASSIGNED",
          version: 0,
          created: false,
          already_assigned: true,
        };
    }
    const allocations = await input.tx.query(
      `SELECT
         coalesce((SELECT sum(a.quantity) FROM license.assignments a
                    WHERE a.tenant_id=$1 AND a.entitlement_id=$2
                      AND a.state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING')),0)::int
         + coalesce((SELECT sum(r.quantity) FROM license.deployment_reservations r
                      WHERE r.tenant_id=$1 AND r.entitlement_id=$2
                        AND r.state='RESERVED'
                        AND ($3::uuid IS NULL OR r.deployment_target_id<>$3)),0)::int
           AS allocated`,
      [input.tx.tenantId, entitlement.id, input.deploymentTargetId ?? null],
    );
    if (Number(allocations.rows[0]!.allocated) >= Number(entitlement.quantity))
      continue;
    const reservationId = input.existingReservation?.id ?? randomUUID();
    const version = (input.existingReservation?.version ?? 0) + 1;
    const targetId = input.deploymentTargetId
      ? uuid(input.deploymentTargetId, "deployment_target_id")
      : null;
    const saved = input.existingReservation
      ? await input.tx.query(
          `UPDATE license.deployment_reservations
              SET entitlement_id=$1,asset_id=$2,state='RESERVED',version=$3,updated_at=now()
            WHERE tenant_id=$4 AND id=$5
            RETURNING id,entitlement_id,deployment_target_id,asset_id,quantity,state,version`,
          [
            entitlement.id,
            input.principalId,
            version,
            input.tx.tenantId,
            reservationId,
          ],
        )
      : await input.tx.query(
          `INSERT INTO license.deployment_reservations
             (id,tenant_id,entitlement_id,deployment_target_id,asset_id,quantity,state)
           VALUES($1,$2,$3,$4,$5,1,'RESERVED')
           RETURNING id,entitlement_id,deployment_target_id,asset_id,quantity,state,version`,
          [
            reservationId,
            input.tx.tenantId,
            entitlement.id,
            targetId,
            input.principalId,
          ],
        );
    const row = saved.rows[0]!;
    await history({
      tx: input.tx,
      table: "reservation_history",
      idField: "reservation_id",
      id: reservationId,
      version,
      action: "RESERVED",
      snapshot: row,
      actorId: input.actorId,
      reason: input.reason,
    });
    return {
      id: String(row.id),
      entitlement_id: String(row.entitlement_id),
      deployment_target_id: row.deployment_target_id as string | null,
      asset_id: String(row.asset_id),
      state: String(row.state),
      version: Number(row.version),
      created: !input.existingReservation,
    };
  }
  throw new ApplicationError(
    "BUSINESS_RULE_VIOLATION",
    "No active countable license seat is available for this principal.",
  );
}

export async function reserveLicenseForDeployment(input: {
  tx: Transaction;
  softwareProductId: string;
  assetId: string;
  deploymentTargetId: string;
  actorId: string;
}) {
  const productId = uuid(input.softwareProductId, "software_product_id");
  const assetId = uuid(input.assetId, "asset_id");
  const targetId = uuid(input.deploymentTargetId, "deployment_target_id");
  const existing = await input.tx.query(
    `SELECT id,entitlement_id,deployment_target_id,asset_id,state,version
       FROM license.deployment_reservations
      WHERE tenant_id=$1 AND deployment_target_id=$2 FOR UPDATE`,
    [input.tx.tenantId, targetId],
  );
  if (existing.rowCount && existing.rows[0]!.state !== "RELEASED") {
    const row = existing.rows[0]!;
    return {
      id: String(row.id),
      entitlement_id: String(row.entitlement_id),
      deployment_target_id: String(row.deployment_target_id),
      asset_id: String(row.asset_id),
      state: String(row.state),
      version: Number(row.version),
      created: false,
    };
  }
  const activeAssignment = await input.tx.query(
    `SELECT a.id,a.entitlement_id
       FROM license.assignments a
       JOIN license.license_entitlements e
         ON e.tenant_id=a.tenant_id AND e.id=a.entitlement_id
       JOIN license.entitlement_terms t
         ON t.tenant_id=e.tenant_id AND t.entitlement_id=e.id
        AND t.term_version=e.current_term_version
       LEFT JOIN license.license_pools p
         ON p.tenant_id=e.tenant_id AND p.id=e.pool_id
      WHERE a.tenant_id=$1 AND e.software_product_id=$2
        AND a.principal_type='ASSET' AND a.principal_id=$3
        AND a.state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING')
        AND t.valid_from<=now() AND (t.valid_until IS NULL OR t.valid_until>now())
        AND (e.pool_id IS NULL OR p.state='ACTIVE')
      ORDER BY a.created_at LIMIT 1`,
    [input.tx.tenantId, productId, assetId],
  );
  if (activeAssignment.rowCount)
    return {
      id: null,
      entitlement_id: String(activeAssignment.rows[0]!.entitlement_id),
      deployment_target_id: targetId,
      asset_id: assetId,
      state: "ASSIGNED",
      version: 0,
      created: false,
      already_assigned: true,
    };
  const selected = await reserveAvailableSeat({
    tx: input.tx,
    productId,
    principalType: "ASSET",
    principalId: assetId,
    deploymentTargetId: targetId,
    ...(existing.rowCount
      ? {
          existingReservation: {
            id: String(existing.rows[0]!.id),
            version: Number(existing.rows[0]!.version),
          },
        }
      : {}),
    actorId: input.actorId,
    reason: "Reserve a license seat before deployment execution.",
  });
  return selected;
}

export async function releaseDeploymentReservation(input: {
  tx: Transaction;
  deploymentTargetId: string;
  actorId: string;
  reason: string;
}) {
  const targetId = uuid(input.deploymentTargetId, "deployment_target_id");
  const result = await input.tx.query(
    `SELECT id,state,version,entitlement_id,asset_id
       FROM license.deployment_reservations
      WHERE tenant_id=$1 AND deployment_target_id=$2 FOR UPDATE`,
    [input.tx.tenantId, targetId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0]!;
  if (row.state === "RELEASED") return null;
  if (row.state === "ASSIGNED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "An activated license assignment cannot be released as a deployment reservation.",
    );
  const version = Number(row.version) + 1;
  await input.tx.query(
    `UPDATE license.deployment_reservations
        SET state='RELEASED',version=$1,updated_at=now()
      WHERE tenant_id=$2 AND id=$3`,
    [version, input.tx.tenantId, row.id],
  );
  await history({
    tx: input.tx,
    table: "reservation_history",
    idField: "reservation_id",
    id: String(row.id),
    version,
    action: "RELEASED",
    snapshot: { ...row, state: "RELEASED", version },
    actorId: input.actorId,
    reason: input.reason,
  });
  return {
    id: String(row.id),
    entitlement_id: String(row.entitlement_id),
    asset_id: String(row.asset_id),
    state: "RELEASED",
    version,
  };
}

export async function activateDeploymentReservation(input: {
  tx: Transaction;
  deploymentTargetId: string;
  softwareProductId: string;
  assetId: string;
  actorId: string;
}) {
  const targetId = uuid(input.deploymentTargetId, "deployment_target_id");
  const productId = uuid(input.softwareProductId, "software_product_id");
  const assetId = uuid(input.assetId, "asset_id");
  const result = await input.tx.query(
    `SELECT r.*,e.software_product_id
       FROM license.deployment_reservations r
       JOIN license.license_entitlements e
         ON e.tenant_id=r.tenant_id AND e.id=r.entitlement_id
      WHERE r.tenant_id=$1 AND r.deployment_target_id=$2 FOR UPDATE OF r`,
    [input.tx.tenantId, targetId],
  );
  if (!result.rowCount) {
    const assignment = await input.tx.query(
      `SELECT a.id,a.entitlement_id,a.version FROM license.assignments a
        JOIN license.license_entitlements e
           ON e.tenant_id=a.tenant_id AND e.id=a.entitlement_id
        JOIN license.entitlement_terms t
          ON t.tenant_id=e.tenant_id AND t.entitlement_id=e.id
         AND t.term_version=e.current_term_version
        LEFT JOIN license.license_pools p
          ON p.tenant_id=e.tenant_id AND p.id=e.pool_id
        WHERE a.tenant_id=$1 AND e.software_product_id=$2
          AND a.principal_type='ASSET' AND a.principal_id=$3
          AND a.state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING')
          AND t.valid_from<=now() AND (t.valid_until IS NULL OR t.valid_until>now())
          AND (e.pool_id IS NULL OR p.state='ACTIVE')
        ORDER BY a.created_at LIMIT 1`,
      [input.tx.tenantId, productId, assetId],
    );
    if (assignment.rowCount)
      return {
        assignment_id: String(assignment.rows[0]!.id),
        entitlement_id: String(assignment.rows[0]!.entitlement_id),
        version: Number(assignment.rows[0]!.version),
        already_active: true,
      };
    throw new ApplicationError(
      "NOT_FOUND",
      "Deployment license reservation was not found.",
    );
  }
  const row = result.rows[0]!;
  if (row.state === "ASSIGNED") {
    const assignment = await input.tx.query(
      `SELECT id,version FROM license.assignments
        WHERE tenant_id=$1 AND reservation_id=$2`,
      [input.tx.tenantId, row.id],
    );
    return {
      assignment_id: assignment.rowCount
        ? String(assignment.rows[0]!.id)
        : null,
      entitlement_id: String(row.entitlement_id),
      version: assignment.rowCount ? Number(assignment.rows[0]!.version) : 0,
      already_active: true,
    };
  }
  if (row.state !== "RESERVED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only an active deployment reservation can be activated.",
    );
  const assignmentId = randomUUID();
  const assignment = await input.tx.query(
    `INSERT INTO license.assignments
       (id,tenant_id,entitlement_id,reservation_id,principal_type,principal_id,
        quantity,state,created_by)
     VALUES($1,$2,$3,$4,'ASSET',$5,1,'ASSIGNED',$6)
     ON CONFLICT (tenant_id,reservation_id) WHERE reservation_id IS NOT NULL
     DO NOTHING RETURNING id,entitlement_id,reservation_id,principal_type,principal_id,
       quantity,state,version,activated_at`,
    [
      assignmentId,
      input.tx.tenantId,
      row.entitlement_id,
      row.id,
      row.asset_id,
      input.actorId,
    ],
  );
  if (!assignment.rowCount)
    return { assignment_id: null, already_active: true };
  await input.tx.query(
    `UPDATE license.deployment_reservations
        SET state='ASSIGNED',version=version+1,updated_at=now()
      WHERE tenant_id=$1 AND id=$2`,
    [input.tx.tenantId, row.id],
  );
  const snapshot = assignment.rows[0]!;
  await history({
    tx: input.tx,
    table: "assignment_history",
    idField: "assignment_id",
    id: assignmentId,
    version: 1,
    action: "ASSIGNED",
    snapshot: { ...snapshot, state: "ASSIGNED" },
    actorId: input.actorId,
    reason: "Verified software deployment assigned the reserved license.",
  });
  const active = await input.tx.query(
    `UPDATE license.assignments SET state='ACTIVE',activated_at=now(),version=2,updated_at=now()
      WHERE tenant_id=$1 AND id=$2
      RETURNING id,entitlement_id,reservation_id,principal_type,principal_id,
        quantity,state,version,activated_at`,
    [input.tx.tenantId, assignmentId],
  );
  await history({
    tx: input.tx,
    table: "assignment_history",
    idField: "assignment_id",
    id: assignmentId,
    version: 2,
    action: "ACTIVATED",
    snapshot: active.rows[0]!,
    actorId: input.actorId,
    reason: "Verified software deployment activated the reserved license.",
  });
  const reservationVersion = Number(row.version) + 1;
  await input.tx.query(
    `INSERT INTO license.reservation_history
       (id,tenant_id,reservation_id,entity_version,action,snapshot,actor_id,reason)
     VALUES($1,$2,$3,$4,'ASSIGNED',$5,$6,$7)`,
    [
      randomUUID(),
      input.tx.tenantId,
      row.id,
      reservationVersion,
      JSON.stringify({
        ...row,
        state: "ASSIGNED",
        version: reservationVersion,
      }),
      input.actorId,
      "Verified deployment converted the reservation to an assignment.",
    ],
  );
  return {
    assignment_id: assignmentId,
    entitlement_id: String(row.entitlement_id),
    version: 2,
    already_active: false,
  };
}

export async function createLicenseAssignment(input: {
  tx: Transaction;
  entitlementId: string;
  principalType: "USER" | "ASSET";
  principalId: string;
  actorId: string;
  reason: string;
}) {
  const entitlementId = uuid(input.entitlementId, "entitlement_id");
  const principalId = uuid(input.principalId, "principal_id");
  const locked = await input.tx.query(
    `SELECT e.id,e.software_product_id,e.license_type,e.quantity,t.valid_from,t.valid_until,p.state AS pool_state
       FROM license.license_entitlements e
       JOIN license.entitlement_terms t ON t.tenant_id=e.tenant_id
        AND t.entitlement_id=e.id AND t.term_version=e.current_term_version
       LEFT JOIN license.license_pools p
         ON p.tenant_id=e.tenant_id AND p.id=e.pool_id
      WHERE e.tenant_id=$1 AND e.id=$2 FOR UPDATE OF e`,
    [input.tx.tenantId, entitlementId],
  );
  if (!locked.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "License entitlement was not found.",
    );
  const entitlement = locked.rows[0]!;
  const supported = seatTypesByPrincipal[
    input.principalType
  ] as readonly string[];
  if (!supported.includes(String(entitlement.license_type)))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "This license model has no configured one-principal seat rule.",
    );
  if (
    new Date(entitlement.valid_from).getTime() > Date.now() ||
    (entitlement.valid_until &&
      new Date(entitlement.valid_until).getTime() <= Date.now()) ||
    (entitlement.pool_state && entitlement.pool_state !== "ACTIVE")
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only an effective entitlement can receive an assignment.",
    );
  const existing = await input.tx.query(
    `SELECT id FROM license.assignments WHERE tenant_id=$1 AND entitlement_id=$2
      AND principal_type=$3 AND principal_id=$4
      AND state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING')`,
    [input.tx.tenantId, entitlementId, input.principalType, principalId],
  );
  if (existing.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Principal already has a live assignment.",
    );
  const allocations = await input.tx.query(
    `SELECT coalesce((SELECT sum(quantity) FROM license.assignments
        WHERE tenant_id=$1 AND entitlement_id=$2
          AND state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING')),0)::int
      + coalesce((SELECT sum(quantity) FROM license.deployment_reservations
        WHERE tenant_id=$1 AND entitlement_id=$2 AND state='RESERVED'),0)::int AS allocated`,
    [input.tx.tenantId, entitlementId],
  );
  if (Number(allocations.rows[0]!.allocated) >= Number(entitlement.quantity))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "No license seat is available.",
    );
  const id = randomUUID();
  const inserted = await input.tx.query(
    `INSERT INTO license.assignments
       (id,tenant_id,entitlement_id,principal_type,principal_id,quantity,state,created_by)
     VALUES($1,$2,$3,$4,$5,1,'ASSIGNED',$6)
     RETURNING id,entitlement_id,principal_type,principal_id,quantity,state,version,assigned_at`,
    [
      id,
      input.tx.tenantId,
      entitlementId,
      input.principalType,
      principalId,
      input.actorId,
    ],
  );
  const row = inserted.rows[0]!;
  await history({
    tx: input.tx,
    table: "assignment_history",
    idField: "assignment_id",
    id,
    version: 1,
    action: "ASSIGNED",
    snapshot: row,
    actorId: input.actorId,
    reason: input.reason,
  });
  return row;
}

export async function transitionLicenseAssignment(input: {
  tx: Transaction;
  assignmentId: string;
  expectedVersion: number;
  action: "ACTIVATE" | "SUSPEND" | "RECLAIM" | "COMPLETE_RECLAIM" | "CANCEL";
  actorId: string;
  reason: string;
  verificationReference?: string;
}): Promise<{
  id: string;
  version: number;
  before: Record<string, unknown>;
  [key: string]: unknown;
}> {
  const id = uuid(input.assignmentId, "assignment_id");
  const found = await input.tx.query(
    `SELECT * FROM license.assignments WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [input.tx.tenantId, id],
  );
  if (!found.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "License assignment was not found.",
    );
  const current = found.rows[0]!;
  const reason = sanitizeReason(input.reason);
  if (input.action === "CANCEL" && current.state === "CANCELLED") {
    const previousCancellation = await input.tx.query(
      `SELECT reason FROM license.assignment_history
        WHERE tenant_id=$1 AND assignment_id=$2 AND action='CANCELLED'
        ORDER BY entity_version DESC LIMIT 1`,
      [input.tx.tenantId, id],
    );
    if (
      Number(input.expectedVersion) > 0 &&
      Number(input.expectedVersion) <= Number(current.version) &&
      previousCancellation.rows[0]?.reason === reason
    )
      return {
        ...current,
        id,
        version: Number(current.version),
        before: current,
        noOp: true,
      };
  }
  assertVersion(Number(current.version), input.expectedVersion);
  const transitions: Record<string, string> = {
    "ASSIGNED:ACTIVATE": "ACTIVE",
    "ASSIGNED:CANCEL": "CANCELLED",
    "ACTIVE:SUSPEND": "SUSPENDED",
    "SUSPENDED:ACTIVATE": "ACTIVE",
    "ACTIVE:RECLAIM": "RECLAIM_PENDING",
    "SUSPENDED:RECLAIM": "RECLAIM_PENDING",
    "RECLAIM_PENDING:COMPLETE_RECLAIM": "RECLAIMED",
  };
  const next = transitions[`${current.state}:${input.action}`];
  if (!next)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Invalid license assignment state transition.",
    );
  const verificationReference = input.verificationReference?.trim() ?? null;
  if (input.action === "COMPLETE_RECLAIM" && !verificationReference)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "reclaim verification reference is required.",
    );
  if (input.action === "ACTIVATE") {
    const entitlement = await input.tx.query(
      `SELECT 1 FROM license.license_entitlements e
         JOIN license.entitlement_terms t ON t.tenant_id=e.tenant_id
          AND t.entitlement_id=e.id AND t.term_version=e.current_term_version
         LEFT JOIN license.license_pools p
           ON p.tenant_id=e.tenant_id AND p.id=e.pool_id
        WHERE e.tenant_id=$1 AND e.id=$2 AND t.valid_from<=now()
          AND (t.valid_until IS NULL OR t.valid_until>now())
          AND (e.pool_id IS NULL OR p.state='ACTIVE')`,
      [input.tx.tenantId, current.entitlement_id],
    );
    if (!entitlement.rowCount)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Only an effective entitlement can be activated.",
      );
  }
  if (
    verificationReference &&
    (verificationReference.length > 256 ||
      /(?:password|access[_ -]?token|secret|api[_ -]?key|license[_ -]?key)\s*[:=]\s*\S+/i.test(
        verificationReference,
      ))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "reclaim verification reference is invalid.",
    );
  const version = input.expectedVersion + 1;
  const updated = await input.tx.query(
    `UPDATE license.assignments SET state=$1,version=$2,updated_at=now(),
       activated_at=CASE WHEN $1='ACTIVE' THEN coalesce(activated_at,now()) ELSE activated_at END,
       cancelled_at=CASE WHEN $1='CANCELLED' THEN now() ELSE cancelled_at END,
       reclaimed_at=CASE WHEN $1='RECLAIMED' THEN now() ELSE reclaimed_at END,
       reclaim_verification_reference=CASE WHEN $1='RECLAIMED' THEN $5 ELSE reclaim_verification_reference END
     WHERE tenant_id=$3 AND id=$4
     RETURNING id,entitlement_id,principal_type,principal_id,quantity,state,version,activated_at,cancelled_at,reclaimed_at`,
    [next, version, input.tx.tenantId, id, verificationReference],
  );
  const row = updated.rows[0]!;
  const action =
    input.action === "CANCEL"
      ? "CANCELLED"
      : input.action === "COMPLETE_RECLAIM"
        ? "RECLAIMED"
        : input.action === "RECLAIM"
          ? "RECLAIM_PENDING"
          : input.action === "ACTIVATE"
            ? "ACTIVATED"
            : "SUSPENDED";
  await history({
    tx: input.tx,
    table: "assignment_history",
    idField: "assignment_id",
    id,
    version,
    action,
    snapshot: row,
    actorId: input.actorId,
    reason: input.reason,
  });
  return { ...row, id, version, before: current, noOp: false };
}

export async function recordLicenseUsageObservation(input: {
  tx: Transaction;
  entitlementId: string;
  source: "PROVIDER_SYNC" | "MANUAL_ATTESTATION";
  activeUsage: number;
  observedAt: string;
  inactivityThresholdDays?: number | null;
  evidenceReference?: string | null;
  actorId: string;
}) {
  const entitlementId = uuid(input.entitlementId, "entitlement_id");
  if (!Number.isSafeInteger(input.activeUsage) || input.activeUsage < 0)
    throw new ApplicationError("VALIDATION_ERROR", "active_usage is invalid.");
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(input.observedAt))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "observed_at must include a timezone.",
    );
  const observedAt = new Date(input.observedAt);
  if (
    !Number.isFinite(observedAt.getTime()) ||
    observedAt.getTime() > Date.now()
  )
    throw new ApplicationError("VALIDATION_ERROR", "observed_at is invalid.");
  const threshold = input.inactivityThresholdDays ?? null;
  if (
    threshold !== null &&
    (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 3650)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "inactivity_threshold_days is invalid.",
    );
  const evidenceReference = input.evidenceReference?.trim() ?? "";
  if (
    !evidenceReference ||
    evidenceReference.length > 256 ||
    /(?:password|access[_ -]?token|secret|api[_ -]?key|license[_ -]?key)\s*[:=]\s*\S+/i.test(
      evidenceReference,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "evidence_reference is invalid.",
    );
  const exists = await input.tx.query(
    "SELECT 1 FROM license.license_entitlements WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, entitlementId],
  );
  if (!exists.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "License entitlement was not found.",
    );
  const result = await input.tx.query(
    `INSERT INTO license.usage_observations
       (id,tenant_id,entitlement_id,source,active_usage,observed_at,
        inactivity_threshold_days,evidence_reference,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id,entitlement_id,source,active_usage,observed_at,inactivity_threshold_days`,
    [
      randomUUID(),
      input.tx.tenantId,
      entitlementId,
      input.source,
      input.activeUsage,
      observedAt.toISOString(),
      threshold,
      evidenceReference,
      input.actorId,
    ],
  );
  return result.rows[0]!;
}

export async function listLicenseCompliance(tx: Transaction) {
  const result = await tx.query(
    `SELECT e.id AS entitlement_id,e.software_product_id,e.pool_id,p.pool_type,p.scope_reference,
            e.license_type,e.quantity,
            e.current_term_version,e.renewal_notice_days,e.version,t.valid_from,t.valid_until,
            coalesce(a.assigned,0)::int AS assigned,
            coalesce(r.reserved,0)::int AS reserved,
            u.id AS usage_observation_id,u.active_usage,u.source AS usage_source,u.observed_at AS usage_observed_at,
            u.inactivity_threshold_days,
            CASE WHEN t.valid_until IS NOT NULL AND t.valid_until<=now() THEN 'EXPIRED'
                 WHEN e.license_type NOT IN ('PER_USER','NAMED_USER','PER_DEVICE','SERVER_INSTANCE') THEN 'UNKNOWN'
                 WHEN coalesce(a.assigned,0)+coalesce(r.reserved,0)>e.quantity THEN 'OVERUSED'
                 WHEN e.renewal_notice_days>0 AND t.valid_until IS NOT NULL
                   AND t.valid_until<=now()+e.renewal_notice_days*interval '1 day' THEN 'AT_RISK'
                 WHEN u.observed_at>=now()-interval '90 days'
                   AND u.inactivity_threshold_days IS NOT NULL
                   AND u.active_usage<coalesce(a.assigned,0) THEN 'UNDERUSED'
                 WHEN u.observed_at>=now()-interval '90 days' THEN 'COMPLIANT'
                 ELSE 'UNKNOWN' END AS compliance_state
       FROM license.license_entitlements e
       JOIN license.entitlement_terms t ON t.tenant_id=e.tenant_id
        AND t.entitlement_id=e.id AND t.term_version=e.current_term_version
       LEFT JOIN license.license_pools p
         ON p.tenant_id=e.tenant_id AND p.id=e.pool_id
       LEFT JOIN LATERAL (
         SELECT sum(quantity)::int AS assigned FROM license.assignments
          WHERE tenant_id=e.tenant_id AND entitlement_id=e.id
            AND state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING')
       ) a ON true
       LEFT JOIN LATERAL (
         SELECT sum(quantity)::int AS reserved FROM license.deployment_reservations
          WHERE tenant_id=e.tenant_id AND entitlement_id=e.id AND state='RESERVED'
       ) r ON true
       LEFT JOIN LATERAL (
         SELECT id,active_usage,source,observed_at,inactivity_threshold_days
           FROM license.usage_observations
          WHERE tenant_id=e.tenant_id AND entitlement_id=e.id
          ORDER BY observed_at DESC,created_at DESC LIMIT 1
       ) u ON true
      WHERE e.tenant_id=$1 ORDER BY e.created_at DESC,e.id LIMIT 500`,
    [tx.tenantId],
  );
  return result.rows.map((row) => ({
    ...row,
    explanation:
      row.compliance_state === "UNKNOWN"
        ? row.license_type === "PER_USER" ||
          row.license_type === "NAMED_USER" ||
          row.license_type === "PER_DEVICE" ||
          row.license_type === "SERVER_INSTANCE"
          ? "No recent authoritative usage observation is available."
          : "This license model has no configured countable consumption rule."
        : row.compliance_state === "OVERUSED"
          ? "Active assignments and reservations exceed the entitlement quantity."
          : row.compliance_state === "UNDERUSED"
            ? "Recent authoritative usage evidence is below assigned quantity."
            : row.compliance_state === "AT_RISK"
              ? "The entitlement is inside its configured renewal notice window."
              : row.compliance_state === "EXPIRED"
                ? "The current entitlement term has expired."
                : "Countable assignments and reservations are within entitlement quantity.",
  }));
}

export async function recordLicenseComplianceFacts(tx: Transaction) {
  const rows = (await listLicenseCompliance(tx)) as Array<
    Record<string, unknown>
  >;
  const facts: Array<{
    id: string;
    entitlement_id: string;
    compliance_state: "OVERUSED" | "UNDERUSED";
    aggregate_version: number;
    evidence_key: string;
    payload: Record<string, unknown>;
  }> = [];
  for (const row of rows) {
    if (
      row.compliance_state !== "OVERUSED" &&
      row.compliance_state !== "UNDERUSED"
    )
      continue;
    const entitlementId = String(row.entitlement_id);
    const evidenceKey = [
      row.version,
      row.assigned,
      row.reserved,
      row.usage_observation_id ?? "no-usage-observation",
    ].join(":");
    const payload =
      row.compliance_state === "OVERUSED"
        ? {
            entitlement_id: entitlementId,
            entitled: Number(row.quantity),
            assigned: Number(row.assigned),
            installed: null,
            active_usage: row.active_usage ?? null,
            overage:
              Number(row.assigned) +
              Number(row.reserved) -
              Number(row.quantity),
          }
        : {
            entitlement_id: entitlementId,
            entitled: Number(row.quantity),
            active_usage: Number(row.active_usage),
            reclaimable_count: Number(row.assigned) - Number(row.active_usage),
            usage_observation_id: String(row.usage_observation_id),
          };
    const inserted = await tx.query(
      `INSERT INTO license.compliance_facts
         (id,tenant_id,entitlement_id,compliance_state,evidence_key,payload)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id,entitlement_id,compliance_state,evidence_key)
       DO NOTHING RETURNING id`,
      [
        randomUUID(),
        tx.tenantId,
        entitlementId,
        row.compliance_state,
        evidenceKey,
        JSON.stringify(payload),
      ],
    );
    if (inserted.rowCount)
      facts.push({
        id: String(inserted.rows[0]!.id),
        entitlement_id: entitlementId,
        compliance_state: row.compliance_state,
        aggregate_version: Number(row.version),
        evidence_key: evidenceKey,
        payload,
      });
  }
  return facts;
}

export async function readLicenseAvailability(
  tx: Transaction,
  entitlementId: string,
) {
  const id = uuid(entitlementId, "entitlement_id");
  const result = await tx.query(
    `SELECT e.id AS entitlement_id,e.license_type,e.quantity,
            t.valid_from,t.valid_until,
            coalesce(a.assigned,0)::int AS assigned,
            coalesce(r.reserved,0)::int AS reserved
       FROM license.license_entitlements e
       JOIN license.entitlement_terms t ON t.tenant_id=e.tenant_id
        AND t.entitlement_id=e.id AND t.term_version=e.current_term_version
       LEFT JOIN LATERAL (
         SELECT sum(quantity)::int AS assigned FROM license.assignments
          WHERE tenant_id=e.tenant_id AND entitlement_id=e.id
            AND state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING')
       ) a ON true
       LEFT JOIN LATERAL (
         SELECT sum(quantity)::int AS reserved FROM license.deployment_reservations
          WHERE tenant_id=e.tenant_id AND entitlement_id=e.id AND state='RESERVED'
       ) r ON true
      WHERE e.tenant_id=$1 AND e.id=$2`,
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "License entitlement was not found.",
    );
  const row = result.rows[0]!;
  const supported = [
    "PER_USER",
    "NAMED_USER",
    "PER_DEVICE",
    "SERVER_INSTANCE",
  ].includes(String(row.license_type));
  const allocated = Number(row.assigned) + Number(row.reserved);
  return {
    entitlement_id: String(row.entitlement_id),
    license_type: String(row.license_type),
    quantity: Number(row.quantity),
    assigned: Number(row.assigned),
    reserved: Number(row.reserved),
    consumption_rule_supported: supported,
    available: supported ? Math.max(0, Number(row.quantity) - allocated) : null,
    effective_state:
      row.valid_until && new Date(row.valid_until).getTime() <= Date.now()
        ? "EXPIRED"
        : new Date(row.valid_from).getTime() > Date.now()
          ? "NOT_YET_VALID"
          : "ACTIVE",
  };
}

export async function readLicenseAssignment(
  tx: Transaction,
  assignmentId: string,
) {
  const id = uuid(assignmentId, "assignment_id");
  const result = await tx.query(
    `SELECT id,entitlement_id,reservation_id,principal_type,principal_id,
            quantity,state,version,assigned_at,activated_at,cancelled_at,reclaimed_at,
            reclaim_verification_reference,created_at,updated_at
       FROM license.assignments WHERE tenant_id=$1 AND id=$2`,
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "License assignment was not found.",
    );
  return result.rows[0]!;
}
