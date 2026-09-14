import { createHash, randomUUID } from "node:crypto";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import {
  authorize,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import type { Json } from "../../../packages/shared-kernel/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { PostgresOutboxWriter } from "../../../packages/messaging/src/index.js";
import { evaluateAuthorization } from "../../identity/index.js";
import { queryIncidentAssetHistory } from "../../incident/index.js";
import {
  queryMonitoringAssetReliability,
  resolveMonitoringEpisodeForEvent,
} from "../../monitoring/index.js";
import {
  queryMaintenanceAssetHistory,
  queryWarrantyAsset,
} from "../../maintenance/index.js";
import { queryAssetScoringEvidence } from "../../procurement/index.js";
import { PostgresAudit } from "../../audit/index.js";
import { recommendReplacementCandidate } from "./replacement-candidate.js";
import { upsertAssetRiskReviewWorkItem } from "../../work-queue/index.js";
import {
  ageContribution,
  ageMonthsUtc,
  calculateReplacement,
  calculateRisk,
  replacementProfile,
  riskProfile,
  SCORING_ELIGIBLE_LIFECYCLE_STATES,
  warrantyContribution,
  type Evidence,
} from "../domain/scoring.js";

export type ScoringActor = Principal & { actor_type: string };
const eligibleLifecycle = new Set<string>(SCORING_ELIGIBLE_LIFECYCLE_STATES);
const sha256 = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const windowStart = (asOf: string, days: number) =>
  new Date(Date.parse(asOf) - days * 86_400_000).toISOString();
const json = (value: unknown) => JSON.stringify(value);
const scoreAvailability = (
  available: boolean,
  score: number,
  weight: number,
  details: Record<string, unknown>,
  missingReason?: string,
): Evidence => ({
  available,
  score,
  details: { ...details, availability_weight: weight },
  ...(available
    ? {}
    : { missing_reason: missingReason ?? "EVIDENCE_UNAVAILABLE" }),
});

function systemAuthorization(tx: Transaction): AuthorizationPort {
  return {
    async evaluate(request) {
      const decision = await evaluateAuthorization(tx, {
        principalId: request.principal.id,
        principalType: "SYSTEM_ASSET_SCORING",
        tenantId: request.resource.tenant_id,
        action: request.action,
        resourceType: request.resource.type,
        resourceId: request.resource.id,
        scope: {
          ...request.scope,
          tenant: request.resource.tenant_id,
          asset: request.resource.id,
        },
      });
      return {
        ...decision,
        ...(decision.matched
          ? { scope_reference: decision.matched.scopeId }
          : {}),
      };
    },
  };
}

async function requireSystemPrincipal(tx: Transaction, actor: ScoringActor) {
  if (
    actor.tenant_id !== tx.tenantId ||
    actor.actor_type !== "SYSTEM_ASSET_SCORING"
  )
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Scoring system principal is not valid for this tenant.",
    );
  const row = await tx.query(
    "SELECT id FROM identity.asset_scoring_principals WHERE tenant_id=$1 AND id=$2 AND active=true",
    [tx.tenantId, actor.id],
  );
  if (!row.rowCount)
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Scoring system principal is inactive or missing.",
    );
}

async function sourceRead<T>(
  operation: () => Promise<T>,
): Promise<{ value: T; error: null } | { value: null; error: string }> {
  try {
    return { value: await operation(), error: null };
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "PERMISSION_DENIED")
      throw error;
    return {
      value: null,
      error:
        error instanceof ApplicationError
          ? error.code
          : "SOURCE_QUERY_UNAVAILABLE",
    };
  }
}

async function loadAsset(tx: Transaction, assetId: string) {
  const result = await tx.query<{
    id: string;
    lifecycle_state: string;
    health_state: string;
    operational_state: string;
    version: number;
    category_id: string;
  }>(
    `SELECT a.id,a.lifecycle_state,a.health_state,a.operational_state,a.version,m.category_id
       FROM asset.assets a JOIN asset.models m
         ON m.tenant_id=a.tenant_id AND m.id=a.asset_model_id
      WHERE a.tenant_id=$1 AND a.id=$2 FOR UPDATE OF a`,
    [tx.tenantId, assetId],
  );
  return result.rows[0] ?? null;
}

async function readAgeBasis(
  tx: Transaction,
  assetId: string,
  procurementEvidence: Awaited<ReturnType<typeof queryAssetScoringEvidence>>,
) {
  if (procurementEvidence.acquisition.available)
    return procurementEvidence.acquisition;
  if (
    procurementEvidence.acquisition.reason_code !==
    "NO_POSTED_RECEIPT_PROVENANCE"
  )
    return procurementEvidence.acquisition;
  const manual = await tx.query<{ id: string; acquired_on: string }>(
    `SELECT id,acquired_on::text FROM asset.acquisition_evidence
      WHERE tenant_id=$1 AND asset_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`,
    [tx.tenantId, assetId],
  );
  if (manual.rowCount)
    return {
      available: true as const,
      acquired_on: String(manual.rows[0]!.acquired_on),
      basis: "VERIFIED_ACQUIRED_DATE" as const,
      reference: String(manual.rows[0]!.id),
    };
  return procurementEvidence.acquisition;
}

