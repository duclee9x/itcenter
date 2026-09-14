import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../../../packages/config/src/index.js";
import type { Principal } from "../../../packages/auth/src/index.js";
import {
  ApplicationError,
  errorResponse,
} from "../../../packages/api-contracts/src/index.js";
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
  activateDeploymentReservation,
  releaseDeploymentReservation,
  reserveLicenseForDeployment,
} from "../../../modules/license/index.js";
import { resolveDeploymentAgentContext } from "../../../modules/agent/index.js";
import {
  claimDeploymentTarget,
  nextDeploymentCandidate,
  reportDeploymentResult,
  type DeploymentReport,
} from "../../../modules/software/index.js";
import { json } from "../../../packages/observability/src/index.js";
import {
  agentMessageIdempotencyPrincipal,
  withAgentMessageReceipt,
} from "./agent-message.js";

export interface ArtifactDeliveryPort {
  issueDownloadGrant(input: {
    tenantId: string;
    agentId: string;
    artifactVersionId: string;
    storageRef: string;
    checksumSha256: string;
    expiresAt: string;
  }): Promise<{ url: string; expiresAt: string }>;
}

export interface AgentDeploymentAdapters {
  artifactDelivery?: ArtifactDeliveryPort;
}

async function appendLicenseFact(input: {
  tx: Transaction;
  config: Config;
  principal: Principal;
  context: CorrelationContext;
  eventType: string;
  aggregateType: "LICENSE_RESERVATION" | "LICENSE_ASSIGNMENT";
  aggregateId: string;
  version: number;
  key: string;
  payload: Record<string, unknown>;
  reason: string;
}) {
  const now = new Date().toISOString();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: randomUUID(),
    event_type: input.eventType,
    schema_version: 1,
    occurred_at: now,
    producer: { service: input.config.serviceName, instance: "agent-gateway" },
    aggregate: {
      type: input.aggregateType,
      id: input.aggregateId,
      version: input.version,
    },
    actor: { type: input.principal.actor_type, id: input.principal.id },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    tenant_id: input.principal.tenant_id,
    organization_id: input.principal.tenant_id,
    idempotency_key: input.key,
    payload: input.payload as never,
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: input.eventType,
    occurred_at: now,
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: { command_type: input.eventType },
    subject: { entity_type: input.aggregateType, entity_id: input.aggregateId },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: { code: input.eventType, text: input.reason },
    before: null,
    after: input.payload as never,
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
}

async function parseBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > 16384)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
    chunks.push(part);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApplicationError("VALIDATION_ERROR", "JSON object is required.");
  return value as Record<string, unknown>;
}

function only(input: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request contains unsupported fields.",
    );
}

function safeSummary(value: unknown) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 500)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "summary must be at most 500 characters.",
    );
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(
      /((?:password|token|secret|api[_-]?key|license[_-]?key)\s*[:=]\s*)\S+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 500);
}

function requireText(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (typeof value !== "string" || !value.trim())
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return value.trim();
}

function checkGrant(
  grant: { url: string; expiresAt: string },
  requestedExpiry: string,
) {
  let parsed: URL;
  try {
    parsed = new URL(grant.url);
  } catch {
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "Artifact delivery returned an invalid grant.",
    );
  }
  const expiry = Date.parse(grant.expiresAt);
  const now = Date.now();
  if (
    parsed.protocol !== "https:" ||
    !Number.isFinite(expiry) ||
    expiry <= now ||
    expiry > now + 300_000 ||
    expiry > Date.parse(requestedExpiry)
  )
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "Artifact delivery grant must be HTTPS and expire within five minutes.",
    );
  return { url: grant.url, expires_at: new Date(expiry).toISOString() };
}

