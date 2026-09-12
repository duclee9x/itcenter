import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

export const licenseTypes = [
  "PER_USER",
  "PER_DEVICE",
  "CONCURRENT",
  "SUBSCRIPTION",
  "PERPETUAL",
  "SITE",
  "ENTERPRISE_AGREEMENT",
  "NAMED_USER",
  "FLOATING",
  "CORE_CPU",
  "SERVER_INSTANCE",
] as const;

export const poolTypes = [
  "DEPARTMENT",
  "COUNTRY",
  "BUSINESS_UNIT",
  "PROJECT",
  "CONTRACT",
] as const;

function text(value: string, field: string, limit = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  return value.trim();
}

function nonSecretText(value: string, field: string, limit = 2000) {
  const normalized = text(value, field, limit);
  if (
    /(?:password|access[_ -]?token|secret|api[_ -]?key|license[_ -]?key)\s*[:=]\s*\S+/i.test(
      normalized,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} must not contain credentials, secrets, or license keys.`,
    );
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  field: string,
  limit = 256,
) {
  if (value === undefined || value === null || value === "") return null;
  return nonSecretText(value, field, limit);
}

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

function timestamp(value: string, field: string) {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} must be an ISO-8601 timestamp with a timezone.`,
    );
  const time = Date.parse(value);
  if (!Number.isFinite(time))
    throw new ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  return new Date(time).toISOString();
}

function validateTerms(validFrom: string, validUntil?: string | null) {
  const start = timestamp(validFrom, "valid_from");
  const end = validUntil ? timestamp(validUntil, "valid_until") : null;
  if (end && Date.parse(end) <= Date.parse(start))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "valid_until must be later than valid_from.",
    );
  return { valid_from: start, valid_until: end };
}

function validateQuantity(quantity: number) {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 1_000_000_000
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "quantity must be a positive integer no greater than one billion.",
    );
  return quantity;
}

function validateLicenseType(value: string) {
  if (!licenseTypes.includes(value as (typeof licenseTypes)[number]))
    throw new ApplicationError("VALIDATION_ERROR", "license_type is invalid.");
  return value;
}

function validatePoolType(value: string) {
  if (!poolTypes.includes(value as (typeof poolTypes)[number]))
    throw new ApplicationError("VALIDATION_ERROR", "pool_type is invalid.");
  return value;
}

function validateCost(cost?: number | null, currency?: string | null) {
  if (cost === undefined || cost === null) {
    if (currency !== undefined && currency !== null)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "currency requires a cost value.",
      );
    return { cost: null, currency: null };
  }
  if (
    !Number.isFinite(cost) ||
    cost < 0 ||
    Math.round(cost * 100) !== cost * 100
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "cost must be a non-negative amount with at most two decimal places.",
    );
  const code = text(currency ?? "", "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code))
    throw new ApplicationError("VALIDATION_ERROR", "currency is invalid.");
  return { cost, currency: code };
}

function validateRestrictions(value: string[]) {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        !item.trim() ||
        item.length > 500 ||
        /(?:password|access[_ -]?token|secret|api[_ -]?key|license[_ -]?key)\s*[:=]\s*\S+/i.test(
          item,
        ),
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "restrictions must contain at most 100 short text entries.",
    );
  return [...new Set(value.map((item) => item.trim()))];
}

function effectiveState(
  validFrom: string | Date,
  validUntil: string | Date | null,
  now: Date,
) {
  if (new Date(validFrom).getTime() > now.getTime()) return "NOT_YET_VALID";
  if (!validUntil || new Date(validUntil).getTime() > now.getTime())
    return "ACTIVE";
  return "EXPIRED";
}

