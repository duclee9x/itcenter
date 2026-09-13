import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

export const PLATFORM_FAMILIES = [
  "WINDOWS",
  "MACOS",
  "LINUX",
  "IOS",
  "ANDROID",
  "OTHER",
] as const;
export type PlatformFamily = (typeof PLATFORM_FAMILIES)[number];
export type CatalogKind = "SERVICE" | "PLATFORM" | "SERVICE_ENVIRONMENT";
type CatalogRow = Record<string, unknown> & {
  id: string;
  tenant_id: string;
  key: string;
  name: string;
  state: "ACTIVE" | "INACTIVE";
  version: number;
};
const tables = {
  SERVICE: "service.services",
  PLATFORM: "service.platforms",
  SERVICE_ENVIRONMENT: "service.environments",
} as const;

function canonicalUniqueFailure(error: unknown): never {
  if ((error as { code?: string })?.code === "23505")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "A reference with this tenant-scoped key already exists.",
    );
  throw error;
}

function required(value: string, field: string) {
  const clean = value.trim();
  if (!clean || clean.length > 200)
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return clean;
}

function keyValue(value: string) {
  const key = required(value, "key");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(key))
    throw new ApplicationError("VALIDATION_ERROR", "key is invalid.");
  return key;
}
function canonicalId(value: string, field: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApplicationError("VALIDATION_ERROR", `${field} must be a UUID.`);
  return value;
}

async function readById<T extends CatalogRow>(
  tx: Transaction,
  kind: CatalogKind,
  id: string,
): Promise<T> {
  const result = await tx.query<T>(
    `SELECT * FROM ${tables[kind]} WHERE tenant_id=$1 AND id=$2`,
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", `${kind} was not found.`);
  return result.rows[0]!;
}

export async function readService(tx: Transaction, id: string) {
  return readById(tx, "SERVICE", id);
}
export async function readPlatform(tx: Transaction, id: string) {
  return readById(tx, "PLATFORM", id);
}
export async function readServiceEnvironment(tx: Transaction, id: string) {
  return readById(tx, "SERVICE_ENVIRONMENT", id);
}

export async function createService(input: {
  tx: Transaction;
  key: string;
  name: string;
  description?: string | null;
}) {
  const id = randomUUID();
  try {
    const result = await input.tx.query<CatalogRow>(
      `INSERT INTO service.services(id,tenant_id,key,name,description)
     VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [
        id,
        input.tx.tenantId,
        keyValue(input.key),
        required(input.name, "name"),
        input.description?.trim() || null,
      ],
    );
    return result.rows[0]!;
  } catch (error) {
    canonicalUniqueFailure(error);
  }
}

export async function createPlatform(input: {
  tx: Transaction;
  key: string;
  family: PlatformFamily;
  name: string;
  majorVersion?: string | null;
}) {
  if (!(PLATFORM_FAMILIES as readonly string[]).includes(input.family))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Platform family is invalid.",
    );
  try {
    const result = await input.tx.query<CatalogRow>(
      `INSERT INTO service.platforms(id,tenant_id,key,family,name,major_version)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        randomUUID(),
        input.tx.tenantId,
        keyValue(input.key),
        input.family,
        required(input.name, "name"),
        input.majorVersion?.trim() || null,
      ],
    );
    return result.rows[0]!;
  } catch (error) {
    canonicalUniqueFailure(error);
  }
}

