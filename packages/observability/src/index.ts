import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Config } from "../../config/src/index.js";
import type { CorrelationContext } from "../../shared-kernel/src/index.js";
import {
  ApplicationError,
  errorResponse,
} from "../../api-contracts/src/index.js";
export interface MetricsRecorder {
  increment(name: string): void;
}
export class Metrics implements MetricsRecorder {
  private readonly counts = new Map<string, number>();
  increment(name: string): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
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
export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
export function createHttpServer(
  config: Pick<Config, "serviceName" | "environment" | "logLevel">,
  ready: () => Promise<boolean>,
  route?: Route,
  metrics = new Metrics(),
) {
  const log = logger(config);
  const server = createServer(async (req, res) => {
    const context = requestContext(req.headers["x-correlation-id"]);
    res.setHeader("X-Request-Id", context.request_id);
    res.setHeader("X-Correlation-Id", context.correlation_id);
    res.on("finish", () => {
      metrics.increment(`http_${res.statusCode}`);
      log("info", "http.request", context, res.statusCode);
    });
    try {
      if (req.method === "GET" && req.url === "/api/v1/health/live") {
        json(res, 200, { data: { status: "ok" }, meta: context });
        return;
      }
      if (req.method === "GET" && req.url === "/api/v1/health/ready") {
        let available = false;
        try {
          available = await ready();
        } catch {
          available = false;
        }
        if (!available)
          throw new ApplicationError(
            "DEPENDENCY_UNAVAILABLE",
            "Service dependencies are not ready.",
            true,
          );
        json(res, 200, { data: { status: "ok" }, meta: context });
        return;
      }
      if (route && (await route(req, res, context))) return;
      throw new ApplicationError("NOT_FOUND", "Route not found.");
    } catch (error) {
      const response = errorResponse(error, context);
      json(res, response.status, response.body);
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}
