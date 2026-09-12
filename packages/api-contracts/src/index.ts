import type {
  ActorContext,
  CorrelationContext,
  Json,
} from "../../shared-kernel/src/index.js";
const errors = {
  VALIDATION_ERROR: [400, "VALIDATION"],
  AUTHENTICATION_REQUIRED: [401, "AUTHENTICATION"],
  PERMISSION_DENIED: [403, "AUTHORIZATION"],
  NOT_FOUND: [404, "NOT_FOUND"],
  VERSION_CONFLICT: [409, "CONFLICT"],
  IDEMPOTENCY_KEY_CONFLICT: [409, "CONFLICT"],
  OPERATION_IN_PROGRESS: [409, "CONFLICT"],
  BUSINESS_RULE_VIOLATION: [422, "BUSINESS_RULE"],
  GOODS_RECEIPT_OVER_ORDERED_QUANTITY: [422, "BUSINESS_RULE"],
  GOODS_RECEIPT_PO_NOT_RECEIVABLE: [409, "CONFLICT"],
  GOODS_RECEIPT_BLOCKING_EXCEPTION: [422, "BUSINESS_RULE"],
  GOODS_RECEIPT_UNIT_IDENTITY_DUPLICATE: [409, "CONFLICT"],
  DEPENDENCY_UNAVAILABLE: [503, "DEPENDENCY"],
  INTERNAL_ERROR: [500, "INTERNAL_BUG"],
} as const;
export type ErrorCode = keyof typeof errors;
export class ApplicationError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}
export function errorResponse(error: unknown, context: CorrelationContext) {
  const e =
    error instanceof ApplicationError
      ? error
      : new ApplicationError("INTERNAL_ERROR", "An internal error occurred.");
  const [status, category] = errors[e.code];
  return {
    status,
    body: {
      error: {
        code: e.code,
        message: e.message,
        details: {},
        retryable: e.retryable,
        category,
        severity: status >= 500 ? "ERROR" : "WARNING",
        retryability: e.retryable ? "RETRY_WITH_BACKOFF" : "DO_NOT_RETRY",
      },
      meta: {
        request_id: context.request_id,
        correlation_id: context.correlation_id,
      },
    },
  };
}
export interface Command<T extends Json> {
  command_id: string;
  command_type: string;
  schema_version: number;
  requested_at: string;
  actor: ActorContext;
  correlation_id: string;
  causation_id: string;
  idempotency_key: string;
  target: { type: string; id: string };
  expected_version: number;
  payload: T;
}
export function assertVersion(actual: number, expected: number): void {
  if (!Number.isSafeInteger(expected) || actual !== expected)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Resource version has changed.",
    );
}
