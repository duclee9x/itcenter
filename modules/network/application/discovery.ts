import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";

const sourceTypes = [
  "SNMP",
  "ICMP",
  "ARP",
  "MAC_TABLE",
  "LLDP",
  "DHCP",
  "DNS",
  "AGENT",
  "CONTROLLER_API",
  "SWITCH_API",
  "MANUAL",
  "IMPORT",
] as const;
const confidenceLevels = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;

export function normalizeNetworkObservation(input: Record<string, unknown>) {
  const sourceType = String(input.source_type ?? "")
    .trim()
    .toUpperCase();
  const source = String(input.source ?? "").trim();
  const sourceEventId = String(input.source_event_id ?? "").trim();
  const observedAt = String(input.observed_at ?? "");
  const rawIp = input.ip == null ? null : String(input.ip).trim();
  const rawMac = input.mac == null ? null : String(input.mac).trim();
  const mac = rawMac?.replaceAll("-", ":").toLowerCase() ?? null;
  const confidence = String(input.confidence ?? "UNKNOWN").toUpperCase();
  if (!sourceTypes.includes(sourceType as (typeof sourceTypes)[number]))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported network observation source_type.",
    );
  if (!source || !sourceEventId)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "source and source_event_id are required.",
    );
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "observed_at must be an ISO-8601 timestamp.",
    );
  if (!rawIp && !mac)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "At least one of ip or mac is required.",
    );
  if (rawIp && isIP(rawIp) === 0)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "ip must be a valid IPv4 or IPv6 address.",
    );
  if (mac && !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "mac must contain six hexadecimal octets.",
    );
  if (
    !confidenceLevels.includes(confidence as (typeof confidenceLevels)[number])
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported network observation confidence.",
    );
  return {
    source_type: sourceType,
    source,
    source_event_id: sourceEventId,
    observed_at: new Date(observedAt).toISOString(),
    asset_id: input.asset_id ? String(input.asset_id) : null,
    ip: rawIp,
    mac,
    hostname: input.hostname == null ? null : String(input.hostname).trim(),
    vendor: input.vendor == null ? null : String(input.vendor).trim(),
    model: input.model == null ? null : String(input.model).trim(),
    operating_system:
      input.operating_system == null
        ? null
        : String(input.operating_system).trim(),
    vlan: input.vlan == null ? null : String(input.vlan).trim(),
    switch_name:
      input.switch_name == null ? null : String(input.switch_name).trim(),
    port_name: input.port_name == null ? null : String(input.port_name).trim(),
    confidence,
  };
}

export async function createDiscoveryJob(input: {
  tx: Transaction;
  sourceType: string;
  scope?: unknown;
  freshnessThresholdSeconds?: number;
}) {
  const sourceType = input.sourceType.trim().toUpperCase();
  if (!sourceTypes.includes(sourceType as (typeof sourceTypes)[number]))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported discovery source_type.",
    );
  const threshold = input.freshnessThresholdSeconds;
  if (
    threshold !== undefined &&
    (!Number.isInteger(threshold) || threshold <= 0)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "freshness_threshold_seconds must be a positive integer.",
    );
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO network.discovery_jobs(id,tenant_id,source_type,scope,freshness_threshold_seconds) VALUES($1,$2,$3,$4::jsonb,$5)",
    [
      id,
      input.tx.tenantId,
      sourceType,
      JSON.stringify(input.scope ?? {}),
      threshold ?? null,
    ],
  );
  return { id, state: "QUEUED", source_type: sourceType };
}

