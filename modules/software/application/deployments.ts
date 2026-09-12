import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

const stages = [1, 10, 25, 50, 100] as const;
const activeTargetStates = ["QUEUED", "CLAIMED", "WAITING_REBOOT"] as const;

function requiredText(value: string, field: string, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  return value.trim();
}

function requireUuid(value: string, field: string) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  return value;
}

function cutoff(total: number, percent: number) {
  return Math.max(1, Math.ceil((total * percent) / 100));
}

function nextStage(current: number) {
  return stages[stages.indexOf(current as (typeof stages)[number]) + 1];
}

async function assertApprovedChange(
  tx: Transaction,
  changeId: string,
  required: boolean,
) {
  if (!changeId) {
    if (required)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "This deployment requires a scheduled and approved Change.",
      );
    return;
  }
  requireUuid(changeId, "change_id");
  const approved = await tx.query(
    "SELECT 1 FROM problem.changes c WHERE c.tenant_id=$1 AND c.id=$2 AND c.state='SCHEDULED' AND EXISTS (SELECT 1 FROM control.approval_requests a WHERE a.tenant_id=c.tenant_id AND a.source_type='CHANGE' AND a.source_id=c.id AND a.state='APPROVED')",
    [tx.tenantId, changeId],
  );
  if (!approved.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Deployment Change must be scheduled and approved.",
    );
}

async function loadDeployableVersion(
  tx: Transaction,
  softwareVersionId: string,
) {
  const result = await tx.query(
    `SELECT p.id AS product_id,p.product_code,p.category,p.classification,
            p.published_version_id,p.license_required,p.supported_asset_classes,
            v.id AS software_version_id,v.version_label,v.state AS version_state,
            a.id AS artifact_version_id,a.state AS artifact_state,
            a.review_status,a.scan_status,a.scan_waived_until,
            a.signature_status,a.checksum_sha256,a.storage_ref
       FROM software.software_versions v
       JOIN software.software_products p
         ON p.tenant_id=v.tenant_id AND p.id=v.product_id
       JOIN artifact.artifact_versions a
         ON a.tenant_id=v.tenant_id AND a.id=v.approved_artifact_version_id
      WHERE v.tenant_id=$1 AND v.id=$2
      FOR SHARE OF p,v,a`,
    [tx.tenantId, softwareVersionId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Published software version was not found.",
    );
  const row = result.rows[0]!;
  if (
    row.classification !== "APPROVED" ||
    row.published_version_id !== row.software_version_id ||
    row.version_state !== "PUBLISHED" ||
    row.artifact_state !== "ACTIVE" ||
    row.review_status !== "APPROVED" ||
    row.signature_status !== "VALID" ||
    (row.scan_status !== "PASSED" &&
      !(
        row.scan_status === "WAIVED" &&
        row.scan_waived_until &&
        new Date(row.scan_waived_until).getTime() > Date.now()
      ))
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Deployment requires a published version with an active approved artifact and valid security evidence.",
    );
  if (row.license_required)
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "License reservation is required but no License-domain reservation contract is configured.",
      true,
    );
  return row;
}

