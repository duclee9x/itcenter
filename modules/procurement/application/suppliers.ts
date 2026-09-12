import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import {
  assertSupplierTransition,
  supplierCommand,
  supplierCommandContract,
  SupplierRuleError,
} from "../domain/supplier.js";

type SupplierRow = Record<string, unknown>;

function assertReasonExcludesProtectedValues(
  reason: string,
  values: Array<unknown>,
): void {
  const normalizedReason = reason.toLocaleLowerCase();
  const includesProtectedValue = values.some((candidate) => {
    if (typeof candidate !== "string" || !candidate.trim()) return false;
    const value = candidate.trim().toLocaleLowerCase();
    if (value.length >= 4) return normalizedReason.includes(value);
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
      "iu",
    ).test(reason);
  });
  if (includesProtectedValue)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "reason must not contain Supplier tax or banking values.",
    );
}

function mapSupplierRule<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SupplierRuleError)
      throw new ApplicationError(
        error.rule === "UNSUPPORTED_COMMAND"
          ? "VALIDATION_ERROR"
          : "BUSINESS_RULE_VIOLATION",
        error.message,
      );
    throw error;
  }
}

export interface SupplierContact {
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
}

export interface SupplierProfile {
  legal_name?: string;
  tax_identifier?: string | null;
  address?: string | null;
  categories?: string[];
  risk_state?: string | null;
  bank_info_reference?: string | null;
  contacts?: SupplierContact[];
}

export interface SupplierMutationContext {
  tx: Transaction;
  actorId: string;
  reason: string;
  correlationId: string;
}

export function safeSupplier(row: SupplierRow) {
  return {
    id: String(row.id),
    code: String(row.code),
    legal_name: String(row.legal_name),
    address: row.address as string | null,
    categories: row.categories as string[],
    risk_state: row.risk_state as string | null,
    contacts: row.contacts as SupplierContact[],
    state: String(row.state),
    version: Number(row.version),
    created_at: row.created_at,
    updated_at: row.updated_at,
    tax_identifier_present: row.tax_identifier !== null,
    bank_info_reference_present: row.bank_info_reference !== null,
  };
}

async function writeHistory(input: {
  tx: Transaction;
  supplierId: string;
  version: number;
  action: string;
  previousState: string | null;
  newState: string;
  changedFields: string[];
  actorId: string;
  reason: string;
  correlationId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}) {
  await input.tx.query(
    `INSERT INTO procurement.supplier_history
       (id,tenant_id,supplier_id,entity_version,action,previous_state,new_state,
        changed_fields,before_snapshot,after_snapshot,actor_id,reason,correlation_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13)`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.supplierId,
      input.version,
      input.action,
      input.previousState,
      input.newState,
      JSON.stringify(input.changedFields),
      input.before === null ? null : JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.actorId,
      input.reason,
      input.correlationId,
    ],
  );
}

function safeSnapshot(row: SupplierRow) {
  return {
    code: row.code,
    legal_name: row.legal_name,
    address: row.address,
    categories: row.categories,
    risk_state: row.risk_state,
    state: row.state,
    version: Number(row.version),
  };
}

export async function createSupplier(
  input: SupplierMutationContext & {
    profile: Required<Pick<SupplierProfile, "legal_name">> & SupplierProfile;
  },
) {
  assertReasonExcludesProtectedValues(input.reason, [
    input.profile.tax_identifier,
    input.profile.bank_info_reference,
  ]);
  const id = randomUUID();
  const code = `SUP-${id.slice(0, 8).toUpperCase()}`;
  const result = await input.tx.query(
    `INSERT INTO procurement.suppliers
       (id,tenant_id,code,legal_name,tax_identifier,address,categories,risk_state,
        bank_info_reference,contacts,state,version,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,'PROSPECT',1,$11)
     RETURNING *`,
    [
      id,
      input.tx.tenantId,
      code,
      input.profile.legal_name,
      input.profile.tax_identifier ?? null,
      input.profile.address ?? null,
      JSON.stringify(input.profile.categories ?? []),
      input.profile.risk_state ?? null,
      input.profile.bank_info_reference ?? null,
      JSON.stringify(input.profile.contacts ?? []),
      input.actorId,
    ],
  );
  const row = result.rows[0]!;
  const safe = safeSupplier(row);
  await writeHistory({
    tx: input.tx,
    supplierId: id,
    version: 1,
    action: "SUPPLIER.CREATE",
    previousState: null,
    newState: "PROSPECT",
    changedFields: Object.keys(input.profile).sort(),
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    before: null,
    after: safeSnapshot(row),
  });
  return safe;
}

