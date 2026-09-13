import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import type {
  AuthorizationPort,
  Principal,
} from "../../../packages/auth/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
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

export const KNOWLEDGE_AUDIENCES = ["END_USER_SAFE", "OPERATOR_ONLY"] as const;
export type KnowledgeAudience = (typeof KNOWLEDGE_AUDIENCES)[number];
export const KNOWLEDGE_APPLICABILITY_TYPES = [
  "SERVICE",
  "PLATFORM",
  "SERVICE_ENVIRONMENT",
  "SOFTWARE_PRODUCT",
  "PROBLEM",
  "KNOWN_ERROR",
] as const;
export type KnowledgeApplicabilityType =
  (typeof KNOWLEDGE_APPLICABILITY_TYPES)[number];
export interface KnowledgeApplicabilityTarget {
  type: KnowledgeApplicabilityType;
  id: string;
}
export interface KnowledgeApplicabilityTargetStatus {
  exists: boolean;
  active: boolean;
}
export type KnowledgeApplicabilityResolver = (
  tx: Transaction,
  target: KnowledgeApplicabilityTarget,
) => Promise<KnowledgeApplicabilityTargetStatus>;

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function readKnowledgeArticle(tx: Transaction, id: string) {
  const result = await tx.query<{
    id: string;
    tenant_id: string;
    slug: string;
    title: string;
    body: string;
    state: string;
    audience: KnowledgeAudience;
    version: number;
    updated_at: string;
  }>(
    `SELECT id,tenant_id,slug,title,body,state,audience,version,updated_at
       FROM problem.knowledge_articles WHERE tenant_id=$1 AND id=$2`,
    [tx.tenantId, id],
  );
  return result.rows[0] ?? null;
}

export async function readProblemRecommendationReference(
  tx: Transaction,
  id: string,
  kind: "PROBLEM" | "KNOWN_ERROR",
) {
  const result = await tx.query<{ id: string; state: string }>(
    `SELECT id,state FROM problem.problems WHERE tenant_id=$1 AND id=$2`,
    [tx.tenantId, id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const active =
    kind === "KNOWN_ERROR"
      ? row.state === "KNOWN_ERROR"
      : !["CLOSED", "CANCELLED"].includes(row.state);
  return { id: row.id, state: row.state, active };
}

/** Canonical fail-closed check used immediately before Knowledge presentation. */
export async function readKnowledgeRecommendationEligibility(input: {
  tx: Transaction;
  knowledgeId: string;
  knowledgeVersion: number;
}) {
  const article = await input.tx.query<{
    id: string;
    slug: string;
    title: string;
    body: string;
    version: number;
    state: string;
    audience: string;
  }>(
    `SELECT id,slug,title,body,version,state,audience
       FROM problem.knowledge_articles
      WHERE tenant_id=$1 AND id=$2 AND version=$3
        AND state='PUBLISHED' AND audience='END_USER_SAFE'`,
    [input.tx.tenantId, input.knowledgeId, input.knowledgeVersion],
  );
  const row = article.rows[0];
  return row
    ? {
        eligible: true as const,
        knowledge_id: row.id,
        version: row.version,
        state: row.state,
        audience: row.audience,
        title: row.title,
        body: row.body,
      }
    : { eligible: false as const };
}

export async function queryKnowledgeRecommendationEligibility(input: {
  tx: Transaction;
  authorization: AuthorizationPort;
  principal: Principal;
  context: CorrelationContext;
  knowledgeId: string;
  knowledgeVersion: number;
}) {
  if (input.principal.tenant_id !== input.tx.tenantId)
    return { eligible: false as const };
  const canonical = await readKnowledgeRecommendationEligibility(input);
  if (!canonical.eligible) return canonical;
  const decision = await input.authorization.evaluate({
    principal: input.principal,
    action: "knowledge.read",
    resource: {
      type: "knowledge",
      id: canonical.knowledge_id,
      tenant_id: input.tx.tenantId,
    },
    scope: {},
    context: { ...input.context },
  });
  return decision.result === "ALLOW" ? canonical : { eligible: false as const };
}

export async function isKnowledgeSearchCandidateCurrent(input: {
  tx: Transaction;
  knowledgeId: string;
  knowledgeVersion: number;
  audience: string;
}) {
  const result = await input.tx.query(
    `SELECT 1 FROM problem.knowledge_articles
      WHERE tenant_id=$1 AND id=$2 AND version=$3 AND state='PUBLISHED' AND audience=$4`,
    [
      input.tx.tenantId,
      input.knowledgeId,
      input.knowledgeVersion,
      input.audience,
    ],
  );
  return Boolean(result.rowCount);
}

export async function updateKnowledgeAudience(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  audience: KnowledgeAudience;
}) {
  if (!(KNOWLEDGE_AUDIENCES as readonly string[]).includes(input.audience))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Knowledge audience is invalid.",
    );
  const current = await input.tx.query<{
    id: string;
    state: string;
    audience: KnowledgeAudience;
    version: number;
  }>(
    "SELECT id,state,audience,version FROM problem.knowledge_articles WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.id],
  );
  if (!current.rowCount)
    throw new ApplicationError("NOT_FOUND", "Knowledge article was not found.");
  assertVersion(current.rows[0]!.version, input.expectedVersion);
  const updated = await input.tx.query(
    `UPDATE problem.knowledge_articles SET audience=$1,version=version+1,updated_at=now()
      WHERE tenant_id=$2 AND id=$3 AND version=$4 RETURNING id,state,audience,version`,
    [input.audience, input.tx.tenantId, input.id, input.expectedVersion],
  );
  if (!updated.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Knowledge article version has changed.",
    );
  return { before: current.rows[0]!, after: updated.rows[0]! };
}