async function writeAssessment(input: {
  tx: Transaction;
  assetId: string;
  table: "risk_assessments" | "replacement_assessments";
  data: Record<string, unknown>;
  identity: string;
}) {
  const id = randomUUID();
  const cols = Object.keys(input.data);
  const values = cols.map((key) => input.data[key]);
  const placeholders = cols.map((_, index) => `$${index + 3}`);
  const result = await input.tx.query<{
    id: string;
    valid_until: Date | string;
  }>(
    `INSERT INTO asset.${input.table}(id,tenant_id,${cols.join(",")})
     VALUES($1,$2,${placeholders.join(",")})
     ON CONFLICT(tenant_id,asset_id,evidence_identity) DO NOTHING RETURNING id,valid_until`,
    [id, input.tx.tenantId, ...values],
  );
  if (result.rowCount)
    return {
      id,
      created: true,
      validUntil: new Date(String(result.rows[0]!.valid_until)).toISOString(),
    };
  const existing = await input.tx.query<{
    id: string;
    valid_until: Date | string;
  }>(
    `SELECT id,valid_until FROM asset.${input.table} WHERE tenant_id=$1 AND asset_id=$2 AND evidence_identity=$3`,
    [input.tx.tenantId, input.assetId, input.identity],
  );
  if (!existing.rowCount)
    throw new Error("Assessment idempotency conflict could not be reloaded");
  return {
    id: String(existing.rows[0]!.id),
    created: false,
    validUntil: new Date(String(existing.rows[0]!.valid_until)).toISOString(),
  };
}

async function appendAssessmentEvidence(input: {
  tx: Transaction;
  id: string;
  assetId: string;
  assessmentType: "RISK" | "REPLACEMENT";
  score: number;
  band: string;
  completeness: number;
  profileId: string;
  profileVersion: string;
  contributions: unknown;
  missing: unknown;
  references: unknown;
  correlationId: string;
  calculatedAt: string;
  asOf: string;
  validUntil: string;
  actor: ScoringActor;
  serviceName: string;
}) {
  const now = input.calculatedAt;
  const eventType =
    input.assessmentType === "RISK"
      ? "ASSET.RISK_ASSESSED"
      : "ASSET.REPLACEMENT_ASSESSED";
  const version = Number(
    (
      await input.tx.query<{ version: number }>(
        "SELECT version FROM asset.assets WHERE tenant_id=$1 AND id=$2",
        [input.tx.tenantId, input.assetId],
      )
    ).rows[0]!.version,
  );
  await new PostgresOutboxWriter(input.tx).append({
    event_id: randomUUID(),
    event_type: eventType,
    schema_version: 1,
    occurred_at: now,
    producer: { service: input.serviceName, instance: "asset-scoring" },
    aggregate: { type: "ASSET", id: input.assetId, version },
    actor: { type: "SYSTEM", id: input.actor.id },
    correlation_id: input.correlationId,
    causation_id: input.id,
    tenant_id: input.tx.tenantId,
    organization_id: input.tx.tenantId,
    idempotency_key: `asset-assessment:${input.assessmentType}:${input.id}`,
    payload: {
      asset_id: input.assetId,
      assessment_id: input.id,
      assessment_type: input.assessmentType,
      score: input.score,
      band: input.band,
      completeness: input.completeness,
      profile_id: input.profileId,
      profile_version: input.profileVersion,
      missing_evidence: input.missing,
      as_of: input.asOf,
      valid_until: input.validUntil,
      evidence_references: input.references,
    } as never,
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.tx.tenantId,
    event_type: eventType,
    occurred_at: now,
    actor: { type: input.actor.actor_type, id: input.actor.id },
    action: {
      command_type: `ASSET.${input.assessmentType}_ASSESSMENT.CALCULATE`,
    },
    subject: { entity_type: "ASSET", entity_id: input.assetId },
    correlation_id: input.correlationId,
    causation_id: input.id,
    reason: {
      code: "SCORING_RECALCULATION",
      text: "Versioned Asset scoring profile evaluation",
    },
    before: null,
    after: {
      assessment_id: input.id,
      score: input.score,
      band: input.band,
      completeness: input.completeness,
    } as Json,
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [
      {
        entity_type: "ASSET_ASSESSMENT",
        entity_id: input.id,
        relation: "CREATED",
      },
    ],
    evidence: [],
  });
}