export async function updateSupplierProfile(
  input: SupplierMutationContext & {
    supplierId: string;
    expectedVersion: number;
    profile: SupplierProfile;
  },
) {
  const currentResult = await input.tx.query(
    "SELECT * FROM procurement.suppliers WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.supplierId],
  );
  if (!currentResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Supplier was not found.");
  const current = currentResult.rows[0]!;
  assertVersion(Number(current.version), input.expectedVersion);
  const merged = {
    legal_name: input.profile.legal_name ?? String(current.legal_name),
    tax_identifier:
      input.profile.tax_identifier === undefined
        ? (current.tax_identifier as string | null)
        : input.profile.tax_identifier,
    address:
      input.profile.address === undefined
        ? (current.address as string | null)
        : input.profile.address,
    categories: input.profile.categories ?? (current.categories as string[]),
    risk_state:
      input.profile.risk_state === undefined
        ? (current.risk_state as string | null)
        : input.profile.risk_state,
    bank_info_reference:
      input.profile.bank_info_reference === undefined
        ? (current.bank_info_reference as string | null)
        : input.profile.bank_info_reference,
    contacts: input.profile.contacts ?? (current.contacts as SupplierContact[]),
  };
  assertReasonExcludesProtectedValues(input.reason, [
    current.tax_identifier,
    current.bank_info_reference,
    merged.tax_identifier,
    merged.bank_info_reference,
  ]);
  const fields = Object.keys(input.profile).sort();
  if (!fields.length)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "At least one profile field is required.",
    );
  const version = input.expectedVersion + 1;
  const updated = await input.tx.query(
    `UPDATE procurement.suppliers
        SET legal_name=$1,tax_identifier=$2,address=$3,categories=$4::jsonb,
            risk_state=$5,bank_info_reference=$6,contacts=$7::jsonb,
            version=$8,updated_at=now()
      WHERE tenant_id=$9 AND id=$10 AND version=$11
      RETURNING *`,
    [
      merged.legal_name,
      merged.tax_identifier,
      merged.address,
      JSON.stringify(merged.categories),
      merged.risk_state,
      merged.bank_info_reference,
      JSON.stringify(merged.contacts),
      version,
      input.tx.tenantId,
      input.supplierId,
      input.expectedVersion,
    ],
  );
  if (!updated.rowCount)
    throw new ApplicationError("VERSION_CONFLICT", "Supplier version changed.");
  const row = updated.rows[0]!;
  const safe = safeSupplier(row);
  await writeHistory({
    tx: input.tx,
    supplierId: input.supplierId,
    version,
    action: "SUPPLIER.UPDATE_PROFILE",
    previousState: String(current.state),
    newState: String(current.state),
    changedFields: fields,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    before: safeSnapshot(current),
    after: { ...safeSnapshot(row), changed_fields: fields },
  });
  return {
    ...safe,
    previous_state: String(current.state),
    changed_fields: fields,
  };
}

export async function transitionSupplier(
  input: SupplierMutationContext & {
    supplierId: string;
    expectedVersion: number;
    command: string;
  },
) {
  const command = mapSupplierRule(() => supplierCommand(input.command));
  const contract = supplierCommandContract[command];
  const currentResult = await input.tx.query(
    "SELECT * FROM procurement.suppliers WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.supplierId],
  );
  if (!currentResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Supplier was not found.");
  const current = currentResult.rows[0]!;
  assertVersion(Number(current.version), input.expectedVersion);
  assertReasonExcludesProtectedValues(input.reason, [
    current.tax_identifier,
    current.bank_info_reference,
  ]);
  const allowedFrom: readonly string[] = Array.isArray(contract.from)
    ? contract.from
    : [contract.from as string];
  if (!allowedFrom.includes(String(current.state)))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      `SUPPLIER.${command} is not allowed from ${String(current.state)}.`,
    );
  mapSupplierRule(() =>
    assertSupplierTransition(String(current.state), contract.to),
  );
  const version = input.expectedVersion + 1;
  const updated = await input.tx.query(
    `UPDATE procurement.suppliers SET state=$1,version=$2,updated_at=now()
      WHERE tenant_id=$3 AND id=$4 AND version=$5 RETURNING *`,
    [
      contract.to,
      version,
      input.tx.tenantId,
      input.supplierId,
      input.expectedVersion,
    ],
  );
  if (!updated.rowCount)
    throw new ApplicationError("VERSION_CONFLICT", "Supplier version changed.");
  const row = updated.rows[0]!;
  const safe = safeSupplier(row);
  const changed = {
    ...safe,
    previous_state: String(current.state),
    reason: input.reason,
  };
  await writeHistory({
    tx: input.tx,
    supplierId: input.supplierId,
    version,
    action: `SUPPLIER.${command}`,
    previousState: String(current.state),
    newState: contract.to,
    changedFields: ["state"],
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    before: safeSnapshot(current),
    after: safeSnapshot(row),
  });
  return { value: changed, eventType: contract.event };
}

export async function readSupplier(tx: Transaction, supplierId: string) {
  const result = await tx.query(
    "SELECT * FROM procurement.suppliers WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, supplierId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Supplier was not found.");
  return safeSupplier(result.rows[0]!);
}

export async function listSuppliers(
  tx: Transaction,
  input: {
    state?: string | null;
    limit: number;
    offset: number;
  },
) {
  const rows = await tx.query(
    `SELECT * FROM procurement.suppliers
      WHERE tenant_id=$1 AND ($2::text IS NULL OR state=$2)
      ORDER BY legal_name,id LIMIT $3 OFFSET $4`,
    [tx.tenantId, input.state ?? null, input.limit, input.offset],
  );
  return rows.rows.map(safeSupplier);
}
