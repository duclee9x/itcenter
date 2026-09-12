import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { EventEnvelope } from "../../../packages/event-contracts/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { AuthorizationPort } from "../../../packages/auth/src/index.js";
import {
  consume,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import { registerReceivedAsset } from "../../../modules/asset/index.js";
import {
  readReceivedUnitForAssetRegistration,
  recordAssetization,
} from "../../../modules/procurement/index.js";
import {
  upsertAssetLifecycleWorkItem,
  recordAssetLifecycleTimelineEvent,
} from "../../../modules/work-queue/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import type { WorkerTask } from "./host.js";

const CONSUMER = "goods-receipt-assetizer";
const MAX_ATTEMPTS = 5;
const assetRegistrationAuthorization: AuthorizationPort = {
  async evaluate(request) {
    const trustedCommand =
      request.principal.id === "goods-receipt-assetizer" &&
      request.principal.actor_type === "SYSTEM" &&
      request.action === "asset.receive" &&
      request.resource.type === "asset" &&
      request.context.source_event_type === "GOODS_RECEIPT.POSTED" &&
      request.context.received_unit_id === request.resource.id;
    return {
      result: trustedCommand ? "ALLOW" : "DENY",
      reason: trustedCommand
        ? "trusted_receipt_assetization"
        : "service_scope_denied",
    };
  },
};
function wait(signal: AbortSignal, delay: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delay);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function processGoodsReceiptAssetizationUnit(
  uow: UnitOfWork,
  event: EventEnvelope,
  unitId: string,
): Promise<void> {
  const consumer = `${CONSUMER}:${unitId}`;
  await consume(uow, consumer, event, async (tx, committed) => {
    const received = await readReceivedUnitForAssetRegistration(tx, unitId);
    const asset = await registerReceivedAsset({
      tx,
      receivedUnitId: unitId,
      goodsReceiptId: String(received.goods_receipt_id),
      modelId: String(received.asset_model_id),
      serialNumber: String(received.serial_number),
      locationId: String(received.location_id),
      actorId: "goods-receipt-assetizer",
      correlationId: committed.correlation_id,
      authorization: assetRegistrationAuthorization,
      principal: {
        id: "goods-receipt-assetizer",
        tenant_id: tx.tenantId,
        actor_type: "SYSTEM",
      },
    });
    await recordAssetization(tx, {
      receivedUnitId: unitId,
      status: "REGISTERED",
      assetId: asset.id,
    });
    if (asset.created) {
      const eventId = randomUUID(),
        occurredAt = new Date().toISOString();
      const payload = {
        asset_id: asset.id,
        asset_code: asset.asset_code,
        asset_model_id: received.asset_model_id,
        serial_number: received.serial_number,
        source: "GOODS_RECEIPT",
        lifecycle_state: "RECEIVED",
        assignment_state: "UNASSIGNED",
        current_location_id: received.location_id,
        goods_receipt_id: received.goods_receipt_id,
        received_unit_id: unitId,
      };
      await new PostgresOutboxWriter(tx).append({
        event_id: eventId,
        event_type: "ASSET.CREATED",
        schema_version: 1,
        occurred_at: occurredAt,
        producer: { service: "worker", instance: CONSUMER },
        aggregate: { type: "ASSET", id: asset.id, version: 1 },
        actor: { type: "SYSTEM", id: "goods-receipt-assetizer" },
        correlation_id: committed.correlation_id,
        causation_id: committed.event_id,
        tenant_id: tx.tenantId,
        organization_id: tx.tenantId,
        idempotency_key: `asset_register_received:${tx.tenantId}:${unitId}`,
        payload,
      });
      await new PostgresAudit(tx).append({
        id: randomUUID(),
        tenant_id: tx.tenantId,
        event_type: "ASSET.CREATED",
        occurred_at: occurredAt,
        actor: { type: "SYSTEM", id: "goods-receipt-assetizer" },
        action: {
          command_type: "ASSET.REGISTER_RECEIVED",
          idempotency_key: `asset_register_received:${tx.tenantId}:${unitId}`,
        },
        subject: { entity_type: "ASSET", entity_id: asset.id },
        correlation_id: committed.correlation_id,
        causation_id: committed.event_id,
        reason: {
          code: "ASSET.REGISTER_RECEIVED",
          text: `Registered received unit ${unitId}`,
        },
        before: null,
        after: payload,
        outcome: { status: "SUCCESS" },
        classification: "INTERNAL",
        relations: [
          {
            entity_type: "GOODS_RECEIPT",
            entity_id: String(received.goods_receipt_id),
            relation: "RECEIVED_FROM",
          },
        ],
        evidence: [],
      });
      await recordAssetLifecycleTimelineEvent({
        tx,
        assetId: asset.id,
        eventType: "ASSET.CREATED",
        summary: `Asset ${asset.asset_code} registered from Goods Receipt`,
        payload,
        sourceEventId: eventId,
      });
    }
  });
}

export function goodsReceiptAssetizerTask(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  reportFailure?: () => void;
}): WorkerTask {
  return {
    name: "goods-receipt-assetizer",
    async run(signal) {
      while (!signal.aborted) {
        try {
          const pending = await input.pool.query<{
            payload: EventEnvelope;
          }>(`SELECT o.payload FROM platform.outbox_events o
          WHERE o.event_type='GOODS_RECEIPT.POSTED' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(o.payload->'payload'->'received_unit_ids') u(unit_id)
            JOIN procurement.receipt_assetization_state s ON s.tenant_id=o.tenant_id AND s.received_unit_id=u.unit_id::uuid
            WHERE s.status='PENDING' AND s.next_attempt_at<=now())
          ORDER BY o.created_at,o.id LIMIT 25`);
          if (!pending.rowCount) {
            await wait(signal, 1000);
            continue;
          }
          for (const { payload: pendingEvent } of pending.rows) {
            // Outbox rows store PendingEvent; stamp delivery metadata at consumption.
            const event = {
              ...pendingEvent,
              published_at: new Date().toISOString(),
            };
            if (signal.aborted) break;
            const unitIds = event.payload.received_unit_ids;
            if (!Array.isArray(unitIds)) continue;
            for (const value of unitIds) {
              if (signal.aborted) break;
              const unitId = String(value);
              const state = await input.pool.query<{
                received_unit_id: string;
              }>(
                "SELECT received_unit_id FROM procurement.receipt_assetization_state WHERE tenant_id=$1 AND received_unit_id=$2 AND status='PENDING' AND next_attempt_at<=now()",
                [event.tenant_id, unitId],
              );
              if (!state.rowCount) continue;
              try {
                await processGoodsReceiptAssetizationUnit(
                  input.uow,
                  event,
                  unitId,
                );
              } catch (error) {
                input.reportFailure?.();
                const permanent =
                  error instanceof ApplicationError &&
                  [
                    "BUSINESS_RULE_VIOLATION",
                    "NOT_FOUND",
                    "VALIDATION_ERROR",
                  ].includes(error.code);
                await input.uow.run(event.tenant_id, async (tx) => {
                  const code =
                    error instanceof ApplicationError
                      ? error.code
                      : "ASSET_REGISTRATION_DEPENDENCY_FAILED";
                  const failure = await tx.query<{ attempt_count: number }>(
                    "UPDATE procurement.receipt_assetization_state SET attempt_count=attempt_count+1,failure_code=$1,updated_at=now() WHERE tenant_id=$2 AND received_unit_id=$3 AND status='PENDING' RETURNING attempt_count",
                    [code, tx.tenantId, unitId],
                  );
                  const attempt = Number(
                    failure.rows[0]?.attempt_count ?? MAX_ATTEMPTS,
                  );
                  const exhausted = permanent || attempt >= MAX_ATTEMPTS;
                  await tx.query(
                    "UPDATE procurement.receipt_assetization_state SET status=$1,next_attempt_at=CASE WHEN $1='PENDING' THEN now()+make_interval(secs=>LEAST(300,power(2,LEAST(attempt_count,8))::integer)) ELSE now() END,updated_at=now() WHERE tenant_id=$2 AND received_unit_id=$3 AND status='PENDING'",
                    [exhausted ? "FAILED" : "PENDING", tx.tenantId, unitId],
                  );
                  if (exhausted)
                    await upsertAssetLifecycleWorkItem({
                      tx,
                      sourceId: unitId,
                      title: `Asset registration needs review for received unit ${unitId}: ${code}`,
                      priority: "HIGH",
                    });
                });
              }
            }
          }
        } catch {
          input.reportFailure?.();
          await wait(signal, 2000);
        }
      }
    },
  };
}
