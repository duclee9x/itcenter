import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { EventEnvelope } from "../../../packages/event-contracts/src/index.js";
import { consume } from "../../../packages/messaging/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import { evaluateAuthorization } from "../../../modules/identity/index.js";
import {
  createIncident,
  correlationProfile,
  decideCorrelation,
  scoreCorrelationCandidate,
  type CorrelationEvidenceFacts,
} from "../../../modules/incident/index.js";
import { readCurrentTopology } from "../../../modules/network/index.js";
import {
  createIncidentCorrelationFailureWorkItem,
  createIncidentCorrelationReviewWorkItem,
  recordIncidentCorrelationTimelineEvent,
} from "../../../modules/work-queue/index.js";
import { PostgresOutboxWriter } from "../../../packages/messaging/src/index.js";
import type { WorkerTask } from "./host.js";

const CONSUMER = "incident-correlation";
const serviceIdentity = "incident-correlation";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const deterministicEvaluationIdentity = (
  tenantId: string,
  subjectId: string,
  eventId: string,
  source: string,
  sourceKey: string,
  rootId: string,
) =>
  hash({
    tenant: tenantId,
    subject: subjectId,
    event: eventId,
    profile: correlationProfile,
    deterministic_cluster: {
      source,
      source_key_fingerprint: hash(sourceKey),
      root: rootId,
    },
  });
