import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { Config } from "../../../packages/config/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import { PostgresOutboxWriter } from "../../../packages/messaging/src/index.js";
import {
  executeContractCommand,
  resolveContractAlertConfiguration,
} from "../../../modules/contract/index.js";
import {
  upsertContractAlertExceptionWorkItem,
  upsertContractAlertWorkItem,
} from "../../../modules/work-queue/index.js";
import type { WorkerTask } from "./host.js";

const ACTOR = "contract-alert-scheduler";
const MAX_BATCH = 50;

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

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function appendContractAlertEvent(input: {
  tx: Transaction;
  config: Config;
  eventId: string;
  eventType: string;
  aggregateId: string;
  version: number;
  correlationId: string;
  payload: Record<string, unknown>;
  reason: string;
}) {
  const at = new Date().toISOString();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: input.eventId,
    event_type: input.eventType,
    schema_version: 1,
    occurred_at: at,
    producer: {
      service: input.config.serviceName,
      instance: "contract-alert-scheduler",
    },
    aggregate: {
      type: "CONTRACT",
      id: input.aggregateId,
      version: input.version,
    },
    actor: { type: "SYSTEM", id: ACTOR },
    correlation_id: input.correlationId,
    causation_id: "contract-alert-scheduler",
    tenant_id: input.tx.tenantId,
    organization_id: input.tx.tenantId,
    idempotency_key: `${input.eventType}:${input.aggregateId}:${String(input.payload.contract_version_id ?? input.version)}:${String(input.payload.trigger_at ?? "")}`,
    payload: input.payload as never,
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.tx.tenantId,
    event_type: input.eventType,
    occurred_at: at,
    actor: { type: "SYSTEM", id: ACTOR },
    action: { command_type: input.eventType },
    subject: { entity_type: "CONTRACT", entity_id: input.aggregateId },
    correlation_id: input.correlationId,
    causation_id: "contract-alert-scheduler",
    reason: { code: input.eventType, text: input.reason },
    before: null,
    after: input.payload as never,
    outcome: { status: "SUCCESS" },
    classification: "CONFIDENTIAL",
    relations: [],
    evidence: [],
  });
  await input.tx.query(
    `INSERT INTO operations.timeline_events(id,tenant_id,entity_type,entity_id,event_type,summary,payload,source_event_id)
     VALUES($1,$2,'CONTRACT',$3,$4,$5,$6::jsonb,$7)`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.aggregateId,
      input.eventType,
      input.reason,
      JSON.stringify(input.payload),
      input.eventId,
    ],
  );
}

async function scheduleForContract(input: {
  tx: Transaction;
  config: Config;
  contract: Record<string, unknown>;
  version: Record<string, unknown>;
  now: Date;
}) {
  const snapshot = input.version.commercial_snapshot as Record<string, unknown>;
  const configured = resolveContractAlertConfiguration({
    effective_at: String(input.contract.effective_at),
    end_at: String(input.contract.end_at),
    renewal_notice_date: snapshot.renewal_notice_date,
    renewal_notice_period_days: snapshot.renewal_notice_period_days,
  });
  const contractId = String(input.contract.id);
  const versionId = String(input.version.id);
  const correlationId = String(input.contract.correlation_id ?? randomUUID());
  if (!configured.valid) {
    const fingerprint = hash({
      version: versionId,
      snapshot,
      error: configured.errorCode,
    });
    const exceptionId = randomUUID();
    const eventId = randomUUID();
    const inserted = await input.tx.query(
      `INSERT INTO contract.alert_configuration_exceptions
         (id,tenant_id,contract_id,contract_version_id,configuration_fingerprint,error_code,details,event_id,correlation_id)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
       ON CONFLICT(tenant_id,contract_id,contract_version_id,configuration_fingerprint) DO NOTHING
       RETURNING id`,
      [
        exceptionId,
        input.tx.tenantId,
        contractId,
        versionId,
        fingerprint,
        configured.errorCode,
        JSON.stringify({ field: configured.field }),
        eventId,
        correlationId,
      ],
    );
    if (inserted.rowCount) {
      const code = String(input.contract.contract_code);
      await upsertContractAlertExceptionWorkItem({
        tx: input.tx,
        exceptionId,
        contractCode: code,
      });
      await appendContractAlertEvent({
        tx: input.tx,
        config: input.config,
        eventId,
        eventType: "CONTRACT.ALERT_CONFIGURATION_INVALID",
        aggregateId: contractId,
        version: Number(input.contract.version),
        correlationId,
        payload: {
          contract_id: contractId,
          contract_version_id: versionId,
          error_code: configured.errorCode,
          field: configured.field,
          exception_id: exceptionId,
        },
        reason: `Contract ${code} renewal alert configuration is invalid (${configured.field}).`,
      });
    }
    return;
  }
  const trigger = configured.trigger;
  if (!trigger || Date.parse(trigger.triggerAt) > input.now.getTime()) return;
  const alertId = randomUUID();
  const eventId = randomUUID();
  const inserted = await input.tx.query(
    `INSERT INTO contract.alert_facts
      (id,tenant_id,contract_id,contract_version_id,trigger_type,trigger_source,trigger_at,event_id,correlation_id)
     VALUES($1,$2,$3,$4,'RENEWAL_NOTICE',$5,$6,$7,$8)
     ON CONFLICT(tenant_id,contract_id,contract_version_id,trigger_type,trigger_at) DO NOTHING
     RETURNING id`,
    [
      alertId,
      input.tx.tenantId,
      contractId,
      versionId,
      trigger.source,
      trigger.triggerAt,
      eventId,
      correlationId,
    ],
  );
  if (!inserted.rowCount) return;
  const code = String(input.contract.contract_code);
  const payload = {
    contract_id: contractId,
    contract_version_id: versionId,
    trigger_type: "RENEWAL_NOTICE",
    trigger_at: trigger.triggerAt,
    trigger_source: trigger.source,
    alert_id: alertId,
  };
  await upsertContractAlertWorkItem({
    tx: input.tx,
    alertId,
    contractCode: code,
    triggerAt: trigger.triggerAt,
  });
  await appendContractAlertEvent({
    tx: input.tx,
    config: input.config,
    eventId,
    eventType: "CONTRACT.RENEWAL_NOTICE_DUE",
    aggregateId: contractId,
    version: Number(input.contract.version),
    correlationId,
    payload,
    reason: `Contract ${code} renewal action is due.`,
  });
}