async function appendHistory(input: {
  tx: Transaction;
  entitlementId: string;
  version: number;
  termVersion: number;
  action: "CREATED" | "UPDATED" | "RENEWED";
  snapshot: Record<string, unknown>;
  actorId: string;
  reason: string;
}) {
  await input.tx.query(
    `INSERT INTO license.entitlement_history
       (id,tenant_id,entitlement_id,entity_version,term_version,action,
        snapshot,actor_id,reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.entitlementId,
      input.version,
      input.termVersion,
      input.action,
      JSON.stringify(input.snapshot),
      text(input.actorId, "actor_id"),
      nonSecretText(input.reason, "reason", 2000),
    ],
  );
}

const entitlementProjection = `
  SELECT e.id,e.software_product_id,e.pool_id,e.license_type,e.quantity,
         e.purchased_at,e.contract_reference,e.supplier_reference,e.cost,
         e.currency,e.renewal_notice_days,e.restrictions,e.current_term_version,
         e.version,e.created_at,e.updated_at,t.valid_from,t.valid_until,
         CASE WHEN t.valid_from>now() THEN 'NOT_YET_VALID'
              WHEN t.valid_until IS NULL OR now()<t.valid_until THEN 'ACTIVE'
              ELSE 'EXPIRED' END AS effective_state
    FROM license.license_entitlements e
    JOIN license.entitlement_terms t
      ON t.tenant_id=e.tenant_id AND t.entitlement_id=e.id
     AND t.term_version=e.current_term_version`;

export async function createLicensePool(input: {
  tx: Transaction;
  name: string;
  poolType: string;
  scopeReference: string;
  contractReference?: string | null;
  actorId: string;
}) {
  const id = randomUUID();
  const values = [
    id,
    input.tx.tenantId,
    text(input.name, "name", 160),
    validatePoolType(input.poolType),
    text(input.scopeReference, "scope_reference"),
    optionalText(input.contractReference, "contract_reference"),
    text(input.actorId, "actor_id"),
  ];
  try {
    await input.tx.query(
      `INSERT INTO license.license_pools
         (id,tenant_id,name,pool_type,scope_reference,contract_reference,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      values,
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "VERSION_CONFLICT",
        "A pool with this name and scope already exists.",
      );
    throw error;
  }
  return {
    id,
    name: values[2],
    pool_type: values[3],
    scope_reference: values[4],
    contract_reference: values[5],
    state: "ACTIVE",
    version: 1,
  };
}

export async function updateLicensePool(input: {
  tx: Transaction;
  poolId: string;
  expectedVersion: number;
  name: string;
  state: "ACTIVE" | "INACTIVE";
  contractReference?: string | null;
}) {
  const poolId = uuid(input.poolId, "pool_id");
  const current = await input.tx.query(
    "SELECT id,name,pool_type,scope_reference,contract_reference,state,version FROM license.license_pools WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, poolId],
  );
  if (!current.rowCount)
    throw new ApplicationError("NOT_FOUND", "License pool was not found.");
  const row = current.rows[0]!;
  assertVersion(Number(row.version), input.expectedVersion);
  if (!["ACTIVE", "INACTIVE"].includes(input.state))
    throw new ApplicationError("VALIDATION_ERROR", "state is invalid.");
  const version = input.expectedVersion + 1;
  const updated = await input.tx.query(
    `UPDATE license.license_pools
        SET name=$1,contract_reference=$2,state=$3,version=$4,updated_at=now()
      WHERE tenant_id=$5 AND id=$6
      RETURNING id,name,pool_type,scope_reference,contract_reference,state,version`,
    [
      text(input.name, "name", 160),
      optionalText(input.contractReference, "contract_reference"),
      input.state,
      version,
      input.tx.tenantId,
      poolId,
    ],
  );
  const changed = updated.rows[0]!;
  return {
    id: String(changed.id),
    name: String(changed.name),
    pool_type: String(changed.pool_type),
    scope_reference: String(changed.scope_reference),
    contract_reference: changed.contract_reference as string | null,
    state: String(changed.state),
    version,
    before: row,
  };
}

export async function readLicensePool(tx: Transaction, poolId: string) {
  const result = await tx.query(
    `SELECT p.id,p.name,p.pool_type,p.scope_reference,p.contract_reference,
            p.state,p.version,p.created_at,p.updated_at,
            (SELECT count(*)::int FROM license.license_entitlements e
              WHERE e.tenant_id=p.tenant_id AND e.pool_id=p.id) AS entitlement_count,
            (SELECT coalesce(sum(e.quantity),0)::bigint
               FROM license.license_entitlements e
              WHERE e.tenant_id=p.tenant_id AND e.pool_id=p.id) AS entitled_quantity
       FROM license.license_pools p WHERE p.tenant_id=$1 AND p.id=$2`,
    [tx.tenantId, uuid(poolId, "pool_id")],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "License pool was not found.");
  return result.rows[0]!;
}

