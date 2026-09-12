import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import type { NetworkException, NetworkExceptionQueuePort } from "./ports.js";

type ExceptionType = NetworkException["exception_type"];
type ExceptionSeed = {
  type: ExceptionType;
  observationId: string;
  dedupeKey: string;
  expected?: unknown;
  observed: unknown;
};

async function createOpenException(input: {
  tx: Transaction;
  queue: NetworkExceptionQueuePort;
  seed: ExceptionSeed;
}) {
  const id = randomUUID();
  const inserted = await input.tx.query(
    "INSERT INTO network.exceptions(id,tenant_id,exception_type,source_observation_id,dedupe_key,expected,observed) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) ON CONFLICT (tenant_id,exception_type,dedupe_key) WHERE state='OPEN' DO NOTHING RETURNING id,exception_type,state,source_observation_id,dedupe_key,expected,observed,version",
    [
      id,
      input.tx.tenantId,
      input.seed.type,
      input.seed.observationId,
      input.seed.dedupeKey,
      input.seed.expected === undefined
        ? null
        : JSON.stringify(input.seed.expected),
      JSON.stringify(input.seed.observed),
    ],
  );
  if (!inserted.rowCount) return null;
  const exception = inserted.rows[0] as NetworkException;
  await input.queue.createReference({
    tx: input.tx,
    exceptionId: exception.id,
    title: `${exception.exception_type.replaceAll("_", " ")} detected`,
    priority: exception.exception_type === "UNKNOWN_DEVICE" ? "P1" : "P2",
  });
  return exception;
}

export async function detectObservationExceptions(input: {
  tx: Transaction;
  observationId: string;
  queue: NetworkExceptionQueuePort;
}) {
  const result = await input.tx.query(
    "SELECT id,asset_id,ip::text,mac::text,hostname,vendor,vlan,switch_name,port_name,source,confidence,observed_at FROM network.observations WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.observationId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Network observation was not found.",
    );
  const observation = result.rows[0]!;
  const observed = {
    observation_id: observation.id,
    asset_id: observation.asset_id,
    ip: observation.ip,
    mac: observation.mac,
    hostname: observation.hostname,
    vendor: observation.vendor,
    vlan: observation.vlan,
    switch: observation.switch_name,
    port: observation.port_name,
    source: observation.source,
    confidence: observation.confidence,
    observed_at: observation.observed_at,
  };
  const created: NetworkException[] = [];
  if (!observation.asset_id) {
    const knownDisposition = observation.mac
      ? await input.tx.query(
          "SELECT id FROM network.device_dispositions WHERE tenant_id=$1 AND mac=$2::macaddr",
          [input.tx.tenantId, observation.mac],
        )
      : { rowCount: 0 };
    if (!knownDisposition.rowCount) {
      const exception = await createOpenException({
        tx: input.tx,
        queue: input.queue,
        seed: {
          type: "UNKNOWN_DEVICE",
          observationId: observation.id,
          dedupeKey: observation.mac
            ? `mac:${observation.mac}`
            : `ip:${observation.ip}`,
          observed,
        },
      });
      if (exception) created.push(exception);
    }
  }
  if (observation.ip && observation.mac) {
    const conflicts = await input.tx.query(
      "SELECT DISTINCT mac::text AS mac FROM network.observations WHERE tenant_id=$1 AND ip=$2::inet AND mac IS NOT NULL AND mac<>$3::macaddr ORDER BY mac::text",
      [input.tx.tenantId, observation.ip, observation.mac],
    );
    if (conflicts.rowCount) {
      const macs = [
        ...new Set([
          ...conflicts.rows.map((row) => String(row.mac)),
          String(observation.mac),
        ]),
      ].sort();
      const exception = await createOpenException({
        tx: input.tx,
        queue: input.queue,
        seed: {
          type: "IP_CONFLICT",
          observationId: observation.id,
          dedupeKey: `ip:${observation.ip}`,
          observed: {
            ip: observation.ip,
            macs,
            observation_id: observation.id,
          },
        },
      });
      if (exception) created.push(exception);
    }
  }
  return created;
}

export async function compareExpectedVlan(input: {
  tx: Transaction;
  observationId: string;
  expectedVlan: string;
  queue: NetworkExceptionQueuePort;
}) {
  const expectedVlan = input.expectedVlan.trim();
  if (!expectedVlan)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_vlan is required.",
    );
  const result = await input.tx.query(
    "SELECT id,asset_id,ip::text,mac::text,vlan,switch_name,port_name,confidence,observed_at FROM network.observations WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.observationId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Network observation was not found.",
    );
  const observation = result.rows[0]!;
  if (!observation.vlan)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Observation has no VLAN value to compare.",
    );
  if (String(observation.vlan) === expectedVlan)
    return { mismatch: false, exception: null };
  const exception = await createOpenException({
    tx: input.tx,
    queue: input.queue,
    seed: {
      type: "VLAN_MISMATCH",
      observationId: observation.id,
      dedupeKey: `observation:${observation.id}:expected:${expectedVlan}`,
      expected: { vlan: expectedVlan },
      observed: {
        observation_id: observation.id,
        asset_id: observation.asset_id,
        ip: observation.ip,
        mac: observation.mac,
        vlan: observation.vlan,
        switch: observation.switch_name,
        port: observation.port_name,
        confidence: observation.confidence,
        observed_at: observation.observed_at,
      },
    },
  });
  return { mismatch: true, exception };
}