async function expireContract(input: {
  tx: Transaction;
  config: Config;
  contract: Record<string, unknown>;
}) {
  const contractId = String(input.contract.id);
  const correlationId = randomUUID();
  const result = await executeContractCommand({
    tx: input.tx,
    command: "CONTRACT.EXPIRE",
    id: contractId,
    expectedVersion: Number(input.contract.version),
    body: {},
    actorId: ACTOR,
    correlationId,
  });
  for (const event of result.events ?? []) {
    const eventId = randomUUID();
    const at = new Date().toISOString();
    await new PostgresOutboxWriter(input.tx).append({
      event_id: eventId,
      event_type: event.type,
      schema_version: 1,
      occurred_at: at,
      producer: { service: input.config.serviceName, instance: ACTOR },
      aggregate: {
        type: "CONTRACT",
        id: event.aggregateId,
        version: event.version,
      },
      actor: { type: "SYSTEM", id: ACTOR },
      correlation_id: correlationId,
      causation_id: "contract-expiry-scheduler",
      tenant_id: input.tx.tenantId,
      organization_id: input.tx.tenantId,
      idempotency_key: `contract-expiry:${contractId}:${String(input.contract.current_version_id)}`,
      payload: event.payload as never,
    });
    await new PostgresAudit(input.tx).append({
      id: randomUUID(),
      tenant_id: input.tx.tenantId,
      event_type: event.type,
      occurred_at: at,
      actor: { type: "SYSTEM", id: ACTOR },
      action: { command_type: "CONTRACT.EXPIRE" },
      subject: { entity_type: "CONTRACT", entity_id: contractId },
      correlation_id: correlationId,
      causation_id: "contract-expiry-scheduler",
      reason: {
        code: "CONTRACT_TERM_ENDED",
        text: "Contract reached its contractual end date.",
      },
      before: event.before as never,
      after: event.after as never,
      outcome: { status: "SUCCESS" },
      classification: "CONFIDENTIAL",
      relations: [],
      evidence: [],
    });
  }
}

export async function processContractAlertAndExpiryBatch(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  config: Config;
  now?: Date;
  reportFailure?: () => void;
}) {
  const now = input.now ?? new Date();
  const alerts = await input.pool.query<{
    tenant_id: string;
    contract_id: string;
  }>(
    `SELECT c.tenant_id,c.id AS contract_id
       FROM contract.contracts c
       JOIN contract.contract_versions v ON v.tenant_id=c.tenant_id AND v.id=c.current_version_id
      WHERE c.lifecycle_state IN ('EXECUTED','ACTIVE')
      ORDER BY c.end_at,c.id LIMIT $1`,
    [MAX_BATCH],
  );
  for (const candidate of alerts.rows) {
    await input.uow
      .run(candidate.tenant_id, async (tx) => {
        const rows = await tx.query(
          `SELECT c.*,v.id AS alert_version_id,v.commercial_snapshot,v.fingerprint
           FROM contract.contracts c JOIN contract.contract_versions v
             ON v.tenant_id=c.tenant_id AND v.contract_id=c.id AND v.id=c.current_version_id
          WHERE c.tenant_id=$1 AND c.id=$2 AND c.lifecycle_state IN ('EXECUTED','ACTIVE')
          FOR UPDATE OF c`,
          [tx.tenantId, candidate.contract_id],
        );
        const row = rows.rows[0];
        if (row)
          await scheduleForContract({
            tx,
            config: input.config,
            contract: row,
            version: {
              id: row.alert_version_id,
              commercial_snapshot: row.commercial_snapshot,
            },
            now,
          });
      })
      .catch((error: unknown) => {
        if (!(
          error instanceof ApplicationError && error.code === "VERSION_CONFLICT"
        ))
          input.reportFailure?.();
      });
  }
  const expired = await input.pool.query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id,id FROM contract.contracts
      WHERE lifecycle_state='ACTIVE' AND end_at<=now()
      ORDER BY end_at,id LIMIT $1`,
    [MAX_BATCH],
  );
  for (const candidate of expired.rows) {
    await input.uow
      .run(candidate.tenant_id, async (tx) => {
        const row = await tx.query(
          `SELECT * FROM contract.contracts WHERE tenant_id=$1 AND id=$2 AND lifecycle_state='ACTIVE' AND end_at<=now() FOR UPDATE`,
          [tx.tenantId, candidate.id],
        );
        if (row.rowCount)
          await expireContract({
            tx,
            config: input.config,
            contract: row.rows[0]!,
          });
      })
      .catch((error: unknown) => {
        if (!(
          error instanceof ApplicationError && error.code === "VERSION_CONFLICT"
        ))
          input.reportFailure?.();
      });
  }
}

export function contractAlertTask(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  config: Config;
  reportFailure?: () => void;
}): WorkerTask {
  return {
    name: "contract-alert-expiry",
    async run(signal) {
      while (!signal.aborted) {
        try {
          await processContractAlertAndExpiryBatch(input);
        } catch {
          input.reportFailure?.();
        }
        await wait(signal, 5000);
      }
    },
  };
}
