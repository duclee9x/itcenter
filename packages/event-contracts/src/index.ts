import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import type { Json } from "../../shared-kernel/src/index.js";
export interface EventEnvelope {
  event_id: string;
  event_type: string;
  schema_version: number;
  occurred_at: string;
  published_at: string;
  producer: { service: string; instance: string };
  aggregate: { type: string; id: string; version: number };
  actor: { type: string; id: string | null };
  correlation_id: string;
  causation_id: string;
  tenant_id: string;
  organization_id: string;
  idempotency_key: string;
  payload: { [key: string]: Json };
}
export type PendingEvent = Omit<EventEnvelope, "published_at">;
const ajv = new Ajv();
addFormats.default(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync(
      new URL(
        "../../../contracts/json-schema/event-envelope.v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
export function assertEvent(value: unknown): asserts value is EventEnvelope {
  if (!validate(value)) throw new Error("Invalid event envelope");
}