export async function recordDiscoveryObservation(input: {
  tx: Transaction;
  jobId: string;
  observation: ReturnType<typeof normalizeNetworkObservation>;
}) {
  const job = await input.tx.query(
    "SELECT state,source_type FROM network.discovery_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.jobId],
  );
  if (!job.rowCount)
    throw new ApplicationError("NOT_FOUND", "Discovery job was not found.");
  if (!["QUEUED", "RUNNING", "PARTIAL"].includes(String(job.rows[0]!.state)))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Discovery job is terminal.",
    );
  if (job.rows[0]!.source_type !== input.observation.source_type)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Observation source_type must match its discovery job.",
    );
  const observation = input.observation;
  const inserted = await input.tx.query(
    "INSERT INTO network.observations(id,tenant_id,discovery_job_id,source_type,source,source_event_id,observed_at,asset_id,ip,mac,hostname,vendor,model,operating_system,vlan,switch_name,port_name,confidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (tenant_id,source_type,source_event_id) DO NOTHING RETURNING id,discovery_job_id,source_type,source,source_event_id,observed_at,asset_id,ip::text,mac::text,hostname,vendor,model,operating_system,vlan,switch_name,port_name,confidence",
    [
      randomUUID(),
      input.tx.tenantId,
      input.jobId,
      observation.source_type,
      observation.source,
      observation.source_event_id,
      observation.observed_at,
      observation.asset_id,
      observation.ip,
      observation.mac,
      observation.hostname,
      observation.vendor,
      observation.model,
      observation.operating_system,
      observation.vlan,
      observation.switch_name,
      observation.port_name,
      observation.confidence,
    ],
  );
  if (!inserted.rowCount) {
    const existing = await input.tx.query(
      "SELECT id,discovery_job_id,source_type,source,source_event_id,observed_at,asset_id,ip::text,mac::text,hostname,vendor,model,operating_system,vlan,switch_name,port_name,confidence FROM network.observations WHERE tenant_id=$1 AND source_type=$2 AND source_event_id=$3",
      [input.tx.tenantId, observation.source_type, observation.source_event_id],
    );
    return { observation: existing.rows[0], duplicate: true };
  }
  await input.tx.query(
    "UPDATE network.discovery_jobs SET state='RUNNING',started_at=COALESCE(started_at,now()),finished_at=NULL WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.jobId],
  );
  return { observation: inserted.rows[0], duplicate: false };
}

export async function transitionDiscoveryJob(input: {
  tx: Transaction;
  jobId: string;
  targetState: string;
  failureReason?: string;
}) {
  if (
    !["RUNNING", "PARTIAL", "COMPLETED", "FAILED", "CANCELLED"].includes(
      input.targetState,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Invalid discovery job state.",
    );
  if (input.targetState === "FAILED" && !input.failureReason?.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "failure_reason is required for FAILED jobs.",
    );
  const result = await input.tx.query(
    `UPDATE network.discovery_jobs SET state=$1,
       started_at=CASE WHEN $1='RUNNING' THEN COALESCE(started_at,now()) ELSE started_at END,
       finished_at=CASE WHEN $1 IN ('RUNNING','PARTIAL') THEN NULL ELSE now() END,
       failure_reason=$2
     WHERE tenant_id=$3 AND id=$4 AND (
       ($1='RUNNING' AND state='QUEUED') OR
       ($1='PARTIAL' AND state='RUNNING') OR
       ($1='COMPLETED' AND state IN ('RUNNING','PARTIAL')) OR
       ($1 IN ('FAILED','CANCELLED') AND state IN ('QUEUED','RUNNING','PARTIAL'))
     ) RETURNING id,state,finished_at`,
    [
      input.targetState,
      input.failureReason ?? null,
      input.tx.tenantId,
      input.jobId,
    ],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Discovery job was not found or the requested state transition is invalid.",
    );
  return result.rows[0]!;
}

export async function readCurrentTopology(tx: Transaction) {
  const result = await tx.query(
    `WITH ranked AS (
       SELECT o.id,o.discovery_job_id,o.asset_id,o.ip::text AS ip,o.mac::text AS mac,
         o.hostname,o.vendor,o.model,o.operating_system,o.vlan,o.switch_name,
         o.port_name,o.source_type,o.source,o.confidence,o.observed_at,
         j.freshness_threshold_seconds,
         row_number() OVER (PARTITION BY COALESCE(o.mac::text,'ip:'||o.ip::text)
           ORDER BY o.observed_at DESC,o.created_at DESC) AS position
       FROM network.observations o
       JOIN network.discovery_jobs j ON j.tenant_id=o.tenant_id AND j.id=o.discovery_job_id
       WHERE o.tenant_id=$1
     )
     SELECT id,discovery_job_id,asset_id,ip,mac,hostname,vendor,model,operating_system,
       vlan,switch_name,port_name,source_type,source,confidence,observed_at,
       CASE WHEN freshness_threshold_seconds IS NULL THEN 'UNKNOWN'
            WHEN observed_at < now() - make_interval(secs => freshness_threshold_seconds) THEN 'STALE'
            ELSE 'FRESH' END AS freshness
     FROM ranked WHERE position=1 ORDER BY COALESCE(mac,ip)`,
    [tx.tenantId],
  );
  return result.rows;
}
