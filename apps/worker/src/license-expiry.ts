import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Config } from "../../../packages/config/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import { PostgresOutboxWriter } from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  recordDueEntitlementExpiryFacts,
  recordUpcomingEntitlementExpiringFacts,
} from "../../../modules/license/index.js";
import type { WorkerTask } from "./host.js";

type ExpiryFact = {
  entitlement_id: string;
  term_version: number;
  valid_until: string;
  expired_at: string;
};
type ExpiringFact = {
  entitlement_id: string;
  term_version: number;
  valid_until: string;
  notice_days: number;
  emitted_at: string;
};

async function writeFact(input: {
  tx: Transaction;
  config: Config;
  tenantId: string;
  eventType: "LICENSE.EXPIRING" | "LICENSE.EXPIRED";
  fact: ExpiryFact | ExpiringFact;
}) {
  const now =
    "expired_at" in input.fact ? input.fact.expired_at : input.fact.emitted_at;
  const correlationId = randomUUID();
  const idempotencyKey = `license-${input.eventType.toLowerCase()}:${input.fact.entitlement_id}:${input.fact.term_version}`;
  const payload =
    input.eventType === "LICENSE.EXPIRED"
      ? {
          entitlement_id: input.fact.entitlement_id,
          term_version: input.fact.term_version,
          expired_at: (input.fact as ExpiryFact).expired_at,
          valid_until: input.fact.valid_until,
        }
      : {
          entitlement_id: input.fact.entitlement_id,
          valid_until: input.fact.valid_until,
          days_remaining: Math.max(
            0,
            Math.ceil(
              (Date.parse(input.fact.valid_until) - Date.parse(now)) /
                86_400_000,
            ),
          ),
          usage_summary: null,
        };
  await new PostgresOutboxWriter(input.tx).append({
    event_id: randomUUID(),
    event_type: input.eventType,
    schema_version: 1,
    occurred_at: now,
    producer: { service: input.config.serviceName, instance: "worker" },
    aggregate: {
      type: "LICENSE_ENTITLEMENT",
      id: input.fact.entitlement_id,
      version: input.fact.term_version,
    },
    actor: { type: "SYSTEM", id: null },
    correlation_id: correlationId,
    causation_id: "license-entitlement-expiry-scheduler",
    tenant_id: input.tenantId,
    organization_id: input.tenantId,
    idempotency_key: idempotencyKey,
    payload,
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.tenantId,
    event_type: input.eventType,
    occurred_at: now,
    actor: { type: "SYSTEM", id: null },
    action: {
      command_type:
        input.eventType === "LICENSE.EXPIRED"
          ? "LICENSE.ENTITLEMENT_EXPIRY_RECORDED"
          : "LICENSE.ENTITLEMENT_EXPIRY_WARNING_RECORDED",
    },
    subject: {
      entity_type: "LICENSE_ENTITLEMENT",
      entity_id: input.fact.entitlement_id,
    },
    correlation_id: correlationId,
    causation_id: "license-entitlement-expiry-scheduler",
    reason: {
      code:
        input.eventType === "LICENSE.EXPIRED"
          ? "ENTITLEMENT_TERM_EXPIRED"
          : "ENTITLEMENT_RENEWAL_NOTICE",
      text:
        input.eventType === "LICENSE.EXPIRED"
          ? "The entitlement validity term has ended."
          : "The entitlement reached its configured renewal notice window.",
    },
    before: {
      term_version: input.fact.term_version,
      valid_until: input.fact.valid_until,
    },
    after:
      input.eventType === "LICENSE.EXPIRED"
        ? {
            effective_state: "EXPIRED",
            expired_at: (input.fact as ExpiryFact).expired_at,
          }
        : {
            notice_days: (input.fact as ExpiringFact).notice_days,
            event: "LICENSE.EXPIRING",
          },
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
}

export function licenseExpiryTask(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  config: Config;
  reportFailure: () => void;
}): WorkerTask {
  return {
    name: "license-entitlement-expiry",
    async run(signal) {
      while (!signal.aborted) {
        try {
          const tenants = await input.pool.query<{ tenant_id: string }>(
            `SELECT tenant_id FROM (
               SELECT t.tenant_id
                 FROM license.entitlement_terms t
                WHERE t.valid_until IS NOT NULL AND t.valid_until<=now()
                  AND NOT EXISTS (
                    SELECT 1 FROM license.entitlement_expiry_facts f
                     WHERE f.tenant_id=t.tenant_id
                       AND f.entitlement_id=t.entitlement_id
                       AND f.term_version=t.term_version)
               UNION
               SELECT e.tenant_id
                 FROM license.license_entitlements e
                 JOIN license.entitlement_terms t
                   ON t.tenant_id=e.tenant_id AND t.entitlement_id=e.id
                  AND t.term_version=e.current_term_version
                WHERE e.renewal_notice_days>0 AND t.valid_until>now()
                  AND t.valid_until<=now()+e.renewal_notice_days*interval '1 day'
                  AND NOT EXISTS (
                    SELECT 1 FROM license.entitlement_expiring_facts f
                     WHERE f.tenant_id=t.tenant_id
                       AND f.entitlement_id=t.entitlement_id
                       AND f.term_version=t.term_version)
             ) due ORDER BY tenant_id LIMIT 1000`,
          );
          for (const { tenant_id: tenantId } of tenants.rows) {
            if (signal.aborted) break;
            await input.uow.run(tenantId, async (tx) => {
              const expiring = await recordUpcomingEntitlementExpiringFacts({
                tx,
              });
              for (const fact of expiring)
                await writeFact({
                  tx,
                  config: input.config,
                  tenantId,
                  eventType: "LICENSE.EXPIRING",
                  fact,
                });
              const expired = await recordDueEntitlementExpiryFacts({ tx });
              for (const fact of expired)
                await writeFact({
                  tx,
                  config: input.config,
                  tenantId,
                  eventType: "LICENSE.EXPIRED",
                  fact,
                });
            });
          }
        } catch {
          input.reportFailure();
        }
        if (signal.aborted) break;
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, 60_000);
          signal.addEventListener("abort", finish, { once: true });
        });
      }
    },
  };
}