export async function listNetworkExceptions(input: {
  tx: Transaction;
  state?: string;
  exceptionType?: string;
}) {
  const result = await input.tx.query(
    "SELECT id,exception_type,state,source_observation_id,expected,observed,resolution_action,resolution_reason,linked_asset_id,version,created_at,resolved_at FROM network.exceptions WHERE tenant_id=$1 AND ($2::text IS NULL OR state=$2) AND ($3::text IS NULL OR exception_type=$3) ORDER BY created_at DESC LIMIT 200",
    [input.tx.tenantId, input.state ?? null, input.exceptionType ?? null],
  );
  return result.rows;
}

export async function resolveNetworkException(input: {
  tx: Transaction;
  exceptionId: string;
  expectedVersion: number;
  action: string;
  reason: string;
  linkedAssetId?: string;
  assertAssetExists: (assetId: string) => Promise<unknown>;
  queue: NetworkExceptionQueuePort;
}) {
  if (!Number.isSafeInteger(input.expectedVersion) || !input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version and reason are required.",
    );
  const current = await input.tx.query(
    "SELECT id,exception_type,state,source_observation_id,dedupe_key,version FROM network.exceptions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.exceptionId],
  );
  if (!current.rowCount)
    throw new ApplicationError("NOT_FOUND", "Network exception was not found.");
  const exception = current.rows[0]!;
  assertVersion(exception.version, input.expectedVersion);
  if (exception.state !== "OPEN")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Network exception is already closed.",
    );
  let nextState: "RESOLVED" | "ACCEPTED";
  if (exception.exception_type === "UNKNOWN_DEVICE") {
    const actions = [
      "LINK_TO_ASSET",
      "MARK_GUEST",
      "MARK_INFRASTRUCTURE",
      "IGNORE_BY_POLICY",
      "INVESTIGATE_COMPLETE",
    ];
    if (!actions.includes(input.action))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Unsupported unknown-device resolution action.",
      );
    if (input.action === "LINK_TO_ASSET") {
      if (!input.linkedAssetId)
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "asset_id is required to link an unknown device.",
        );
      await input.assertAssetExists(input.linkedAssetId);
    } else if (input.linkedAssetId) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "asset_id is only valid for LINK_TO_ASSET.",
      );
    }
    nextState =
      input.action === "MARK_GUEST" || input.action === "IGNORE_BY_POLICY"
        ? "ACCEPTED"
        : "RESOLVED";
  } else {
    if (!["RESOLVE", "ACCEPT_RISK"].includes(input.action))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "action must be RESOLVE or ACCEPT_RISK.",
      );
    if (input.linkedAssetId)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "asset_id is not valid for this exception type.",
      );
    nextState = input.action === "ACCEPT_RISK" ? "ACCEPTED" : "RESOLVED";
  }
  const updated = await input.tx.query(
    "UPDATE network.exceptions SET state=$1,resolution_action=$2,resolution_reason=$3,linked_asset_id=$4,resolved_at=now(),version=version+1 WHERE tenant_id=$5 AND id=$6 AND version=$7 RETURNING id,exception_type,state,source_observation_id,dedupe_key,expected,observed,resolution_action,resolution_reason,linked_asset_id,version,resolved_at",
    [
      nextState,
      input.action,
      input.reason,
      input.linkedAssetId ?? null,
      input.tx.tenantId,
      input.exceptionId,
      input.expectedVersion,
    ],
  );
  if (!updated.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Network exception changed concurrently.",
    );
  if (
    exception.exception_type === "UNKNOWN_DEVICE" &&
    [
      "LINK_TO_ASSET",
      "MARK_GUEST",
      "MARK_INFRASTRUCTURE",
      "IGNORE_BY_POLICY",
    ].includes(input.action)
  ) {
    const evidence = await input.tx.query(
      "SELECT mac::text AS mac FROM network.observations WHERE tenant_id=$1 AND id=$2",
      [input.tx.tenantId, exception.source_observation_id],
    );
    const mac = evidence.rows[0]?.mac;
    if (!mac)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "This device has no MAC address for a persistent disposition.",
      );
    const disposition =
      input.action === "LINK_TO_ASSET"
        ? "LINKED"
        : input.action === "MARK_GUEST"
          ? "GUEST"
          : input.action === "MARK_INFRASTRUCTURE"
            ? "INFRASTRUCTURE"
            : "IGNORED";
    const existing = await input.tx.query(
      "SELECT disposition,linked_asset_id FROM network.device_dispositions WHERE tenant_id=$1 AND mac=$2::macaddr FOR UPDATE",
      [input.tx.tenantId, mac],
    );
    if (
      existing.rowCount &&
      (existing.rows[0]!.disposition !== disposition ||
        String(existing.rows[0]!.linked_asset_id ?? "") !==
          String(input.linkedAssetId ?? ""))
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Device already has a different disposition.",
      );
    await input.tx.query(
      "INSERT INTO network.device_dispositions(id,tenant_id,mac,disposition,linked_asset_id,source_exception_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,mac) DO NOTHING",
      [
        randomUUID(),
        input.tx.tenantId,
        mac,
        disposition,
        input.linkedAssetId ?? null,
        input.exceptionId,
      ],
    );
  }
  await input.queue.resolveReference({
    tx: input.tx,
    exceptionId: input.exceptionId,
  });
  return updated.rows[0]!;
}
