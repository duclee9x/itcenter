import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import {
  authorize,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { PostgresOutboxWriter } from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../audit/index.js";

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export async function saveAssetReplacementPolicy(input: {
  tx: Transaction;
  categoryId: string;
  expectedLifeMonths: number;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
  actor: Principal;
  authorization: AuthorizationPort;
  correlationId: string;
  serviceName: string;
}) {
  if (
    !Number.isSafeInteger(input.expectedLifeMonths) ||
    input.expectedLifeMonths <= 0 ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    !input.idempotencyKey.trim() ||
    !input.reason.trim()
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A positive useful-life policy, reason, version and idempotency key are required.",
    );
  await input.tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `asset-replacement-policy-idem:${input.tx.tenantId}:${input.idempotencyKey}`,
  ]);
  await authorize(input.authorization, {
    principal: input.actor,
    action: "asset.scoring.manage_policy",
    resource: {
      type: "asset_replacement_policy",
      id: input.categoryId,
      tenant_id: input.tx.tenantId,
    },
    scope: { category: input.categoryId, tenant: input.tx.tenantId },
    context: { correlation_id: input.correlationId },
  });
  const replay = await input.tx.query<{
    id: string;
    category_id: string;
    expected_life_months: number;
    version: number;
    reason: string;
  }>(
    "SELECT id,category_id,expected_life_months,version,reason FROM asset.replacement_policies WHERE tenant_id=$1 AND idempotency_key=$2",
    [input.tx.tenantId, input.idempotencyKey],
  );
  if (replay.rowCount) {
    const row = replay.rows[0]!;
    if (
      row.category_id !== input.categoryId ||
      Number(row.expected_life_months) !== input.expectedLifeMonths ||
      row.reason !== input.reason
    )
      throw new ApplicationError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "The policy idempotency key was used with different input.",
      );
    return { id: String(row.id), version: Number(row.version), created: false };
  }
  await input.tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `replacement-policy:${input.tx.tenantId}:${input.categoryId}`,
  ]);
  const category = await input.tx.query(
    "SELECT id FROM asset.categories WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.categoryId],
  );
  if (!category.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Asset category was not found in this tenant.",
    );
  const current = await input.tx.query<{ version: number }>(
    "SELECT COALESCE(max(version),0)::integer AS version FROM asset.replacement_policies WHERE tenant_id=$1 AND category_id=$2",
    [input.tx.tenantId, input.categoryId],
  );
  assertVersion(Number(current.rows[0]!.version), input.expectedVersion);
  const id = randomUUID();
  const version = input.expectedVersion + 1;
  await input.tx.query(
    `INSERT INTO asset.replacement_policies
      (id,tenant_id,category_id,version,expected_life_months,created_by_type,created_by_id,reason,idempotency_key)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      input.tx.tenantId,
      input.categoryId,
      version,
      input.expectedLifeMonths,
      input.actor.actor_type,
      input.actor.id,
      input.reason,
      input.idempotencyKey,
    ],
  );
  const now = new Date().toISOString();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: randomUUID(),
    event_type: "ASSET.REPLACEMENT_POLICY_VERSIONED",
    schema_version: 1,
    occurred_at: now,
    producer: { service: input.serviceName, instance: "asset-scoring-policy" },
    aggregate: { type: "ASSET_REPLACEMENT_POLICY", id, version },
    actor: { type: input.actor.actor_type, id: input.actor.id },
    correlation_id: input.correlationId,
    causation_id: input.idempotencyKey,
    tenant_id: input.tx.tenantId,
    organization_id: input.tx.tenantId,
    idempotency_key: `replacement-policy:${input.idempotencyKey}`,
    payload: {
      category_id: input.categoryId,
      policy_id: id,
      version,
      expected_life_months: input.expectedLifeMonths,
    } as never,
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.tx.tenantId,
    event_type: "ASSET.REPLACEMENT_POLICY_VERSIONED",
    occurred_at: now,
    actor: { type: input.actor.actor_type, id: input.actor.id },
    action: { command_type: "ASSET.REPLACEMENT_POLICY.VERSION" },
    subject: { entity_type: "ASSET_REPLACEMENT_POLICY", entity_id: id },
    correlation_id: input.correlationId,
    causation_id: input.idempotencyKey,
    reason: { code: "USEFUL_LIFE_POLICY_CHANGE", text: input.reason },
    before: null,
    after: {
      category_id: input.categoryId,
      version,
      expected_life_months: input.expectedLifeMonths,
    },
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
  return { id, version, created: true };
}

export async function recordVerifiedAcquisitionDate(input: {
  tx: Transaction;
  assetId: string;
  acquiredOn: string;
  expectedAssetVersion: number;
  sourceReference: string;
  reason: string;
  idempotencyKey: string;
  actor: Principal;
  authorization: AuthorizationPort;
  correlationId: string;
  serviceName: string;
}) {
  if (
    !validDate(input.acquiredOn) ||
    !input.sourceReference.trim() ||
    !input.reason.trim() ||
    !input.idempotencyKey.trim()
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid verified acquisition date, source, reason and idempotency key are required.",
    );
  await input.tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `asset-acquisition-idem:${input.tx.tenantId}:${input.idempotencyKey}`,
  ]);
  await authorize(input.authorization, {
    principal: input.actor,
    action: "asset.acquisition.verify",
    resource: {
      type: "asset",
      id: input.assetId,
      tenant_id: input.tx.tenantId,
    },
    scope: { asset: input.assetId, tenant: input.tx.tenantId },
    context: { correlation_id: input.correlationId },
  });
  const replay = await input.tx.query<{
    id: string;
    acquired_on: string;
    asset_id: string;
    source_reference: string;
    reason: string;
  }>(
    "SELECT id,acquired_on::text,asset_id,source_reference,reason FROM asset.acquisition_evidence WHERE tenant_id=$1 AND idempotency_key=$2",
    [input.tx.tenantId, input.idempotencyKey],
  );
  if (replay.rowCount) {
    const row = replay.rows[0]!;
    if (
      row.asset_id !== input.assetId ||
      row.acquired_on !== input.acquiredOn ||
      row.source_reference !== input.sourceReference ||
      row.reason !== input.reason
    )
      throw new ApplicationError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "The acquisition idempotency key was used with different input.",
      );
    return { id: String(row.id), created: false };
  }
  const asset = await input.tx.query<{ version: number }>(
    "SELECT version FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.assetId],
  );
  if (!asset.rowCount)
    throw new ApplicationError("NOT_FOUND", "Asset was not found.");
  assertVersion(Number(asset.rows[0]!.version), input.expectedAssetVersion);
  if (input.acquiredOn > new Date().toISOString().slice(0, 10))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Verified acquisition date cannot be in the future.",
    );
  const id = randomUUID();
  await input.tx.query(
    `INSERT INTO asset.acquisition_evidence
      (id,tenant_id,asset_id,acquired_on,provenance_type,source_reference,actor_type,actor_id,reason,idempotency_key)
     VALUES($1,$2,$3,$4,'MANUAL_VERIFIED',$5,$6,$7,$8,$9)`,
    [
      id,
      input.tx.tenantId,
      input.assetId,
      input.acquiredOn,
      input.sourceReference,
      input.actor.actor_type,
      input.actor.id,
      input.reason,
      input.idempotencyKey,
    ],
  );
  await input.tx.query(
    "UPDATE asset.assets SET version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.assetId],
  );
  const now = new Date().toISOString();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: randomUUID(),
    event_type: "ASSET.ACQUISITION_DATE_VERIFIED",
    schema_version: 1,
    occurred_at: now,
    producer: {
      service: input.serviceName,
      instance: "asset-acquisition-evidence",
    },
    aggregate: {
      type: "ASSET",
      id: input.assetId,
      version: Number(asset.rows[0]!.version) + 1,
    },
    actor: { type: input.actor.actor_type, id: input.actor.id },
    correlation_id: input.correlationId,
    causation_id: input.idempotencyKey,
    tenant_id: input.tx.tenantId,
    organization_id: input.tx.tenantId,
    idempotency_key: `asset-acquisition:${input.idempotencyKey}`,
    payload: {
      asset_id: input.assetId,
      evidence_id: id,
      acquired_on: input.acquiredOn,
      provenance_type: "MANUAL_VERIFIED",
      source_reference: input.sourceReference,
    } as never,
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.tx.tenantId,
    event_type: "ASSET.ACQUISITION_DATE_VERIFIED",
    occurred_at: now,
    actor: { type: input.actor.actor_type, id: input.actor.id },
    action: { command_type: "ASSET.ACQUISITION_DATE.VERIFY" },
    subject: { entity_type: "ASSET", entity_id: input.assetId },
    correlation_id: input.correlationId,
    causation_id: input.idempotencyKey,
    reason: { code: "VERIFIED_ACQUISITION_DATE", text: input.reason },
    before: null,
    after: {
      evidence_id: id,
      acquired_on: input.acquiredOn,
      source_reference: input.sourceReference,
    },
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [
      {
        type: "ACQUISITION_SOURCE",
        id: input.sourceReference,
        checksum: createHash("sha256")
          .update(input.sourceReference)
          .digest("hex"),
        relation: "SUPPORTS",
      },
    ],
  });
  return {
    id,
    created: true,
    asset_version: Number(asset.rows[0]!.version) + 1,
  };
}
