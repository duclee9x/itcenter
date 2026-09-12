import type pg from "pg";
import type { EventEnvelope } from "../../../packages/event-contracts/src/index.js";
import { consume } from "../../../packages/messaging/src/index.js";
import type {
  UnitOfWork,
  Transaction,
} from "../../../packages/persistence/src/index.js";
import { recordCostProvenance } from "../../../modules/procurement/index.js";
import { upsertCostProvenanceWorkItem } from "../../../modules/work-queue/index.js";
import type { WorkerTask } from "./host.js";

const CONSUMER = "cost-provenance-linker";
const INPUT_EVENTS = [
  "ASSET.CREATED",
  "INVOICE.APPROVED",
  "CREDIT_NOTE.APPLIED",
] as const;
const MAX_RETRY_ATTEMPTS = 5;
type Unit = {
  received_unit_id: string;
  asset_id: string | null;
  goods_receipt_line_id: string;
  purchase_order_line_id: string;
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

async function unitForAsset(
  tx: Transaction,
  assetId: string,
): Promise<Unit | null> {
  const result = await tx.query(
    `SELECT r.received_unit_id,r.asset_id,u.goods_receipt_line_id,l.purchase_order_line_id
       FROM asset.received_unit_registrations r
       JOIN procurement.goods_receipt_units u ON u.tenant_id=r.tenant_id AND u.id=r.received_unit_id
       JOIN procurement.goods_receipt_lines l ON l.tenant_id=u.tenant_id AND l.goods_receipt_id=u.goods_receipt_id AND l.id=u.goods_receipt_line_id
      WHERE r.tenant_id=$1 AND r.asset_id=$2`,
    [tx.tenantId, assetId],
  );
  return (result.rows[0] as Unit | undefined) ?? null;
}

async function unitsForReceiptLine(
  tx: Transaction,
  receiptLineId: string,
): Promise<Unit[]> {
  const result = await tx.query(
    `SELECT u.id AS received_unit_id,r.asset_id,l.id AS goods_receipt_line_id,l.purchase_order_line_id
       FROM procurement.goods_receipt_units u
       JOIN procurement.goods_receipt_lines l ON l.tenant_id=u.tenant_id AND l.goods_receipt_id=u.goods_receipt_id AND l.id=u.goods_receipt_line_id
       JOIN procurement.goods_receipts g ON g.tenant_id=u.tenant_id AND g.id=u.goods_receipt_id
       LEFT JOIN asset.received_unit_registrations r ON r.tenant_id=u.tenant_id AND r.received_unit_id=u.id
      WHERE u.tenant_id=$1 AND l.id=$2 AND u.accepted AND g.state='POSTED'
      ORDER BY u.id`,
    [tx.tenantId, receiptLineId],
  );
  return result.rows as Unit[];
}

async function unitsForAllocation(
  tx: Transaction,
  allocationId: string,
  receiptLineId: string,
  creditNoteId: string,
) {
  const unitSet = await unitsForReceiptLine(tx, receiptLineId);
  const allocations = await tx.query<{ id: string; quantity: string }>(
    `SELECT a.id,a.quantity::text AS quantity
       FROM procurement.invoice_match_allocations a
       JOIN procurement.invoices i ON i.tenant_id=a.tenant_id AND i.id=a.invoice_id
      WHERE a.tenant_id=$1 AND a.goods_receipt_line_id=$2
        AND a.allocation_type='RECEIPT_MATCHED' AND i.lifecycle_state='APPROVED'
        AND a.evaluation_id=i.current_match_evaluation_id
      ORDER BY a.created_at,a.id`,
    [tx.tenantId, receiptLineId],
  );
  let offset = 0;
  for (const allocation of allocations.rows) {
    const quantity = Number(allocation.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return null;
    if (allocation.id === allocationId) {
      const prior = await tx.query<{ quantity: string }>(
        `SELECT COALESCE(sum(rel.released_quantity),0)::text AS quantity
           FROM procurement.credit_note_allocation_releases rel
           JOIN procurement.credit_notes cn ON cn.tenant_id=rel.tenant_id AND cn.id=rel.credit_note_id
          WHERE rel.tenant_id=$1 AND rel.allocation_id=$2 AND cn.lifecycle_state='APPLIED' AND cn.id<>$3`,
        [tx.tenantId, allocationId, creditNoteId],
      );
      const alreadyReleased = Number(prior.rows[0]!.quantity);
      if (
        !Number.isSafeInteger(alreadyReleased) ||
        alreadyReleased < 0 ||
        alreadyReleased >= quantity
      )
        return null;
      const remaining = unitSet.slice(
        offset + alreadyReleased,
        offset + quantity,
      );
      return remaining.length === quantity - alreadyReleased ? remaining : null;
    }
    offset += quantity;
  }
  return null;
}

async function createAmbiguityWork(input: {
  tx: Transaction;
  entityId: string;
  label: string;
}) {
  await upsertCostProvenanceWorkItem({
    tx: input.tx,
    sourceId: input.entityId,
    title: `${input.label} has a cost allocation that cannot be assigned to received Assets unambiguously.`,
  });
}

async function recordCommittedCost(input: {
  tx: Transaction;
  unit: Unit;
  correlationId: string;
  causationId: string;
}) {
  if (!input.unit.asset_id) return;
  const source = await input.tx.query(
    `SELECT po.id AS purchase_order_id,po.currency,po.current_commercial_version,
            pol.id AS purchase_order_line_id,pol.unit_price,pol.quantity,
            v.commercial_version
       FROM procurement.goods_receipt_units u
       JOIN procurement.goods_receipts gr ON gr.tenant_id=u.tenant_id AND gr.id=u.goods_receipt_id
       JOIN procurement.purchase_orders po ON po.tenant_id=gr.tenant_id AND po.id=gr.purchase_order_id
       JOIN procurement.purchase_order_lines pol ON pol.tenant_id=gr.tenant_id AND pol.id=$2
       JOIN procurement.purchase_order_versions v ON v.tenant_id=po.tenant_id AND v.purchase_order_id=po.id AND v.commercial_version=gr.purchase_order_commercial_version
      WHERE u.tenant_id=$1 AND u.id=$3 AND gr.state='POSTED' AND po.lifecycle_state IN ('ISSUED','ON_HOLD','CLOSED')`,
    [
      input.tx.tenantId,
      input.unit.purchase_order_line_id,
      input.unit.received_unit_id,
    ],
  );
  if (!source.rowCount) return;
  const row = source.rows[0]!;
  await recordCostProvenance({
    tx: input.tx,
    actorId: "cost-provenance-linker",
    correlationId: input.correlationId,
    causationId: input.causationId,
    value: {
      targetType: "ASSET",
      targetId: input.unit.asset_id,
      sourceType: "PURCHASE_ORDER",
      sourceDocumentId: String(row.purchase_order_id),
      sourceVersionRef: `${row.purchase_order_id}:v${row.commercial_version}`,
      sourceLineId: String(row.purchase_order_line_id),
      basis: "COMMITTED",
      amount: String(row.unit_price),
      currency: String(row.currency).trim(),
      quantity: 1,
      allocationMethod: "PO_LINE_UNIT_PRICE",
      allocationRole: `RECEIVED_UNIT:${input.unit.received_unit_id}`,
    },
  });
}

async function recordActualForAsset(input: {
  tx: Transaction;
  unit: Unit;
  correlationId: string;
  causationId: string;
}) {
  const allocation = await input.tx.query(
    `SELECT a.invoice_id,a.invoice_line_id,a.purchase_order_line_id,a.goods_receipt_line_id,
            i.snapshot_fingerprint,i.currency,il.unit_price,il.id AS line_id,
            a.allocation_type,a.id AS allocation_id,a.quantity AS allocation_quantity
       FROM procurement.invoice_match_allocations a
       JOIN procurement.invoices i ON i.tenant_id=a.tenant_id AND i.id=a.invoice_id
       JOIN procurement.invoice_lines il ON il.tenant_id=a.tenant_id AND il.invoice_id=a.invoice_id AND il.id=a.invoice_line_id
      WHERE a.tenant_id=$1 AND a.purchase_order_line_id=$2 AND i.lifecycle_state='APPROVED'
        AND a.evaluation_id=i.current_match_evaluation_id
        AND (a.goods_receipt_line_id=$3 OR (a.goods_receipt_line_id IS NULL AND a.allocation_type='APPROVED_EXCEPTION'))
      ORDER BY a.created_at,a.id`,
    [
      input.tx.tenantId,
      input.unit.purchase_order_line_id,
      input.unit.goods_receipt_line_id,
    ],
  );
  const offsets = new Map<string, number>();
  for (const row of allocation.rows) {
    if (!row.goods_receipt_line_id) {
      await createAmbiguityWork({
        tx: input.tx,
        entityId: String(row.invoice_id),
        label: `Invoice ${row.invoice_id}`,
      });
      continue;
    }
    const key = String(row.goods_receipt_line_id);
    const units = await unitsForReceiptLine(input.tx, key);
    const qty = Number(row.allocation_quantity);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      await createAmbiguityWork({
        tx: input.tx,
        entityId: String(row.invoice_id),
        label: `Invoice ${row.invoice_id}`,
      });
      continue;
    }
    const start = offsets.get(key) ?? 0;
    offsets.set(key, start + qty);
    const allocatedUnits = units.slice(start, start + qty);
    if (allocatedUnits.length !== qty) {
      await createAmbiguityWork({
        tx: input.tx,
        entityId: String(row.invoice_id),
        label: `Invoice ${row.invoice_id}`,
      });
      continue;
    }
    const targetUnit = allocatedUnits.find(
      (unit) => unit.received_unit_id === input.unit.received_unit_id,
    );
    if (!targetUnit?.asset_id) continue;
    await recordCostProvenance({
      tx: input.tx,
      actorId: "cost-provenance-linker",
      correlationId: input.correlationId,
      causationId: input.causationId,
      value: {
        targetType: "ASSET",
        targetId: targetUnit.asset_id,
        sourceType: "INVOICE",
        sourceDocumentId: String(row.invoice_id),
        sourceVersionRef: String(row.snapshot_fingerprint).trim(),
        sourceLineId: String(row.line_id),
        basis: "ACTUAL",
        amount: String(row.unit_price),
        currency: String(row.currency).trim(),
        quantity: 1,
        allocationMethod: "INVOICE_MATCH_UNIT_PRICE",
        allocationRole: `RECEIPT:${input.unit.goods_receipt_line_id}:UNIT:${input.unit.received_unit_id}`,
      },
    });
  }
}

function minorDigits(currency: string) {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

function splitMinorUnits(amount: string, count: number, currency: string) {
  const digits = minorDigits(currency);
  const [whole, fraction = ""] = amount.split(".");
  const scale = 10n ** BigInt(digits);
  const fractionValue = BigInt(
    (fraction + "0".repeat(digits)).slice(0, digits) || "0",
  );
  const total = BigInt(whole || "0") * scale + fractionValue;
  const divisor = BigInt(count);
  const base = total / divisor;
  const remainder = Number(total % divisor);
  return Array.from({ length: count }, (_, index) => {
    const units = base + (index < remainder ? 1n : 0n);
    return `${units / scale}.${String(units % scale).padStart(digits, "0")}`;
  });
}

async function recordCreditAdjustments(input: {
  tx: Transaction;
  assetUnit: Unit;
  creditNoteId: string;
  correlationId: string;
  causationId: string;
}) {
  const notes = await input.tx.query(
    `SELECT cn.id AS credit_note_id,cn.snapshot_fingerprint,cn.currency,cl.id AS credit_line_id,
            cl.invoice_line_id,cl.credited_quantity,cl.credited_amount,
            rel.released_quantity,rel.allocation_id,a.goods_receipt_line_id,a.purchase_order_line_id
       FROM procurement.credit_note_lines cl
       JOIN procurement.credit_notes cn ON cn.tenant_id=cl.tenant_id AND cn.id=cl.credit_note_id
       JOIN procurement.credit_note_allocation_releases rel ON rel.tenant_id=cl.tenant_id AND rel.credit_note_line_id=cl.id
       JOIN procurement.invoice_match_allocations a ON a.tenant_id=rel.tenant_id AND a.id=rel.allocation_id
      WHERE cn.tenant_id=$1 AND cn.id=$2 AND cn.lifecycle_state='APPLIED'
        AND (a.goods_receipt_line_id=$3 OR (a.goods_receipt_line_id IS NULL AND a.purchase_order_line_id=$4))
      ORDER BY cl.id,rel.created_at,rel.id`,
    [
      input.tx.tenantId,
      input.creditNoteId,
      input.assetUnit.goods_receipt_line_id,
      input.assetUnit.purchase_order_line_id,
    ],
  );
  const byLine = new Map<string, typeof notes.rows>();
  for (const row of notes.rows) {
    const key = `${row.credit_note_id}:${row.credit_line_id}`;
    byLine.set(key, [...(byLine.get(key) ?? []), row]);
  }
  for (const rows of byLine.values()) {
    const first = rows[0]!;
    if (
      Number(first.credited_quantity) <= 0 ||
      Number(first.credited_amount) <= 0
    )
      continue;
    const releasedQuantity = rows.reduce(
      (sum, row) => sum + Number(row.released_quantity),
      0,
    );
    if (
      releasedQuantity !== Number(first.credited_quantity) ||
      !Number.isSafeInteger(releasedQuantity)
    ) {
      await createAmbiguityWork({
        tx: input.tx,
        entityId: String(first.credit_note_id),
        label: `Credit Note ${first.credit_note_id}`,
      });
      continue;
    }
    const releasedUnits: Unit[] = [];
    let ambiguous = false;
    for (const row of rows) {
      if (!row.goods_receipt_line_id) {
        ambiguous = true;
        break;
      }
      const allocationUnits = await unitsForAllocation(
        input.tx,
        String(row.allocation_id),
        String(row.goods_receipt_line_id),
        String(first.credit_note_id),
      );
      const quantity = Number(row.released_quantity);
      if (
        !allocationUnits ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        quantity > allocationUnits.length
      ) {
        ambiguous = true;
        break;
      }
      releasedUnits.push(...allocationUnits.slice(0, quantity));
    }
    if (ambiguous || releasedUnits.length !== releasedQuantity) {
      await createAmbiguityWork({
        tx: input.tx,
        entityId: String(first.credit_note_id),
        label: `Credit Note ${first.credit_note_id}`,
      });
      continue;
    }
    const sorted = [...releasedUnits].sort((a, b) =>
      a.received_unit_id.localeCompare(b.received_unit_id),
    );
    const index = sorted.findIndex(
      (unit) => unit.received_unit_id === input.assetUnit.received_unit_id,
    );
    if (index < 0) continue;
    const amounts = splitMinorUnits(
      String(first.credited_amount),
      sorted.length,
      String(first.currency).trim(),
    );
    const amount = amounts[index];
    if (!amount || !input.assetUnit.asset_id) continue;
    await recordCostProvenance({
      tx: input.tx,
      actorId: "cost-provenance-linker",
      correlationId: input.correlationId,
      causationId: input.causationId,
      value: {
        targetType: "ASSET",
        targetId: input.assetUnit.asset_id,
        sourceType: "CREDIT_NOTE",
        sourceDocumentId: String(first.credit_note_id),
        sourceVersionRef: String(first.snapshot_fingerprint).trim(),
        sourceLineId: String(first.credit_line_id),
        basis: "ADJUSTMENT",
        adjustmentDirection: "CREDIT",
        amount,
        currency: String(first.currency).trim(),
        quantity: 1,
        allocationMethod: "CREDIT_NOTE_RELEASE_UNIT_SPLIT",
        allocationRole: `RECEIPT:${input.assetUnit.goods_receipt_line_id}:UNIT:${input.assetUnit.received_unit_id}`,
      },
    });
  }
}

async function reconcileAsset(input: {
  tx: Transaction;
  assetId: string;
  correlationId: string;
  causationId: string;
}) {
  const unit = await unitForAsset(input.tx, input.assetId);
  if (!unit) return;
  await recordCommittedCost({ ...input, unit });
  await recordActualForAsset({ ...input, unit });
  const credits = await input.tx.query(
    `SELECT DISTINCT cn.id FROM procurement.credit_notes cn
       JOIN procurement.credit_note_lines cl ON cl.tenant_id=cn.tenant_id AND cl.credit_note_id=cn.id
       JOIN procurement.credit_note_allocation_releases rel ON rel.tenant_id=cl.tenant_id AND rel.credit_note_line_id=cl.id
       JOIN procurement.invoice_match_allocations a ON a.tenant_id=rel.tenant_id AND a.id=rel.allocation_id
      WHERE cn.tenant_id=$1 AND cn.lifecycle_state='APPLIED'
        AND (a.goods_receipt_line_id=$2 OR a.purchase_order_line_id=$3)`,
    [
      input.tx.tenantId,
      unit.goods_receipt_line_id,
      unit.purchase_order_line_id,
    ],
  );
  for (const row of credits.rows)
    await recordCreditAdjustments({
      ...input,
      assetUnit: unit,
      creditNoteId: String(row.id),
    });
}

export async function processCostProvenanceEvent(
  uow: UnitOfWork,
  event: EventEnvelope,
) {
  return consume(uow, CONSUMER, event, async (tx, committed) => {
    const payload = committed.payload as Record<string, unknown>;
    if (committed.event_type === "ASSET.CREATED") {
      const assetId = String(payload.asset_id ?? "");
      if (assetId)
        await reconcileAsset({
          tx,
          assetId,
          correlationId: committed.correlation_id,
          causationId: committed.event_id,
        });
      await tx.query(
        "DELETE FROM procurement.cost_provenance_retries WHERE tenant_id=$1 AND event_id=$2",
        [tx.tenantId, committed.event_id],
      );
      return;
    }
    if (committed.event_type === "INVOICE.APPROVED") {
      const result = await tx.query(
        `SELECT DISTINCT r.asset_id FROM procurement.invoice_match_allocations a
         JOIN procurement.invoices i ON i.tenant_id=a.tenant_id AND i.id=a.invoice_id
         LEFT JOIN procurement.goods_receipt_units u ON u.tenant_id=a.tenant_id AND u.goods_receipt_id=a.goods_receipt_id AND u.goods_receipt_line_id=a.goods_receipt_line_id AND u.accepted
         LEFT JOIN asset.received_unit_registrations r ON r.tenant_id=u.tenant_id AND r.received_unit_id=u.id
         WHERE i.tenant_id=$1 AND i.id=$2 AND i.lifecycle_state='APPROVED'
           AND a.evaluation_id=i.current_match_evaluation_id AND r.asset_id IS NOT NULL`,
        [tx.tenantId, payload.invoice_id],
      );
      for (const row of result.rows)
        await reconcileAsset({
          tx,
          assetId: String(row.asset_id),
          correlationId: committed.correlation_id,
          causationId: committed.event_id,
        });
      await tx.query(
        "DELETE FROM procurement.cost_provenance_retries WHERE tenant_id=$1 AND event_id=$2",
        [tx.tenantId, committed.event_id],
      );
      return;
    }
    const noteId = String(payload.credit_note_id ?? "");
    if (!noteId) {
      await tx.query(
        "DELETE FROM procurement.cost_provenance_retries WHERE tenant_id=$1 AND event_id=$2",
        [tx.tenantId, committed.event_id],
      );
      return;
    }
    const result = await tx.query(
      `SELECT DISTINCT r.asset_id FROM procurement.credit_note_lines cl
       JOIN procurement.credit_notes cn ON cn.tenant_id=cl.tenant_id AND cn.id=cl.credit_note_id
       JOIN procurement.credit_note_allocation_releases rel ON rel.tenant_id=cl.tenant_id AND rel.credit_note_line_id=cl.id
       JOIN procurement.invoice_match_allocations a ON a.tenant_id=rel.tenant_id AND a.id=rel.allocation_id
       LEFT JOIN procurement.goods_receipt_units u ON u.tenant_id=a.tenant_id AND u.goods_receipt_id=a.goods_receipt_id AND u.goods_receipt_line_id=a.goods_receipt_line_id AND u.accepted
       LEFT JOIN asset.received_unit_registrations r ON r.tenant_id=u.tenant_id AND r.received_unit_id=u.id
       WHERE cn.tenant_id=$1 AND cn.id=$2 AND cn.lifecycle_state='APPLIED' AND r.asset_id IS NOT NULL`,
      [tx.tenantId, noteId],
    );
    for (const row of result.rows)
      await reconcileAsset({
        tx,
        assetId: String(row.asset_id),
        correlationId: committed.correlation_id,
        causationId: committed.event_id,
      });
    await tx.query(
      "DELETE FROM procurement.cost_provenance_retries WHERE tenant_id=$1 AND event_id=$2",
      [tx.tenantId, committed.event_id],
    );
  });
}

export async function recordCostProvenanceRetryFailure(input: {
  uow: UnitOfWork;
  event: EventEnvelope;
  failureCode?: string;
}) {
  const code = input.failureCode ?? "COST_PROVENANCE_LINK_FAILED";
  await input.uow.run(input.event.tenant_id, async (tx) => {
    const retry = await tx.query<{
      attempt_count: number;
      status: "PENDING" | "FAILED";
    }>(
      `INSERT INTO procurement.cost_provenance_retries(tenant_id,event_id,attempt_count,next_attempt_at,status,failure_code,updated_at)
       VALUES($1,$2,1,now()+interval '2 seconds','PENDING',$3,now())
       ON CONFLICT(tenant_id,event_id) DO UPDATE SET
         attempt_count=procurement.cost_provenance_retries.attempt_count+1,
         next_attempt_at=now()+make_interval(secs=>LEAST(300,power(2,LEAST(procurement.cost_provenance_retries.attempt_count+1,8))::integer)),
         status=CASE WHEN procurement.cost_provenance_retries.attempt_count+1 >= $4 THEN 'FAILED' ELSE 'PENDING' END,
         failure_code=EXCLUDED.failure_code,updated_at=now()
       RETURNING attempt_count,status`,
      [tx.tenantId, input.event.event_id, code, MAX_RETRY_ATTEMPTS],
    );
    const row = retry.rows[0]!;
    if (row.status === "FAILED") {
      await upsertCostProvenanceWorkItem({
        tx,
        sourceId: input.event.event_id,
        title: `Cost provenance linkage for ${input.event.aggregate.type} ${input.event.aggregate.id} failed after ${row.attempt_count} attempts (${code}); reconcile the commercial source and retry manually.`,
      });
    }
  });
}

export function costProvenanceTask(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  reportFailure?: () => void;
}): WorkerTask {
  return {
    name: "cost-provenance-linker",
    async run(signal) {
      while (!signal.aborted) {
        try {
          const result = await input.pool.query<{
            event_id: string;
            payload: EventEnvelope;
          }>(
            `SELECT o.event_id,o.payload FROM platform.outbox_events o
              LEFT JOIN procurement.cost_provenance_retries r ON r.tenant_id=o.tenant_id AND r.event_id=o.event_id
              WHERE o.event_type=ANY($1::text[])
                AND (r.event_id IS NULL OR (r.status='PENDING' AND r.next_attempt_at<=now()))
                AND NOT EXISTS (SELECT 1 FROM platform.inbox_events i WHERE i.consumer_name=$2 AND i.event_id=o.event_id AND i.tenant_id=o.tenant_id AND i.status='PROCESSED')
              ORDER BY o.created_at,o.id LIMIT 50`,
            [INPUT_EVENTS, CONSUMER],
          );
          if (!result.rowCount) {
            await wait(signal, 1000);
            continue;
          }
          for (const row of result.rows) {
            if (signal.aborted) break;
            try {
              await processCostProvenanceEvent(input.uow, {
                ...row.payload,
                published_at:
                  row.payload.published_at ?? new Date().toISOString(),
              });
            } catch {
              input.reportFailure?.();
              try {
                await recordCostProvenanceRetryFailure({
                  uow: input.uow,
                  event: row.payload,
                });
              } catch {
                input.reportFailure?.();
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
