import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  createServer as createTlsServer,
  type ServerOptions as TlsServerOptions,
} from "node:https";
import type { Config } from "../../config/src/index.js";
import type { CorrelationContext } from "../../shared-kernel/src/index.js";
import {
  aggregateReadiness,
  asReadinessSnapshot,
  publicReadiness,
  type ReadinessSnapshot,
} from "./readiness.js";
export {
  aggregateReadiness,
  addReadinessComponent,
  asReadinessSnapshot,
  publicReadiness,
  ReadinessCheckCache,
  type ComponentCriticality,
  type ComponentReadinessState,
  type ReadinessComponent,
  type ReadinessSnapshot,
  type ReadinessState,
} from "./readiness.js";
import {
  ApplicationError,
  errorResponse,
} from "../../api-contracts/src/index.js";
export interface MetricsRecorder {
  increment(name: string): void;
  gauge(name: string, value: number): void;
}
export class Metrics implements MetricsRecorder {
  private readonly counts = new Map<string, number>();
  increment(name: string): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }
  gauge(name: string, value: number): void {
    this.counts.set(name, value);
  }
  snapshot(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.counts);
  }
}
export function requestContext(
  header: string | string[] | undefined,
): CorrelationContext {
  const request_id = randomUUID();
  const correlation_id =
    typeof header === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(header)
      ? header
      : randomUUID();
  return { request_id, correlation_id, causation_id: request_id };
}
export function logger(
  config: Pick<Config, "serviceName" | "environment" | "logLevel">,
  write: (line: string) => void = (line) => process.stdout.write(line + "\n"),
) {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  // Fixed fields: caller payloads, secrets, raw exceptions and headers never enter the logger.
  return (
    level: keyof typeof levels,
    event: string,
    context?: CorrelationContext,
    status?: number,
  ) => {
    if (levels[level] < levels[config.logLevel]) return;
    write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        service_name: config.serviceName,
        environment: config.environment,
        level,
        event,
        request_id: context?.request_id,
        correlation_id: context?.correlation_id,
        status,
      }),
    );
  };
}
export type Route = (
  req: IncomingMessage,
  res: ServerResponse,
  context: CorrelationContext,
) => Promise<boolean>;
export interface RequestPolicy {
  beforeRoute(
    req: IncomingMessage,
    res: ServerResponse,
    context: CorrelationContext,
  ): boolean;
}
export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function requestListener(
  config: Pick<Config, "serviceName" | "environment" | "logLevel">,
  ready: () => Promise<boolean | ReadinessSnapshot>,
  route?: Route,
  metrics = new Metrics(),
  policy?: RequestPolicy,
): (req: IncomingMessage, res: ServerResponse) => void {
  const log = logger(config);
  let lastReadinessKey: string | undefined;
  const lastComponentStates = new Map<string, string>();
  return (req, res) => {
    const context = requestContext(req.headers["x-correlation-id"]);
    res.setHeader("X-Request-Id", context.request_id);
    res.setHeader("X-Correlation-Id", context.correlation_id);
    res.on("finish", () => {
      metrics.increment(`http_${res.statusCode}`);
      log("info", "http.request", context, res.statusCode);
    });
    void (async () => {
      try {
        if (req.method === "GET" && req.url === "/api/v1/health/live") {
          json(res, 200, { data: { status: "ok" }, meta: context });
          return;
        }
        if (req.method === "GET" && req.url === "/api/v1/health/ready") {
          let readiness: ReadinessSnapshot;
          try {
            readiness = asReadinessSnapshot(await ready());
          } catch {
            readiness = aggregateReadiness("APPLICATION", [
              {
                id: "readiness-check",
                state: "NOT_READY",
                criticality: "MANDATORY",
                reasonCode: "READINESS_CHECK_FAILED",
              },
            ]);
          }
          const readinessKey = JSON.stringify([
            readiness.profile,
            readiness.status,
            readiness.components.map((component) => [
              component.id,
              component.state,
              component.reasonCode ?? null,
            ]),
          ]);
          if (lastReadinessKey !== readinessKey) {
            lastReadinessKey = readinessKey;
            log(
              "info",
              `readiness.transition.${readiness.profile.toLowerCase()}.${readiness.status.toLowerCase()}`,
              context,
            );
          }
          for (const state of ["READY", "DEGRADED", "NOT_READY"] as const)
            metrics.gauge(
              `readiness_${readiness.profile.toLowerCase()}_${state.toLowerCase()}`,
              readiness.status === state ? 1 : 0,
            );
          for (const component of readiness.components) {
            for (const state of [
              "STARTING",
              "READY",
              "DEGRADED",
              "NOT_READY",
              "STOPPING",
            ] as const)
              metrics.gauge(
                `readiness_component_${component.id}_${state.toLowerCase()}`,
                component.state === state ? 1 : 0,
              );
            if (component.restartCount !== undefined)
              metrics.gauge(
                `worker_unexpected_exit_restart_count_${component.id}`,
                component.restartCount,
              );
            if (component.lastHeartbeatAt) {
              metrics.gauge(
                `worker_heartbeat_age_seconds_${component.id}`,
                Math.max(
                  0,
                  (Date.now() - Date.parse(component.lastHeartbeatAt)) / 1000,
                ),
              );
            }
            const previousState = lastComponentStates.get(component.id);
            if (
              previousState !== undefined &&
              previousState !== component.state
            )
              log(
                "info",
                `readiness.component_transition.${component.id}.${component.state.toLowerCase()}`,
                context,
              );
            lastComponentStates.set(component.id, component.state);
          }
          json(res, readiness.status === "NOT_READY" ? 503 : 200, {
            data: publicReadiness(readiness),
            meta: context,
          });
          return;
        }
        if (policy?.beforeRoute(req, res, context)) return;
        if (route && (await route(req, res, context))) return;
        throw new ApplicationError("NOT_FOUND", "Route not found.");
      } catch (error) {
        const response = errorResponse(error, context);
        if (error instanceof ApplicationError)
          for (const [name, value] of Object.entries(error.headers))
            res.setHeader(name, value);
        json(res, response.status, response.body);
      }
    })();
  };
}

export function createHttpServer(
  config: Pick<Config, "serviceName" | "environment" | "logLevel">,
  ready: () => Promise<boolean | ReadinessSnapshot>,
  route?: Route,
  metrics = new Metrics(),
  policy?: RequestPolicy,
) {
  const server = createServer(
    requestListener(config, ready, route, metrics, policy),
  );
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

export function createHttpsServer(
  config: Pick<Config, "serviceName" | "environment" | "logLevel">,
  ready: () => Promise<boolean | ReadinessSnapshot>,
  tls: TlsServerOptions,
  route?: Route,
  metrics = new Metrics(),
  policy?: RequestPolicy,
) {
  const server = createTlsServer(
    tls,
    requestListener(config, ready, route, metrics, policy),
  );
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}
