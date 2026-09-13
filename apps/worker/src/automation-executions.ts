import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { EventEnvelope } from "../../../packages/event-contracts/src/index.js";
import { consume } from "../../../packages/messaging/src/index.js";
import type {
  UnitOfWork,
  Transaction,
} from "../../../packages/persistence/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  createAutomationExecutionWorkItem,
  recordAutomationTimelineEvent,
} from "../../../modules/work-queue/index.js";
import {
  createAutomaticExecution,
  markExpiredExecutionsUnknown,
  observeAgentRuntime,
  recordExecutionAcceptance,
  recordExecutionRejection,
} from "../../../modules/automation/index.js";
import type { WorkerTask } from "./host.js";

const CONSUMER = "automation-action-executions";
const ACTION_EVENTS = [
  "AUTOMATION.EXECUTION_CREATED",
  "AUTOMATION.EXECUTION_CLAIMED",
  "AUTOMATION.ACTION_DISPATCHED",
  "AUTOMATION.ACTION_ACCEPTED",
  "AUTOMATION.ACTION_VERIFYING",
  "AUTOMATION.ACTION_SUCCEEDED",
  "AUTOMATION.ACTION_FAILED",
  "AUTOMATION.ACTION_UNKNOWN",
  "AUTOMATION.ACTION_CANCELLED",
];
const CONSUMED_EVENTS = [
  "AUTOMATION.INTENT_READY",
  "AGENT.AUTOMATION_ACTION_ACCEPTED",
  "AGENT.AUTOMATION_ACTION_REJECTED",
  "AGENT.ONLINE",
  ...ACTION_EVENTS,
];
const wait = (signal: AbortSignal, ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

function summary(type: string) {
  switch (type) {
    case "AUTOMATION.ACTION_DISPATCHED":
      return "Restart command dispatched to Agent";
    case "AUTOMATION.ACTION_ACCEPTED":
      return "Agent accepted restart command";
    case "AUTOMATION.ACTION_SUCCEEDED":
      return "Agent restart positively verified";
    case "AUTOMATION.ACTION_UNKNOWN":
      return "Agent restart outcome is unknown; reconcile before retry";
    case "AUTOMATION.ACTION_CANCELLED":
      return "Restart command cancelled before Agent acceptance";
    case "AUTOMATION.ACTION_FAILED":
      return "Agent restart execution failed";
    default:
      return "Agent restart execution updated";
  }
}
async function project(tx: Transaction, event: EventEnvelope) {
  if (!ACTION_EVENTS.includes(event.event_type)) return;
  const executionId = event.payload.execution_id;
  if (typeof executionId !== "string") return;
  await recordAutomationTimelineEvent({
    tx,
    entityType: "ACTION_EXECUTION",
    entityId: executionId,
    eventType: event.event_type,
    summary: summary(event.event_type),
    payload: {
      execution_id: executionId,
      state: event.payload.state,
      reason_code: event.payload.reason_code,
    },
    sourceEventId: event.event_id,
  });
  if (
    event.event_type === "AUTOMATION.ACTION_UNKNOWN" ||
    event.event_type === "AUTOMATION.ACTION_FAILED"
  ) {
    await createAutomationExecutionWorkItem({
      tx,
      executionId,
      title:
        event.event_type === "AUTOMATION.ACTION_UNKNOWN"
          ? "Agent restart outcome is unknown; reconcile Agent before any retry"
          : "Agent restart failed and requires operator review",
    });
  }
  await new PostgresAudit(tx).append({
    id: randomUUID(),
    tenant_id: event.tenant_id,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    actor: { type: event.actor.type, id: event.actor.id ?? "automation" },
    action: { command_type: event.event_type },
    subject: { entity_type: "ACTION_EXECUTION", entity_id: executionId },
    correlation_id: event.correlation_id,
    causation_id: event.causation_id,
    reason: {
      code: String(event.payload.reason_code ?? event.event_type),
      text: String(event.payload.reason_code ?? event.event_type),
    },
    before: null,
    after: event.payload as never,
    outcome: {
      status:
        event.event_type.endsWith("FAILED") ||
        event.event_type.endsWith("UNKNOWN")
          ? "FAILURE"
          : "SUCCESS",
    },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
}

export async function applyAutomationExecutionEvent(
  uow: UnitOfWork,
  event: EventEnvelope,
) {
  return consume(uow, CONSUMER, event, async (tx, delivered) => {
    if (delivered.event_type === "AUTOMATION.INTENT_READY") {
      const intentId = delivered.payload.intent_id;
      if (typeof intentId === "string")
        await createAutomaticExecution(tx, {
          intentId,
          sourceEventId: delivered.causation_id,
        });
      return;
    }
    if (delivered.event_type === "AGENT.AUTOMATION_ACTION_ACCEPTED") {
      const commandId = delivered.payload.command_id,
        agentId = delivered.payload.agent_id,
        acceptedAt = delivered.payload.accepted_at;
      if (
        typeof commandId === "string" &&
        typeof agentId === "string" &&
        typeof acceptedAt === "string"
      )
        await recordExecutionAcceptance(tx, { commandId, agentId, acceptedAt });
      return;
    }
    if (delivered.event_type === "AGENT.AUTOMATION_ACTION_REJECTED") {
      const commandId = delivered.payload.command_id,
        agentId = delivered.payload.agent_id;
      if (typeof commandId === "string" && typeof agentId === "string")
        await recordExecutionRejection(tx, {
          commandId,
          agentId,
          reason: String(
            delivered.payload.reason_code ?? "AGENT_COMMAND_REJECTED",
          ),
        });
      return;
    }
    if (delivered.event_type === "AGENT.ONLINE") {
      const agentId = delivered.aggregate.id,
        runtime = delivered.payload.agent_runtime_id,
        observed = delivered.payload.last_seen_at;
      if (typeof runtime === "string" && typeof observed === "string")
        await observeAgentRuntime(tx, {
          agentId,
          runtimeId: runtime,
          observedAt: observed,
        });
      return;
    }
    await project(tx, delivered);
  });
}

export function automationExecutionTask(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  reportFailure?: () => void;
}): WorkerTask {
  return {
    name: CONSUMER,
    async run(signal) {
      while (!signal.aborted) {
        try {
          const pending = await input.pool.query<{ payload: EventEnvelope }>(
            `SELECT o.payload FROM platform.outbox_events o WHERE o.event_type=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM platform.inbox_events i WHERE i.consumer_name=$2 AND i.event_id=o.event_id AND i.tenant_id=o.tenant_id AND i.status='PROCESSED') ORDER BY o.created_at,o.id LIMIT 100`,
            [CONSUMED_EVENTS, CONSUMER],
          );
          if (pending.rowCount) {
            for (const row of pending.rows) {
              if (signal.aborted) break;
              try {
                await applyAutomationExecutionEvent(input.uow, row.payload);
              } catch {
                input.reportFailure?.();
              }
            }
          }
          const tenants = await input.pool.query<{ tenant_id: string }>(
            "SELECT DISTINCT tenant_id FROM automation.action_executions WHERE state IN ('ACCEPTED','VERIFYING') AND verification_deadline<=now() LIMIT 100",
          );
          for (const row of tenants.rows) {
            if (signal.aborted) break;
            try {
              await input.uow.run(row.tenant_id, (tx) =>
                markExpiredExecutionsUnknown(tx),
              );
            } catch {
              input.reportFailure?.();
            }
          }
          if (!pending.rowCount && !tenants.rowCount) await wait(signal, 1000);
        } catch {
          input.reportFailure?.();
          await wait(signal, 1000);
        }
      }
    },
  };
}