/** Asset-owned scoring use case. All source evidence is read through the owning-domain public query contracts. */
export async function recalculateAssetAssessments(input: {
  tx: Transaction;
  assetId: string;
  actor: ScoringActor;
  asOf: string;
  trigger: string;
  correlationId: string;
  serviceName: string;
  explicitAuthorization?: AuthorizationPort;
  expectedAssetVersion?: number;
}) {
  if (
    !Number.isFinite(Date.parse(input.asOf)) ||
    !input.trigger.trim() ||
    !input.correlationId.trim()
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid scoring context is required.",
    );
  const asset = await loadAsset(input.tx, input.assetId);
  if (!asset) throw new ApplicationError("NOT_FOUND", "Asset was not found.");
  if (input.expectedAssetVersion !== undefined)
    assertVersion(Number(asset.version), input.expectedAssetVersion);
  const auth = input.explicitAuthorization ?? systemAuthorization(input.tx);
  if (input.explicitAuthorization) {
    await authorize(auth, {
      principal: input.actor,
      action: "asset.scoring.recalculate",
      resource: {
        type: "asset",
        id: input.assetId,
        tenant_id: input.tx.tenantId,
      },
      scope: { asset: input.assetId, tenant: input.tx.tenantId },
      context: { correlation_id: input.correlationId },
    });
  } else {
    await requireSystemPrincipal(input.tx, input.actor);
    await authorize(auth, {
      principal: input.actor,
      action: "asset.scoring.recalculate",
      resource: {
        type: "asset",
        id: input.assetId,
        tenant_id: input.tx.tenantId,
      },
      scope: { asset: input.assetId, tenant: input.tx.tenantId },
      context: { correlation_id: input.correlationId },
    });
  }
  if (!eligibleLifecycle.has(asset.lifecycle_state)) {
    await input.tx.query(
      `UPDATE asset.assets SET risk_state='UNKNOWN',risk_assessment_id=NULL,
         risk_assessment_valid_until=NULL,version=version+1,updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND risk_state<>'UNKNOWN'`,
      [input.tx.tenantId, input.assetId],
    );
    return { outcome: "INELIGIBLE" as const, asset_id: input.assetId };
  }

  const incidentEvidence = await sourceRead(() =>
    queryIncidentAssetHistory({
      tx: input.tx,
      assetId: input.assetId,
      from: windowStart(input.asOf, 90),
      to: input.asOf,
      principal: input.actor,
      authorization: auth,
      correlationId: input.correlationId,
    }),
  );
  const monitoringEvidence = await sourceRead(() =>
    queryMonitoringAssetReliability({
      tx: input.tx,
      assetId: input.assetId,
      from: windowStart(input.asOf, 30),
      to: input.asOf,
      principal: input.actor,
      authorization: auth,
      correlationId: input.correlationId,
    }),
  );
  const maintenanceEvidence = await sourceRead(() =>
    queryMaintenanceAssetHistory({
      tx: input.tx,
      assetId: input.assetId,
      from: windowStart(input.asOf, 180),
      to: input.asOf,
      principal: input.actor,
      authorization: auth,
      context: { correlation_id: input.correlationId },
    }),
  );
  const warrantyEvidence = await sourceRead(() =>
    queryWarrantyAsset({
      tx: input.tx,
      assetId: input.assetId,
      asOf: input.asOf,
      principal: input.actor,
      authorization: auth,
      correlationId: input.correlationId,
    }),
  );
  const receiptReferences = await input.tx.query<{
    goods_receipt_id: string;
    received_unit_id: string;
  }>(
    `SELECT goods_receipt_id,received_unit_id FROM asset.received_unit_registrations
      WHERE tenant_id=$1 AND asset_id=$2 AND registered_at <= $3 ORDER BY registered_at,received_unit_id`,
    [input.tx.tenantId, input.assetId, input.asOf],
  );
  const financialEvidence = await sourceRead(() =>
    queryAssetScoringEvidence({
      tx: input.tx,
      assetId: input.assetId,
      asOf: input.asOf,
      receiptReferences: receiptReferences.rows,
      principal: input.actor,
      authorization: auth,
      correlationId: input.correlationId,
    }),
  );

  const incidents = incidentEvidence.value?.incidents ?? [];
  const incidentEpisodes = incidentEvidence.value
    ? new Set(incidents.map((item) => item.episode_id)).size
    : null;
  const overlapIds = new Set<string>();
  let overlapIdentityAvailable = Boolean(
    incidentEvidence.value &&
    monitoringEvidence.value?.availability === "AVAILABLE",
  );
  if (
    incidentEvidence.value &&
    monitoringEvidence.value?.availability === "AVAILABLE"
  ) {
    for (const incident of incidents) {
      if (!incident.monitoring_event_id) continue;
      const resolved = await sourceRead(() =>
        resolveMonitoringEpisodeForEvent({
          tx: input.tx,
          eventId: incident.monitoring_event_id!,
          assetId: input.assetId,
          principal: input.actor,
          authorization: auth,
          correlationId: input.correlationId,
        }),
      );
      if (
        resolved.value?.availability === "AVAILABLE" &&
        resolved.value.episode
      )
        overlapIds.add(resolved.value.episode.episode_id);
      else overlapIdentityAvailable = false;
    }
  } else overlapIdentityAvailable = false;
  const criticalEpisodes =
    monitoringEvidence.value?.episodes.filter((episode) =>
      episode.severities.includes("CRITICAL"),
    ) ?? [];
  const maintenanceOrders = maintenanceEvidence.value?.orders ?? [];
  const correctiveCount = maintenanceOrders.filter(
    (order) => order.classification === "CORRECTIVE",
  ).length;
  const unknownMaintenance =
    maintenanceEvidence.value?.unknown_classification_count ?? 0;
  const risk = calculateRisk({
    health: asset.health_state,
    operational: asset.operational_state,
    incidentEpisodes: incidentEvidence.value ? incidentEpisodes : null,
    monitoringEpisodes: monitoringEvidence.value
      ? criticalEpisodes.length
      : null,
    monitoringIdentityAvailable: Boolean(
      monitoringEvidence.value && overlapIdentityAvailable,
    ),
    incidentMonitoringEpisodeIds: [...overlapIds],
    monitoringEpisodeIds: criticalEpisodes.map((episode) => episode.episode_id),
    maintenanceCorrectiveCount: correctiveCount,
    maintenanceUnknownCount: unknownMaintenance,
    maintenanceAvailable: Boolean(maintenanceEvidence.value),
  });
  if (incidentEvidence.error)
    risk.missing_evidence.push({
      group: "RELIABILITY",
      reason: `INCIDENT_QUERY_${incidentEvidence.error}`,
    });
  if (monitoringEvidence.error)
    risk.missing_evidence.push({
      group: "RELIABILITY",
      reason: `MONITORING_QUERY_${monitoringEvidence.error}`,
    });
  if (maintenanceEvidence.error)
    risk.missing_evidence.push({
      group: "CORRECTIVE_MAINTENANCE",
      reason: `MAINTENANCE_QUERY_${maintenanceEvidence.error}`,
    });

  const calculatedAt = new Date().toISOString();
  const validUntil = new Date(
    Date.parse(calculatedAt) + 86_400_000,
  ).toISOString();
  const incidentRefs = incidents.map((item) => ({
    incident_id: item.incident_id,
    root_incident_id: item.root_incident_id,
    episode_id: item.episode_id,
    monitoring_event_id: item.monitoring_event_id,
    occurred_at: item.occurred_at,
  }));
  const monitoringRefs = criticalEpisodes.map((episode) => ({
    episode_id: episode.episode_id,
    event_ids: episode.event_ids,
    occurred_at: episode.occurred_at,
  }));
  const maintenanceRefs = maintenanceOrders.map((order) => ({
    id: order.id,
    completed_at: order.completed_at,
    classification: order.classification,
  }));
  const riskReferences = {
    asset_version: asset.version,
    incident_query: incidentEvidence.error ?? "AVAILABLE",
    incidents: incidentRefs,
    monitoring_query:
      monitoringEvidence.error ??
      monitoringEvidence.value?.reason_code ??
      "AVAILABLE",
    monitoring_episodes: monitoringRefs,
    monitoring_overlap_episode_ids: [...overlapIds],
    maintenance_query: maintenanceEvidence.error ?? "AVAILABLE",
    maintenance: maintenanceRefs,
  };
  const riskIdentity = sha256({
    tenant_id: input.tx.tenantId,
    asset_id: input.assetId,
    profile: riskProfile,
    epoch: input.asOf.slice(0, 13),
    health: asset.health_state,
    operational: asset.operational_state,
    lifecycle: asset.lifecycle_state,
    evidence: { ...riskReferences, asset_version: undefined },
    groups: risk.groups,
  });
  const riskRow = await writeAssessment({
    tx: input.tx,
    assetId: input.assetId,
    table: "risk_assessments",
    identity: riskIdentity,
    data: {
      asset_id: input.assetId,
      score: risk.score,
      band: risk.band,
      completeness: risk.completeness,
      profile_id: riskProfile.id,
      profile_version: riskProfile.version,
      contributions: json(risk.groups),
      missing_evidence: json(risk.missing_evidence),
      evidence_references: json(riskReferences),
      evidence_identity: riskIdentity,
      trigger: input.trigger,
      calculated_at: calculatedAt,
      as_of: input.asOf,
      valid_until: validUntil,
      correlation_id: input.correlationId,
      actor_type: input.actor.actor_type,
      actor_id: input.actor.id,
    },
  });
  const effectiveRiskBand =
    Date.parse(riskRow.validUntil) > Date.parse(calculatedAt)
      ? risk.band
      : "UNKNOWN";
  const oldProjection = await input.tx.query<{
    risk_state: string;
    risk_assessment_id: string | null;
  }>(
    "SELECT risk_state,risk_assessment_id FROM asset.assets WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.assetId],
  );
  await input.tx.query(
    `INSERT INTO asset.scoring_latest(tenant_id,asset_id,risk_assessment_id,updated_at)
     VALUES($1,$2,$3,now()) ON CONFLICT(tenant_id,asset_id) DO UPDATE
       SET risk_assessment_id=EXCLUDED.risk_assessment_id,updated_at=now()`,
    [input.tx.tenantId, input.assetId, riskRow.id],
  );
  const riskChanged = oldProjection.rows[0]?.risk_state !== effectiveRiskBand;
  await input.tx.query(
    `UPDATE asset.assets SET risk_state=$1,risk_assessment_id=$2,risk_assessment_valid_until=$3,
       version=version+CASE WHEN $4 THEN 1 ELSE 0 END,updated_at=now()
      WHERE tenant_id=$5 AND id=$6`,
    [
      effectiveRiskBand,
      riskRow.id,
      riskRow.validUntil,
      riskChanged,
      input.tx.tenantId,
      input.assetId,
    ],
  );
  if (riskRow.created) {
    await appendAssessmentEvidence({
      tx: input.tx,
      id: riskRow.id,
      assetId: input.assetId,
      assessmentType: "RISK",
      score: risk.score,
      band: risk.band,
      completeness: risk.completeness,
      profileId: riskProfile.id,
      profileVersion: riskProfile.version,
      contributions: risk.groups,
      missing: risk.missing_evidence,
      references: riskReferences,
      correlationId: input.correlationId,
      calculatedAt,
      asOf: input.asOf,
      validUntil,
      actor: input.actor,
      serviceName: input.serviceName,
    });
    if (riskChanged)
      await new PostgresOutboxWriter(input.tx).append({
        event_id: randomUUID(),
        event_type: "ASSET.RISK_BAND_CHANGED",
        schema_version: 1,
        occurred_at: calculatedAt,
        producer: { service: input.serviceName, instance: "asset-scoring" },
        aggregate: {
          type: "ASSET",
          id: input.assetId,
          version: Number(asset.version) + 1,
        },
        actor: { type: "SYSTEM", id: input.actor.id },
        correlation_id: input.correlationId,
        causation_id: riskRow.id,
        tenant_id: input.tx.tenantId,
        organization_id: input.tx.tenantId,
        idempotency_key: `asset-risk-band:${riskRow.id}`,
        payload: {
          asset_id: input.assetId,
          assessment_id: riskRow.id,
          from_band: oldProjection.rows[0]?.risk_state ?? "UNKNOWN",
          to_band: effectiveRiskBand,
        } as never,
      });
    if (risk.band === "CRITICAL")
      await upsertAssetRiskReviewWorkItem({
        tx: input.tx,
        assetId: input.assetId,
        assessmentId: riskRow.id,
        score: risk.score,
        correlationId: input.correlationId,
      });
  }

  const ageBasis = financialEvidence.value
    ? await readAgeBasis(input.tx, input.assetId, financialEvidence.value)
    : {
        available: false as const,
        reason_code: `ACQUISITION_QUERY_${financialEvidence.error ?? "UNAVAILABLE"}`,
      };
  const policyResult = await input.tx.query<{
    id: string;
    version: number;
    expected_life_months: number;
  }>(
    `SELECT id,version,expected_life_months FROM asset.replacement_policies
      WHERE tenant_id=$1 AND category_id=$2 ORDER BY version DESC LIMIT 1`,
    [input.tx.tenantId, asset.category_id],
  );
  const usefulLife = policyResult.rows[0] ?? null;
  const age =
    ageBasis.available && usefulLife
      ? ageMonthsUtc(ageBasis.acquired_on, input.asOf)
      : null;
  const ageComponent =
    age === null || !usefulLife
      ? null
      : ageContribution(age, Number(usefulLife.expected_life_months));
  const riskComponent =
    riskRow.id && Date.parse(riskRow.validUntil) > Date.parse(input.asOf)
      ? Math.floor((risk.score * 40) / 100)
      : null;
  const warranty = warrantyEvidence.value;
  const warrantyPoints =
    warranty && warranty.availability === "AVAILABLE"
      ? warrantyContribution(warranty.state)
      : null;
  const costRows = financialEvidence.value?.actual_acquisition_costs ?? [];
  const validCostRows = costRows.filter(
    (row) =>
      Number.isFinite(Number(row.amount)) &&
      Number(row.amount) > 0 &&
      row.actual_evidence_count > 0,
  );
  const actualCost = validCostRows.length === 1 ? validCostRows[0]! : null;
  const acquisitionCostsByCurrency = costRows.map((row) => ({
    currency: row.currency,
    amount: row.amount,
    actual_evidence_count: row.actual_evidence_count,
    evidence_references: row.evidence_references,
  }));
  const economicPoints = null; // No canonical actual repair-cost ledger exists in TASK-094 v1.
  const replacementComponents: Record<string, Evidence> = {
    OPERATIONAL_RISK: scoreAvailability(
      riskComponent !== null,
      riskComponent ?? 0,
      40,
      {
        assessment_id: riskRow.id,
        score: risk.score,
        band: risk.band,
        contribution: riskComponent,
      },
      "NO_CURRENT_RISK_ASSESSMENT",
    ),
    AGE_USEFUL_LIFE: scoreAvailability(
      ageComponent !== null,
      ageComponent?.score ?? 0,
      20,
      {
        acquired_on: ageBasis.available ? ageBasis.acquired_on : null,
        age_basis: ageBasis.available ? ageBasis.basis : null,
        age_months: age,
        ratio: ageComponent?.ratio ?? null,
        policy_id: usefulLife?.id ?? null,
        policy_version: usefulLife?.version ?? null,
        expected_life_months: usefulLife?.expected_life_months ?? null,
        evidence_reference: ageBasis.available ? ageBasis.reference : null,
      },
      !ageBasis.available
        ? ageBasis.reason_code
        : !usefulLife
          ? "NO_USEFUL_LIFE_POLICY"
          : "INVALID_ACQUISITION_DATE",
    ),
    WARRANTY: scoreAvailability(
      warrantyPoints !== null,
      warrantyPoints ?? 0,
      15,
      {
        state: warranty?.state ?? null,
        policy_id: warranty?.state_policy_id ?? null,
        policy_version: warranty?.state_policy_version ?? null,
        evidence_reference: warranty?.warranty_id ?? null,
        reason_code: warranty?.reason_code ?? warrantyEvidence.error,
      },
      warrantyEvidence.error
        ? `WARRANTY_QUERY_${warrantyEvidence.error}`
        : (warranty?.reason_code ?? "WARRANTY_STATE_UNKNOWN"),
    ),
    ECONOMIC_REPAIR: scoreAvailability(
      economicPoints !== null,
      economicPoints ?? 0,
      25,
      {
        repair_cost_ledger: "UNAVAILABLE",
        acquisition_cost_currency: actualCost?.currency ?? null,
        acquisition_cost_amount: actualCost?.amount ?? null,
        acquisition_cost_evidence_references: acquisitionCostsByCurrency,
        comparison: "NO_FX",
      },
      financialEvidence.error
        ? `COST_QUERY_${financialEvidence.error}`
        : "NO_CANONICAL_ACTUAL_REPAIR_COST_LEDGER",
    ),
  };
  const replacement = calculateReplacement({
    riskScore: riskComponent,
    ageScore: ageComponent?.score ?? null,
    warrantyScore: warrantyPoints,
    economicScore: economicPoints,
    components: replacementComponents,
  });
  const replacementReferences = {
    asset_version: asset.version,
    risk_assessment_id: riskRow.id,
    age_basis: ageBasis.available
      ? {
          basis: ageBasis.basis,
          reference: ageBasis.reference,
          acquired_on: ageBasis.acquired_on,
        }
      : ageBasis,
    policy_id: usefulLife?.id ?? null,
    policy_version: usefulLife?.version ?? null,
    warranty_id: warranty?.warranty_id ?? null,
    warranty_policy: warranty
      ? `${warranty.state_policy_id}:v${warranty.state_policy_version}`
      : null,
    acquisition_costs_by_currency: acquisitionCostsByCurrency,
    repair_cost_reason: "NO_CANONICAL_ACTUAL_REPAIR_COST_LEDGER",
  };
  const replacementIdentity = sha256({
    tenant_id: input.tx.tenantId,
    asset_id: input.assetId,
    profile: replacementProfile,
    epoch: input.asOf.slice(0, 13),
    risk_assessment_id: riskRow.id,
    components: replacementComponents,
    references: { ...replacementReferences, asset_version: undefined },
  });
  const replacementRow = await writeAssessment({
    tx: input.tx,
    assetId: input.assetId,
    table: "replacement_assessments",
    identity: replacementIdentity,
    data: {
      asset_id: input.assetId,
      score: replacement.score,
      band: replacement.band,
      completeness: replacement.completeness,
      profile_id: replacementProfile.id,
      profile_version: replacementProfile.version,
      risk_assessment_id: riskRow.id,
      policy_id: usefulLife?.id ?? null,
      policy_version: usefulLife?.version ?? null,
      contributions: json(replacementComponents),
      missing_evidence: json(replacement.missing_evidence),
      evidence_references: json(replacementReferences),
      evidence_identity: replacementIdentity,
      trigger: input.trigger,
      calculated_at: calculatedAt,
      as_of: input.asOf,
      valid_until: validUntil,
      correlation_id: input.correlationId,
      actor_type: input.actor.actor_type,
      actor_id: input.actor.id,
    },
  });
  await input.tx.query(
    `UPDATE asset.scoring_latest SET replacement_assessment_id=$1,updated_at=now()
      WHERE tenant_id=$2 AND asset_id=$3`,
    [replacementRow.id, input.tx.tenantId, input.assetId],
  );
  if (replacementRow.created) {
    await appendAssessmentEvidence({
      tx: input.tx,
      id: replacementRow.id,
      assetId: input.assetId,
      assessmentType: "REPLACEMENT",
      score: replacement.score,
      band: replacement.band,
      completeness: replacement.completeness,
      profileId: replacementProfile.id,
      profileVersion: replacementProfile.version,
      contributions: replacementComponents,
      missing: replacement.missing_evidence,
      references: replacementReferences,
      correlationId: input.correlationId,
      calculatedAt,
      asOf: input.asOf,
      validUntil,
      actor: input.actor,
      serviceName: input.serviceName,
    });
  }
  if (
    replacementRow.created &&
    (replacement.band === "PLAN" || replacement.band === "PRIORITY")
  ) {
    const candidate = await recommendReplacementCandidate(input.tx, {
      tenant_id: input.tx.tenantId,
      asset_id: input.assetId,
      replacement_assessment_id: replacementRow.id,
      score: replacement.score,
      band: replacement.band,
      scoring_profile_id: replacementProfile.id,
      scoring_profile_version: replacementProfile.version,
      reasons: replacement.missing_evidence.length
        ? replacement.missing_evidence.map(
            (item) => `${item.dimension}:${item.reason}`,
          )
        : [
            `Replacement assessment ${replacementRow.id} is ${replacement.band}`,
          ],
      evidence_summary: {
        contributions: replacementComponents,
        completeness: replacement.completeness,
      },
      principal: {
        id: input.actor.id,
        tenant_id: input.tx.tenantId,
        actor_type: "SYSTEM_ASSET_SCORING",
      },
      authorization: auth,
      context: {
        correlation_id: input.correlationId,
        causation_id: replacementRow.id,
      },
      service_name: input.serviceName,
      reason:
        "Versioned TASK-094 replacement assessment recommends human review.",
      idempotency_key: `asset-replacement-assessment:${replacementRow.id}`,
    });
    if (["CREATED", "UPDATED_ACTIVE"].includes(candidate.outcome))
      await new PostgresOutboxWriter(input.tx).append({
        event_id: randomUUID(),
        event_type: "ASSET.REPLACEMENT_RECOMMENDED",
        schema_version: 1,
        occurred_at: calculatedAt,
        producer: { service: input.serviceName, instance: "asset-scoring" },
        aggregate: {
          type: "ASSET",
          id: input.assetId,
          version: Number(asset.version),
        },
        actor: { type: "SYSTEM", id: input.actor.id },
        correlation_id: input.correlationId,
        causation_id: replacementRow.id,
        tenant_id: input.tx.tenantId,
        organization_id: input.tx.tenantId,
        idempotency_key: `asset-replacement-recommended:${replacementRow.id}`,
        payload: {
          asset_id: input.assetId,
          assessment_id: replacementRow.id,
          candidate_id: candidate.candidate_id,
          score: replacement.score,
          band: replacement.band,
          candidate_outcome: candidate.outcome,
        } as never,
      });
  }
  return {
    outcome: "ASSESSED" as const,
    asset_id: input.assetId,
    risk: { assessment_id: riskRow.id, created: riskRow.created, ...risk },
    replacement: {
      assessment_id: replacementRow.id,
      created: replacementRow.created,
      ...replacement,
    },
    valid_until: validUntil,
  };
}

