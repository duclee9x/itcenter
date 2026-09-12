import type { Config } from "../../../packages/config/src/index.js";
import {
  createHttpServer,
  json,
} from "../../../packages/observability/src/index.js";
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
  recordHeartbeat,
  recordInventory,
} from "../../../modules/agent/index.js";
import { ingestSoftwareInventory } from "../../../modules/software/index.js";
import {
  createSoftwareExceptionWorkItem,
  resolveSoftwareExceptionWorkItem,
} from "../../../modules/work-queue/index.js";
import { randomUUID } from "node:crypto";
import {
  handleAgentSoftwareDeploymentRoute,
  type AgentDeploymentAdapters,
} from "./software-deployment-routes.js";
import { handleAgentSoftwareRemovalRoute } from "./software-removal-routes.js";
// No user administration routes; dedicated adapter must authenticate enrolled agents.
export function agentServer(
  config: Config,
  ready: () => Promise<boolean>,
  agentAuthentication: AuthenticationPort,
  uow?: UnitOfWork,
  deploymentAdapters?: AgentDeploymentAdapters,
) {
  return createHttpServer(config, ready, async (req, res, context) => {
    if (!req.url?.startsWith("/api/v1/agent/")) return false;
    const principal = await authenticate(
      agentAuthentication,
      req.headers.authorization,
    );
    if (!uow) return false;
    if (
      await handleAgentSoftwareDeploymentRoute({
        req,
        res,
        context,
        config,
        principal,
        uow,
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
        uow,
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
    const now = new Date().toISOString();
    const result = await uow.run(principal.tenant_id, async (tx) => {
      if (req.url === "/api/v1/agent/heartbeat") {
        const agent = await recordHeartbeat({
          tx,
          agentId: principal.id,
          agentVersion:
            typeof input.agent_version === "string"
              ? input.agent_version
              : "unknown",
          now,
        });
        await new PostgresOutboxWriter(tx).append({
          event_id: randomUUID(),
          event_type: "AGENT.ONLINE",
          schema_version: 1,
          occurred_at: now,
          producer: { service: config.serviceName, instance: "agent-gateway" },
          aggregate: { type: "AGENT", id: agent.id, version: 1 },
          actor: { type: principal.actor_type, id: principal.id },
          correlation_id: context.correlation_id,
          causation_id: context.causation_id,
          tenant_id: principal.tenant_id,
          organization_id: principal.tenant_id,
          idempotency_key: randomUUID(),
          payload: agent,
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
          principalId: principal.id,
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
    });
    const data =
      req.url === "/api/v1/agent/inventory"
        ? (result as { body: unknown }).body
        : result;
    json(res, 200, { data, meta: context });
    return true;
  });
}