export async function createServiceEnvironment(input: {
  tx: Transaction;
  serviceId: string;
  key: string;
  name: string;
}) {
  canonicalId(input.serviceId, "service_id");
  const service = await input.tx.query<CatalogRow>(
    "SELECT * FROM service.services WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.serviceId],
  );
  if (!service.rowCount)
    throw new ApplicationError("NOT_FOUND", "SERVICE was not found.");
  if (service.rows[0]!.state !== "ACTIVE")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "A new environment must belong to an active Service.",
    );
  try {
    const result = await input.tx.query<CatalogRow>(
      `INSERT INTO service.environments(id,tenant_id,service_id,key,name)
     VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [
        randomUUID(),
        input.tx.tenantId,
        input.serviceId,
        keyValue(input.key),
        required(input.name, "name"),
      ],
    );
    return result.rows[0]!;
  } catch (error) {
    if ((error as { code?: string })?.code === "23503")
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "service_id must reference a canonical Service in this tenant.",
      );
    canonicalUniqueFailure(error);
  }
}

export async function updateCatalog(input: {
  tx: Transaction;
  kind: CatalogKind;
  id: string;
  expectedVersion: number;
  changes: Record<string, string | null>;
}) {
  const current = await readById(input.tx, input.kind, input.id);
  assertVersion(current.version, input.expectedVersion);
  if (current.state !== "ACTIVE")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Inactive reference data cannot be edited.",
    );
  const allowed: Record<CatalogKind, readonly string[]> = {
    SERVICE: ["key", "name", "description"],
    PLATFORM: ["key", "family", "name", "major_version"],
    SERVICE_ENVIRONMENT: ["key", "name"],
  };
  const fields = Object.keys(input.changes);
  if (
    !fields.length ||
    fields.some((field) => !allowed[input.kind].includes(field))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported catalog changes.",
    );
  const values: unknown[] = [];
  const assignments = fields.map((field, index) => {
    const value = input.changes[field];
    if (field === "key") values.push(keyValue(value ?? ""));
    else if (field === "name") values.push(required(value ?? "", "name"));
    else if (field === "family") {
      if (!(PLATFORM_FAMILIES as readonly string[]).includes(value ?? ""))
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "Platform family is invalid.",
        );
      values.push(value);
    } else values.push(value?.trim() || null);
    return `${field}=$${index + 1}`;
  });
  values.push(
    input.expectedVersion + 1,
    input.tx.tenantId,
    input.id,
    input.expectedVersion,
  );
  let updated;
  try {
    updated = await input.tx.query<CatalogRow>(
      `UPDATE ${tables[input.kind]} SET ${assignments.join(",")},version=$${fields.length + 1},updated_at=now()
     WHERE tenant_id=$${fields.length + 2} AND id=$${fields.length + 3} AND version=$${fields.length + 4}
     RETURNING *`,
      values,
    );
  } catch (error) {
    canonicalUniqueFailure(error);
  }
  if (!updated.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Reference version has changed.",
    );
  return updated.rows[0]!;
}

export async function deactivateCatalog(input: {
  tx: Transaction;
  kind: CatalogKind;
  id: string;
  expectedVersion: number;
}) {
  const current = await readById(input.tx, input.kind, input.id);
  assertVersion(current.version, input.expectedVersion);
  if (current.state !== "ACTIVE")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Reference is already inactive.",
    );
  const result = await input.tx.query<CatalogRow>(
    `UPDATE ${tables[input.kind]} SET state='INACTIVE',version=version+1,updated_at=now()
     WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *`,
    [input.tx.tenantId, input.id, input.expectedVersion],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Reference version has changed.",
    );
  return { before: current, after: result.rows[0]! };
}

export async function resolveObservedPlatform(input: {
  tx: Transaction;
  observed: string;
}): Promise<
  { status: "RESOLVED"; platform: CatalogRow } | { status: "UNRESOLVED" }
> {
  const normalized = input.observed
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
  if (!normalized) return { status: "UNRESOLVED" };
  const result = await input.tx.query<CatalogRow>(
    "SELECT * FROM service.platforms WHERE tenant_id=$1 AND state='ACTIVE'",
    [input.tx.tenantId],
  );
  const matches = result.rows.filter((row) =>
    [row.key, row.name].some(
      (candidate) =>
        String(candidate)
          .normalize("NFKC")
          .trim()
          .replace(/\s+/g, " ")
          .toLocaleLowerCase("en-US") === normalized,
    ),
  );
  return matches.length === 1
    ? { status: "RESOLVED", platform: matches[0]! }
    : { status: "UNRESOLVED" };
}

export interface ServiceQueryPort {
  get(
    tenantId: string,
    serviceId: string,
  ): Promise<{
    id: string;
    tenant_id: string;
    key: string;
    name: string;
    state: "ACTIVE" | "INACTIVE";
  } | null>;
}
export interface PlatformQueryPort {
  get(
    tenantId: string,
    platformId: string,
  ): Promise<{
    id: string;
    tenant_id: string;
    key: string;
    name: string;
    family: PlatformFamily;
    state: "ACTIVE" | "INACTIVE";
  } | null>;
}
export interface ServiceEnvironmentQueryPort {
  get(
    tenantId: string,
    environmentId: string,
  ): Promise<{
    id: string;
    tenant_id: string;
    service_id: string;
    key: string;
    name: string;
    state: "ACTIVE" | "INACTIVE";
  } | null>;
}

export function serviceQueryPort(tx: Transaction): ServiceQueryPort {
  return {
    async get(tenantId, serviceId) {
      if (tenantId !== tx.tenantId) return null;
      const result = await tx.query<{
        id: string;
        tenant_id: string;
        key: string;
        name: string;
        state: "ACTIVE" | "INACTIVE";
      }>(
        "SELECT id,tenant_id,key,name,state FROM service.services WHERE tenant_id=$1 AND id=$2",
        [tenantId, serviceId],
      );
      return result.rows[0] ?? null;
    },
  };
}

export function platformQueryPort(tx: Transaction): PlatformQueryPort {
  return {
    async get(tenantId, platformId) {
      if (tenantId !== tx.tenantId) return null;
      const result = await tx.query<{
        id: string;
        tenant_id: string;
        key: string;
        name: string;
        family: PlatformFamily;
        state: "ACTIVE" | "INACTIVE";
      }>(
        "SELECT id,tenant_id,key,name,family,state FROM service.platforms WHERE tenant_id=$1 AND id=$2",
        [tenantId, platformId],
      );
      return result.rows[0] ?? null;
    },
  };
}

export function serviceEnvironmentQueryPort(
  tx: Transaction,
): ServiceEnvironmentQueryPort {
  return {
    async get(tenantId, environmentId) {
      if (tenantId !== tx.tenantId) return null;
      const result = await tx.query<{
        id: string;
        tenant_id: string;
        service_id: string;
        key: string;
        name: string;
        state: "ACTIVE" | "INACTIVE";
      }>(
        "SELECT id,tenant_id,service_id,key,name,state FROM service.environments WHERE tenant_id=$1 AND id=$2",
        [tenantId, environmentId],
      );
      return result.rows[0] ?? null;
    },
  };
}
