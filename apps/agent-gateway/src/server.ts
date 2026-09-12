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
import {
  recordHeartbeat,
  recordInventory,
} from "../../../modules/agent/index.js";
import { randomUUID } from "node:crypto";
import {
  handleAgentSoftwareDeploymentRoute,
  type AgentDeploymentAdapters,
} from "./software-deployment-routes.js";
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
      req.url !== "/api/v1/agent/heartbeat" &&
      req.url !== "/api/v1/agent/inventory"
    )
      return false;
    const body = await new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
    });
    let input: Record<string, unknown>;
    try {
      input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid JSON request.");
    }
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
      if (
        typeof input.dataset !== "string" ||
        input.inventory === undefined ||
        typeof input.observed_at !== "string"
      )
        throw new Error("dataset, inventory and observed_at are required.");
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
        producer: { service: config.serviceName, instance: "agent-gateway" },
        aggregate: { type: "AGENT", id: inventory.id, version: 1 },
        actor: { type: principal.actor_type, id: principal.id },
        correlation_id: context.correlation_id,
        causation_id: context.causation_id,
        tenant_id: principal.tenant_id,
        organization_id: principal.tenant_id,
        idempotency_key: randomUUID(),
        payload: inventory,
      });
      return inventory;
    });
    json(res, 200, { data: result, meta: context });
    return true;
  });
}