export async function createDeploymentCampaign(input: {
  tx: Transaction;
  softwareVersionId: string;
  assetIds: string[];
  initialStagePercent: number;
  failureThresholdPercent: number;
  maxAttempts: number;
  stopOnSecurityFailure: boolean;
  changeId?: string;
  actorId: string;
  reason: string;
}) {
  const softwareVersionId = requireUuid(
    input.softwareVersionId,
    "software_version_id",
  );
  if (
    !Array.isArray(input.assetIds) ||
    input.assetIds.length < 1 ||
    input.assetIds.length > 500
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "asset_ids must contain between 1 and 500 assets.",
    );
  const assetIds = input.assetIds.map((id) => requireUuid(id, "asset_id"));
  if (new Set(assetIds).size !== assetIds.length)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "asset_ids cannot contain duplicates.",
    );
  if (!stages.includes(input.initialStagePercent as (typeof stages)[number]))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "initial_stage_percent must be one of 1, 10, 25, 50, or 100.",
    );
  if (
    !Number.isSafeInteger(input.failureThresholdPercent) ||
    input.failureThresholdPercent < 1 ||
    input.failureThresholdPercent > 100
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "failure_threshold_percent must be between 1 and 100.",
    );
  if (
    !Number.isSafeInteger(input.maxAttempts) ||
    input.maxAttempts < 1 ||
    input.maxAttempts > 3
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "max_attempts must be between 1 and 3.",
    );
  const reason = requiredText(input.reason, "reason");
  const version = await loadDeployableVersion(input.tx, softwareVersionId);

  const assets = await input.tx.query(
    `SELECT a.id,c.name AS asset_class
       FROM asset.assets a
       JOIN asset.models m ON m.tenant_id=a.tenant_id AND m.id=a.asset_model_id
       JOIN asset.categories c ON c.tenant_id=m.tenant_id AND c.id=m.category_id
      WHERE a.tenant_id=$1 AND a.id=ANY($2::uuid[])
        AND a.lifecycle_state NOT IN ('RETIRED','DISPOSED')`,
    [input.tx.tenantId, assetIds],
  );
  if (assets.rowCount !== assetIds.length)
    throw new ApplicationError(
      "NOT_FOUND",
      "One or more deployment assets are unavailable in this tenant.",
    );
  const allowedClasses = new Set(
    (version.supported_asset_classes as string[]).map((value) =>
      value.toLowerCase(),
    ),
  );
  if (
    allowedClasses.size &&
    assets.rows.some(
      (asset) => !allowedClasses.has(String(asset.asset_class).toLowerCase()),
    )
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "One or more target assets are outside the software's supported asset classes.",
    );

  const highRiskClasses = new Set([
    "server",
    "network",
    "security appliance",
    "infrastructure",
  ]);
  const requiresChange = assets.rows.some((asset) =>
    highRiskClasses.has(String(asset.asset_class).toLowerCase()),
  );
  await assertApprovedChange(input.tx, input.changeId ?? "", requiresChange);

  const id = randomUUID();
  await input.tx.query(
    `INSERT INTO software.deployments
       (id,tenant_id,product_id,software_version_id,artifact_version_id,
        rollout_stage_percent,failure_threshold_percent,max_attempts,
        stop_on_security_failure,change_id,reason,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      input.tx.tenantId,
      version.product_id,
      version.software_version_id,
      version.artifact_version_id,
      input.initialStagePercent,
      input.failureThresholdPercent,
      input.maxAttempts,
      input.stopOnSecurityFailure,
      input.changeId ?? null,
      reason,
      input.actorId,
    ],
  );
  for (const [index, assetId] of [...assetIds].sort().entries())
    await input.tx.query(
      `INSERT INTO software.deployment_targets
         (id,tenant_id,campaign_id,asset_id,cohort_order,state)
       VALUES ($1,$2,$3,$4,$5,'HELD')`,
      [randomUUID(), input.tx.tenantId, id, assetId, index + 1],
    );
  return {
    id,
    software_version_id: String(version.software_version_id),
    artifact_version_id: String(version.artifact_version_id),
    state: "DRAFT",
    rollout_stage_percent: input.initialStagePercent,
    target_count: assetIds.length,
    version: 1,
    reason,
  };
}

export async function transitionDeploymentCampaign(input: {
  tx: Transaction;
  campaignId: string;
  expectedVersion: number;
  action: "START" | "PAUSE" | "RESUME" | "ADVANCE" | "STOP";
  reason: string;
}) {
  const campaignId = requireUuid(input.campaignId, "campaign_id");
  const rowResult = await input.tx.query(
    "SELECT * FROM software.deployments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, campaignId],
  );
  if (!rowResult.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Deployment campaign was not found.",
    );
  const row = rowResult.rows[0]!;
  assertVersion(Number(row.version), input.expectedVersion);
  const reason = requiredText(input.reason, "reason");
  const before = {
    state: String(row.state),
    rollout_stage_percent: Number(row.rollout_stage_percent),
  };
  let state = String(row.state);
  let stage = Number(row.rollout_stage_percent);
  let eventType: string;

  if (input.action === "START" && state === "DRAFT") {
    await loadDeployableVersion(input.tx, String(row.software_version_id));
    await assertApprovedChange(input.tx, String(row.change_id ?? ""), false);
    state = "ACTIVE";
    eventType = "SOFTWARE.DEPLOYMENT_CAMPAIGN_STARTED";
  } else if (input.action === "PAUSE" && state === "ACTIVE") {
    state = "PAUSED";
    eventType = "SOFTWARE.DEPLOYMENT_CAMPAIGN_PAUSED";
  } else if (input.action === "RESUME" && state === "PAUSED") {
    state = "ACTIVE";
    eventType = "SOFTWARE.DEPLOYMENT_CAMPAIGN_RESUMED";
  } else if (input.action === "ADVANCE" && state === "ACTIVE") {
    const next = nextStage(stage);
    if (!next)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Campaign is already at its final rollout stage.",
      );
    const pending = await input.tx.query(
      `SELECT 1 FROM software.deployment_targets
        WHERE tenant_id=$1 AND campaign_id=$2 AND cohort_order<=$3
          AND state=ANY($4::text[]) LIMIT 1`,
      [
        input.tx.tenantId,
        campaignId,
        cutoff(
          Number(
            (
              await input.tx.query(
                "SELECT count(*)::int AS count FROM software.deployment_targets WHERE tenant_id=$1 AND campaign_id=$2",
                [input.tx.tenantId, campaignId],
              )
            ).rows[0]!.count,
          ),
          stage,
        ),
        [...activeTargetStates],
      ],
    );
    if (pending.rowCount)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "The current rollout cohort must reach a terminal result before advancing.",
      );
    stage = next;
    eventType = "SOFTWARE.DEPLOYMENT_CAMPAIGN_ADVANCED";
  } else if (
    input.action === "STOP" &&
    state !== "STOPPED" &&
    state !== "COMPLETED"
  ) {
    state = "STOPPED";
    await input.tx.query(
      `UPDATE software.deployment_targets
          SET state='CANCELLED',assigned_agent_id=NULL,lease_id=NULL,
              lease_expires_at=NULL,version=version+1,updated_at=now()
        WHERE tenant_id=$1 AND campaign_id=$2 AND state IN ('HELD','QUEUED')`,
      [input.tx.tenantId, campaignId],
    );
    eventType = "SOFTWARE.DEPLOYMENT_CAMPAIGN_STOPPED";
  } else {
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Invalid deployment campaign state transition.",
    );
  }

  const version = input.expectedVersion + 1;
  await input.tx.query(
    `UPDATE software.deployments
        SET state=$1,rollout_stage_percent=$2,version=$3,updated_at=now()
      WHERE tenant_id=$4 AND id=$5`,
    [state, stage, version, input.tx.tenantId, campaignId],
  );
  if (input.action === "START" || input.action === "ADVANCE") {
    const total = Number(
      (
        await input.tx.query(
          "SELECT count(*)::int AS count FROM software.deployment_targets WHERE tenant_id=$1 AND campaign_id=$2",
          [input.tx.tenantId, campaignId],
        )
      ).rows[0]!.count,
    );
    await input.tx.query(
      `UPDATE software.deployment_targets
          SET state='QUEUED',version=version+1,updated_at=now()
        WHERE tenant_id=$1 AND campaign_id=$2 AND state='HELD' AND cohort_order<=$3`,
      [input.tx.tenantId, campaignId, cutoff(total, stage)],
    );
  }
  const queued = await input.tx.query(
    "SELECT count(*)::int AS count FROM software.deployment_targets WHERE tenant_id=$1 AND campaign_id=$2 AND state='QUEUED'",
    [input.tx.tenantId, campaignId],
  );
  return {
    id: campaignId,
    state,
    rollout_stage_percent: stage,
    version,
    reason,
    queued_count: Number(queued.rows[0]!.count),
    event_type: eventType,
    before,
  };
}

export async function listDeploymentCampaigns(tx: Transaction) {
  const result = await tx.query(
    `SELECT c.id,c.product_id,c.software_version_id,c.state,
            c.rollout_stage_percent,c.failure_threshold_percent,c.max_attempts,
            c.version,c.created_at,count(t.id)::int AS target_count,
            count(t.id) FILTER (WHERE t.state='SUCCESS')::int AS success_count,
            count(t.id) FILTER (WHERE t.state='FAILED')::int AS failure_count
       FROM software.deployments c
       LEFT JOIN software.deployment_targets t
         ON t.tenant_id=c.tenant_id AND t.campaign_id=c.id
      WHERE c.tenant_id=$1
      GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200`,
    [tx.tenantId],
  );
  return result.rows;
}

export async function readDeploymentCampaign(tx: Transaction, id: string) {
  const result = await tx.query(
    `SELECT c.*,count(t.id)::int AS target_count,
            count(t.id) FILTER (WHERE t.state='SUCCESS')::int AS success_count,
            count(t.id) FILTER (WHERE t.state='FAILED')::int AS failure_count
       FROM software.deployments c
       LEFT JOIN software.deployment_targets t
         ON t.tenant_id=c.tenant_id AND t.campaign_id=c.id
      WHERE c.tenant_id=$1 AND c.id=$2 GROUP BY c.id`,
    [tx.tenantId, requireUuid(id, "campaign_id")],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Deployment campaign was not found.",
    );
  return result.rows[0];
}

export async function listDeploymentTargets(
  tx: Transaction,
  campaignId: string,
) {
  const result = await tx.query(
    `SELECT t.id,t.asset_id,t.cohort_order,t.state,t.attempt_count,
            t.last_error_code,t.version,t.updated_at
       FROM software.deployment_targets t
       JOIN software.deployments c
         ON c.tenant_id=t.tenant_id AND c.id=t.campaign_id
      WHERE t.tenant_id=$1 AND c.id=$2 ORDER BY t.cohort_order LIMIT 1000`,
    [tx.tenantId, requireUuid(campaignId, "campaign_id")],
  );
  return result.rows;
}

export async function retryDeploymentTarget(input: {
  tx: Transaction;
  targetId: string;
  expectedVersion: number;
  reason: string;
}) {
  const result = await input.tx.query(
    `SELECT t.*,c.state AS campaign_state,c.max_attempts,c.software_version_id
       FROM software.deployment_targets t
       JOIN software.deployments c
         ON c.tenant_id=t.tenant_id AND c.id=t.campaign_id
      WHERE t.tenant_id=$1 AND t.id=$2 FOR UPDATE OF t,c`,
    [input.tx.tenantId, requireUuid(input.targetId, "deployment_job_id")],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Deployment job was not found.");
  const target = result.rows[0]!;
  assertVersion(Number(target.version), input.expectedVersion);
  if (
    target.state !== "FAILED" ||
    target.campaign_state !== "ACTIVE" ||
    target.security_failure ||
    Number(target.attempt_count) >= Number(target.max_attempts)
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "This deployment cannot be retried in its current state or campaign.",
    );
  await loadDeployableVersion(input.tx, String(target.software_version_id));
  const reason = requiredText(input.reason, "reason");
  const version = input.expectedVersion + 1;
  await input.tx.query(
    `UPDATE software.deployment_targets
        SET state='QUEUED',last_error_code=NULL,version=$1,updated_at=now()
      WHERE tenant_id=$2 AND id=$3`,
    [version, input.tx.tenantId, input.targetId],
  );
  return {
    id: input.targetId,
    campaign_id: String(target.campaign_id),
    state: "QUEUED",
    version,
    reason,
    event_type: "SOFTWARE.DEPLOYMENT_JOB_RETRIED",
  };
}

export async function nextDeploymentCandidate(
  tx: Transaction,
  input: { assetId: string },
) {
  const result = await tx.query(
    `SELECT t.id AS target_id,t.version AS target_version,t.state AS target_state,
            c.id AS campaign_id,c.state AS campaign_state,c.version AS campaign_version,
            c.max_attempts,c.stop_on_security_failure,c.failure_threshold_percent,
            p.id AS product_id,p.product_code,p.license_required,p.classification,
            p.published_version_id,v.id AS software_version_id,v.version_label,
            v.state AS version_state,
            a.id AS artifact_version_id,a.checksum_sha256,a.storage_ref,
            a.state AS artifact_state,a.review_status,a.scan_status,
            a.scan_waived_until,a.signature_status
       FROM software.deployment_targets t
       JOIN software.deployments c
         ON c.tenant_id=t.tenant_id AND c.id=t.campaign_id
       JOIN software.software_products p
         ON p.tenant_id=c.tenant_id AND p.id=c.product_id
       JOIN software.software_versions v
         ON v.tenant_id=c.tenant_id AND v.id=c.software_version_id
       JOIN artifact.artifact_versions a
         ON a.tenant_id=c.tenant_id AND a.id=c.artifact_version_id
      WHERE t.tenant_id=$1 AND t.asset_id=$2
        AND c.state='ACTIVE' AND t.state IN ('QUEUED','WAITING_REBOOT')
      ORDER BY t.cohort_order,t.created_at
      LIMIT 1`,
    [tx.tenantId, input.assetId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0]!;
  if (String(row.license_required) === "true")
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "License reservation is not configured; this deployment cannot be dispatched.",
      true,
    );
  if (
    row.classification !== "APPROVED" ||
    row.version_state !== "PUBLISHED" ||
    row.published_version_id !== row.software_version_id ||
    row.product_id === null ||
    row.version_label === null ||
    row.artifact_state !== "ACTIVE" ||
    row.review_status !== "APPROVED" ||
    row.signature_status !== "VALID" ||
    (row.scan_status !== "PASSED" &&
      !(
        row.scan_status === "WAIVED" &&
        row.scan_waived_until &&
        new Date(row.scan_waived_until).getTime() > Date.now()
      ))
  ) {
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Artifact is no longer eligible for deployment.",
    );
  }
  return {
    target_id: String(row.target_id),
    target_version: Number(row.target_version),
    target_state: String(row.target_state),
    campaign_id: String(row.campaign_id),
    campaign_version: Number(row.campaign_version),
    max_attempts: Number(row.max_attempts),
    stop_on_security_failure: Boolean(row.stop_on_security_failure),
    failure_threshold_percent: Number(row.failure_threshold_percent),
    product_id: String(row.product_id),
    product_code: String(row.product_code),
    software_version_id: String(row.software_version_id),
    version_label: String(row.version_label),
    artifact_version_id: String(row.artifact_version_id),
    checksum_sha256: String(row.checksum_sha256),
    storage_ref: String(row.storage_ref),
    resume_after_reboot: row.target_state === "WAITING_REBOOT",
  };
}

export async function claimDeploymentTarget(input: {
  tx: Transaction;
  candidate: NonNullable<Awaited<ReturnType<typeof nextDeploymentCandidate>>>;
  agentId: string;
  assetId: string;
  leaseId: string;
  leaseExpiresAt: string;
  now: string;
}) {
  const rowResult = await input.tx.query(
    `SELECT t.*,c.state AS campaign_state,c.max_attempts
       FROM software.deployment_targets t
       JOIN software.deployments c
         ON c.tenant_id=t.tenant_id AND c.id=t.campaign_id
      WHERE t.tenant_id=$1 AND t.id=$2 FOR UPDATE OF t,c`,
    [input.tx.tenantId, input.candidate.target_id],
  );
  if (!rowResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Deployment job was not found.");
  const row = rowResult.rows[0]!;
  const current = await loadDeployableVersion(
    input.tx,
    input.candidate.software_version_id,
  );
  if (
    String(current.artifact_version_id) !==
      input.candidate.artifact_version_id ||
    String(current.checksum_sha256) !== input.candidate.checksum_sha256
  )
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Approved artifact changed before the job could be leased.",
    );
  assertVersion(Number(row.version), input.candidate.target_version);
  if (
    String(row.asset_id) !== input.assetId ||
    row.campaign_state !== "ACTIVE" ||
    !["QUEUED", "WAITING_REBOOT"].includes(String(row.state))
  )
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Deployment job is no longer available to this agent.",
    );
  if (Number(row.attempt_count) >= Number(row.max_attempts))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Deployment has reached its bounded attempt limit.",
    );
  const attemptNumber = Number(row.attempt_count) + 1;
  await input.tx.query(
    `UPDATE software.deployment_targets
        SET state='CLAIMED',attempt_count=$1,assigned_agent_id=$2,lease_id=$3,
            lease_started_at=$4,lease_expires_at=$5,version=version+1,updated_at=now()
      WHERE tenant_id=$6 AND id=$7`,
    [
      attemptNumber,
      input.agentId,
      input.leaseId,
      input.now,
      input.leaseExpiresAt,
      input.tx.tenantId,
      input.candidate.target_id,
    ],
  );
  return {
    ...input.candidate,
    target_state: "CLAIMED",
    attempt_number: attemptNumber,
    lease_id: input.leaseId,
    lease_expires_at: input.leaseExpiresAt,
    version: Number(row.version) + 1,
  };
}

export type DeploymentReport = {
  leaseId: string;
  outcome:
    | "PRECHECK_FAILED"
    | "ARTIFACT_REJECTED"
    | "INSTALL_FAILED"
    | "WAITING_REBOOT"
    | "POSTCHECK_VERIFIED";
  checksumVerified: boolean;
  signatureVerified: boolean;
  precheckPassed: boolean;
  installerExitCode?: number;
  observedProductCode?: string;
  observedVersion?: string;
  rebootRequired?: boolean;
  retryable?: boolean;
  errorCode?: string;
  summary?: string;
};

export async function reportDeploymentResult(input: {
  tx: Transaction;
  targetId: string;
  agentId: string;
  report: DeploymentReport;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const leaseId = requireUuid(input.report.leaseId, "lease_id");
  const rowResult = await input.tx.query(
    `SELECT t.*,c.id AS campaign_id,c.state AS campaign_state,c.version AS campaign_version,c.max_attempts,
            c.stop_on_security_failure,c.failure_threshold_percent,c.rollout_stage_percent,
            c.software_version_id,c.product_id,c.artifact_version_id,
            p.product_code,v.version_label,a.checksum_sha256
       FROM software.deployment_targets t
       JOIN software.deployments c
         ON c.tenant_id=t.tenant_id AND c.id=t.campaign_id
       JOIN software.software_products p
         ON p.tenant_id=c.tenant_id AND p.id=c.product_id
       JOIN software.software_versions v
         ON v.tenant_id=c.tenant_id AND v.id=c.software_version_id
       JOIN artifact.artifact_versions a
         ON a.tenant_id=c.tenant_id AND a.id=c.artifact_version_id
      WHERE t.tenant_id=$1 AND t.id=$2 FOR UPDATE OF t,c`,
    [input.tx.tenantId, requireUuid(input.targetId, "target_id")],
  );
  if (!rowResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Deployment job was not found.");
  const row = rowResult.rows[0]!;
  if (
    row.state !== "CLAIMED" ||
    String(row.assigned_agent_id) !== input.agentId ||
    String(row.lease_id) !== leaseId ||
    new Date(row.lease_expires_at).getTime() <= Date.now()
  )
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Deployment lease is stale or belongs to another agent.",
    );

  const report = input.report;
  const summary = (report.summary ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 500);
  if (report.errorCode && !/^[A-Z0-9_.-]{1,64}$/.test(report.errorCode))
    throw new ApplicationError("VALIDATION_ERROR", "error_code is invalid.");
  if (
    report.outcome === "INSTALL_FAILED" &&
    report.installerExitCode === undefined
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "installer_exit_code is required for INSTALL_FAILED.",
    );
  if (
    (report.outcome === "PRECHECK_FAILED" && report.precheckPassed) ||
    (report.outcome !== "PRECHECK_FAILED" && !report.precheckPassed)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "precheck_passed must match the reported deployment outcome.",
    );
  if (report.outcome === "INSTALL_FAILED" && report.installerExitCode === 0)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "INSTALL_FAILED requires a non-zero installer exit code.",
    );

  let outcome: string = report.outcome;
  let state: string;
  let securityFailure = false;
  const integrityPassed = report.checksumVerified && report.signatureVerified;
  if (
    report.outcome === "ARTIFACT_REJECTED" ||
    (!integrityPassed && report.outcome !== "PRECHECK_FAILED")
  ) {
    outcome = "ARTIFACT_REJECTED";
    state = "FAILED";
    securityFailure = true;
  } else if (report.outcome === "PRECHECK_FAILED") {
    state = "FAILED";
  } else if (report.outcome === "INSTALL_FAILED") {
    state = "FAILED";
  } else if (report.outcome === "WAITING_REBOOT") {
    if (report.installerExitCode !== 0 || !report.rebootRequired)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "WAITING_REBOOT requires a successful installer and reboot_required.",
      );
    state = "WAITING_REBOOT";
  } else {
    if (report.installerExitCode !== 0)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Installation verification requires a successful installer result.",
      );
    if (
      report.observedProductCode !== row.product_code ||
      report.observedVersion !== row.version_label
    ) {
      outcome = "VERIFICATION_FAILED";
      state = "FAILED";
    } else {
      outcome = "SUCCESS";
      state = "SUCCESS";
    }
  }

  const attemptNumber = Number(row.attempt_count);
  const attemptId = randomUUID();
  await input.tx.query(
    `INSERT INTO software.deployment_attempts
       (id,tenant_id,target_id,attempt_number,agent_id,lease_id,outcome,
        started_at,completed_at,retryable,precheck_passed,installer_exit_code,checksum_verified,
        signature_verified,observed_product,observed_version,reboot_required,
        error_code,summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      attemptId,
      input.tx.tenantId,
      row.id,
      attemptNumber,
      input.agentId,
      leaseId,
      outcome,
      row.lease_started_at,
      now,
      Boolean(report.retryable && !securityFailure),
      report.precheckPassed,
      report.installerExitCode ?? null,
      report.checksumVerified,
      report.signatureVerified,
      report.observedProductCode ?? null,
      report.observedVersion ?? null,
      Boolean(report.rebootRequired),
      report.errorCode ?? null,
      summary,
    ],
  );

  const retryable =
    !securityFailure &&
    state === "FAILED" &&
    Boolean(report.retryable) &&
    attemptNumber < Number(row.max_attempts) &&
    ["PRECHECK_FAILED", "INSTALL_FAILED"].includes(report.outcome);
  const targetState = retryable ? "QUEUED" : state;
  await input.tx.query(
    `UPDATE software.deployment_targets
        SET state=$1,assigned_agent_id=NULL,lease_id=NULL,lease_started_at=NULL,
            lease_expires_at=NULL,last_error_code=$2,security_failure=$3,
            version=version+1,updated_at=now()
      WHERE tenant_id=$4 AND id=$5`,
    [
      targetState,
      report.errorCode ?? (state === "FAILED" ? outcome : null),
      securityFailure,
      input.tx.tenantId,
      row.id,
    ],
  );

  let installationId: string | null = null;
  if (state === "SUCCESS") {
    installationId = randomUUID();
    await input.tx.query(
      `INSERT INTO software.software_installations
         (id,tenant_id,asset_id,product_id,software_version_id,source_target_id,
          verified_by_agent_id,artifact_checksum_sha256,installed_at,last_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       ON CONFLICT (tenant_id,asset_id,product_id,software_version_id)
       DO UPDATE SET source_target_id=EXCLUDED.source_target_id,
                     verified_by_agent_id=EXCLUDED.verified_by_agent_id,
                     artifact_checksum_sha256=EXCLUDED.artifact_checksum_sha256,
                     state='INSTALLED',last_verified_at=EXCLUDED.last_verified_at
       RETURNING id`,
      [
        installationId,
        input.tx.tenantId,
        row.asset_id,
        row.product_id,
        row.software_version_id,
        row.id,
        input.agentId,
        row.checksum_sha256,
        now,
      ],
    );
  }

  const eventType =
    state === "SUCCESS"
      ? "SOFTWARE.INSTALLATION_VERIFIED"
      : state === "WAITING_REBOOT"
        ? "SOFTWARE.INSTALLATION_REPORTED"
        : securityFailure
          ? "SOFTWARE.DEPLOYMENT_SECURITY_FAILURE"
          : "SOFTWARE.DEPLOYMENT_FAILED";
  const facts: { type: string; payload: Record<string, unknown> }[] = [
    {
      type: "SOFTWARE.DEPLOYMENT_PRECHECK_COMPLETED",
      payload: {
        campaign_id: String(row.campaign_id),
        deployment_job_id: String(row.id),
        asset_id: String(row.asset_id),
        agent_id: input.agentId,
        passed: report.precheckPassed,
        attempt_id: attemptId,
      },
    },
    ...(report.precheckPassed && !securityFailure
      ? [
          {
            type: "SOFTWARE.DEPLOYMENT_ARTIFACT_VERIFIED",
            payload: {
              campaign_id: String(row.campaign_id),
              deployment_job_id: String(row.id),
              asset_id: String(row.asset_id),
              checksum_verified: report.checksumVerified,
              signature_verified: report.signatureVerified,
              attempt_id: attemptId,
            },
          },
        ]
      : []),
    {
      type: "SOFTWARE.INSTALLATION_REPORTED",
      payload: {
        campaign_id: String(row.campaign_id),
        deployment_job_id: String(row.id),
        asset_id: String(row.asset_id),
        agent_id: input.agentId,
        attempt_id: attemptId,
        attempt_number: attemptNumber,
        outcome,
        retryable,
        error_code: report.errorCode ?? null,
      },
    },
    ...(state === "SUCCESS"
      ? [
          {
            type: "SOFTWARE.INSTALLATION_VERIFIED",
            payload: {
              deployment_job_id: String(row.id),
              asset_id: String(row.asset_id),
              software_product_id: String(row.product_id),
              software_version_id: String(row.software_version_id),
              installation_id: installationId,
              verification: "CHECKSUM_SIGNATURE_AND_INSTALLED_VERSION",
            },
          },
        ]
      : []),
  ];
  if (state === "FAILED")
    facts.push({
      type: securityFailure
        ? "SOFTWARE.DEPLOYMENT_SECURITY_FAILURE"
        : "SOFTWARE.DEPLOYMENT_FAILED",
      payload: {
        campaign_id: String(row.campaign_id),
        deployment_job_id: String(row.id),
        asset_id: String(row.asset_id),
        attempt_id: attemptId,
        error_code: report.errorCode ?? outcome,
        retryable,
      },
    });
  const campaignResult = await input.tx.query(
    "SELECT state,rollout_stage_percent,stop_on_security_failure,failure_threshold_percent FROM software.deployments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, row.campaign_id],
  );
  const campaign = campaignResult.rows[0]!;
  if (
    campaign.state === "ACTIVE" &&
    ((securityFailure && campaign.stop_on_security_failure) ||
      (state === "FAILED" && !retryable))
  ) {
    const cohort = await input.tx.query(
      "SELECT count(*)::int AS total FROM software.deployment_targets WHERE tenant_id=$1 AND campaign_id=$2",
      [input.tx.tenantId, row.campaign_id],
    );
    const stageCutoff = cutoff(
      Number(cohort.rows[0]!.total),
      Number(campaign.rollout_stage_percent),
    );
    const counts = await input.tx.query(
      `SELECT count(*) FILTER (WHERE state IN ('SUCCESS','FAILED'))::int AS done,
              count(*) FILTER (WHERE state='FAILED')::int AS failed
         FROM software.deployment_targets
        WHERE tenant_id=$1 AND campaign_id=$2 AND cohort_order<=$3`,
      [input.tx.tenantId, row.campaign_id, stageCutoff],
    );
    const done = Number(counts.rows[0]!.done);
    const failed = Number(counts.rows[0]!.failed);
    const thresholdTripped =
      done > 0 &&
      (failed * 100) / done >= Number(campaign.failure_threshold_percent);
    if (
      (securityFailure && campaign.stop_on_security_failure) ||
      thresholdTripped
    ) {
      const stopped = await input.tx.query(
        "UPDATE software.deployments SET state='STOPPED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING version",
        [input.tx.tenantId, row.campaign_id],
      );
      await input.tx.query(
        `UPDATE software.deployment_targets SET state='CANCELLED',version=version+1,updated_at=now()
          WHERE tenant_id=$1 AND campaign_id=$2 AND state IN ('HELD','QUEUED')`,
        [input.tx.tenantId, row.campaign_id],
      );
      facts.push({
        type: "SOFTWARE.DEPLOYMENT_CAMPAIGN_STOPPED",
        payload: {
          campaign_id: String(row.campaign_id),
          version: Number(stopped.rows[0]!.version),
          trigger: securityFailure ? "SECURITY_FAILURE" : "FAILURE_THRESHOLD",
          deployment_job_id: String(row.id),
        },
      });
    }
  }
  const latestCampaign = await input.tx.query(
    "SELECT state,rollout_stage_percent FROM software.deployments WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, row.campaign_id],
  );
  if (
    latestCampaign.rows[0]?.state === "ACTIVE" &&
    Number(latestCampaign.rows[0]?.rollout_stage_percent) === 100
  ) {
    const remaining = await input.tx.query(
      "SELECT 1 FROM software.deployment_targets WHERE tenant_id=$1 AND campaign_id=$2 AND state=ANY($3::text[]) LIMIT 1",
      [input.tx.tenantId, row.campaign_id, [...activeTargetStates]],
    );
    if (!remaining.rowCount) {
      const completed = await input.tx.query(
        "UPDATE software.deployments SET state='COMPLETED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING version",
        [input.tx.tenantId, row.campaign_id],
      );
      facts.push({
        type: "SOFTWARE.DEPLOYMENT_CAMPAIGN_COMPLETED",
        payload: {
          campaign_id: String(row.campaign_id),
          state: "COMPLETED",
          rollout_stage_percent: 100,
          queued_count: 0,
          version: Number(completed.rows[0]!.version),
          reason: "All deployment targets reached a terminal result.",
        },
      });
    }
  }
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    state: targetState,
    outcome,
    retryable,
    attempt_id: attemptId,
    attempt_number: attemptNumber,
    target_version: Number(row.version) + 1,
    installation_id: installationId,
    event_type: eventType,
    facts,
    reason: summary || outcome,
  };
}

export const deploymentPermissions = [
  {
    code: "software.deploy",
    resource_type: "software_deployment",
    action: "create",
  },
  {
    code: "software.deployment.read",
    resource_type: "software_deployment",
    action: "read",
  },
  {
    code: "software.deployment.cancel",
    resource_type: "software_deployment",
    action: "cancel",
  },
] as const;
