import type { Config } from "../../../packages/config/src/index.js";
import {
  createHttpServer,
  createHttpsServer,
  json,
  type Route,
} from "../../../packages/observability/src/index.js";
import { TLSSocket } from "node:tls";
import type { ServerOptions } from "node:https";
import type pg from "pg";
import {
  authenticate,
  type AuthenticationPort,
} from "../../../packages/auth/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import { PostgresOutboxWriter } from "../../../packages/messaging/src/index.js";
import { PostgresIdempotencyStore } from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import {
  processAgentMessage,
  recordHeartbeat,
  recordInventory,
} from "../../../modules/agent/index.js";
import { ingestSoftwareInventory } from "../../../modules/software/index.js";
import {
  createSoftwareExceptionWorkItem,
  resolveSoftwareExceptionWorkItem,
} from "../../../modules/work-queue/index.js";
import { createHash, randomUUID } from "node:crypto";
import { handleAgentAutomationActionRoute } from "./automation-action-routes.js";
import {
  handleAgentSoftwareDeploymentRoute,
  type AgentDeploymentAdapters,
} from "./software-deployment-routes.js";
import { handleAgentSoftwareRemovalRoute } from "./software-removal-routes.js";
import { handleAgentAssetWipeRoute } from "./asset-wipe-routes.js";
import { agentMessageIdempotencyPrincipal } from "./agent-message.js";
import {
  unavailableArtifactStorage,
  type ArtifactObjectStoragePort,
} from "../../../modules/artifact/application/ports.js";
import type {
  AgentPeerAuthenticationPort,
  AgentPrincipal,
} from "../../../modules/agent/application/authentication.js";
import { assertCurrentAgentPrincipal } from "../../../modules/agent/application/authentication.js";
import {
  enrollAgentCertificate,
  rotateAgentCredential,
  type AgentCertificateIssuerPort,
} from "../../../modules/agent/index.js";
// No user administration routes; dedicated adapter must authenticate enrolled agents.
function isMtlsAuthentication(
  port: AuthenticationPort | AgentPeerAuthenticationPort,
): port is AgentPeerAuthenticationPort {
  return "mode" in port && port.mode === "mtls";
}