export async function readAssetAssessments(input: {
  tx: Transaction;
  assetId: string;
  principal: Principal;
  authorization: AuthorizationPort;
  correlationId: string;
  limit?: number;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: "asset.scoring.read",
    resource: {
      type: "asset",
      id: input.assetId,
      tenant_id: input.tx.tenantId,
    },
    scope: { asset: input.assetId, tenant: input.tx.tenantId },
    context: { correlation_id: input.correlationId },
  });
  const asset = await input.tx.query<{
    lifecycle_state: string;
    risk_state: string;
  }>(
    "SELECT lifecycle_state,risk_state FROM asset.assets WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.assetId],
  );
  if (!asset.rowCount)
    throw new ApplicationError("NOT_FOUND", "Asset was not found.");
  const riskRows = await input.tx.query(
    "SELECT * FROM asset.risk_assessments WHERE tenant_id=$1 AND asset_id=$2 ORDER BY calculated_at DESC,id DESC LIMIT $3",
    [input.tx.tenantId, input.assetId, input.limit ?? 50],
  );
  const replacementRows = await input.tx.query(
    "SELECT * FROM asset.replacement_assessments WHERE tenant_id=$1 AND asset_id=$2 ORDER BY calculated_at DESC,id DESC LIMIT $3",
    [input.tx.tenantId, input.assetId, input.limit ?? 50],
  );
  const projection = await input.tx.query<{
    risk_assessment_id: string | null;
    replacement_assessment_id: string | null;
  }>(
    "SELECT risk_assessment_id,replacement_assessment_id FROM asset.scoring_latest WHERE tenant_id=$1 AND asset_id=$2",
    [input.tx.tenantId, input.assetId],
  );
  const currentRisk = riskRows.rows.find(
    (row) => row.id === projection.rows[0]?.risk_assessment_id,
  );
  const currentReplacement = replacementRows.rows.find(
    (row) => row.id === projection.rows[0]?.replacement_assessment_id,
  );
  const now = Date.now();
  const currentRiskFresh = Boolean(
    currentRisk &&
    Date.parse(String(currentRisk.valid_until)) > now &&
    eligibleLifecycle.has(asset.rows[0]!.lifecycle_state),
  );
  return {
    asset_id: input.assetId,
    effective_risk_state: currentRiskFresh ? currentRisk!.band : "UNKNOWN",
    latest: {
      risk: currentRisk
        ? { ...currentRisk, freshness: currentRiskFresh ? "CURRENT" : "STALE" }
        : null,
      replacement: currentReplacement
        ? {
            ...currentReplacement,
            freshness:
              Date.parse(String(currentReplacement.valid_until)) > now &&
              eligibleLifecycle.has(asset.rows[0]!.lifecycle_state)
                ? "CURRENT"
                : "STALE",
          }
        : null,
    },
    risk_history: riskRows.rows,
    replacement_history: replacementRows.rows,
  };
}

