import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../../../packages/config/src/index.js";
import type { Principal } from "../../../packages/auth/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  claimRemovalJob,
  reportRemovalResult,
} from "../../../modules/software/index.js";
import { json } from "../../../packages/observability/src/index.js";

const supported = ["MSI_PRODUCT_CODE", "PACKAGE_IDENTIFIER", "MANAGED_PACKAGE"];

async function parseBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > 65536)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
    chunks.push(part);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApplicationError("VALIDATION_ERROR", "JSON object is required.");
  return body as Record<string, unknown>;
}

function text(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (typeof value !== "string" || !value.trim())
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return value.trim();
}

function only(body: Record<string, unknown>, fields: readonly string[]) {
  if (Object.keys(body).some((key) => !fields.includes(key)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request contains unsupported fields.",
    );
}

async function appendEffects(input: {
  tx: Transaction;
  config: Config;
  principal: Principal;
  context: CorrelationContext;
  key: string;
  eventType: string;
  aggregateType?: string;
  aggregateId: string;
  version: number;
  reason: string;
  after: unknown;
}) {
  const now = new Date().toISOString();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: randomUUID(),
    event_type: input.eventType,
    schema_version: 1,
    occurred_at: now,
    producer: { service: input.config.serviceName, instance: "agent-gateway" },
    aggregate: {
      type: input.aggregateType ?? "SOFTWARE_REMOVAL_JOB",
      id: input.aggregateId,
      version: input.version,
    },
    actor: { type: input.principal.actor_type, id: input.principal.id },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    tenant_id: input.principal.tenant_id,
    organization_id: input.principal.tenant_id,
    idempotency_key: input.key,
    payload: input.after as never,
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: input.eventType,
    occurred_at: now,
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: { command_type: input.eventType },
    subject: {
      entity_type: input.aggregateType ?? "SOFTWARE_REMOVAL_JOB",
      entity_id: input.aggregateId,
    },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: { code: input.eventType, text: input.reason },
    before: null,
    after: input.after as never,
    outcome: {
      status: input.eventType.endsWith("FAILED") ? "FAILURE" : "SUCCESS",
    },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
}

export async function handleAgentSoftwareRemovalRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  config: Config;
  principal: Principal;
  uow: UnitOfWork;
}): Promise<boolean> {
  const { req, res, context, config, principal, uow } = input;
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const isClaim =
    req.method === "POST" && path === "/api/v1/agent/software-removals/claim";
  const reportPath =
    /^\/api\/v1\/agent\/software-removals\/([^/]+)\/commands\/report$/.exec(
      path,
    );
  if (!isClaim && !(req.method === "POST" && reportPath)) return false;
  if (principal.actor_type !== "AGENT")
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Only an enrolled agent may use software removal routes.",
    );
  const body = await parseBody(req);
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !key.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );

  if (isClaim) {
    only(body, ["supported_methods"]);
    if (
      !Array.isArray(body.supported_methods) ||
      body.supported_methods.length < 1 ||
      body.supported_methods.length > supported.length ||
      body.supported_methods.some(
        (method) => typeof method !== "string" || !supported.includes(method),
      )
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "supported_methods must list supported symbolic methods.",
      );
    const intent = {
      principalId: principal.id,
      operation: "SOFTWARE.REMOVAL_AGENT_CLAIM",
      businessScope: principal.id,
      key,
      semanticRequest: {
        agent_id: principal.id,
        supported_methods: body.supported_methods,
      },
      expiresAt: new Date(Date.now() + 86400000),
    };
    const previous = await uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).findPrevious(intent),
    );
    if (previous) {
      const data = previous.body as Record<string, unknown>;
      if (
        data.lease_expires_at &&
        Date.parse(String(data.lease_expires_at)) <= Date.now()
      )
        throw new ApplicationError(
          "VERSION_CONFLICT",
          "Removal job lease expired; reconciliation is required.",
        );
      res.writeHead(previous.status, { "content-type": "application/json" });
      res.end(JSON.stringify({ data, meta: context }));
      return true;
    }
    const leaseId = randomUUID();
    const now = Date.now();
    const leaseExpiresAt = new Date(now + 180_000).toISOString();
    const result = await uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).execute(intent, async () => {
        const claim = await claimRemovalJob({
          tx,
          agentId: principal.id,
          supportedMethods: body.supported_methods as string[],
          leaseId,
          leaseExpiresAt,
          now: new Date(now).toISOString(),
        });
        for (const exception of claim.expired_exceptions) {
          await appendEffects({
            tx,
            config,
            principal,
            context,
            key,
            eventType: "SOFTWARE.EXCEPTION_UPDATED",
            aggregateType: "SOFTWARE_EXCEPTION",
            aggregateId: String(exception.id),
            version: Number(exception.version),
            reason: String(exception.reason),
            after: {
              software_exception_id: String(exception.id),
              state: "OPEN",
              version: Number(exception.version),
              reason: String(exception.reason),
              approval_request_id: null,
              approved_until: null,
            },
          });
        }
        if (!claim.job) return { status: 200, body: null as never };
        const job = claim.job;
        await appendEffects({
          tx,
          config,
          principal,
          context,
          key,
          eventType: "SOFTWARE.REMOVAL_JOB_CLAIMED",
          aggregateId: job.id,
          version: job.version,
          reason:
            "Authenticated agent claimed an approved symbolic removal job.",
          after: {
            removal_job_id: job.id,
            software_exception_id: job.exception_id,
            asset_id: job.asset_id,
            agent_id: principal.id,
            symbolic_method: job.symbolic_method,
            attempt_number: job.attempt_number,
            lease_expires_at: job.lease_expires_at,
          },
        });
        return { status: 200, body: job as never };
      }),
    );
    res.writeHead(result.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: result.body, meta: context }));
    return true;
  }

  only(body, ["lease_id", "outcome", "retryable", "error_code", "summary"]);
  if (!["REMOVAL_REPORTED", "FAILED"].includes(String(body.outcome)))
    throw new ApplicationError("VALIDATION_ERROR", "outcome is invalid.");
  if (typeof body.retryable !== "boolean")
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "retryable must be boolean.",
    );
  if (body.outcome === "REMOVAL_REPORTED" && body.retryable)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A reported removal cannot be retryable.",
    );
  if (
    body.error_code !== undefined &&
    (typeof body.error_code !== "string" ||
      !/^[A-Z0-9_.-]{1,64}$/.test(body.error_code))
  )
    throw new ApplicationError("VALIDATION_ERROR", "error_code must be text.");
  if (
    body.summary !== undefined &&
    (typeof body.summary !== "string" || body.summary.length > 500)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "summary must be at most 500 characters.",
    );
  const jobId = reportPath![1]!;
  const result = await uow.run(principal.tenant_id, (tx) =>
    new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation: "SOFTWARE.REMOVAL_AGENT_REPORT",
        businessScope: jobId,
        key,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        const changed = await reportRemovalResult({
          tx,
          agentId: principal.id,
          jobId,
          leaseId: text(body, "lease_id"),
          outcome: body.outcome as "REMOVAL_REPORTED" | "FAILED",
          retryable: body.retryable as boolean,
          ...(typeof body.error_code === "string"
            ? { errorCode: body.error_code }
            : {}),
          ...(typeof body.summary === "string"
            ? { summary: body.summary }
            : {}),
        });
        const eventType =
          body.outcome === "FAILED"
            ? "SOFTWARE.REMOVAL_FAILED"
            : "SOFTWARE.REMOVAL_JOB_REPORTED";
        await appendEffects({
          tx,
          config,
          principal,
          context,
          key,
          eventType,
          aggregateId: jobId,
          version: changed.version,
          reason: changed.outcome,
          after: {
            removal_job_id: changed.id,
            software_exception_id: changed.exception_id,
            outcome: changed.outcome,
            state: changed.state,
            error_code: body.error_code ?? null,
            version: changed.version,
          },
        });
        if (
          changed.exception_update &&
          typeof changed.exception_update === "object"
        ) {
          const exception = changed.exception_update as Record<string, unknown>;
          await appendEffects({
            tx,
            config,
            principal,
            context,
            key: `${key}:exception`,
            eventType: "SOFTWARE.EXCEPTION_UPDATED",
            aggregateType: "SOFTWARE_EXCEPTION",
            aggregateId: String(exception.id),
            version: Number(exception.version),
            reason: String(exception.reason),
            after: {
              software_exception_id: String(exception.id),
              state: "OPEN",
              version: Number(exception.version),
              reason: String(exception.reason),
              approval_request_id: null,
              approved_until: null,
            },
          });
        }
        return { status: 200, body: changed as never };
      },
    ),
  );
  json(res, result.status, { data: result.body, meta: context });
  return true;
}
