import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import { json } from "../../../packages/observability/src/index.js";

export const API_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
export const GENERAL_RATE_LIMIT = { rate: 300, windowSeconds: 60, burst: 100 };
export const MUTATION_RATE_LIMIT = { rate: 60, windowSeconds: 60, burst: 20 };

export type BucketPolicy = typeof GENERAL_RATE_LIMIT;

interface Bucket {
  tokens: number;
  updatedAt: number;
  touchedAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxEntries = 10_000,
    private readonly now = () => Date.now(),
  ) {}

  consume(key: string, policy: BucketPolicy): RateLimitDecision {
    const now = this.now();
    this.prune(now, policy.windowSeconds * 2_000);
    const capacity = policy.rate + policy.burst;
    const refillPerMs = policy.rate / (policy.windowSeconds * 1000);
    const existing = this.buckets.get(key);
    const bucket =
      existing ??
      ({ tokens: capacity, updatedAt: now, touchedAt: now } satisfies Bucket);
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + Math.max(0, now - bucket.updatedAt) * refillPerMs,
    );
    bucket.updatedAt = now;
    bucket.touchedAt = now;
    if (bucket.tokens < 1) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((1 - bucket.tokens) / (refillPerMs * 1000)),
      );
      this.buckets.set(key, bucket);
      return { allowed: false, retryAfterSeconds };
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    this.bound();
    return { allowed: true };
  }

  size(): number {
    return this.buckets.size;
  }

  private prune(now: number, idleMs: number): void {
    for (const [key, bucket] of this.buckets)
      if (now - bucket.touchedAt >= idleMs) this.buckets.delete(key);
  }

  private bound(): void {
    while (this.buckets.size > this.maxEntries) {
      const oldest = this.buckets.keys().next().value;
      if (typeof oldest !== "string") return;
      this.buckets.delete(oldest);
    }
  }
}

function normalizedIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const candidate = value.trim().replace(/^\[|\]$/g, "");
  return isIP(candidate) ? candidate : undefined;
}

function isTrustedProxyAddress(value: string): boolean {
  const ip = normalizedIp(value);
  if (!ip) return false;
  if (isIP(ip) === 6)
    return (
      ip === "::1" ||
      ip.toLowerCase().startsWith("fc") ||
      ip.toLowerCase().startsWith("fd") ||
      ip.toLowerCase().startsWith("fe8") ||
      ip.toLowerCase().startsWith("fe9") ||
      ip.toLowerCase().startsWith("fea") ||
      ip.toLowerCase().startsWith("feb")
    );
  const octets = ip.split(".").map(Number);
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
}

export function trustedClientIp(req: IncomingMessage): string {
  const remote = normalizedIp(req.socket.remoteAddress);
  if (!remote || !isTrustedProxyAddress(remote)) return remote ?? "unknown";
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const client = normalizedIp(forwarded.split(",", 1)[0]);
    if (client) return client;
  }
  return remote;
}

export function createApiEdgePolicy(options?: {
  general?: BucketPolicy;
  mutations?: BucketPolicy;
  maxEntries?: number;
}) {
  const generalPolicy = options?.general ?? GENERAL_RATE_LIMIT;
  const mutationPolicy = options?.mutations ?? MUTATION_RATE_LIMIT;
  const general = new TokenBucketLimiter(options?.maxEntries);
  const mutations = new TokenBucketLimiter(options?.maxEntries);
  return {
    beforeRoute(
      req: IncomingMessage,
      res: ServerResponse,
      context: CorrelationContext,
    ): boolean {
      const path = req.url?.split("?", 1)[0] ?? "/";
      if (
        [
          "/health/live",
          "/health/ready",
          "/api/v1/health/live",
          "/api/v1/health/ready",
        ].includes(path)
      )
        return false;
      if (!path.startsWith("/api/v1/")) return false;
      const key = trustedClientIp(req);
      const decisions = [general.consume(key, generalPolicy)];
      if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method ?? ""))
        decisions.push(mutations.consume(key, mutationPolicy));
      const rejected = decisions.find((decision) => !decision.allowed);
      if (!rejected) {
        const contentLength = Number(req.headers["content-length"] ?? 0);
        if (
          Number.isFinite(contentLength) &&
          contentLength > API_BODY_LIMIT_BYTES
        ) {
          json(res, 413, {
            error: {
              code: "REQUEST_BODY_TOO_LARGE",
              message: "Request body is too large.",
              retryable: false,
            },
            meta: context,
          });
          return true;
        }
        return false;
      }
      res.setHeader("Retry-After", String(rejected.retryAfterSeconds ?? 1));
      json(res, 429, {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests.",
          retryable: true,
        },
        meta: context,
      });
      return true;
    },
  };
}