export async function listScoringAssetIds(tx: Transaction) {
  const rows = await tx.query<{ id: string }>(
    "SELECT id FROM asset.assets WHERE tenant_id=$1 ORDER BY id",
    [tx.tenantId],
  );
  return rows.rows.map((row) => String(row.id));
}

export async function expireAssetRiskProjections(input: {
  tx: Transaction;
  serviceName: string;
  correlationId: string;
  actorId: string;
}) {
  const expired = await input.tx.query<{
    id: string;
    risk_state: string;
    version: number;
  }>(
    `WITH stale AS (
       SELECT id,risk_state FROM asset.assets WHERE tenant_id=$1 AND risk_state<>'UNKNOWN'
         AND (risk_assessment_valid_until IS NULL OR risk_assessment_valid_until<=now()
           OR lifecycle_state NOT IN ('ASSIGNED','IN_USE','REPAIR')) FOR UPDATE
     ), changed AS (
       UPDATE asset.assets a SET risk_state='UNKNOWN',risk_assessment_id=NULL,
         risk_assessment_valid_until=NULL,version=version+1,updated_at=now()
        FROM stale s WHERE a.tenant_id=$1 AND a.id=s.id RETURNING a.id,a.version
     )
     SELECT changed.id,stale.risk_state,changed.version FROM changed JOIN stale USING(id)`,
    [input.tx.tenantId],
  );
  for (const row of expired.rows) {
    await new PostgresOutboxWriter(input.tx).append({
      event_id: randomUUID(),
      event_type: "ASSET.RISK_BAND_CHANGED",
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      producer: {
        service: input.serviceName,
        instance: "asset-risk-freshness",
      },
      aggregate: {
        type: "ASSET",
        id: String(row.id),
        version: Number(row.version),
      },
      actor: { type: "SYSTEM", id: input.actorId },
      correlation_id: input.correlationId,
      causation_id: "ASSESSMENT_STALE_OR_INELIGIBLE",
      tenant_id: input.tx.tenantId,
      organization_id: input.tx.tenantId,
      idempotency_key: `asset-risk-expired:${row.id}:${row.version}`,
      payload: {
        asset_id: String(row.id),
        from_band: row.risk_state,
        to_band: "UNKNOWN",
        reason_code: "ASSESSMENT_STALE_OR_INELIGIBLE",
      } as never,
    });
  }
  return expired.rowCount;
}