export async function replaceKnowledgeApplicability(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  targets: KnowledgeApplicabilityTarget[];
  resolveTarget: KnowledgeApplicabilityResolver;
  actorId: string;
}) {
  if (!Array.isArray(input.targets) || input.targets.length > 100)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Applicability targets are invalid.",
    );
  const current = await input.tx.query<{
    id: string;
    version: number;
    state: string;
  }>(
    "SELECT id,version,state FROM problem.knowledge_articles WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.id],
  );
  if (!current.rowCount)
    throw new ApplicationError("NOT_FOUND", "Knowledge article was not found.");
  assertVersion(current.rows[0]!.version, input.expectedVersion);
  const seen = new Set<string>();
  for (const target of input.targets) {
    if (
      !target ||
      typeof target !== "object" ||
      !(KNOWLEDGE_APPLICABILITY_TYPES as readonly string[]).includes(
        target.type,
      ) ||
      typeof target.id !== "string" ||
      !uuid(target.id)
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Applicability target is invalid.",
      );
    const identity = `${target.type}:${target.id.toLowerCase()}`;
    if (seen.has(identity))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Applicability target is duplicated.",
      );
    seen.add(identity);
    const status =
      target.type === "PROBLEM" || target.type === "KNOWN_ERROR"
        ? await readProblemApplicabilityTarget(input.tx, target)
        : await input.resolveTarget(input.tx, target);
    if (!status.exists)
      throw new ApplicationError(
        "NOT_FOUND",
        "Applicability target was not found.",
      );
    if (!status.active)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Inactive applicability targets cannot be added.",
      );
  }
  const before = await input.tx.query(
    `SELECT target_type,coalesce(service_id,platform_id,service_environment_id,software_product_id,problem_id)::text AS target_id
       FROM problem.knowledge_applicability WHERE tenant_id=$1 AND knowledge_id=$2
       ORDER BY target_type,target_id`,
    [input.tx.tenantId, input.id],
  );
  await input.tx.query(
    "DELETE FROM problem.knowledge_applicability WHERE tenant_id=$1 AND knowledge_id=$2",
    [input.tx.tenantId, input.id],
  );
  const columns: Record<KnowledgeApplicabilityType, string> = {
    SERVICE: "service_id",
    PLATFORM: "platform_id",
    SERVICE_ENVIRONMENT: "service_environment_id",
    SOFTWARE_PRODUCT: "software_product_id",
    PROBLEM: "problem_id",
    KNOWN_ERROR: "problem_id",
  };
  for (const target of input.targets) {
    const column = columns[target.type];
    await input.tx.query(
      `INSERT INTO problem.knowledge_applicability(id,tenant_id,knowledge_id,target_type,${column},created_by)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        randomUUID(),
        input.tx.tenantId,
        input.id,
        target.type,
        target.id,
        input.actorId,
      ],
    );
  }
  const updated = await input.tx.query(
    `UPDATE problem.knowledge_articles SET version=version+1,updated_at=now()
      WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING id,state,version`,
    [input.tx.tenantId, input.id, input.expectedVersion],
  );
  if (!updated.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Knowledge article version has changed.",
    );
  return {
    before: before.rows,
    after: input.targets.map((target) => ({
      target_type: target.type,
      target_id: target.id,
    })),
    knowledge: updated.rows[0],
  };
}

async function readProblemApplicabilityTarget(
  tx: Transaction,
  target: KnowledgeApplicabilityTarget,
): Promise<KnowledgeApplicabilityTargetStatus> {
  const result = await tx.query<{ state: string }>(
    "SELECT state FROM problem.problems WHERE tenant_id=$1 AND id=$2 FOR SHARE",
    [tx.tenantId, target.id],
  );
  if (!result.rowCount) return { exists: false, active: false };
  return {
    exists: true,
    active:
      target.type === "KNOWN_ERROR"
        ? result.rows[0]!.state === "KNOWN_ERROR"
        : result.rows[0]!.state !== "CLOSED" &&
          result.rows[0]!.state !== "CANCELLED",
  };
}
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
  const updatedAt = input.kind === "KNOWLEDGE" ? ",updated_at=now()" : "";
  await input.tx.query(
    `UPDATE ${table} SET state=$1,version=$2${updatedAt} WHERE tenant_id=$3 AND id=$4`,
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