async function appendClaimEffects(input: {
  tx: Transaction;
  config: Config;
  principal: Principal;
  context: CorrelationContext;
  key: string;
  job: {
    target_id: string;
    campaign_id: string;
    asset_id: string;
    attempt_number: number;
    lease_expires_at: string;
    version: number;
    resume_after_reboot: boolean;
  };
}) {
  const now = new Date().toISOString();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: randomUUID(),
    event_type: "SOFTWARE.DEPLOYMENT_JOB_CLAIMED",
    schema_version: 1,
    occurred_at: now,
    producer: { service: input.config.serviceName, instance: "agent-gateway" },
    aggregate: {
      type: "SOFTWARE_DEPLOYMENT_TARGET",
      id: String(input.job.target_id),
      version: Number(input.job.version),
    },
    actor: { type: input.principal.actor_type, id: input.principal.id },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    tenant_id: input.principal.tenant_id,
    organization_id: input.principal.tenant_id,
    idempotency_key: input.key,
    payload: {
      campaign_id: input.job.campaign_id,
      deployment_job_id: input.job.target_id,
      asset_id: input.job.asset_id,
      agent_id: input.principal.id,
      attempt_number: input.job.attempt_number,
      lease_expires_at: input.job.lease_expires_at,
    },
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: "SOFTWARE.DEPLOYMENT_JOB_CLAIMED",
    occurred_at: now,
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: { command_type: "SOFTWARE.DEPLOYMENT_JOB_CLAIM" },
    subject: {
      entity_type: "SOFTWARE_DEPLOYMENT_TARGET",
      entity_id: String(input.job.target_id),
    },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: {
      code: "AGENT_JOB_CLAIM",
      text: "Authenticated agent claimed an eligible deployment.",
    },
    before: {
      state: input.job.resume_after_reboot ? "WAITING_REBOOT" : "QUEUED",
    },
    after: {
      state: "CLAIMED",
      campaign_id: input.job.campaign_id,
      asset_id: input.job.asset_id,
      attempt_number: input.job.attempt_number,
      lease_expires_at: input.job.lease_expires_at,
    },
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
}

async function appendReportEffects(input: {
  tx: Transaction;
  config: Config;
  principal: Principal;
  context: CorrelationContext;
  key: string;
  result: Awaited<ReturnType<typeof reportDeploymentResult>>;
}) {
  const now = new Date().toISOString();
  for (const [index, fact] of input.result.facts.entries()) {
    const campaignEvent = fact.type.startsWith("SOFTWARE.DEPLOYMENT_CAMPAIGN_");
    await new PostgresOutboxWriter(input.tx).append({
      event_id: randomUUID(),
      event_type: fact.type,
      schema_version: 1,
      occurred_at: now,
      producer: {
        service: input.config.serviceName,
        instance: "agent-gateway",
      },
      aggregate: {
        type: campaignEvent
          ? "SOFTWARE_DEPLOYMENT_CAMPAIGN"
          : "SOFTWARE_DEPLOYMENT_TARGET",
        id: campaignEvent ? String(fact.payload.campaign_id) : input.result.id,
        version: campaignEvent
          ? Number(fact.payload.version)
          : input.result.target_version,
      },
      actor: { type: input.principal.actor_type, id: input.principal.id },
      correlation_id: input.context.correlation_id,
      causation_id: input.context.causation_id,
      tenant_id: input.principal.tenant_id,
      organization_id: input.principal.tenant_id,
      idempotency_key: `${input.key}:${index}`,
      payload: fact.payload as never,
    });
  }
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: input.result.event_type,
    occurred_at: now,
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: { command_type: "SOFTWARE.DEPLOYMENT_JOB_REPORT" },
    subject: {
      entity_type: "SOFTWARE_DEPLOYMENT_TARGET",
      entity_id: input.result.id,
    },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: { code: input.result.outcome, text: input.result.outcome },
    before: { state: "CLAIMED", attempt_number: input.result.attempt_number },
    after: {
      state: input.result.state,
      outcome: input.result.outcome,
      retryable: input.result.retryable,
      attempt_id: input.result.attempt_id,
      installation_id: input.result.installation_id,
    },
    outcome: {
      status: input.result.state === "SUCCESS" ? "SUCCESS" : "FAILURE",
    },
    classification:
      input.result.outcome === "ARTIFACT_REJECTED" ? "SECURITY" : "INTERNAL",
    relations: [],
    evidence: [],
  });
  for (const fact of input.result.facts) {
    if (!fact.type.startsWith("SOFTWARE.DEPLOYMENT_CAMPAIGN_")) continue;
    await new PostgresAudit(input.tx).append({
      id: randomUUID(),
      tenant_id: input.principal.tenant_id,
      event_type: fact.type,
      occurred_at: now,
      actor: { type: input.principal.actor_type, id: input.principal.id },
      action: { command_type: fact.type },
      subject: {
        entity_type: "SOFTWARE_DEPLOYMENT_CAMPAIGN",
        entity_id: String(fact.payload.campaign_id),
      },
      correlation_id: input.context.correlation_id,
      causation_id: input.context.causation_id,
      reason: { code: fact.type, text: fact.type },
      before: { state: "ACTIVE" },
      after: fact.payload as never,
      outcome: { status: "SUCCESS" },
      classification: "INTERNAL",
      relations: [],
      evidence: [],
    });
  }
}

export async function handleAgentSoftwareDeploymentRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  config: Config;
  principal: Principal;
  uow: UnitOfWork;
  adapters?: AgentDeploymentAdapters;
}): Promise<boolean> {
  const { req, res, context, config, principal, uow, adapters } = input;
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const isClaim =
    req.method === "POST" && path === "/api/v1/agent/deployments/claim";
  const reportPath =
    /^\/api\/v1\/agent\/deployments\/([^/]+)\/commands\/report$/.exec(path);
  const isReport = req.method === "POST" && !!reportPath;
  if (!isClaim && !isReport) return false;
  if (principal.actor_type !== "AGENT")
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Only an authenticated enrolled agent may use deployment routes.",
    );

  const body = await parseBody(req);
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !key.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );

  if (isClaim) {
    only(body, []);
    if (!adapters?.artifactDelivery)
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "Trusted artifact delivery is not configured.",
        true,
      );
    const intent = {
      principalId: agentMessageIdempotencyPrincipal(principal),
      operation: "SOFTWARE.DEPLOYMENT_AGENT_CLAIM",
      businessScope: principal.id,
      key,
      semanticRequest: { agent_id: principal.id },
      expiresAt: new Date(Date.now() + 86400000),
    };
    let previous = await uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).findPrevious(intent),
    );
    if (!previous) {
      const agentContext = await uow.run(principal.tenant_id, (tx) =>
        resolveDeploymentAgentContext({ tx, agentId: principal.id }),
      );
      const candidate = await uow.run(principal.tenant_id, (tx) =>
        nextDeploymentCandidate(tx, { assetId: agentContext.asset_id }),
      );
      if (!candidate) {
        previous = await uow.run(principal.tenant_id, (tx) =>
          withAgentMessageReceipt({
            tx,
            req,
            principal,
            body,
            production: config.environment === "production",
            process: () =>
              new PostgresIdempotencyStore(tx).execute(intent, async () => ({
                status: 200,
                body: null as never,
              })),
          }),
        );
        json(res, 200, { data: null, meta: context });
        return true;
      }
      previous = await uow.run(principal.tenant_id, (tx) =>
        withAgentMessageReceipt({
          tx,
          req,
          principal,
          body,
          production: config.environment === "production",
          process: () =>
            new PostgresIdempotencyStore(tx).execute(intent, async () => {
              if (candidate.license_required) {
                const reservation = await reserveLicenseForDeployment({
                  tx,
                  softwareProductId: candidate.product_id,
                  assetId: agentContext.asset_id,
                  deploymentTargetId: candidate.target_id,
                  actorId: principal.id,
                });
                if (reservation.created && reservation.id) {
                  await appendLicenseFact({
                    tx,
                    config,
                    principal,
                    context,
                    eventType: "LICENSE.RESERVED",
                    aggregateType: "LICENSE_RESERVATION",
                    aggregateId: reservation.id,
                    version: reservation.version,
                    key: `license-reserve:${candidate.target_id}`,
                    payload: {
                      reservation_id: reservation.id,
                      entitlement_id: reservation.entitlement_id,
                      deployment_target_id: candidate.target_id,
                      asset_id: agentContext.asset_id,
                    },
                    reason:
                      "License seat reserved before deployment execution.",
                  });
                }
              }
              const leaseId = randomUUID();
              const now = new Date();
              const leaseExpiresAt = new Date(
                now.getTime() + 180_000,
              ).toISOString();
              const job = await claimDeploymentTarget({
                tx,
                candidate,
                agentId: principal.id,
                assetId: agentContext.asset_id,
                leaseId,
                leaseExpiresAt,
                now: now.toISOString(),
              });
              await appendClaimEffects({
                tx,
                config,
                principal,
                context,
                key,
                job: { ...job, asset_id: agentContext.asset_id },
              });
              return {
                status: 200,
                body: { ...job, asset_id: agentContext.asset_id } as never,
              };
            }),
        }),
      );
    }
    const claimed = previous.body as Record<string, unknown>;
    if (
      typeof claimed.lease_expires_at !== "string" ||
      Date.parse(claimed.lease_expires_at) <= Date.now()
    )
      throw new ApplicationError(
        "VERSION_CONFLICT",
        "The idempotent deployment lease has expired and requires reconciliation.",
      );
    const now = Date.now();
    const requestedExpiry = new Date(now + 120_000).toISOString();
    const grant = checkGrant(
      await adapters.artifactDelivery.issueDownloadGrant({
        tenantId: principal.tenant_id,
        agentId: principal.id,
        artifactVersionId: String(claimed.artifact_version_id),
        storageRef: String(claimed.storage_ref),
        checksumSha256: String(claimed.checksum_sha256),
        expiresAt: requestedExpiry,
      }),
      requestedExpiry,
    );
    const publicJob = { ...claimed };
    delete publicJob.storage_ref;
    json(res, 200, {
      data: {
        ...publicJob,
        asset_id: claimed.asset_id,
        download_url: grant.url,
        download_expires_at: grant.expires_at,
        verification: {
          checksum_sha256: claimed.checksum_sha256,
          signature_required: true,
          expected_product_code: claimed.product_code,
          expected_version: claimed.version_label,
        },
      },
      meta: context,
    });
    return true;
  }

  only(body, [
    "lease_id",
    "outcome",
    "precheck_passed",
    "checksum_verified",
    "signature_verified",
    "installer_exit_code",
    "observed_product_code",
    "observed_version",
    "reboot_required",
    "retryable",
    "error_code",
    "summary",
  ]);
  if (typeof body.precheck_passed !== "boolean")
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "precheck_passed must be boolean.",
    );
  if (
    typeof body.checksum_verified !== "boolean" ||
    typeof body.signature_verified !== "boolean"
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Integrity results must be boolean.",
    );
  const outcomes = [
    "PRECHECK_FAILED",
    "ARTIFACT_REJECTED",
    "INSTALL_FAILED",
    "WAITING_REBOOT",
    "POSTCHECK_VERIFIED",
  ] as const;
  if (
    typeof body.outcome !== "string" ||
    !outcomes.includes(body.outcome as (typeof outcomes)[number])
  )
    throw new ApplicationError("VALIDATION_ERROR", "outcome is invalid.");
  if (
    body.installer_exit_code !== undefined &&
    !Number.isSafeInteger(body.installer_exit_code)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "installer_exit_code must be an integer.",
    );
  for (const field of [
    "observed_product_code",
    "observed_version",
    "error_code",
  ])
    if (body[field] !== undefined && typeof body[field] !== "string")
      throw new ApplicationError("VALIDATION_ERROR", `${field} must be text.`);
  for (const field of ["reboot_required", "retryable"])
    if (body[field] !== undefined && typeof body[field] !== "boolean")
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `${field} must be boolean.`,
      );
  const report: DeploymentReport = {
    leaseId: requireText(body, "lease_id"),
    outcome: body.outcome as DeploymentReport["outcome"],
    precheckPassed: body.precheck_passed,
    checksumVerified: body.checksum_verified,
    signatureVerified: body.signature_verified,
    ...(typeof body.installer_exit_code === "number"
      ? { installerExitCode: body.installer_exit_code }
      : {}),
    ...(typeof body.observed_product_code === "string"
      ? { observedProductCode: body.observed_product_code }
      : {}),
    ...(typeof body.observed_version === "string"
      ? { observedVersion: body.observed_version }
      : {}),
    ...(typeof body.reboot_required === "boolean"
      ? { rebootRequired: body.reboot_required }
      : {}),
    ...(typeof body.retryable === "boolean"
      ? { retryable: body.retryable }
      : {}),
    ...(typeof body.error_code === "string"
      ? { errorCode: body.error_code }
      : {}),
    summary: safeSummary(body.summary),
  };
  const result = await uow.run(principal.tenant_id, (tx) =>
    withAgentMessageReceipt({
      tx,
      req,
      principal,
      body,
      production: config.environment === "production",
      process: () =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: agentMessageIdempotencyPrincipal(principal),
            operation: "SOFTWARE.DEPLOYMENT_AGENT_REPORT",
            businessScope: reportPath![1]!,
            key,
            semanticRequest: body as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const changed = await reportDeploymentResult({
              tx,
              targetId: reportPath![1]!,
              agentId: principal.id,
              report,
            });
            if (changed.license_required && changed.outcome === "SUCCESS") {
              const activated = await activateDeploymentReservation({
                tx,
                deploymentTargetId: reportPath![1]!,
                softwareProductId: changed.product_id,
                assetId: changed.asset_id,
                actorId: principal.id,
              });
              if (activated.assignment_id && !activated.already_active) {
                await appendLicenseFact({
                  tx,
                  config,
                  principal,
                  context,
                  eventType: "LICENSE.ASSIGNED",
                  aggregateType: "LICENSE_ASSIGNMENT",
                  aggregateId: activated.assignment_id,
                  version: 1,
                  key: `license-assignment:${reportPath![1]!}`,
                  payload: {
                    assignment_id: activated.assignment_id,
                    entitlement_id: activated.entitlement_id,
                    principal_type: "ASSET",
                    principal_id: changed.asset_id,
                    deployment_target_id: reportPath![1]!,
                  },
                  reason:
                    "Verified deployment assigned a license to the asset.",
                });
                await appendLicenseFact({
                  tx,
                  config,
                  principal,
                  context,
                  eventType: "LICENSE.ACTIVATED",
                  aggregateType: "LICENSE_ASSIGNMENT",
                  aggregateId: activated.assignment_id,
                  version: activated.version ?? 2,
                  key: `license-activation:${reportPath![1]!}`,
                  payload: {
                    assignment_id: activated.assignment_id,
                    activated_at: new Date().toISOString(),
                    activation_source: "VERIFIED_SOFTWARE_DEPLOYMENT",
                  },
                  reason:
                    "Verified software deployment activated the license assignment.",
                });
              }
            } else if (
              changed.license_required &&
              ["PRECHECK_FAILED", "ARTIFACT_REJECTED"].includes(report.outcome)
            ) {
              const released = await releaseDeploymentReservation({
                tx,
                deploymentTargetId: reportPath![1]!,
                actorId: principal.id,
                reason: `Safe pre-execution deployment failure: ${changed.outcome}.`,
              });
              if (released) {
                await appendLicenseFact({
                  tx,
                  config,
                  principal,
                  context,
                  eventType: "LICENSE.RESERVATION_RELEASED",
                  aggregateType: "LICENSE_RESERVATION",
                  aggregateId: released.id,
                  version: released.version,
                  key: `license-release:${reportPath![1]}:${released.version}`,
                  payload: {
                    reservation_id: released.id,
                    entitlement_id: released.entitlement_id,
                    deployment_target_id: reportPath![1]!,
                    asset_id: released.asset_id,
                    reason: changed.outcome,
                  },
                  reason:
                    "Verified pre-execution failure released the reservation.",
                });
              }
            }
            await appendReportEffects({
              tx,
              config,
              principal,
              context,
              key,
              result: changed,
            });
            return {
              status: 200,
              body: {
                deployment_job_id: changed.id,
                state: changed.state,
                outcome: changed.outcome,
                retryable: changed.retryable,
                attempt_id: changed.attempt_id,
                attempt_number: changed.attempt_number,
                installation_id: changed.installation_id,
              } as never,
            };
          },
        ),
    }),
  );
  json(res, result.status, { data: result.body, meta: context });
  return true;
}

export function deploymentAgentFailure(
  error: unknown,
  context: CorrelationContext,
) {
  return errorResponse(error, context);
}