export async function listLicensePools(tx: Transaction) {
  const result = await tx.query(
    `SELECT p.id,p.name,p.pool_type,p.scope_reference,p.contract_reference,
            p.state,p.version,p.created_at,p.updated_at,
            (SELECT count(*)::int FROM license.license_entitlements e
              WHERE e.tenant_id=p.tenant_id AND e.pool_id=p.id) AS entitlement_count,
            (SELECT coalesce(sum(e.quantity),0)::bigint
               FROM license.license_entitlements e
              WHERE e.tenant_id=p.tenant_id AND e.pool_id=p.id) AS entitled_quantity
       FROM license.license_pools p WHERE p.tenant_id=$1
      ORDER BY p.name,p.id LIMIT 200`,
    [tx.tenantId],
  );
  return result.rows;
}

export async function createLicenseEntitlement(input: {
  tx: Transaction;
  softwareProductId: string;
  poolId?: string | null;
  licenseType: string;
  quantity: number;
  purchasedAt?: string | null;
  validFrom: string;
  validUntil?: string | null;
  contractReference?: string | null;
  supplierReference?: string | null;
  cost?: number | null;
  currency?: string | null;
  renewalNoticeDays?: number | null;
  restrictions: string[];
  actorId: string;
  reason: string;
}) {
  const productId = uuid(input.softwareProductId, "software_product_id");
  const poolId = optionalText(input.poolId, "pool_id");
  if (poolId) uuid(poolId, "pool_id");
  const licenseType = validateLicenseType(input.licenseType);
  const quantity = validateQuantity(input.quantity);
  const terms = validateTerms(input.validFrom, input.validUntil);
  const purchasedAt = input.purchasedAt
    ? timestamp(input.purchasedAt, "purchased_at")
    : null;
  const money = validateCost(input.cost, input.currency);
  const renewalNoticeDays = input.renewalNoticeDays ?? null;
  if (
    renewalNoticeDays !== null &&
    (!Number.isSafeInteger(renewalNoticeDays) ||
      renewalNoticeDays < 0 ||
      renewalNoticeDays > 3650)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "renewal_notice_days must be between 0 and 3650.",
    );
  if (poolId) {
    const pool = await input.tx.query(
      "SELECT state FROM license.license_pools WHERE tenant_id=$1 AND id=$2",
      [input.tx.tenantId, poolId],
    );
    if (!pool.rowCount)
      throw new ApplicationError("NOT_FOUND", "License pool was not found.");
    if (pool.rows[0]!.state !== "ACTIVE")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Entitlements can only be linked to an active pool.",
      );
  }
  const id = randomUUID();
  const reason = nonSecretText(input.reason, "reason", 2000);
  const actorId = text(input.actorId, "actor_id");
  const contractReference = optionalText(
    input.contractReference,
    "contract_reference",
  );
  const supplierReference = optionalText(
    input.supplierReference,
    "supplier_reference",
  );
  const restrictions = validateRestrictions(input.restrictions);
  try {
    await input.tx.query(
      `INSERT INTO license.license_entitlements
         (id,tenant_id,software_product_id,pool_id,license_type,quantity,
          purchased_at,contract_reference,supplier_reference,cost,currency,
          renewal_notice_days,restrictions,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id,
        input.tx.tenantId,
        productId,
        poolId,
        licenseType,
        quantity,
        purchasedAt,
        contractReference,
        supplierReference,
        money.cost,
        money.currency,
        renewalNoticeDays,
        JSON.stringify(restrictions),
        actorId,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23503")
      throw new ApplicationError(
        "NOT_FOUND",
        "Software product or pool was not found in this tenant.",
      );
    throw error;
  }
  await input.tx.query(
    `INSERT INTO license.entitlement_terms
       (id,tenant_id,entitlement_id,term_version,valid_from,valid_until,recorded_by,reason)
     VALUES($1,$2,$3,1,$4,$5,$6,$7)`,
    [
      randomUUID(),
      input.tx.tenantId,
      id,
      terms.valid_from,
      terms.valid_until,
      actorId,
      reason,
    ],
  );
  const snapshot = {
    software_product_id: productId,
    pool_id: poolId,
    license_type: licenseType,
    quantity,
    purchased_at: purchasedAt,
    ...terms,
    contract_reference: contractReference,
    supplier_reference: supplierReference,
    ...money,
    renewal_notice_days: renewalNoticeDays,
    restrictions,
    effective_state: effectiveState(
      terms.valid_from,
      terms.valid_until,
      new Date(),
    ),
  };
  await appendHistory({
    tx: input.tx,
    entitlementId: id,
    version: 1,
    termVersion: 1,
    action: "CREATED",
    snapshot,
    actorId,
    reason,
  });
  return { id, ...snapshot, term_version: 1, version: 1 };
}

export async function updateLicenseEntitlement(input: {
  tx: Transaction;
  entitlementId: string;
  expectedVersion: number;
  poolId?: string | null;
  licenseType: string;
  quantity: number;
  purchasedAt?: string | null;
  contractReference?: string | null;
  supplierReference?: string | null;
  cost?: number | null;
  currency?: string | null;
  renewalNoticeDays?: number | null;
  restrictions: string[];
  actorId: string;
  reason: string;
}) {
  const id = uuid(input.entitlementId, "entitlement_id");
  const result = await input.tx.query(
    `${entitlementProjection}
      WHERE e.tenant_id=$1 AND e.id=$2 FOR UPDATE OF e`,
    [input.tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "License entitlement was not found.",
    );
  const current = result.rows[0]!;
  assertVersion(Number(current.version), input.expectedVersion);
  const poolId = optionalText(input.poolId, "pool_id");
  if (poolId) {
    uuid(poolId, "pool_id");
    const pool = await input.tx.query(
      "SELECT state FROM license.license_pools WHERE tenant_id=$1 AND id=$2",
      [input.tx.tenantId, poolId],
    );
    if (!pool.rowCount)
      throw new ApplicationError("NOT_FOUND", "License pool was not found.");
    if (pool.rows[0]!.state !== "ACTIVE")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Entitlements can only be linked to an active pool.",
      );
  }
  const licenseType = validateLicenseType(input.licenseType);
  const quantity = validateQuantity(input.quantity);
  const allocations = await input.tx.query(
    `SELECT
       coalesce((SELECT sum(a.quantity) FROM license.assignments a
                  WHERE a.tenant_id=$1 AND a.entitlement_id=$2
                    AND a.state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING')),0)::int
       + coalesce((SELECT sum(r.quantity) FROM license.deployment_reservations r
                    WHERE r.tenant_id=$1 AND r.entitlement_id=$2
                      AND r.state='RESERVED'),0)::int AS allocated,
       EXISTS(SELECT 1 FROM license.assignments a
               WHERE a.tenant_id=$1 AND a.entitlement_id=$2
                 AND a.state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING'))
       OR EXISTS(SELECT 1 FROM license.deployment_reservations r
                  WHERE r.tenant_id=$1 AND r.entitlement_id=$2
                    AND r.state='RESERVED') AS has_allocations,
       EXISTS(SELECT 1 FROM license.assignments a
               WHERE a.tenant_id=$1 AND a.entitlement_id=$2
                 AND a.state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING')
                 AND NOT ((a.principal_type='USER' AND $3=ANY(ARRAY['PER_USER','NAMED_USER']))
                       OR (a.principal_type='ASSET' AND $3=ANY(ARRAY['PER_DEVICE','SERVER_INSTANCE']))))
          AS incompatible_assignment`,
    [input.tx.tenantId, id, licenseType],
  );
  const allocated = Number(allocations.rows[0]!.allocated);
  const hasAllocations = Boolean(allocations.rows[0]!.has_allocations);
  if (allocated > quantity)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Quantity cannot be reduced below currently assigned and reserved seats.",
    );
  if (
    hasAllocations &&
    (licenseType !== current.license_type ||
      poolId !== (current.pool_id as string | null) ||
      allocations.rows[0]!.incompatible_assignment)
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "License type and pool cannot change while seats are assigned or reserved.",
    );
  const purchasedAt = input.purchasedAt
    ? timestamp(input.purchasedAt, "purchased_at")
    : null;
  const money = validateCost(input.cost, input.currency);
  const renewalNoticeDays = input.renewalNoticeDays ?? null;
  if (
    renewalNoticeDays !== null &&
    (!Number.isSafeInteger(renewalNoticeDays) ||
      renewalNoticeDays < 0 ||
      renewalNoticeDays > 3650)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "renewal_notice_days is invalid.",
    );
  const restrictions = validateRestrictions(input.restrictions);
  const reason = nonSecretText(input.reason, "reason", 2000);
  const actorId = text(input.actorId, "actor_id");
  const contractReference = optionalText(
    input.contractReference,
    "contract_reference",
  );
  const supplierReference = optionalText(
    input.supplierReference,
    "supplier_reference",
  );
  const version = input.expectedVersion + 1;
  const updated = await input.tx.query(
    `UPDATE license.license_entitlements
        SET pool_id=$1,license_type=$2,quantity=$3,purchased_at=$4,
            contract_reference=$5,supplier_reference=$6,cost=$7,currency=$8,
            renewal_notice_days=$9,restrictions=$10,version=$11,updated_at=now()
      WHERE tenant_id=$12 AND id=$13
      RETURNING id,software_product_id,pool_id,license_type,quantity,purchased_at,
                contract_reference,supplier_reference,cost,currency,
                renewal_notice_days,restrictions,current_term_version,version`,
    [
      poolId,
      licenseType,
      quantity,
      purchasedAt,
      contractReference,
      supplierReference,
      money.cost,
      money.currency,
      renewalNoticeDays,
      JSON.stringify(restrictions),
      version,
      input.tx.tenantId,
      id,
    ],
  );
  const snapshot = {
    ...updated.rows[0],
    valid_from: current.valid_from,
    valid_until: current.valid_until,
    effective_state: current.effective_state,
  };
  await appendHistory({
    tx: input.tx,
    entitlementId: id,
    version,
    termVersion: Number(current.current_term_version),
    action: "UPDATED",
    snapshot,
    actorId,
    reason,
  });
  return {
    ...updated.rows[0]!,
    id: String(updated.rows[0]!.id),
    version,
    effective_state: current.effective_state,
    reason,
    before: current,
  };
}

export async function renewLicenseEntitlement(input: {
  tx: Transaction;
  entitlementId: string;
  expectedVersion: number;
  validFrom: string;
  validUntil: string | null;
  actorId: string;
  reason: string;
}) {
  const id = uuid(input.entitlementId, "entitlement_id");
  const result = await input.tx.query(
    `${entitlementProjection}
      WHERE e.tenant_id=$1 AND e.id=$2 FOR UPDATE OF e`,
    [input.tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "License entitlement was not found.",
    );
  const current = result.rows[0]!;
  assertVersion(Number(current.version), input.expectedVersion);
  const terms = validateTerms(input.validFrom, input.validUntil);
  const version = input.expectedVersion + 1;
  const termVersion = Number(current.current_term_version) + 1;
  const reason = nonSecretText(input.reason, "reason", 2000);
  const actorId = text(input.actorId, "actor_id");
  await input.tx.query(
    `INSERT INTO license.entitlement_terms
       (id,tenant_id,entitlement_id,term_version,valid_from,valid_until,recorded_by,reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      randomUUID(),
      input.tx.tenantId,
      id,
      termVersion,
      terms.valid_from,
      terms.valid_until,
      actorId,
      reason,
    ],
  );
  await input.tx.query(
    `UPDATE license.license_entitlements
        SET current_term_version=$1,version=$2,updated_at=now()
      WHERE tenant_id=$3 AND id=$4`,
    [termVersion, version, input.tx.tenantId, id],
  );
  const snapshot = {
    ...current,
    ...terms,
    current_term_version: termVersion,
    effective_state: effectiveState(
      terms.valid_from,
      terms.valid_until,
      new Date(),
    ),
  };
  await appendHistory({
    tx: input.tx,
    entitlementId: id,
    version,
    termVersion,
    action: "RENEWED",
    snapshot,
    actorId,
    reason,
  });
  return {
    id,
    software_product_id: String(current.software_product_id),
    previous_valid_from: new Date(current.valid_from).toISOString(),
    previous_valid_until: current.valid_until
      ? new Date(current.valid_until).toISOString()
      : null,
    ...terms,
    effective_state: snapshot.effective_state,
    current_term_version: termVersion,
    version,
    reason,
  };
}

export async function readLicenseEntitlement(
  tx: Transaction,
  entitlementId: string,
) {
  const result = await tx.query(
    `${entitlementProjection} WHERE e.tenant_id=$1 AND e.id=$2`,
    [tx.tenantId, uuid(entitlementId, "entitlement_id")],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "License entitlement was not found.",
    );
  return result.rows[0]!;
}

export async function listLicenseEntitlements(tx: Transaction) {
  const result = await tx.query(
    `${entitlementProjection} WHERE e.tenant_id=$1
      ORDER BY e.created_at DESC,e.id LIMIT 200`,
    [tx.tenantId],
  );
  return result.rows;
}

export async function recordDueEntitlementExpiryFacts(input: {
  tx: Transaction;
  asOf?: string;
}) {
  const asOf = input.asOf
    ? timestamp(input.asOf, "as_of")
    : new Date().toISOString();
  const result = await input.tx.query(
    `INSERT INTO license.entitlement_expiry_facts
       (id,tenant_id,entitlement_id,term_version,valid_until,expired_at)
     SELECT gen_random_uuid(),t.tenant_id,t.entitlement_id,t.term_version,t.valid_until,$2
       FROM license.entitlement_terms t
      WHERE t.tenant_id=$1 AND t.valid_until IS NOT NULL AND t.valid_until<=$2
      ORDER BY t.valid_until,t.entitlement_id,t.term_version
      LIMIT 500
     ON CONFLICT (tenant_id,entitlement_id,term_version) DO NOTHING
     RETURNING entitlement_id,term_version,valid_until,expired_at`,
    [input.tx.tenantId, asOf],
  );
  return result.rows.map((row) => ({
    entitlement_id: String(row.entitlement_id),
    term_version: Number(row.term_version),
    valid_until: new Date(row.valid_until).toISOString(),
    expired_at: new Date(row.expired_at).toISOString(),
  }));
}

export async function recordUpcomingEntitlementExpiringFacts(input: {
  tx: Transaction;
  asOf?: string;
}) {
  const asOf = input.asOf
    ? timestamp(input.asOf, "as_of")
    : new Date().toISOString();
  const result = await input.tx.query(
    `INSERT INTO license.entitlement_expiring_facts
       (id,tenant_id,entitlement_id,term_version,valid_until,notice_days,emitted_at)
     SELECT gen_random_uuid(),e.tenant_id,e.id,t.term_version,t.valid_until,
            e.renewal_notice_days,$2
       FROM license.license_entitlements e
       JOIN license.entitlement_terms t
         ON t.tenant_id=e.tenant_id AND t.entitlement_id=e.id
        AND t.term_version=e.current_term_version
      WHERE e.tenant_id=$1 AND e.renewal_notice_days>0
        AND t.valid_until>$2
        AND t.valid_until<=$2+(e.renewal_notice_days * interval '1 day')
      ORDER BY t.valid_until,e.id
      LIMIT 500
     ON CONFLICT (tenant_id,entitlement_id,term_version) DO NOTHING
     RETURNING entitlement_id,term_version,valid_until,notice_days,emitted_at`,
    [input.tx.tenantId, asOf],
  );
  return result.rows.map((row) => ({
    entitlement_id: String(row.entitlement_id),
    term_version: Number(row.term_version),
    valid_until: new Date(row.valid_until).toISOString(),
    notice_days: Number(row.notice_days),
    emitted_at: new Date(row.emitted_at).toISOString(),
  }));
}
