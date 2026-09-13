import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { EventEnvelope } from "../../../packages/event-contracts/src/index.js";
import {
  consume,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  createAutomationReviewWorkItem,
  recordAutomationTimelineEvent,
} from "../../../modules/work-queue/index.js";
import {
  evaluateEvent,
  recheckIntentApproval,
  type ActionAuthorization,
  type AutomationPolicyPort,
  PostgresAutomationSecurity,
} from "../../../modules/automation/index.js";
import type {
  ActionCapabilityPort,
  AutomationTargetPort,
} from "../../../modules/automation/index.js";
import type { WorkerTask } from "./host.js";

const CONSUMER = "automation-rule-evaluator";
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

async function appendDecision(
  tx: Transaction,
  event: EventEnvelope,
  type: string,
  aggregateId: string,
  version: number,
  payload: Record<string, unknown>,
  reason: string,
) {
  const now = new Date().toISOString();
  const decisionEventId = randomUUID();
  await new PostgresOutboxWriter(tx).append({
    event_id: decisionEventId,
    event_type: type,
    schema_version: 1,
    occurred_at: now,
    producer: { service: "itcenter-worker", instance: "automation-evaluator" },
    aggregate: { type: "AUTOMATION", id: aggregateId, version },
    actor: { type: "SERVICE_ACCOUNT", id: "automation-evaluator" },
    correlation_id: event.correlation_id,
    causation_id: event.event_id,
    tenant_id: event.tenant_id,
    organization_id: event.organization_id,
    idempotency_key: `${CONSUMER}:${event.event_id}:${type}:${aggregateId}`,
    payload: payload as never,
  });
  await new PostgresAudit(tx).append({
    id: randomUUID(),
    tenant_id: event.tenant_id,
    event_type: type,
    occurred_at: now,
    actor: { type: "SERVICE", id: "automation-evaluator" },
    action: { command_type: type },
    subject: { entity_type: "AUTOMATION", entity_id: aggregateId },
    correlation_id: event.correlation_id,
    causation_id: event.event_id,
    reason: { code: reason, text: reason },
    before: null,
    after: payload as never,
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
  if (
    type === "AUTOMATION.INTENT_READY" ||
    type === "AUTOMATION.INTENT_BLOCKED" ||
    type === "AUTOMATION.INTENT_CONFLICTED" ||
    type === "AUTOMATION.INTENT_DEDUPLICATED"
  ) {
    const conflict = type === "AUTOMATION.INTENT_CONFLICTED";
    const summary = conflict
      ? "Automation intent conflict requires human resolution"
      : type === "AUTOMATION.INTENT_READY"
        ? "Automation Action Intent is eligible for TASK-091"
        : type === "AUTOMATION.INTENT_DEDUPLICATED"
          ? "Automation Action Intent was deduplicated"
          : "Automation Action Intent is blocked by policy or safety checks";
    await recordAutomationTimelineEvent({
      tx,
      entityType: conflict ? "AUTOMATION_CONFLICT" : "ACTION_INTENT",
      entityId:
        conflict && typeof payload.conflict_reference === "string"
          ? payload.conflict_reference
          : aggregateId,
      eventType: type,
      summary,
      payload,
      sourceEventId: decisionEventId,
    });
  }
}

export async function applyAutomationEvent(
  uow: UnitOfWork,
  event: EventEnvelope,
  ports: {
    authorization?: ActionAuthorization;
    policy?: AutomationPolicyPort;
    capabilities?: ActionCapabilityPort;
    targets?: AutomationTargetPort;
  } = {},
) {
  return consume(uow, CONSUMER, event, async (tx, delivered) => {
    const security = new PostgresAutomationSecurity(tx);
    if (delivered.event_type.startsWith("APPROVAL.")) {
      const approvalId =
        typeof delivered.payload.approval_request_id === "string"
          ? delivered.payload.approval_request_id
          : typeof delivered.payload.id === "string"
            ? delivered.payload.id
            : null;
      if (!approvalId) return;
      const approval = await tx.query<{
        source_type: string;
        source_id: string;
        state: string;
      }>(
        "SELECT source_type,source_id,state FROM control.approval_requests WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, approvalId],
      );
      if (
        !approval.rowCount ||
        approval.rows[0]!.source_type !== "AUTOMATION_ACTION_INTENT"
      )
        return;
      const intentId = approval.rows[0]!.source_id;
      const promoted =
        delivered.event_type === "APPROVAL.APPROVED"
          ? await recheckIntentApproval(tx, {
              approvalId,
              eventId: delivered.event_id,
              authorization: ports.authorization ?? security,
              policy: ports.policy ?? security,
              capabilities: ports.capabilities ?? security,
              targets: ports.targets ?? security,
            })
          : false;
      if (!promoted)
        await tx.query(
          "UPDATE automation.action_intents SET state='BLOCKED',approval_id=$1,reason_code=$2,entity_version=entity_version+1,updated_at=now() WHERE tenant_id=$3 AND id=$4 AND state='PENDING_APPROVAL'",
          [
            approvalId,
            approval.rows[0]!.state === "APPROVED"
              ? "AUTOMATION_APPROVAL_RECHECK_BLOCKED"
              : "APPROVAL_NOT_APPROVED",
            tx.tenantId,
            intentId,
          ],
        );
      const intent = await tx.query<{ state: string; policy_decision: string }>(
        "SELECT state,policy_decision FROM automation.action_intents WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, intentId],
      );
      if (intent.rowCount)
        await appendDecision(
          tx,
          delivered,
          intent.rows[0]!.state === "READY"
            ? "AUTOMATION.INTENT_READY"
            : "AUTOMATION.INTENT_BLOCKED",
          intentId,
          1,
          {
            intent_id: intentId,
            approval_reference: approvalId,
            intent_state: intent.rows[0]!.state,
            policy_decision: intent.rows[0]!.policy_decision,
            reason_code:
              intent.rows[0]!.state === "READY"
                ? "APPROVAL_SATISFIED"
                : "APPROVAL_OR_POLICY_BLOCKED",
          },
          intent.rows[0]!.state,
        );
      if (promoted)
        await tx.query(
          "UPDATE operations.work_items SET state='RESOLVED',resolved_at=now(),last_action_at=now(),version=version+1 WHERE tenant_id=$1 AND source_type='AUTOMATION_REVIEW' AND source_id=$2 AND state NOT IN ('RESOLVED','CLOSED')",
          [tx.tenantId, intentId],
        );
      else
        await createAutomationReviewWorkItem({
          tx,
          sourceId: intentId,
          title: "Automation approval is stale or the intent remains blocked",
        });
      return;
    }
    const results = await evaluateEvent(
      tx,
      {
        event_id: delivered.event_id,
        event_type: delivered.event_type,
        tenant_id: delivered.tenant_id,
        correlation_id: delivered.correlation_id,
        causation_id: delivered.causation_id,
        occurred_at: delivered.occurred_at,
        payload: delivered.payload,
      },
      ports.authorization ?? security,
      ports.policy ?? security,
      {
        capabilities: ports.capabilities ?? security,
        targets: ports.targets ?? security,
      },
    );
    for (const evaluation of results) {
      const evaluationId = String(evaluation.evaluation_id ?? "");
      if (!evaluationId) continue;
      const ids = Array.isArray(evaluation.action_intent_ids)
        ? evaluation.action_intent_ids.map(String)
        : [];
      await appendDecision(
        tx,
        delivered,
        "AUTOMATION.RULE_EVALUATED",
        String(evaluation.rule_id),
        Number(evaluation.rule_version),
        {
          evaluation_id: evaluationId,
          mode: "PRODUCTION",
          source_event_id: delivered.event_id,
          source_event_type: delivered.event_type,
          rule_id: evaluation.rule_id,
          rule_version: evaluation.rule_version,
          match_result: evaluation.matched,
          condition_evidence_reference: evaluationId,
          policy_decision: evaluation.policy_decision,
          policy_reason_code: evaluation.reason_code,
          intent_references: ids,
        },
        String(evaluation.reason_code),
      );
    }
    const intents = await tx.query<{
      id: string;
      state: string;
      policy_decision: string;
      contributor_count: number;
      conflict_id: string | null;
      contributor_references: unknown[];
      target_type: string;
      target_id: string;
      action_domain: string;
      action_type: string;
      approval_id: string | null;
      reason_code: string | null;
    }>(
      `SELECT i.id,i.state,i.policy_decision,i.reason_code,i.target_type,i.target_id,i.action_domain,i.action_type,i.approval_id,count(DISTINCT c.rule_id)::int AS contributor_count,min(m.conflict_id::text)::uuid AS conflict_id
       ,COALESCE(jsonb_agg(DISTINCT jsonb_build_object('rule_id',c.rule_id,'rule_version',c.rule_version,'evaluation_id',c.evaluation_id)),'[]'::jsonb) AS contributor_references
       FROM automation.action_intents i JOIN automation.action_intent_contributors c ON c.tenant_id=i.tenant_id AND c.action_intent_id=i.id LEFT JOIN automation.intent_conflict_members m ON m.tenant_id=i.tenant_id AND m.action_intent_id=i.id
      WHERE i.tenant_id=$1 AND i.source_event_id=$2 GROUP BY i.id`,
      [tx.tenantId, delivered.event_id],
    );
    for (const intent of intents.rows) {
      await appendDecision(
        tx,
        delivered,
        "AUTOMATION.INTENT_CREATED",
        intent.id,
        1,
        {
          intent_id: intent.id,
          source_event_id: delivered.event_id,
          target_type: intent.target_type,
          target_id: intent.target_id,
          action_domain: intent.action_domain,
          action_type: intent.action_type,
          intent_state: intent.state,
          policy_decision: intent.policy_decision,
          contributor_references: intent.contributor_references,
        },
        "INTENT_CREATED",
      );
      const conflictMembers = intent.conflict_id
        ? await tx.query<{ ids: string[] }>(
            "SELECT COALESCE(array_agg(action_intent_id),'{}') AS ids FROM automation.intent_conflict_members WHERE tenant_id=$1 AND conflict_id=$2",
            [tx.tenantId, intent.conflict_id],
          )
        : { rows: [{ ids: [] as string[] }] };
      if (intent.state === "CONFLICTED") {
        await appendDecision(
          tx,
          delivered,
          "AUTOMATION.INTENT_CONFLICTED",
          intent.id,
          1,
          {
            conflict_reference: intent.conflict_id,
            intent_references: conflictMembers.rows[0]!.ids,
            contributing_rules: intent.contributor_references,
            source_event_id: delivered.event_id,
            human_fallback_reference: intent.conflict_id,
          },
          "ACTION_INTENT_CONFLICT",
        );
        continue;
      }
      if (intent.state === "PENDING_APPROVAL")
        await createAutomationReviewWorkItem({
          tx,
          sourceId: intent.id,
          title: "Automation action requires a bound approval before execution",
        });
      else if (
        intent.state === "BLOCKED" &&
        [
          "AUTOMATION_POLICY_NOT_CONFIGURED",
          "AUTOMATION_POLICY_NOT_EFFECTIVE",
          "AUTOMATION_POLICY_AMBIGUOUS",
          "AUTOMATION_POLICY_BACKEND_UNAVAILABLE",
          "AUTOMATION_PRINCIPAL_NOT_CONFIGURED",
          "AUTOMATION_PRINCIPAL_AMBIGUOUS",
          "AUTOMATION_PRINCIPAL_SCOPE_OR_PERMISSION_DENIED",
          "AUTOMATION_AUTHORIZATION_BACKEND_UNAVAILABLE",
          "AUTOMATION_ACTION_UNSUPPORTED",
          "AUTOMATION_TARGET_UNRESOLVED",
        ].includes(intent.reason_code ?? "")
      )
        await createAutomationReviewWorkItem({
          tx,
          sourceId: intent.id,
          title: "Automation intent needs policy, grant, or target review",
        });
      if (intent.contributor_count > 1) {
        await appendDecision(
          tx,
          delivered,
          "AUTOMATION.INTENT_DEDUPLICATED",
          intent.id,
          1,
          {
            canonical_intent_id: intent.id,
            source_event_id: delivered.event_id,
            contributor_references: intent.contributor_references,
            deduplication_reference: intent.id,
          },
          "SEMANTICALLY_IDENTICAL_ACTION",
        );
      }
      const stateEvent =
        intent.state === "READY"
          ? "AUTOMATION.INTENT_READY"
          : "AUTOMATION.INTENT_BLOCKED";
      await appendDecision(
        tx,
        delivered,
        stateEvent,
        intent.id,
        1,
        {
          intent_id: intent.id,
          intent_state: intent.state,
          policy_decision: intent.policy_decision,
          reason_code: intent.reason_code ?? "POLICY_GATE",
        },
        intent.reason_code ?? intent.state,
      );
    }
  });
}

export function automationEvaluatorTask(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  reportFailure?: () => void;
}): WorkerTask {
  return {
    name: CONSUMER,
    async run(signal) {
      while (!signal.aborted) {
        try {
          const pending = await input.pool.query<{
            event_id: string;
            payload: EventEnvelope;
          }>(
            `SELECT o.event_id,o.payload FROM platform.outbox_events o
      WHERE o.event_type NOT LIKE 'AUTOMATION.%' AND NOT EXISTS(SELECT 1 FROM platform.inbox_events i WHERE i.consumer_name=$1 AND i.event_id=o.event_id AND i.tenant_id=o.tenant_id AND i.status='PROCESSED')
        AND (o.event_type NOT LIKE 'APPROVAL.%' OR o.event_type IN ('APPROVAL.APPROVED','APPROVAL.REJECTED','APPROVAL.CANCELLED','APPROVAL.EXPIRED'))
      ORDER BY o.created_at,o.id LIMIT 50`,
            [CONSUMER],
          );
          if (!pending.rowCount) {
            await wait(signal, 1000);
            continue;
          }
          for (const row of pending.rows) {
            if (signal.aborted) break;
            try {
              await applyAutomationEvent(input.uow, row.payload);
            } catch {
              input.reportFailure?.();
            }
          }
        } catch {
          input.reportFailure?.();
          await wait(signal, 1000);
        }
      }
    },
  };
}
