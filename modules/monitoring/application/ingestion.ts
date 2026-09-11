import { ApplicationError } from "../../../packages/api-contracts/src/index.js";

export type NormalizedMonitoringEvent = {
  source: string;
  provider_event_id: string;
  asset_id: string | null;
  service_id: string | null;
  metric: string;
  observed_value: string;
  threshold: string | null;
  severity: "CRITICAL" | "WARNING" | "INFO" | "RECOVERED";
  observed_at: string;
};

export function normalizeMonitoringEvent(
  input: Record<string, unknown>,
): NormalizedMonitoringEvent {
  const source = input.source;
  const providerEventId = input.provider_event_id;
  const metric = input.metric;
  const observedAt = input.observed_at;
  const severity = input.severity;
  if (
    [source, providerEventId, metric, observedAt, severity].some(
      (value) => typeof value !== "string" || !value.trim(),
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "source, provider_event_id, metric, severity and observed_at are required.",
    );
  const sourceValue = source as string;
  const providerEventIdValue = providerEventId as string;
  const metricValue = metric as string;
  const observedAtValue = observedAt as string;
  const severityValue = severity as string;
  if (!["CRITICAL", "WARNING", "INFO", "RECOVERED"].includes(severityValue))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported monitoring severity.",
    );
  if (Number.isNaN(Date.parse(observedAtValue)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "observed_at must be an ISO-8601 timestamp.",
    );
  if (
    input.asset_id !== undefined &&
    input.asset_id !== null &&
    typeof input.asset_id !== "string"
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "asset_id must be a string or null.",
    );
  if (
    input.service_id !== undefined &&
    input.service_id !== null &&
    typeof input.service_id !== "string"
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "service_id must be a string or null.",
    );
  if (input.observed_value === undefined || input.observed_value === null)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "observed_value is required.",
    );
  return {
    source: sourceValue,
    provider_event_id: providerEventIdValue,
    asset_id: (input.asset_id as string | null | undefined) ?? null,
    service_id: (input.service_id as string | null | undefined) ?? null,
    metric: metricValue,
    observed_value: String(input.observed_value),
    threshold:
      input.threshold === undefined || input.threshold === null
        ? null
        : String(input.threshold),
    severity: severityValue as NormalizedMonitoringEvent["severity"],
    observed_at: new Date(observedAtValue).toISOString(),
  };
}
