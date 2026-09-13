import type pg from "pg";
import type { EventEnvelope } from "../../../packages/event-contracts/src/index.js";
import { consume } from "../../../packages/messaging/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import {
  refreshSearchEntity,
  refreshKnowledgeByApplicabilityTarget,
  searchTypeForAggregate,
} from "../../../modules/search/index.js";
import type { WorkerTask } from "./host.js";

const CONSUMER = "search-indexer";

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

async function applySearchEvent(
  uow: UnitOfWork,
  event: EventEnvelope,
): Promise<"processed" | "duplicate" | "ignored"> {
  let type = searchTypeForAggregate(event.aggregate.type);
  let entityId = event.aggregate.id;
  let applicabilityTarget:
    | "SERVICE"
    | "PLATFORM"
    | "SERVICE_ENVIRONMENT"
    | "SOFTWARE_PRODUCT"
    | "PROBLEM"
    | null = null;
  if (event.aggregate.type === "SOFTWARE_VERSION") {
    const productId = event.payload.software_product_id;
    if (typeof productId === "string") {
      type = "SOFTWARE_PRODUCT";
      entityId = productId;
      applicabilityTarget = "SOFTWARE_PRODUCT";
    } else return "ignored";
  } else if (
    ["SERVICE", "PLATFORM", "SERVICE_ENVIRONMENT", "PROBLEM"].includes(
      event.aggregate.type,
    )
  )
    applicabilityTarget = event.aggregate.type as
      "SERVICE" | "PLATFORM" | "SERVICE_ENVIRONMENT" | "PROBLEM";
  else if (event.aggregate.type === "SOFTWARE_PRODUCT")
    applicabilityTarget = "SOFTWARE_PRODUCT";
  if (!type && !applicabilityTarget) return "ignored";
  return consume(uow, CONSUMER, event, async (tx, committedEvent) => {
    if (type)
      await refreshSearchEntity(
        tx,
        type,
        entityId,
        committedEvent.aggregate.version,
      );
    if (applicabilityTarget)
      await refreshKnowledgeByApplicabilityTarget(
        tx,
        applicabilityTarget,
        entityId,
      );
    await tx.query(
      `INSERT INTO operations.search_index_state(tenant_id,index_state,last_event_at,indexed_at,updated_at)
       VALUES($1,'CURRENT',$2,now(),now())
       ON CONFLICT(tenant_id) DO UPDATE SET
         index_state=CASE WHEN EXISTS (
           SELECT 1 FROM operations.search_index_retries r
           WHERE r.tenant_id=EXCLUDED.tenant_id
         ) THEN 'FAILED' ELSE 'CURRENT' END,
         last_event_at=GREATEST(operations.search_index_state.last_event_at,EXCLUDED.last_event_at),
         indexed_at=now(),failure_code=CASE WHEN EXISTS (
           SELECT 1 FROM operations.search_index_retries r
           WHERE r.tenant_id=EXCLUDED.tenant_id
         ) THEN 'SEARCH_INDEX_EVENT_FAILED' ELSE NULL END,updated_at=now()`,
      [tx.tenantId, committedEvent.occurred_at],
    );
  }).then((result) => result);
}

export function searchIndexerTask(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  reportFailure?: () => void;
}): WorkerTask {
  return {
    name: "search-indexer",
    async run(signal) {
      while (!signal.aborted) {
        try {
          await input.pool.query(
            `DELETE FROM operations.search_index_retries r
             USING platform.inbox_events i
             WHERE i.consumer_name=$1 AND i.event_id=r.event_id
               AND i.tenant_id=r.tenant_id AND i.status='PROCESSED'`,
            [CONSUMER],
          );
          await input.pool.query(
            `UPDATE operations.search_index_state s SET index_state='CURRENT',
               failure_code=NULL,updated_at=now()
             WHERE s.index_state='FAILED' AND NOT EXISTS (
               SELECT 1 FROM operations.search_index_retries r WHERE r.tenant_id=s.tenant_id
             )`,
          );
          const pending = await input.pool.query<{
            event_id: string;
            payload: EventEnvelope;
          }>(
            `SELECT o.event_id,o.payload FROM platform.outbox_events o
             LEFT JOIN operations.search_index_retries r
               ON r.tenant_id=o.tenant_id AND r.event_id=o.event_id
             WHERE o.aggregate_type IN ('ASSET','USER','IDENTITY_USER','TICKET','INCIDENT',
               'NETWORK_OBSERVATION','SOFTWARE_PRODUCT','SOFTWARE_VERSION','LICENSE_ENTITLEMENT','KNOWLEDGE',
               'SERVICE','PLATFORM','SERVICE_ENVIRONMENT','PROBLEM')
               AND NOT EXISTS (
                 SELECT 1 FROM platform.inbox_events i
                 WHERE i.consumer_name=$1 AND i.event_id=o.event_id
                   AND i.tenant_id=o.tenant_id AND i.status='PROCESSED'
               )
               AND (r.event_id IS NULL OR r.next_attempt_at<=now())
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
              await applySearchEvent(input.uow, row.payload);
            } catch {
              input.reportFailure?.();
              try {
                await input.uow.run(row.payload.tenant_id, async (tx) => {
                  await tx.query(
                    `INSERT INTO operations.search_index_retries(
                       tenant_id,event_id,attempt_count,next_attempt_at,failure_code,updated_at
                     ) VALUES($1,$2,1,now()+interval '2 seconds','SEARCH_INDEX_EVENT_FAILED',now())
                     ON CONFLICT(tenant_id,event_id) DO UPDATE SET
                       attempt_count=operations.search_index_retries.attempt_count+1,
                       next_attempt_at=now()+make_interval(secs=>LEAST(300,
                         power(2,LEAST(operations.search_index_retries.attempt_count+1,8))::integer)),
                       failure_code='SEARCH_INDEX_EVENT_FAILED',updated_at=now()`,
                    [tx.tenantId, row.event_id],
                  );
                  await tx.query(
                    `INSERT INTO operations.search_index_state(tenant_id,index_state,failure_code,updated_at)
                     VALUES($1,'FAILED','SEARCH_INDEX_EVENT_FAILED',now())
                     ON CONFLICT(tenant_id) DO UPDATE SET index_state='FAILED',
                       failure_code='SEARCH_INDEX_EVENT_FAILED',updated_at=now()`,
                    [tx.tenantId],
                  );
                });
              } catch {
                // Continue polling if failure state itself cannot be persisted.
              }
              continue;
            }
            try {
              await input.uow.run(row.payload.tenant_id, async (tx) => {
                await tx.query(
                  "DELETE FROM operations.search_index_retries WHERE tenant_id=$1 AND event_id=$2",
                  [tx.tenantId, row.event_id],
                );
                await tx.query(
                  `UPDATE operations.search_index_state SET
                     index_state=CASE WHEN EXISTS (
                       SELECT 1 FROM operations.search_index_retries r WHERE r.tenant_id=$1
                     ) THEN 'FAILED' ELSE 'CURRENT' END,
                     failure_code=CASE WHEN EXISTS (
                       SELECT 1 FROM operations.search_index_retries r WHERE r.tenant_id=$1
                     ) THEN 'SEARCH_INDEX_EVENT_FAILED' ELSE NULL END,updated_at=now()
                   WHERE tenant_id=$1`,
                  [tx.tenantId],
                );
              });
            } catch {
              input.reportFailure?.();
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

export { applySearchEvent };