const wait = (signal: AbortSignal, ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

type IncidentContext = {
  id: string;
  code: string;
  title: string;
  source: string;
  state: string;
  version: number;
  root_incident_id: string | null;
  service_id: string | null;
  monitoring_event_id: string | null;
  source_correlation_key: string | null;
  metric: string | null;
  observed_at: string | null;
  asset_id: string | null;
  site_id: string | null;
};

async function readIncidentContext(
  tx: Transaction,
  incidentId: string,
): Promise<IncidentContext | null> {
  const result = await tx.query<IncidentContext>(
    `SELECT i.id,i.incident_code AS code,i.title,i.source,i.state,i.version,i.service_id,i.root_incident_id,
            i.monitoring_event_id,m.source_correlation_key,m.metric,m.observed_at,m.asset_id,
            (SELECT l.id FROM asset.locations l
              WHERE l.tenant_id=i.tenant_id AND l.type='SITE' AND l.id IN (
                WITH RECURSIVE ancestry(id,parent_id,depth) AS (
                  SELECT a.current_location_id,loc.parent_id,0
                  FROM asset.assets a JOIN asset.locations loc ON loc.tenant_id=a.tenant_id AND loc.id=a.current_location_id
                  WHERE a.tenant_id=i.tenant_id AND a.id=m.asset_id
                  UNION ALL
                  SELECT parent.id,parent.parent_id,ancestry.depth+1
                  FROM ancestry JOIN asset.locations parent ON parent.tenant_id=i.tenant_id AND parent.id=ancestry.parent_id
                ) SELECT id FROM ancestry
              ) ORDER BY l.id LIMIT 1) AS site_id
       FROM incident.incidents i
       LEFT JOIN monitoring.events m ON m.tenant_id=i.tenant_id AND m.id=i.monitoring_event_id
       WHERE i.tenant_id=$1 AND i.id=$2`,
    [tx.tenantId, incidentId],
  );
  return result.rows[0] ?? null;
}

type TopologyContext = {
  freshness: "FRESH" | "STALE" | "UNKNOWN";
  switch_name: string | null;
  vlan: number | null;
  observation_id: string | null;
};
async function topologyFor(
  tx: Transaction,
  assetId: string | null,
  observations?: Awaited<ReturnType<typeof readCurrentTopology>>,
): Promise<TopologyContext> {
  if (!assetId)
    return {
      freshness: "UNKNOWN",
      switch_name: null,
      vlan: null,
      observation_id: null,
    };
  const rows = observations ?? (await readCurrentTopology(tx));
  const observation = rows.find((row) => row.asset_id === assetId) as
    Record<string, unknown> | undefined;
  if (!observation)
    return {
      freshness: "UNKNOWN",
      switch_name: null,
      vlan: null,
      observation_id: null,
    };
  const freshness =
    observation.freshness === "FRESH" || observation.freshness === "STALE"
      ? observation.freshness
      : "UNKNOWN";
  return {
    freshness,
    switch_name:
      typeof observation.switch_name === "string"
        ? observation.switch_name
        : null,
    vlan: typeof observation.vlan === "number" ? observation.vlan : null,
    observation_id: typeof observation.id === "string" ? observation.id : null,
  };
}

function factsFor(
  subject: IncidentContext,
  candidate: IncidentContext,
  subjectTopology: TopologyContext,
  candidateTopology: TopologyContext,
): CorrelationEvidenceFacts {
  const topologyFreshness =
    subjectTopology.freshness === "FRESH" &&
    candidateTopology.freshness === "FRESH"
      ? "FRESH"
      : subjectTopology.freshness === "STALE" ||
          candidateTopology.freshness === "STALE"
        ? "STALE"
        : "UNKNOWN";
  const onsetA = Date.parse(subject.observed_at ?? "");
  const onsetB = Date.parse(candidate.observed_at ?? "");
  const onsetDifferenceMinutes =
    Number.isFinite(onsetA) && Number.isFinite(onsetB)
      ? Math.abs(onsetA - onsetB) / 60000
      : null;
  return {
    exactSourceKey:
      !!subject.source_correlation_key &&
      subject.source === candidate.source &&
      subject.source_correlation_key === candidate.source_correlation_key,
    topologyFreshness,
    sameFailureDomainAncestor:
      !!subjectTopology.switch_name &&
      subjectTopology.switch_name === candidateTopology.switch_name,
    sameVlanOrSubnet:
      subjectTopology.vlan !== null &&
      subjectTopology.vlan === candidateTopology.vlan,
    sameSite: !!subject.site_id && subject.site_id === candidate.site_id,
    sameServiceOrDependency:
      !!subject.service_id && subject.service_id === candidate.service_id,
    sameSymptomFamily:
      !!subject.metric &&
      subject.metric.trim().toLowerCase() ===
        candidate.metric?.trim().toLowerCase(),
    onsetDifferenceMinutes,
  };
}

async function candidateRootIds(tx: Transaction): Promise<string[]> {
  const result = await tx.query<{ root_incident_id: string }>(
    `SELECT DISTINCT root_incident_id FROM (
       SELECT root_incident_id FROM incident.root_relations WHERE tenant_id=$1 AND relation_state='ACTIVE'
       UNION SELECT root_incident_id FROM incident.incidents WHERE tenant_id=$1 AND root_incident_id IS NOT NULL
       UNION SELECT root_incident_id FROM incident.relations WHERE tenant_id=$1 AND related_entity_type='INCIDENT'
       UNION SELECT root_incident_id FROM incident.correlation_clusters WHERE tenant_id=$1 AND status='ACTIVE' AND root_incident_id IS NOT NULL
     ) roots WHERE root_incident_id IS NOT NULL`,
    [tx.tenantId],
  );
  return result.rows.map((row) => row.root_incident_id);
}

async function rootMemberIds(
  tx: Transaction,
  rootId: string,
): Promise<string[]> {
  const rows = await tx.query<{ incident_id: string }>(
    `SELECT $2::uuid AS incident_id
     UNION SELECT child_incident_id FROM incident.root_relations WHERE tenant_id=$1 AND root_incident_id=$2 AND relation_state='ACTIVE'
     UNION SELECT id FROM incident.incidents WHERE tenant_id=$1 AND root_incident_id=$2
     UNION SELECT legacy.related_entity_id FROM incident.relations legacy
       JOIN incident.incidents child ON child.tenant_id=legacy.tenant_id AND child.id=legacy.related_entity_id
        AND child.root_incident_id=legacy.root_incident_id
       WHERE legacy.tenant_id=$1 AND legacy.root_incident_id=$2 AND legacy.related_entity_type='INCIDENT'`,
    [tx.tenantId, rootId],
  );
  return rows.rows.map((row) => row.incident_id);
}

async function deterministicRoot(
  tx: Transaction,
  subject: IncidentContext,
  event: EventEnvelope,
): Promise<{ rootId: string; created: boolean; peerIds: string[] } | null> {
  if (!subject.source_correlation_key) return null;
  const initialPeers = await tx.query<{
    id: string;
    incident_code: string;
    title: string;
    priority: string;
  }>(
    `SELECT i.id,i.incident_code,i.title,i.priority FROM incident.incidents i
       JOIN monitoring.events m ON m.tenant_id=i.tenant_id AND m.id=i.monitoring_event_id
      WHERE i.tenant_id=$1 AND i.source=$2 AND m.source_correlation_key=$3
        AND i.state NOT IN ('CLOSED','CANCELLED') AND i.root_incident_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM incident.root_relations r WHERE r.tenant_id=i.tenant_id AND r.child_incident_id=i.id AND r.relation_state='ACTIVE')
      ORDER BY i.created_at,i.id`,
    [tx.tenantId, subject.source, subject.source_correlation_key],
  );
  if ((initialPeers.rowCount ?? 0) < 2) return null;
  const initialPeerIds = initialPeers.rows.map((peer) => peer.id);
  await tx.query(
    "SELECT id FROM incident.incidents WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
    [tx.tenantId, initialPeerIds],
  );
  const peers = await tx.query<{
    id: string;
    incident_code: string;
    title: string;
    priority: string;
  }>(
    `SELECT i.id,i.incident_code,i.title,i.priority FROM incident.incidents i
       JOIN monitoring.events m ON m.tenant_id=i.tenant_id AND m.id=i.monitoring_event_id
      WHERE i.tenant_id=$1 AND i.source=$2 AND m.source_correlation_key=$3
        AND i.state NOT IN ('CLOSED','CANCELLED') AND i.root_incident_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM incident.root_relations r WHERE r.tenant_id=i.tenant_id AND r.child_incident_id=i.id AND r.relation_state='ACTIVE')
      ORDER BY i.created_at,i.id`,
    [tx.tenantId, subject.source, subject.source_correlation_key],
  );
  if ((peers.rowCount ?? 0) < 2) {
    const activeCluster = await tx.query<{
      root_incident_id: string | null;
      state: string;
      parent_id: string | null;
    }>(
      `SELECT c.root_incident_id,i.state,i.root_incident_id AS parent_id
         FROM incident.correlation_clusters c
         JOIN incident.incidents i ON i.tenant_id=c.tenant_id AND i.id=c.root_incident_id
        WHERE c.tenant_id=$1 AND c.source_type=$2 AND c.source_correlation_key=$3 AND c.status='ACTIVE'
        FOR UPDATE OF c,i`,
      [tx.tenantId, subject.source, subject.source_correlation_key],
    );
    const current = activeCluster.rows[0];
    if (
      current?.root_incident_id &&
      current.parent_id === null &&
      !["CLOSED", "CANCELLED"].includes(current.state)
    )
      return {
        rootId: current.root_incident_id,
        created: false,
        peerIds: initialPeerIds,
      };
    return null;
  }
  const peerIds = peers.rows.map((peer) => peer.id);
  const clusterKey = `${subject.source}\u0000${subject.source_correlation_key}`;
  const clusterInsert = await tx.query<{ id: string }>(
    `INSERT INTO incident.correlation_clusters(id,tenant_id,source_type,source_correlation_key,status)
     VALUES($1,$2,$3,$4,'ACTIVE') ON CONFLICT(tenant_id,source_type,source_correlation_key) WHERE status='ACTIVE' DO NOTHING RETURNING id`,
    [randomUUID(), tx.tenantId, subject.source, subject.source_correlation_key],
  );
  if (!clusterInsert.rowCount) {
    const existing = await tx.query<{ root_incident_id: string | null }>(
      `SELECT root_incident_id FROM incident.correlation_clusters WHERE tenant_id=$1 AND source_type=$2 AND source_correlation_key=$3 AND status='ACTIVE' FOR UPDATE`,
      [tx.tenantId, subject.source, subject.source_correlation_key],
    );
    if (existing.rows[0]?.root_incident_id)
      return {
        rootId: existing.rows[0].root_incident_id,
        created: false,
        peerIds,
      };
    return null;
  }
  const suffix = hash(clusterKey).slice(0, 16).toUpperCase();
  const root = await createIncident({
    tx,
    incidentCode: `ROOT-${suffix}`,
    title: "Root incident created from deterministic source correlation",
    source: "CORRELATION",
    priority: peers.rows[0]!.priority,
    serviceId: subject.service_id ?? undefined,
  });
  await tx.query(
    "UPDATE incident.correlation_clusters SET root_incident_id=$1 WHERE tenant_id=$2 AND id=$3",
    [root.id, tx.tenantId, clusterInsert.rows[0]!.id],
  );
  await emit(tx, event, "ROOT_INCIDENT.CREATED_FROM_CORRELATION", root.id, 1, {
    root_incident_id: root.id,
    source_type: subject.source,
    source_key_fingerprint: hash(subject.source_correlation_key),
  });
  await new PostgresAudit(tx).append({
    id: randomUUID(),
    tenant_id: tx.tenantId,
    event_type: "ROOT_INCIDENT.CREATED_FROM_CORRELATION",
    occurred_at: new Date().toISOString(),
    actor: { type: "SERVICE_ACCOUNT", id: serviceIdentity },
    action: { command_type: "INCIDENT.CORRELATION_CREATE_ROOT" },
    subject: { entity_type: "INCIDENT", entity_id: root.id },
    correlation_id: event.correlation_id,
    causation_id: event.event_id,
    reason: {
      code: "DETERMINISTIC_SOURCE_CLUSTER",
      text: "At least two eligible Incidents share an exact canonical source key",
    },
    before: null,
    after: {
      root_incident_id: root.id,
      source_type: subject.source,
      source_key_fingerprint: hash(subject.source_correlation_key),
    },
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
  return { rootId: root.id, created: true, peerIds };
}

async function hasSuppression(
  tx: Transaction,
  childId: string,
  rootId: string,
): Promise<boolean> {
  const result = await tx.query(
    "SELECT 1 FROM incident.correlation_active_suppressions WHERE tenant_id=$1 AND child_incident_id=$2 AND root_incident_id=$3",
    [tx.tenantId, childId, rootId],
  );
  return !!result.rowCount;
}

async function emit(
  tx: Transaction,
  cause: EventEnvelope,
  type: string,
  aggregateId: string,
  version: number,
  payload: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  await new PostgresOutboxWriter(tx).append({
    event_id: randomUUID(),
    event_type: type,
    schema_version: 1,
    occurred_at: now,
    producer: { service: "itcenter-worker", instance: CONSUMER },
    aggregate: { type: "INCIDENT", id: aggregateId, version },
    actor: { type: "SERVICE_ACCOUNT", id: serviceIdentity },
    correlation_id: cause.correlation_id,
    causation_id: cause.event_id,
    tenant_id: tx.tenantId,
    organization_id: tx.tenantId,
    idempotency_key: `${CONSUMER}:${cause.event_id}:${type}:${aggregateId}`,
    payload: payload as never,
  });
}

async function automaticLinkAuthorization(
  tx: Transaction,
  subject: IncidentContext,
  rootId: string | null,
): Promise<string | null> {
  const principal = await tx.query<{ id: string }>(
    "SELECT id FROM identity.correlation_principals WHERE tenant_id=$1 AND service_identity=$2 AND active=true",
    [tx.tenantId, serviceIdentity],
  );
  if (!principal.rowCount) return "SYSTEM_CORRELATION_PRINCIPAL_NOT_CONFIGURED";
  const candidates = rootId ? [subject.id, rootId] : [subject.id];
  for (const targetId of candidates) {
    const target = await tx.query<{
      service_id: string | null;
      site_id: string | null;
    }>(
      `SELECT i.service_id,(SELECT l.id FROM asset.locations l WHERE l.tenant_id=i.tenant_id AND l.type='SITE' AND l.id IN (
        WITH RECURSIVE a(id,parent_id) AS (SELECT x.current_location_id,l.parent_id FROM asset.assets x JOIN asset.locations l ON l.tenant_id=x.tenant_id AND l.id=x.current_location_id WHERE x.tenant_id=i.tenant_id AND x.id=m.asset_id
          UNION ALL SELECT p.id,p.parent_id FROM a JOIN asset.locations p ON p.tenant_id=i.tenant_id AND p.id=a.parent_id) SELECT id FROM a) LIMIT 1) site_id
       FROM incident.incidents i LEFT JOIN monitoring.events m ON m.tenant_id=i.tenant_id AND m.id=i.monitoring_event_id WHERE i.tenant_id=$1 AND i.id=$2`,
      [tx.tenantId, targetId],
    );
    if (!target.rowCount) return "CORRELATION_TARGET_NOT_FOUND";
    const targetContext = target.rows[0]!;
    const scopeContext = targetContext;
    const scope = {
      ...Object.fromEntries(
        Object.entries(scopeContext)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => [
            k === "service_id" ? "service" : "site",
            v as string,
          ]),
      ),
      tenant: tx.tenantId,
    };
    const auth = await evaluateAuthorization(tx, {
      principalId: principal.rows[0]!.id,
      principalType: "SYSTEM_CORRELATION",
      tenantId: tx.tenantId,
      action: "incident.correlation.link",
      resourceType: "incident",
      resourceId: targetId,
      scope,
    });
    if (auth.result !== "ALLOW") return "SYSTEM_CORRELATION_NOT_AUTHORIZED";
  }
  return null;
}

async function linkAutomatically(
  tx: Transaction,
  event: EventEnvelope,
  subject: IncidentContext,
  rootId: string,
  decisionId: string,
  score: number,
): Promise<void> {
  const subjectLocked = await tx.query<{
    version: number;
    state: string;
    root_incident_id: string | null;
  }>(
    "SELECT version,state,root_incident_id FROM incident.incidents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, subject.id],
  );
  const current = subjectLocked.rows[0];
  if (!current || ["CLOSED", "CANCELLED"].includes(current.state))
    throw new Error("Correlation subject became non-linkable");
  const rootLocked = await tx.query<{
    state: string;
    root_incident_id: string | null;
  }>(
    "SELECT state,root_incident_id FROM incident.incidents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, rootId],
  );
  if (
    !rootLocked.rowCount ||
    ["CLOSED", "CANCELLED"].includes(rootLocked.rows[0]!.state) ||
    rootLocked.rows[0]!.root_incident_id
  )
    throw new Error("Correlation target Root became non-linkable");
  if (current.root_incident_id && current.root_incident_id !== rootId)
    throw new Error("Correlation subject already belongs to a different Root");
  if (await hasSuppression(tx, subject.id, rootId))
    throw new Error("Manual correlation detach suppression is active");
  const activeRelation = await tx.query<{
    id: string;
    root_incident_id: string;
  }>(
    "SELECT id,root_incident_id FROM incident.root_relations WHERE tenant_id=$1 AND child_incident_id=$2 AND relation_state='ACTIVE' FOR UPDATE",
    [tx.tenantId, subject.id],
  );
  if (
    activeRelation.rowCount &&
    activeRelation.rows[0]!.root_incident_id !== rootId
  )
    throw new Error(
      "Correlation subject already has another active Root relation",
    );
  if (activeRelation.rowCount && current.root_incident_id === rootId) return;
  const existingRelation = activeRelation.rows.some(
    (relation) => relation.root_incident_id === rootId,
  );
  const relationId = existingRelation
    ? activeRelation.rows[0]!.id
    : randomUUID();
  if (!existingRelation)
    await tx.query(
      `INSERT INTO incident.root_relations(id,tenant_id,child_incident_id,root_incident_id,relation_state,origin,decision_id,reason,confidence,linked_by_type,linked_by_id)
     VALUES($1,$2,$3,$4,'ACTIVE','AUTOMATIC',$5,'TASK-092 deterministic correlation',$6,'SYSTEM_CORRELATION',$7) ON CONFLICT DO NOTHING`,
      [
        relationId,
        tx.tenantId,
        subject.id,
        rootId,
        decisionId,
        score,
        serviceIdentity,
      ],
    );
  const changed = await tx.query(
    `UPDATE incident.incidents SET root_incident_id=$1,version=version+1,updated_at=now()
      WHERE tenant_id=$2 AND id=$3 AND version=$4 AND (root_incident_id IS NULL OR root_incident_id=$1)`,
    [rootId, tx.tenantId, subject.id, current.version],
  );
  if (!changed.rowCount)
    throw new Error("Correlation subject version changed concurrently");
  await tx.query(
    `INSERT INTO incident.relations(id,tenant_id,root_incident_id,related_entity_type,related_entity_id,relation_reason,correlation_score)
     VALUES($1,$2,$3,'INCIDENT',$4,'TASK-092 automatic correlation',$5) ON CONFLICT DO NOTHING`,
    [randomUUID(), tx.tenantId, rootId, subject.id, score / 100],
  );
  await emit(
    tx,
    event,
    "INCIDENT.LINKED_TO_ROOT",
    subject.id,
    current.version + 1,
    {
      incident_id: subject.id,
      root_incident_id: rootId,
      decision_id: decisionId,
      confidence: score,
      origin: "AUTOMATIC",
    },
  );
  await new PostgresAudit(tx).append({
    id: randomUUID(),
    tenant_id: tx.tenantId,
    event_type: "INCIDENT.LINKED_TO_ROOT",
    occurred_at: new Date().toISOString(),
    actor: { type: "SYSTEM_CORRELATION", id: serviceIdentity },
    action: { command_type: "INCIDENT.CORRELATION_ATTACH" },
    subject: { entity_type: "INCIDENT", entity_id: subject.id },
    correlation_id: event.correlation_id,
    causation_id: event.event_id,
    reason: {
      code: "AUTO_LINK",
      text: "Unambiguous strong evidence met TASK-092 v1 profile",
    },
    before: { root_incident_id: null },
    after: {
      root_incident_id: rootId,
      decision_id: decisionId,
      confidence: score,
    },
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
  await recordIncidentCorrelationTimelineEvent({
    tx,
    incidentId: subject.id,
    eventType: "INCIDENT.LINKED_TO_ROOT",
    summary: `Automatically linked to Root ${rootId} with confidence ${score}`,
    payload: {
      root_incident_id: rootId,
      decision_id: decisionId,
      confidence: score,
    },
    sourceEventId: randomUUID(),
  });
}

async function linkDeterministicSiblingIncidents(
  tx: Transaction,
  currentSubjectId: string,
  rootId: string,
  currentDecisionId: string,
  peerIds: string[],
): Promise<void> {
  for (const peerId of peerIds) {
    if (peerId === currentSubjectId) continue;
    const peer = await readIncidentContext(tx, peerId);
    if (!peer || ["CLOSED", "CANCELLED"].includes(peer.state)) continue;
    const priorRelation = await tx.query<{ root_incident_id: string }>(
      "SELECT root_incident_id FROM incident.root_relations WHERE tenant_id=$1 AND child_incident_id=$2 AND relation_state='ACTIVE'",
      [tx.tenantId, peerId],
    );
    const pointer = await tx.query<{ root_incident_id: string | null }>(
      "SELECT root_incident_id FROM incident.incidents WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, peerId],
    );
    const sourceEvent = await tx.query<{ payload: EventEnvelope }>(
      "SELECT payload FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='INCIDENT.CREATED' AND aggregate_type='INCIDENT' AND aggregate_id=$2 ORDER BY created_at,id LIMIT 1",
      [tx.tenantId, peerId],
    );
    if (!sourceEvent.rowCount) continue;
    const peerEvent = sourceEvent.rows[0]!.payload;
    const activeRoot =
      priorRelation.rows[0]?.root_incident_id ??
      pointer.rows[0]?.root_incident_id ??
      null;
    if (activeRoot === rootId) continue;
    const suppressed = await hasSuppression(tx, peerId, rootId);
    const authFailure =
      activeRoot && activeRoot !== rootId
        ? "CONFLICTING_ACTIVE_ROOT"
        : suppressed
          ? "MANUAL_DETACH_SUPPRESSION"
          : await automaticLinkAuthorization(tx, peer, rootId);
    const outcome =
      authFailure === "MANUAL_DETACH_SUPPRESSION"
        ? "NO_LINK"
        : (activeRoot && activeRoot !== rootId) ||
            (authFailure && authFailure !== "MANUAL_DETACH_SUPPRESSION")
          ? "REVIEW_REQUIRED"
          : "AUTO_LINK";
    const reasonCode = authFailure ?? "DETERMINISTIC_SOURCE_CLUSTER";
    const evaluationIdentity = deterministicEvaluationIdentity(
      tx.tenantId,
      peerId,
      peerEvent.event_id,
      peer.source,
      peer.source_correlation_key!,
      rootId,
    );
    const fingerprint = hash({
      source_key_fingerprint: hash(peer.source_correlation_key),
      root: rootId,
      active_root: activeRoot,
      suppressed,
      outcome,
    });
    const decisionId = randomUUID();
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO incident.correlation_decisions
        (id,tenant_id,subject_incident_id,source_event_id,evaluation_identity,profile_id,profile_version,evidence_fingerprint,outcome,selected_root_incident_id,confidence,reason_code,candidate_count,decision_evidence,actor_type,actor_id,correlation_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,100,$11,1,$12,'SYSTEM_CORRELATION',$13,$14)
       ON CONFLICT(tenant_id,evaluation_identity) DO NOTHING RETURNING id`,
      [
        decisionId,
        tx.tenantId,
        peerId,
        peerEvent.event_id,
        evaluationIdentity,
        correlationProfile.id,
        correlationProfile.version,
        fingerprint,
        outcome,
        outcome === "AUTO_LINK" ? rootId : null,
        reasonCode,
        JSON.stringify({
          root_incident_id: rootId,
          evidence_code: "DETERMINISTIC_SOURCE_KEY",
          contribution: 100,
          source_event_id: peerEvent.event_id,
          prior_root_incident_id: activeRoot,
          suppressed,
        }),
        serviceIdentity,
        peerEvent.correlation_id,
      ],
    );
    if (!inserted.rowCount) continue;
    await tx.query(
      `INSERT INTO incident.correlation_decision_candidates(id,tenant_id,decision_id,candidate_root_incident_id,raw_score,confidence,strong_signals,eligible,evidence)
       VALUES($1,$2,$3,$4,100,100,'["DETERMINISTIC_SOURCE_KEY"]'::jsonb,true,$5)`,
      [
        randomUUID(),
        tx.tenantId,
        decisionId,
        rootId,
        JSON.stringify({
          evidence_code: "DETERMINISTIC_SOURCE_KEY",
          contribution: 100,
          source_event_id: peerEvent.event_id,
        }),
      ],
    );
    if (outcome === "AUTO_LINK") {
      await linkAutomatically(tx, peerEvent, peer, rootId, decisionId, 100);
      await emit(
        tx,
        peerEvent,
        "INCIDENT.CORRELATION_EVALUATED",
        peerId,
        peer.version,
        {
          decision_id: decisionId,
          incident_id: peerId,
          outcome,
          reason_code: reasonCode,
          profile_id: correlationProfile.id,
          profile_version: correlationProfile.version,
          confidence: 100,
        },
      );
    } else {
      const type =
        outcome === "REVIEW_REQUIRED"
          ? "INCIDENT.CORRELATION_REVIEW_REQUIRED"
          : "INCIDENT.CORRELATION_EVALUATED";
      const payload = {
        decision_id: decisionId,
        incident_id: peerId,
        outcome,
        reason_code: reasonCode,
        profile_id: correlationProfile.id,
        profile_version: correlationProfile.version,
        confidence: 100,
      };
      await emit(tx, peerEvent, type, peerId, peer.version, payload);
      if (outcome === "REVIEW_REQUIRED")
        await createIncidentCorrelationReviewWorkItem({
          tx,
          decisionId,
          title: `Incident correlation requires review (${reasonCode})`,
        });
    }
    await new PostgresAudit(tx).append({
      id: randomUUID(),
      tenant_id: tx.tenantId,
      event_type: "INCIDENT.CORRELATION_EVALUATED",
      occurred_at: new Date().toISOString(),
      actor: { type: "SYSTEM_CORRELATION", id: serviceIdentity },
      action: { command_type: "INCIDENT.CORRELATION_EVALUATE" },
      subject: { entity_type: "INCIDENT", entity_id: peerId },
      correlation_id: peerEvent.correlation_id,
      causation_id: peerEvent.event_id,
      reason: { code: reasonCode, text: reasonCode },
      before: { root_incident_id: activeRoot },
      after: {
        decision_id: decisionId,
        outcome,
        root_incident_id: outcome === "AUTO_LINK" ? rootId : null,
        confidence: 100,
      },
      outcome: { status: "SUCCESS" },
      classification: "INTERNAL",
      relations: [],
      evidence: [],
    });
    await recordIncidentCorrelationTimelineEvent({
      tx,
      incidentId: peerId,
      eventType: "INCIDENT.CORRELATION_EVALUATED",
      summary:
        outcome === "AUTO_LINK"
          ? `Automatically correlated to Root ${rootId}`
          : outcome === "NO_LINK"
            ? "Manual detach suppression prevented automatic reattachment"
            : "Deterministic correlation requires human review",
      payload: {
        decision_id: decisionId,
        outcome,
        reason_code: reasonCode,
        root_incident_id: rootId,
        contributing_decision_id: currentDecisionId,
      },
      sourceEventId: randomUUID(),
    });
  }
}

export async function processIncidentCorrelationEvent(
  uow: UnitOfWork,
  event: EventEnvelope,
): Promise<"processed" | "duplicate"> {
  if (
    event.event_type !== "INCIDENT.CREATED" ||
    event.aggregate.type !== "INCIDENT"
  )
    return "duplicate";
  return consume(uow, CONSUMER, event, async (tx, delivered) => {
    if (delivered.tenant_id !== tx.tenantId)
      throw new Error("Correlation event tenant mismatch");
    await tx.query(
      "UPDATE incident.correlation_processing_failures SET state='RESOLVED',next_attempt_at=NULL,updated_at=now() WHERE tenant_id=$1 AND event_id=$2 AND state='RETRYING'",
      [tx.tenantId, delivered.event_id],
    );
    const subject = await readIncidentContext(tx, delivered.aggregate.id);
    if (!subject || ["CLOSED", "CANCELLED"].includes(subject.state)) return;
    const topology = await readCurrentTopology(tx);
    const subjectTopology = await topologyFor(tx, subject.asset_id, topology);
    const roots = await candidateRootIds(tx);
    let rootCreationReviewReason: string | null = null;
    let deterministicPeerIds: string[] = [];
    const scored = [] as ReturnType<typeof scoreCorrelationCandidate>[];
    const candidateEvidence: Record<string, unknown>[] = [];
    let staleStrongTopology = false;
    let deterministicClusterRootId: string | null = null;
    for (const rootId of roots) {
      const root = await readIncidentContext(tx, rootId);
      if (
        !root ||
        ["CLOSED", "CANCELLED"].includes(root.state) ||
        root.root_incident_id
      )
        continue;
      let bestScore: ReturnType<typeof scoreCorrelationCandidate> | null = null;
      let selectedEvidence: Record<string, unknown> | null = null;
      const memberIds = await rootMemberIds(tx, rootId);
      for (const memberId of memberIds) {
        const member =
          memberId === rootId ? root : await readIncidentContext(tx, memberId);
        if (!member || ["CLOSED", "CANCELLED"].includes(member.state)) continue;
        const memberTopology = await topologyFor(tx, member.asset_id, topology);
        const facts = factsFor(
          subject,
          member,
          subjectTopology,
          memberTopology,
        );
        if (
          facts.sameFailureDomainAncestor &&
          facts.topologyFreshness !== "FRESH"
        )
          staleStrongTopology = true;
        if (subject.source_correlation_key) {
          const cluster = await tx.query(
            "SELECT 1 FROM incident.correlation_clusters WHERE tenant_id=$1 AND root_incident_id=$2 AND source_type=$3 AND source_correlation_key=$4 AND status='ACTIVE'",
            [
              tx.tenantId,
              rootId,
              subject.source,
              subject.source_correlation_key,
            ],
          );
          if (cluster.rowCount) {
            facts.exactSourceKey = true;
            deterministicClusterRootId = rootId;
          }
        }
        const scoredMember = scoreCorrelationCandidate({
          rootIncidentId: root.id,
          facts,
          evidenceReferences: {
            DETERMINISTIC_SOURCE_KEY:
              subject.monitoring_event_id && member.monitoring_event_id
                ? [subject.monitoring_event_id, member.monitoring_event_id]
                : [],
            FRESH_FAILURE_DOMAIN_ANCESTOR: [
              subjectTopology.observation_id,
              memberTopology.observation_id,
            ].filter((v): v is string => !!v),
            FRESH_VLAN_OR_SUBNET: [
              subjectTopology.observation_id,
              memberTopology.observation_id,
            ].filter((v): v is string => !!v),
            SAME_SITE: [subject.asset_id, member.asset_id].filter(
              (v): v is string => !!v,
            ),
            SAME_SERVICE_OR_DEPENDENCY: [
              subject.service_id,
              member.service_id,
            ].filter((v): v is string => !!v),
            SAME_SYMPTOM_FAMILY: [
              subject.monitoring_event_id,
              member.monitoring_event_id,
            ].filter((v): v is string => !!v),
            ONSET_WITHIN_5_MINUTES: [
              subject.monitoring_event_id,
              member.monitoring_event_id,
            ].filter((v): v is string => !!v),
            ONSET_WITHIN_15_MINUTES: [
              subject.monitoring_event_id,
              member.monitoring_event_id,
            ].filter((v): v is string => !!v),
          },
        });
        if (!bestScore || scoredMember.score > bestScore.score) {
          bestScore = scoredMember;
          selectedEvidence = {
            member_incident_id: member.id,
            facts,
            freshness: {
              subject: subjectTopology.freshness,
              candidate: memberTopology.freshness,
            },
            contributions: scoredMember.contributions,
          };
        }
      }
      const score = bestScore;
      if (!score || !selectedEvidence) continue;
      if (score.score === 0) continue;
      scored.push(score);
      candidateEvidence.push({
        root_incident_id: root.id,
        score: score.score,
        raw_score: score.rawScore,
        strong_signals: score.strongSignals,
        ...selectedEvidence,
        eligible: true,
      });
    }
    const sourceKey = subject.source_correlation_key;
    const countSameKey = sourceKey
      ? await tx.query<{ count: string }>(
          `SELECT count(*)::text count FROM incident.incidents i JOIN monitoring.events m ON m.tenant_id=i.tenant_id AND m.id=i.monitoring_event_id
       WHERE i.tenant_id=$1 AND i.source=$2 AND m.source_correlation_key=$3 AND i.state NOT IN ('CLOSED','CANCELLED') AND i.root_incident_id IS NULL
         AND NOT EXISTS(SELECT 1 FROM incident.root_relations r WHERE r.tenant_id=i.tenant_id AND r.child_incident_id=i.id AND r.relation_state='ACTIVE')`,
          [tx.tenantId, subject.source, sourceKey],
        )
      : null;
    if (
      sourceKey &&
      Number(countSameKey?.rows[0]?.count ?? 0) >= 2 &&
      !scored.some((candidate) => candidate.score >= 60)
    ) {
      const authFailure = await automaticLinkAuthorization(tx, subject, null);
      if (authFailure) rootCreationReviewReason = authFailure;
      else {
        const rootResult = await deterministicRoot(tx, subject, delivered);
        if (!rootResult)
          rootCreationReviewReason = "ROOT_CLUSTER_INTEGRITY_FAILURE";
        else if (
          !scored.some(
            (candidate) => candidate.rootIncidentId === rootResult.rootId,
          )
        ) {
          deterministicClusterRootId = rootResult.rootId;
          deterministicPeerIds = rootResult.peerIds;
          const root = await readIncidentContext(tx, rootResult.rootId);
          if (root) {
            const rootTopology = await topologyFor(tx, root.asset_id, topology);
            const facts = factsFor(
              subject,
              root,
              subjectTopology,
              rootTopology,
            );
            facts.exactSourceKey = true;
            const score = scoreCorrelationCandidate({
              rootIncidentId: rootResult.rootId,
              facts,
              evidenceReferences: {
                DETERMINISTIC_SOURCE_KEY: [
                  subject.monitoring_event_id,
                  rootResult.rootId,
                ].filter((value): value is string => !!value),
              },
            });
            scored.push(score);
            candidateEvidence.push({
              root_incident_id: rootResult.rootId,
              score: score.score,
              raw_score: score.rawScore,
              strong_signals: score.strongSignals,
              contributions: score.contributions,
              freshness: {
                subject: subjectTopology.freshness,
                candidate: rootTopology.freshness,
              },
              eligible: true,
            });
            roots.push(rootResult.rootId);
          } else rootCreationReviewReason = "ROOT_CLUSTER_INTEGRITY_FAILURE";
        }
      }
    }
    if (
      staleStrongTopology &&
      !scored.some((candidate) => candidate.score >= 60)
    )
      rootCreationReviewReason =
        rootCreationReviewReason ?? "STALE_TOPOLOGY_EVIDENCE_REQUIRES_REVIEW";
    const existingRelation = await tx.query<{ root_incident_id: string }>(
      "SELECT root_incident_id FROM incident.root_relations WHERE tenant_id=$1 AND child_incident_id=$2 AND relation_state='ACTIVE'",
      [tx.tenantId, subject.id],
    );
    const currentPointer = await tx.query<{ root_incident_id: string | null }>(
      "SELECT root_incident_id FROM incident.incidents WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, subject.id],
    );
    const explicitReviewReason: string | null = rootCreationReviewReason;
    const suppressed = [] as string[];
    for (let i = scored.length - 1; i >= 0; i--)
      if (await hasSuppression(tx, subject.id, scored[i]!.rootIncidentId)) {
        suppressed.push(scored[i]!.rootIncidentId);
        scored.splice(i, 1);
        candidateEvidence.splice(i, 1);
      }
    let decision = decideCorrelation({
      candidates: scored,
      explicitReviewReason,
    });
    const activeRootId =
      existingRelation.rows[0]?.root_incident_id ??
      currentPointer.rows[0]?.root_incident_id ??
      null;
    if (
      activeRootId &&
      decision.outcome === "AUTO_LINK" &&
      decision.selectedRootIncidentId !== activeRootId
    )
      decision = {
        outcome: "REVIEW_REQUIRED",
        selectedRootIncidentId: null,
        reasonCode: "SUBJECT_ALREADY_LINKED_REQUIRES_REVIEW",
      };
    const material = {
      subject: subject.id,
      source_event: delivered.event_id,
      profile: correlationProfile,
      evidence: candidateEvidence,
      suppressed,
    };
    const evidenceFingerprint = hash(material);
    const evaluationIdentity =
      decision.outcome === "AUTO_LINK" &&
      decision.selectedRootIncidentId &&
      deterministicClusterRootId === decision.selectedRootIncidentId &&
      sourceKey
        ? deterministicEvaluationIdentity(
            tx.tenantId,
            subject.id,
            delivered.event_id,
            subject.source,
            sourceKey,
            decision.selectedRootIncidentId,
          )
        : hash({
            tenant: tx.tenantId,
            subject: subject.id,
            event: delivered.event_id,
            profile: correlationProfile.id,
            version: correlationProfile.version,
            evidence: evidenceFingerprint,
          });
    const decisionId = randomUUID();
    if (decision.outcome === "AUTO_LINK" && decision.selectedRootIncidentId) {
      if (activeRootId !== decision.selectedRootIncidentId) {
        const authorizationFailure = await automaticLinkAuthorization(
          tx,
          subject,
          decision.selectedRootIncidentId,
        );
        if (authorizationFailure)
          decision = {
            outcome: "REVIEW_REQUIRED",
            selectedRootIncidentId: null,
            reasonCode: authorizationFailure,
          };
      }
    }
    const confidence = Math.max(
      0,
      ...scored.map((candidate) => candidate.score),
    );
    const insert = await tx.query<{ id: string }>(
      `INSERT INTO incident.correlation_decisions(id,tenant_id,subject_incident_id,source_event_id,evaluation_identity,profile_id,profile_version,evidence_fingerprint,outcome,selected_root_incident_id,confidence,reason_code,candidate_count,decision_evidence,actor_type,actor_id,correlation_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'SYSTEM_CORRELATION',$15,$16)
       ON CONFLICT(tenant_id,evaluation_identity) DO NOTHING RETURNING id`,
      [
        decisionId,
        tx.tenantId,
        subject.id,
        delivered.event_id,
        evaluationIdentity,
        correlationProfile.id,
        correlationProfile.version,
        evidenceFingerprint,
        decision.outcome,
        decision.selectedRootIncidentId,
        confidence,
        decision.reasonCode,
        candidateEvidence.length,
        JSON.stringify({
          subject: {
            incident_id: subject.id,
            monitoring_event_id: subject.monitoring_event_id,
            source_key_fingerprint: sourceKey ? hash(sourceKey) : null,
            source: subject.source,
          },
          candidates: candidateEvidence,
          suppressed_roots: suppressed,
        }),
        serviceIdentity,
        delivered.correlation_id,
      ],
    );
    if (!insert.rowCount) return;
    for (const evidence of candidateEvidence) {
      const candidate = evidence as {
        root_incident_id: string;
        score: number;
        raw_score: number;
        strong_signals: unknown;
        eligible: boolean;
        contributions: unknown;
      };
      await tx.query(
        `INSERT INTO incident.correlation_decision_candidates(id,tenant_id,decision_id,candidate_root_incident_id,raw_score,confidence,strong_signals,eligible,exclusion_reason,evidence)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9) ON CONFLICT DO NOTHING`,
        [
          randomUUID(),
          tx.tenantId,
          decisionId,
          candidate.root_incident_id,
          candidate.raw_score,
          candidate.score,
          JSON.stringify(candidate.strong_signals),
          candidate.eligible,
          JSON.stringify(evidence),
        ],
      );
    }
    if (decision.outcome === "AUTO_LINK" && decision.selectedRootIncidentId) {
      const scoredCandidate = scored.find(
        (item) => item.rootIncidentId === decision.selectedRootIncidentId,
      )!;
      if (activeRootId !== decision.selectedRootIncidentId)
        await linkAutomatically(
          tx,
          delivered,
          subject,
          decision.selectedRootIncidentId,
          decisionId,
          scoredCandidate.score,
        );
    }
    if (
      decision.outcome === "AUTO_LINK" &&
      decision.selectedRootIncidentId &&
      deterministicPeerIds.length > 1
    )
      await linkDeterministicSiblingIncidents(
        tx,
        subject.id,
        decision.selectedRootIncidentId,
        decisionId,
        deterministicPeerIds,
      );
    const eventType =
      decision.outcome === "REVIEW_REQUIRED"
        ? "INCIDENT.CORRELATION_REVIEW_REQUIRED"
        : "INCIDENT.CORRELATION_EVALUATED";
    const eventPayload = {
      decision_id: decisionId,
      incident_id: subject.id,
      outcome: decision.outcome,
      reason_code: decision.reasonCode,
      profile_id: correlationProfile.id,
      profile_version: correlationProfile.version,
      confidence,
    };
    await emit(
      tx,
      delivered,
      eventType,
      subject.id,
      subject.version,
      eventPayload,
    );
    await new PostgresAudit(tx).append({
      id: randomUUID(),
      tenant_id: tx.tenantId,
      event_type: "INCIDENT.CORRELATION_EVALUATED",
      occurred_at: new Date().toISOString(),
      actor: { type: "SERVICE_ACCOUNT", id: serviceIdentity },
      action: { command_type: "INCIDENT.CORRELATION_EVALUATE" },
      subject: { entity_type: "INCIDENT", entity_id: subject.id },
      correlation_id: delivered.correlation_id,
      causation_id: delivered.event_id,
      reason: { code: decision.reasonCode, text: decision.reasonCode },
      before: null,
      after: {
        decision_id: decisionId,
        outcome: decision.outcome,
        confidence,
        profile_id: correlationProfile.id,
        profile_version: correlationProfile.version,
      },
      outcome: { status: "SUCCESS" },
      classification: "INTERNAL",
      relations: [],
      evidence: [],
    });
    await recordIncidentCorrelationTimelineEvent({
      tx,
      incidentId: subject.id,
      eventType: eventType,
      summary:
        decision.outcome === "REVIEW_REQUIRED"
          ? "Incident correlation requires review"
          : decision.outcome === "NO_LINK"
            ? "No Incident correlation found"
            : `Incident correlation evaluated at confidence ${confidence}`,
      payload: eventPayload,
      sourceEventId: randomUUID(),
    });
    if (decision.outcome === "REVIEW_REQUIRED")
      await createIncidentCorrelationReviewWorkItem({
        tx,
        decisionId,
        title: `Incident correlation requires review (${decision.reasonCode})`,
      });
  });
}

const CORRELATION_PROCESSING_MAX_ATTEMPTS = 5;

function safeCorrelationErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)
    ? code
    : "CORRELATION_PROCESSING_FAILED";
}

export async function recordIncidentCorrelationProcessingFailure(
  uow: UnitOfWork,
  event: EventEnvelope,
  error: unknown,
): Promise<void> {
  const errorCode = safeCorrelationErrorCode(error);
  await uow.run(event.tenant_id, async (tx) => {
    const result = await tx.query<{
      attempt_count: number;
      state: "RETRYING" | "EXHAUSTED" | "RESOLVED";
    }>(
      `INSERT INTO incident.correlation_processing_failures
        (tenant_id,event_id,incident_id,attempt_count,state,next_attempt_at,last_error_code,correlation_id)
       VALUES($1,$2,$3,1,'RETRYING',now()+interval '1 second',$4,$5)
       ON CONFLICT(tenant_id,event_id) DO UPDATE SET
         attempt_count=incident.correlation_processing_failures.attempt_count+1,
         state=CASE WHEN incident.correlation_processing_failures.attempt_count+1 >= $6 THEN 'EXHAUSTED' ELSE 'RETRYING' END,
         next_attempt_at=CASE WHEN incident.correlation_processing_failures.attempt_count+1 >= $6 THEN NULL
           ELSE now()+make_interval(secs => LEAST(30,power(2,incident.correlation_processing_failures.attempt_count)::integer)) END,
         last_failed_at=now(),last_error_code=EXCLUDED.last_error_code,updated_at=now()
       WHERE incident.correlation_processing_failures.state='RETRYING'
       RETURNING attempt_count,state`,
      [
        tx.tenantId,
        event.event_id,
        event.aggregate.id,
        errorCode,
        event.correlation_id,
        CORRELATION_PROCESSING_MAX_ATTEMPTS,
      ],
    );
    const failure = result.rows[0];
    if (!failure || failure.state !== "EXHAUSTED") return;
    await createIncidentCorrelationFailureWorkItem({
      tx,
      eventId: event.event_id,
      incidentId: event.aggregate.id,
      attemptCount: failure.attempt_count,
      errorCode,
    });
    await new PostgresAudit(tx).append({
      id: randomUUID(),
      tenant_id: tx.tenantId,
      event_type: "INCIDENT.CORRELATION_PROCESSING_FAILED",
      occurred_at: new Date().toISOString(),
      actor: { type: "SYSTEM_CORRELATION", id: serviceIdentity },
      action: { command_type: "INCIDENT.CORRELATION_EVALUATE" },
      subject: { entity_type: "INCIDENT", entity_id: event.aggregate.id },
      correlation_id: event.correlation_id,
      causation_id: event.event_id,
      reason: {
        code: errorCode,
        text: "Correlation processing retry budget exhausted",
      },
      before: null,
      after: {
        source_event_id: event.event_id,
        attempt_count: failure.attempt_count,
        state: failure.state,
      },
      outcome: { status: "REVIEW_REQUIRED" },
      classification: "INTERNAL",
      relations: [],
      evidence: [],
    });
    await recordIncidentCorrelationTimelineEvent({
      tx,
      incidentId: event.aggregate.id,
      eventType: "INCIDENT.CORRELATION_PROCESSING_FAILED",
      summary: "Incident correlation processing failed and needs review",
      payload: {
        source_event_id: event.event_id,
        attempt_count: failure.attempt_count,
        reason_code: errorCode,
      },
      sourceEventId: event.event_id,
    });
  });
}

export function incidentCorrelationTask(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  reportFailure?: () => void;
}): WorkerTask {
  return {
    name: CONSUMER,
    async run(signal) {
      while (!signal.aborted) {
        try {
          const pending = await input.pool.query<{ payload: EventEnvelope }>(
            `SELECT o.payload FROM platform.outbox_events o WHERE o.event_type='INCIDENT.CREATED'
       AND NOT EXISTS(SELECT 1 FROM platform.inbox_events i WHERE i.consumer_name=$1 AND i.event_id=o.event_id AND i.tenant_id=o.tenant_id AND i.status='PROCESSED')
       AND NOT EXISTS(SELECT 1 FROM incident.correlation_processing_failures f WHERE f.tenant_id=o.tenant_id AND f.event_id=o.event_id AND (f.state IN ('EXHAUSTED','RESOLVED') OR (f.state='RETRYING' AND f.next_attempt_at>now())))
       ORDER BY o.created_at,o.id LIMIT 50`,
            [CONSUMER],
          );
          if (!pending.rowCount) {
            await wait(signal, 1000);
            continue;
          }
          for (const row of pending.rows) {
            if (signal.aborted) break;
            try {
              await processIncidentCorrelationEvent(input.uow, row.payload);
            } catch (error) {
              await recordIncidentCorrelationProcessingFailure(
                input.uow,
                row.payload,
                error,
              );
              input.reportFailure?.();
            }
          }
        } catch {
          input.reportFailure?.();
          await wait(signal, 1500);
        }
      }
    },
  };
}
