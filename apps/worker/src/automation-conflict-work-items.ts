import type pg from "pg";
import type { EventEnvelope } from "../../../packages/event-contracts/src/index.js";
import { consume } from "../../../packages/messaging/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import {
  createAutomationConflictWorkItem,
  createAutomationReviewWorkItem,
} from "../../../modules/work-queue/index.js";
import type { WorkerTask } from "./host.js";

const CONSUMER = "automation-conflict-work-items";
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
export async function applyAutomationWorkItemEvent(
  uow: UnitOfWork,
  event: EventEnvelope,
) {
  if (event.event_type === "AUTOMATION.INTENT_BLOCKED") {
    const reason = String(event.payload.reason_code ?? "");
    const decision = String(event.payload.policy_decision ?? "");
    const actionable =
      decision === "REQUIRE_APPROVAL" ||
      [
        "AUTOMATION_POLICY_NOT_CONFIGURED",
        "AUTOMATION_PRINCIPAL_NOT_CONFIGURED",
        "AUTOMATION_ACTION_UNSUPPORTED",
        "AUTOMATION_TARGET_INVALID",
        "EVALUATION_INTEGRITY_FAILURE",
      ].includes(reason);
    if (!actionable) return;
    const intentId = event.payload.intent_id;
    if (typeof intentId !== "string")
      throw new Error("Automation intent reference is missing");
    return consume(uow, CONSUMER, event, async (tx) => {
      await createAutomationReviewWorkItem({
        tx,
        sourceId: intentId,
        title:
          decision === "REQUIRE_APPROVAL"
            ? "Automation Action Intent requires an Approval Request"
            : "Automation intent is blocked and needs policy/authorization review",
      });
    });
  }
  if (event.event_type !== "AUTOMATION.INTENT_CONFLICTED") return;
  const conflictId = event.payload.conflict_reference;
  if (typeof conflictId !== "string")
    throw new Error("Automation conflict reference is missing");
  return consume(uow, CONSUMER, event, async (tx) => {
    await createAutomationConflictWorkItem({ tx, conflictId });
  });
}
export function automationConflictWorkItemsTask(input: {
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
            `SELECT o.payload FROM platform.outbox_events o WHERE o.event_type IN ('AUTOMATION.INTENT_CONFLICTED','AUTOMATION.INTENT_BLOCKED')
      AND NOT EXISTS(SELECT 1 FROM platform.inbox_events i WHERE i.consumer_name=$1 AND i.event_id=o.event_id AND i.tenant_id=o.tenant_id AND i.status='PROCESSED')
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
              await applyAutomationWorkItemEvent(input.uow, row.payload);
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
