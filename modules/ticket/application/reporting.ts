import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import { ticketTerminalStates } from "./ticket.js";

/** Ticket-owned point-in-time read. A ticket starts in canonical NEW state. */
export async function queryOpenTicketsForReporting(input: {
  tx: Transaction;
  asOf: string;
  dimensions: Record<string, string>;
  offset?: number;
  limit?: number;
}) {
  const result = await input.tx.query<{
    id: string;
    count: string;
    generation: string;
    coverage_gap: boolean;
  }>(
    `WITH ticket_states AS (
       SELECT t.id,t.priority,
         COALESCE((SELECT tr.to_state FROM helpdesk.ticket_transitions tr
           WHERE tr.tenant_id=t.tenant_id AND tr.ticket_id=t.id AND tr.occurred_at <= $2
           ORDER BY tr.occurred_at DESC,tr.id DESC LIMIT 1),'NEW') AS state_at,
         (t.state<>'NEW' AND NOT EXISTS (SELECT 1 FROM helpdesk.ticket_transitions any_tr
           WHERE any_tr.tenant_id=t.tenant_id AND any_tr.ticket_id=t.id)) AS coverage_gap
       FROM helpdesk.tickets t
       WHERE t.tenant_id=$1 AND t.created_at <= $2
         AND ($4::text IS NULL OR t.priority=$4)
     ), eligible AS (
       SELECT * FROM ticket_states WHERE state_at <> ALL($3::text[])
     )
     SELECT id,count(*) OVER()::text AS count,
       md5(COALESCE(string_agg(id::text || ':' || state_at,',') OVER (
         ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING),'')) AS generation,
       bool_or(coverage_gap) OVER() AS coverage_gap
       FROM eligible ORDER BY id OFFSET $5 LIMIT $6`,
    [
      input.tx.tenantId,
      input.asOf,
      ticketTerminalStates,
      input.dimensions.priority ?? null,
      input.offset ?? 0,
      input.limit ?? 1000000,
    ],
  );
  return {
    count: BigInt(result.rows[0]?.count ?? "0"),
    ids: result.rows.map((row) => row.id),
    source: "tickets",
    source_generation: result.rows[0]?.generation ?? "empty",
    coverage: result.rows.some((row) => row.coverage_gap)
      ? "PARTIAL"
      : "COMPLETE",
  };
}

export async function queryOpenTicketDrilldown(input: {
  tx: Transaction;
  asOf: string;
  dimensions: Record<string, string>;
  offset: number;
  limit: number;
}) {
  return queryOpenTicketsForReporting(input);
}

/** Minimal Ticket-owned dimensions for canonical SLA obligations. */
export async function queryTicketPrioritiesForReporting(input: {
  tx: Transaction;
  ticketIds: string[];
}) {
  if (input.ticketIds.length === 0) return new Map<string, string>();
  const result = await input.tx.query<{ id: string; priority: string }>(
    `SELECT id,priority FROM helpdesk.tickets
      WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,
    [input.tx.tenantId, input.ticketIds],
  );
  if (result.rowCount !== new Set(input.ticketIds).size)
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "Canonical Ticket dimensions are unavailable for an SLA obligation.",
    );
  return new Map(result.rows.map((row) => [row.id, row.priority]));
}
