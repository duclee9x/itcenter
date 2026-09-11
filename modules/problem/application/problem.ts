import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
const tables: Record<string, string> = {
  PROBLEM: "problem.problems",
  CHANGE: "problem.changes",
  KNOWLEDGE: "problem.knowledge_articles",
};
const transitions: Record<string, string[]> = {
  NEW: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["INVESTIGATING"],
  INVESTIGATING: ["WORKAROUND_AVAILABLE", "KNOWN_ERROR"],
  WORKAROUND_AVAILABLE: ["FIX_IN_PROGRESS"],
  KNOWN_ERROR: ["FIX_IN_PROGRESS"],
  FIX_IN_PROGRESS: ["VERIFYING_FIX"],
  VERIFYING_FIX: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  DRAFT: ["ASSESSMENT", "IN_REVIEW"],
  ASSESSMENT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["APPROVED"],
  APPROVED: ["SCHEDULED"],
  SCHEDULED: ["IMPLEMENTING"],
  IMPLEMENTING: ["VERIFYING", "FAILED"],
  VERIFYING: ["COMPLETED"],
  COMPLETED: ["CLOSED"],
  IN_REVIEW: ["PUBLISHED"],
  PUBLISHED: ["ARCHIVED"],
};
export async function createProblem(input: {
  tx: Transaction;
  kind: "PROBLEM" | "CHANGE" | "KNOWLEDGE";
  code: string;
  title: string;
  body?: string | undefined;
  risk?: string | undefined;
  impact?: string | undefined;
  implementationPlan?: string | undefined;
}) {
  const table = tables[input.kind];
  const id = randomUUID();
  if (!input.code.trim() || !input.title.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "code and title are required.",
    );
  if (
    input.kind === "CHANGE" &&
    (!input.risk?.trim() ||
      !input.impact?.trim() ||
      !input.implementationPlan?.trim())
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "change risk, impact and implementation plan are required.",
    );
  if (input.kind === "KNOWLEDGE" && !input.body?.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "knowledge body is required.",
    );
  const columns =
    input.kind === "KNOWLEDGE"
      ? "id,tenant_id,slug,title,body"
      : input.kind === "CHANGE"
        ? "id,tenant_id,code,title,risk,impact,implementation_plan"
        : "id,tenant_id,code,title";
  const values =
    input.kind === "KNOWLEDGE"
      ? [id, input.tx.tenantId, input.code, input.title, input.body]
      : input.kind === "CHANGE"
        ? [
            id,
            input.tx.tenantId,
            input.code,
            input.title,
            input.risk,
            input.impact,
            input.implementationPlan,
          ]
        : [id, input.tx.tenantId, input.code, input.title];
  const marks = values.map((_, i) => `$${i + 1}`).join(",");
  await input.tx.query(
    `INSERT INTO ${table}(${columns}) VALUES(${marks})`,
    values,
  );
  return {
    id,
    kind: input.kind,
    state: input.kind === "PROBLEM" ? "NEW" : "DRAFT",
    version: 1,
  };
}
export const createProblemRecord = createProblem;
export async function createChange(
  input: Omit<Parameters<typeof createProblem>[0], "kind">,
) {
  return createProblem({ ...input, kind: "CHANGE" });
}
export async function createKnowledge(
  input: Omit<Parameters<typeof createProblem>[0], "kind">,
) {
  return createProblem({ ...input, kind: "KNOWLEDGE" });
}
export async function transitionRecord(input: {
  tx: Transaction;
  kind: "PROBLEM" | "CHANGE" | "KNOWLEDGE";
  id: string;
  expectedVersion: number;
  targetState: string;
  reason: string;
}) {
  const table = tables[input.kind];
  if (!transitions[input.targetState] || !input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "target state and reason are required.",
    );
  const idColumn = input.kind === "KNOWLEDGE" ? "id" : "id";
  const row = await input.tx.query(
    `SELECT id,state,version FROM ${table} WHERE tenant_id=$1 AND ${idColumn}=$2 FOR UPDATE`,
    [input.tx.tenantId, input.id],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Record was not found.");
  const current = row.rows[0]!;
  assertVersion(current.version, input.expectedVersion);
  if (!transitions[String(current.state)]?.includes(input.targetState))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Invalid state transition.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    `UPDATE ${table} SET state=$1,version=$2 WHERE tenant_id=$3 AND id=$4`,
    [input.targetState, version, input.tx.tenantId, input.id],
  );
  return {
    id: input.id,
    kind: input.kind,
    from_state: String(current.state),
    to_state: input.targetState,
    version,
  };
}