export function agentServer(
  config: Config,
  ready: () => Promise<boolean>,
  agentAuthentication: AuthenticationPort | AgentPeerAuthenticationPort,
  uow?: UnitOfWork,
  deploymentAdapters?: AgentDeploymentAdapters,
  artifactStorage: ArtifactObjectStoragePort = unavailableArtifactStorage,
  tlsOptions?: ServerOptions,
  enrollmentDependencies?: {
    pool: pg.Pool;
    issuer: AgentCertificateIssuerPort;
  },
) {
  if (
    config.environment === "production" &&
    !isMtlsAuthentication(agentAuthentication)
  )
    throw new Error("Production Agent Gateway requires mTLS authentication");
  const sessions = new WeakMap<TLSSocket, string>();
  const route: Route = async (req, res, context) => {
    if (!req.url?.startsWith("/api/v1/agent/")) return false;
    if (req.headers["x-tenant-id"] !== undefined)
      throw new ApplicationError(
        "INVALID_TENANT_CONTEXT",
        "Agent tenant context is server-assigned.",
      );
    if (req.url === "/api/v1/agent/enroll" && req.method === "POST") {
      if (req.headers.authorization !== undefined)
        throw new ApplicationError(
          "AUTHENTICATION_REQUIRED",
          "Enrollment could not be authorized.",
        );
      if (
        config.environment === "production" &&
        (!isMtlsAuthentication(agentAuthentication) || !tlsOptions)
      )
        throw new ApplicationError(
          "DEPENDENCY_UNAVAILABLE",
          "Agent enrollment is temporarily unavailable.",
          true,
        );
      if (!(req.socket instanceof TLSSocket))
        throw new ApplicationError(
          "AUTHENTICATION_REQUIRED",
          "Enrollment could not be authorized.",
        );
      if (!uow || !enrollmentDependencies)
        throw new ApplicationError(
          "DEPENDENCY_UNAVAILABLE",
          "Agent enrollment is temporarily unavailable.",
          true,
        );
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || !idempotencyKey.trim())
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "Idempotency-Key is required.",
        );
      const body = await new Promise<string>((resolve, reject) => {
        let data = "";
        req.on("data", (chunk: Buffer | string) => {
          data += chunk.toString();
          if (Buffer.byteLength(data) > 24_576) {
            reject(
              new ApplicationError(
                "VALIDATION_ERROR",
                "Request body is too large.",
              ),
            );
            req.destroy();
          }
        });
        req.once("error", reject);
        req.once("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).some(
          (key) => !["enrollment_token", "csr"].includes(key),
        ) ||
        typeof input.enrollment_token !== "string" ||
        typeof input.csr !== "string"
      )
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "Invalid enrollment request.",
        );
      const peer = req.socket.getPeerCertificate(true);
      if (peer.raw && !req.socket.authorized)
        throw new ApplicationError(
          "AUTHENTICATION_REQUIRED",
          "Enrollment could not be authorized.",
        );
      const issued = await enrollAgentCertificate({
        pool: enrollmentDependencies.pool,
        uow,
        issuer: enrollmentDependencies.issuer,
        enrollmentToken: input.enrollment_token,
        csrPem: input.csr,
        idempotencyKey,
        audit: {
          append: async (tx, record) => {
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: "AGENT.CREDENTIAL_ISSUED",
              schema_version: 1,
              occurred_at: now,
              producer: {
                service: config.serviceName,
                instance: "agent-gateway",
              },
              aggregate: { type: "AGENT", id: record.agent_id, version: 1 },
              actor: { type: "AGENT", id: record.agent_id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: record.tenant_id,
              organization_id: record.tenant_id,
              idempotency_key: idempotencyKey,
              payload: {
                credential_id: record.credential_id,
                agent_id: record.agent_id,
                asset_id: record.asset_id,
                serial_number: record.serial_number,
                expires_at: record.expires_at.toISOString(),
              },
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: record.tenant_id,
              event_type: "AGENT.CREDENTIAL_ISSUED",
              occurred_at: now,
              actor: { type: "AGENT", id: record.agent_id },
              action: { command_type: "AGENT.ENROLL" },
              subject: {
                entity_type: "AGENT_CREDENTIAL",
                entity_id: record.credential_id,
              },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: {
                code: "ONE_TIME_ENROLLMENT",
                text: "Agent certificate enrolled",
              },
              before: null,
              after: {
                agent_id: record.agent_id,
                asset_id: record.asset_id,
                serial_number: record.serial_number,
                fingerprint_sha256: record.fingerprint_sha256,
                expires_at: record.expires_at.toISOString(),
              },
              outcome: { status: "SUCCESS" },
              classification: "RESTRICTED",
              relations: [],
              evidence: [],
            });
          },
        },
      });
      json(res, issued.created ? 201 : 200, {
        data: {
          credential_id: issued.credential_id,
          certificate_pem: issued.certificate_pem,
          expires_at: issued.expires_at.toISOString(),
        },
        meta: context,
      });
      return true;
    }
    let principal: AgentPrincipal | Awaited<ReturnType<typeof authenticate>>;
    if (isMtlsAuthentication(agentAuthentication)) {
      if (req.headers.authorization !== undefined)
        throw new ApplicationError(
          "AUTHENTICATION_REQUIRED",
          "Agent authentication failed.",
        );
      if (!(req.socket instanceof TLSSocket))
        throw new ApplicationError(
          "AUTHENTICATION_REQUIRED",
          "Agent authentication failed.",
        );
      let sessionId = sessions.get(req.socket);
      if (!sessionId) {
        sessionId = randomUUID();
        sessions.set(req.socket, sessionId);
        const auth = agentAuthentication;
        req.socket.once("close", () => {
          void auth.endSession(sessionId!);
        });
      }
      const peerCertificate = req.socket.getPeerCertificate(true);
      principal = await agentAuthentication.authenticate(
        {
          authorized: req.socket.authorized,
          raw: peerCertificate.raw ?? null,
        },
        sessionId,
      );
      res.setHeader("X-Agent-Session-ID", sessionId);
    } else {
      if (config.environment === "production")
        throw new ApplicationError(
          "AUTHENTICATION_REQUIRED",
          "Agent authentication failed.",
        );
      principal = await authenticate(
        agentAuthentication,
        req.headers.authorization,
      );
    }
    const agentContext = principal as AgentPrincipal;
    if (!uow) return false;
    const protectedUow: UnitOfWork = isMtlsAuthentication(agentAuthentication)
      ? {
          run: (tenantId, work, options) =>
            uow.run(
              tenantId,
              async (tx) => {
                if (tenantId !== agentContext.tenant_id)
                  throw new ApplicationError(
                    "PERMISSION_DENIED",
                    "Agent tenant context is server-assigned.",
                  );
                await assertCurrentAgentPrincipal(tx, agentContext);
                return work(tx);
              },
              options,
            ),
        }
      : uow;
    if (
      req.url === "/api/v1/agent/credentials/rotate" &&
      req.method === "POST"
    ) {
      if (!isMtlsAuthentication(agentAuthentication) || !enrollmentDependencies)
        throw new ApplicationError(
          "AUTHENTICATION_REQUIRED",
          "Agent authentication failed.",
        );
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || !idempotencyKey.trim())
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "Idempotency-Key is required.",
        );
      const rotationIdempotencyKey = createHash("sha256")
        .update(`${agentContext.agent_session_id}\0${idempotencyKey}`)
        .digest("hex");
      const body = await new Promise<string>((resolve, reject) => {
        let data = "";
        req.on("data", (chunk: Buffer | string) => {
          data += chunk.toString();
          if (Buffer.byteLength(data) > 20_000)
            reject(
              new ApplicationError(
                "VALIDATION_ERROR",
                "Request body is too large.",
              ),
            );
        });
        req.once("error", reject);
        req.once("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => key !== "csr") ||
        typeof input.csr !== "string"
      )
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "A certificate signing request is required.",
        );
      const issued = await rotateAgentCredential({
        pool: enrollmentDependencies.pool,
        uow: protectedUow,
        issuer: enrollmentDependencies.issuer,
        principal: principal as AgentPrincipal,
        csrPem: input.csr,
        idempotencyKey: rotationIdempotencyKey,
        audit: {
          append: async (tx, record) => {
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: "AGENT.CREDENTIAL_ROTATED",
              schema_version: 1,
              occurred_at: now,
              producer: {
                service: config.serviceName,
                instance: "agent-gateway",
              },
              aggregate: { type: "AGENT", id: record.agent_id, version: 1 },
              actor: { type: "AGENT", id: record.agent_id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: record.tenant_id,
              organization_id: record.tenant_id,
              idempotency_key: idempotencyKey,
              payload: {
                credential_id: record.credential_id,
                agent_id: record.agent_id,
                expires_at: record.expires_at.toISOString(),
              },
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: record.tenant_id,
              event_type: "AGENT.CREDENTIAL_ROTATED",
              occurred_at: now,
              actor: { type: "AGENT", id: record.agent_id },
              action: { command_type: "AGENT.CREDENTIAL_ROTATE" },
              subject: {
                entity_type: "AGENT_CREDENTIAL",
                entity_id: record.credential_id,
              },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: {
                code: "SELF_ROTATION",
                text: "Agent credential rotated",
              },
              before: null,
              after: {
                agent_id: record.agent_id,
                expires_at: record.expires_at.toISOString(),
              },
              outcome: { status: "SUCCESS" },
              classification: "RESTRICTED",
              relations: [],
              evidence: [],
            });
          },
        },
      });
      json(res, issued.created ? 201 : 200, {
        data: {
          credential_id: issued.credential_id,
          certificate_pem: issued.certificate_pem,
          expires_at: issued.expires_at.toISOString(),
        },
        meta: context,
      });
      return true;
    }
    if (
      await handleAgentAutomationActionRoute({
        req,
        res,
        context,
        config,
        principal,
        uow: protectedUow,
      })
    )
      return true;
    if (
      await handleAgentAssetWipeRoute({
        req,
        res,
        context,
        config,
        principal,
        uow: protectedUow,
        storage: artifactStorage,
      })
    )
      return true;
    if (
      await handleAgentSoftwareDeploymentRoute({
        req,
        res,
        context,
        config,
        principal,
        uow: protectedUow,
        ...(deploymentAdapters ? { adapters: deploymentAdapters } : {}),
      })
    )
      return true;
    if (
      await handleAgentSoftwareRemovalRoute({
        req,
        res,
        context,
        config,
        principal,
        uow: protectedUow,
      })
    )
      return true;
    if (
      req.url !== "/api/v1/agent/heartbeat" &&
      req.url !== "/api/v1/agent/inventory"
    )
      return false;
    const body = await new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 5_242_880)
          reject(
            new ApplicationError(
              "VALIDATION_ERROR",
              "Request body is too large.",
            ),
          );
      });
      req.on("error", reject);
      req.on("end", () => resolve(data));
    });
    let input: Record<string, unknown>;
    try {
      input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
    } catch {
      throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "JSON object is required.",
      );
    if (
      (input.tenant_id !== undefined &&
        input.tenant_id !== principal.tenant_id) ||
      (input.agent_id !== undefined && input.agent_id !== principal.id) ||
      (input.asset_id !== undefined && input.asset_id !== agentContext.asset_id)
    )
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "Agent message identity does not match its authenticated registration.",
      );
    const messageHeader = req.headers["idempotency-key"];
    if (
      Array.isArray(messageHeader) ||
      (typeof messageHeader === "string" &&
        !/^[A-Za-z0-9._:-]{1,200}$/.test(messageHeader))
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Exactly one valid Idempotency-Key is required.",
      );
    if (
      config.environment === "production" &&
      (typeof messageHeader !== "string" || !agentContext.agent_session_id)
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Idempotency-Key is required for authenticated Agent messages.",
      );
    const requestSha256 = createHash("sha256")
      .update(
        JSON.stringify({ method: req.method, path: req.url, body: input }),
      )
      .digest("hex");
    const now = new Date().toISOString();
    const result = await protectedUow.run(principal.tenant_id, async (tx) => {
      const process = async () => {
        if (req.url === "/api/v1/agent/heartbeat") {
          if (
            input.agent_runtime_id !== undefined &&
            (typeof input.agent_runtime_id !== "string" ||
              !/^[0-9a-f-]{36}$/i.test(input.agent_runtime_id))
          )
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "agent_runtime_id must be a UUID when provided.",
            );
          if (
            input.session_id !== undefined &&
            (typeof input.session_id !== "string" ||
              !input.session_id.length ||
              input.session_id.length > 200)
          )
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "session_id must be a non-empty string of at most 200 characters when provided.",
            );
          const agent = await recordHeartbeat({
            tx,
            agentId: principal.id,
            agentVersion:
              typeof input.agent_version === "string"
                ? input.agent_version
                : "unknown",
            now,
            ...(typeof input.agent_runtime_id === "string"
              ? { runtimeId: input.agent_runtime_id }
              : {}),
            ...(typeof input.session_id === "string"
              ? { sessionId: input.session_id }
              : {}),
          });
          await new PostgresOutboxWriter(tx).append({
            event_id: randomUUID(),
            event_type: "AGENT.ONLINE",
            schema_version: 1,
            occurred_at: now,
            producer: {
              service: config.serviceName,
              instance: "agent-gateway",
            },
            aggregate: { type: "AGENT", id: agent.id, version: 1 },
            actor: { type: principal.actor_type, id: principal.id },
            correlation_id: context.correlation_id,
            causation_id: context.causation_id,
            tenant_id: principal.tenant_id,
            organization_id: principal.tenant_id,
            idempotency_key: randomUUID(),
            payload: agent as never,
          });
          return agent;
        }
        const idempotencyKey = req.headers["idempotency-key"];
        if (typeof idempotencyKey !== "string" || !idempotencyKey.trim())
          throw new ApplicationError(
            "VALIDATION_ERROR",
            "Idempotency-Key is required for inventory reports.",
          );
        return new PostgresIdempotencyStore(tx).execute(
          {
            principalId: agentMessageIdempotencyPrincipal(principal),
            operation: "AGENT.INVENTORY_SYNC",
            businessScope: principal.id,
            key: idempotencyKey,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            if (
              typeof input.dataset !== "string" ||
              input.inventory === undefined ||
              typeof input.observed_at !== "string"
            )
              throw new ApplicationError(
                "VALIDATION_ERROR",
                "dataset, inventory and observed_at are required.",
              );
            let softwareInventory: Awaited<
              ReturnType<typeof ingestSoftwareInventory>
            > | null = null;
            if (input.dataset === "software") {
              if (typeof input.inventory_complete !== "boolean")
                throw new ApplicationError(
                  "VALIDATION_ERROR",
                  "inventory_complete is required for software inventory.",
                );
              softwareInventory = await ingestSoftwareInventory({
                tx,
                agentId: principal.id,
                items: input.inventory,
                inventoryComplete: input.inventory_complete,
                observedAt: input.observed_at,
              });
              for (const change of softwareInventory.exception_changes) {
                await createSoftwareExceptionWorkItem({
                  tx,
                  exceptionId: String(change.exception_id),
                  title: "Review unauthorized software installation",
                  priority: String(change.reason).includes("PROHIBITED")
                    ? "HIGH"
                    : "NORMAL",
                });
              }
              for (const exceptionId of softwareInventory.resolved_exception_ids)
                await resolveSoftwareExceptionWorkItem({ tx, exceptionId });
            }
            const inventory = await recordInventory({
              tx,
              agentId: principal.id,
              dataset: input.dataset,
              inventory: input.inventory,
              observedAt: input.observed_at,
            });
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: "AGENT.INVENTORY_SYNCED",
              schema_version: 1,
              occurred_at: now,
              producer: {
                service: config.serviceName,
                instance: "agent-gateway",
              },
              aggregate: { type: "AGENT", id: inventory.id, version: 1 },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: randomUUID(),
              payload: inventory,
            });
            if (softwareInventory) {
              for (const [index, fact] of softwareInventory.facts.entries()) {
                await new PostgresOutboxWriter(tx).append({
                  event_id: randomUUID(),
                  event_type: String(fact.type),
                  schema_version: 1,
                  occurred_at: now,
                  producer: {
                    service: config.serviceName,
                    instance: "agent-gateway",
                  },
                  aggregate: {
                    type: String(fact.aggregate_type),
                    id: String(fact.aggregate_id),
                    version: Number(fact.version),
                  },
                  actor: { type: principal.actor_type, id: principal.id },
                  correlation_id: context.correlation_id,
                  causation_id: context.causation_id,
                  tenant_id: principal.tenant_id,
                  organization_id: principal.tenant_id,
                  idempotency_key: `${softwareInventory.report_id}:${index}`,
                  payload: fact.payload as never,
                });
                await new PostgresAudit(tx).append({
                  id: randomUUID(),
                  tenant_id: principal.tenant_id,
                  event_type: String(fact.type),
                  occurred_at: now,
                  actor: { type: principal.actor_type, id: principal.id },
                  action: { command_type: "SOFTWARE.INVENTORY_RECONCILE" },
                  subject: {
                    entity_type: String(fact.aggregate_type),
                    entity_id: String(fact.aggregate_id),
                  },
                  correlation_id: context.correlation_id,
                  causation_id: context.causation_id,
                  reason: {
                    code: String(fact.type),
                    text: "Authenticated agent inventory reconciled.",
                  },
                  before: null,
                  after: fact.payload as never,
                  outcome: { status: "SUCCESS" },
                  classification: "INTERNAL",
                  relations: [],
                  evidence: [],
                });
              }
            }
            return { status: 200, body: inventory as never };
          },
        );
      };
      if (typeof messageHeader === "string" && agentContext.agent_session_id)
        return processAgentMessage({
          tx,
          principal: agentContext,
          messageId: messageHeader,
          requestSha256,
          process,
        });
      return process();
    });
    const data =
      req.url === "/api/v1/agent/inventory"
        ? (result as { body: unknown }).body
        : result;
    json(res, 200, { data, meta: context });
    return true;
  };
  return tlsOptions
    ? createHttpsServer(config, ready, tlsOptions, route)
    : createHttpServer(config, ready, route);
}
