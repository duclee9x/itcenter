import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../../../packages/config/src/index.js";
import type { Principal } from "../../../packages/auth/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import { OperationRegistry } from "../../../packages/persistence/src/operations.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import type { ArtifactObjectStoragePort } from "../../../modules/artifact/application/ports.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import { json } from "../../../packages/observability/src/index.js";
import type { Json } from "../../../packages/shared-kernel/src/index.js";
import {
  upsertAssetLifecycleWorkItem,
  recordAssetLifecycleTimelineEvent,
} from "../../../modules/work-queue/index.js";

async function body(req: IncomingMessage) {
  const raw = await new Promise<string>((resolve, reject) => {
    let value = "";
    req.on("data", (chunk) => {
      value += chunk;
      if (value.length > 262144)
        reject(
          new ApplicationError(
            "VALIDATION_ERROR",
            "Request body is too large.",
          ),
        );
    });
    req.on("error", reject);
    req.on("end", () => resolve(value));
  });
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
}

export async function handleAgentAssetWipeRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: { correlation_id: string; causation_id: string };
  config: Config;
  principal: Principal;
  uow: UnitOfWork;
  storage: ArtifactObjectStoragePort;
}): Promise<boolean> {
  const { req, res, context, config, principal, uow, storage } = input;
  const claim =
    req.method === "POST" && req.url === "/api/v1/agent/data-wipes/claim";
  const reportMatch =
    req.method === "POST"
      ? /^\/api\/v1\/agent\/data-wipes\/([^/]+)\/commands\/report$/.exec(
          req.url ?? "",
        )
      : null;
  const report = reportMatch !== null;
  if (!claim && !report) return false;
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !key.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  const inputBody = await body(req);
  const intent = claim
    ? {
        principalId: principal.id,
        operation: "DATA_WIPE.CLAIM",
        businessScope: principal.id,
        key,
        semanticRequest: {} as Json,
        expiresAt: new Date(Date.now() + 86400000),
      }
    : {
        principalId: principal.id,
        operation: "DATA_WIPE.REPORT",
        businessScope: reportMatch![1]!,
        key,
        semanticRequest: inputBody as Json,
        expiresAt: new Date(Date.now() + 86400000),
      };
  const previous = await uow.run(principal.tenant_id, (tx) =>
    new PostgresIdempotencyStore(tx).findPrevious(intent),
  );
  if (previous) {
    if (previous.status === 204) {
      res.statusCode = 204;
      res.end();
    } else json(res, previous.status, { data: previous.body, meta: context });
    return true;
  }
  let verifiedEvidence: {
    document: string;
    storageRef: string;
    checksum: string;
  } | null = null;
  if (report && inputBody.result !== "FAIL") {
    const jobId = reportMatch![1]!;
    const bound = await uow.run(principal.tenant_id, (tx) =>
      tx.query(
        "SELECT id FROM asset.data_wipe_jobs WHERE tenant_id=$1 AND id=$2 AND agent_id=$3 AND state='CLAIMED'",
        [tx.tenantId, jobId, principal.id],
      ),
    );
    if (!bound.rowCount)
      throw new ApplicationError(
        "NOT_FOUND",
        "Claimed wipe operation was not found for this agent.",
      );
    if (
      ![
        inputBody.evidence_document_id,
        inputBody.evidence_storage_ref,
        inputBody.evidence_checksum,
      ].every((v) => typeof v === "string" && v.trim())
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "A non-failure wipe result requires evidence document ID, storage reference and checksum.",
      );
    const stored = await storage.inspect(
      String(inputBody.evidence_storage_ref),
    );
    if (
      !stored ||
      stored.checksumSha256.toLowerCase() !==
        String(inputBody.evidence_checksum).toLowerCase()
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Wipe evidence is missing or checksum verification failed.",
      );
    verifiedEvidence = {
      document: String(inputBody.evidence_document_id),
      storageRef: String(inputBody.evidence_storage_ref),
      checksum: stored.checksumSha256,
    };
  }
  const result = await uow.run(principal.tenant_id, async (tx) => {
    if (claim) {
      const replay = await new PostgresIdempotencyStore(tx).execute(
        {
          principalId: principal.id,
          operation: "DATA_WIPE.CLAIM",
          businessScope: principal.id,
          key,
          semanticRequest: {},
          expiresAt: new Date(Date.now() + 86400000),
        },
        async () => {
          if (
            !Array.isArray(inputBody.supported_methods) ||
            inputBody.supported_methods.some((item) => typeof item !== "string")
          )
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "supported_methods capability list is required.",
            );
          const pending = await tx.query(
            "SELECT id,asset_id,method,generation,version FROM asset.data_wipe_jobs WHERE tenant_id=$1 AND agent_id=$2 AND state='QUEUED' AND method=ANY($3::text[]) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
            [tx.tenantId, principal.id, inputBody.supported_methods],
          );
          if (!pending.rowCount) return { status: 204, body: null };
          const job = pending.rows[0]!;
          await tx.query(
            "UPDATE asset.data_wipe_jobs SET state='CLAIMED',claimed_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='QUEUED'",
            [tx.tenantId, job.id],
          );
          await new OperationRegistry(tx).transition({
            operationId: String(job.id),
            expectedVersion: 1,
            from: "QUEUED",
            to: "RUNNING",
          });
          return {
            status: 200,
            body: {
              job_id: job.id,
              asset_id: job.asset_id,
              method: job.method,
              generation: job.generation,
              version: Number(job.version) + 1,
            },
          };
        },
      );
      return { status: replay.status, body: replay.body };
    }
    const jobId = reportMatch![1]!;
    const job = await tx.query(
      "SELECT j.*,a.asset_code FROM asset.data_wipe_jobs j JOIN asset.assets a ON a.tenant_id=j.tenant_id AND a.id=j.asset_id WHERE j.tenant_id=$1 AND j.id=$2 AND j.agent_id=$3 FOR UPDATE",
      [tx.tenantId, jobId, principal.id],
    );
    if (!job.rowCount)
      throw new ApplicationError(
        "NOT_FOUND",
        "Wipe operation is not assigned to this enrolled agent.",
      );
    if (job.rows[0]!.state !== "CLAIMED")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Wipe operation must be claimed before reporting.",
      );
    if (!Number.isSafeInteger(inputBody.expected_version))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "expected_version is required for wipe reports.",
      );
    assertVersion(job.rows[0]!.version, Number(inputBody.expected_version));
    const outcome = inputBody.result;
    if (
      ![
        "PASS",
        "FAIL",
        "NOT_APPLICABLE",
        "PHYSICAL_DESTRUCTION_REQUIRED",
      ].includes(String(outcome))
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Unsupported wipe result.",
      );
    const reportReason =
      typeof inputBody.reason === "string" && inputBody.reason.trim()
        ? inputBody.reason.trim()
        : "Agent wipe report";
    const evidence = verifiedEvidence;
    const replay = await new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation: "DATA_WIPE.REPORT",
        businessScope: jobId,
        key,
        semanticRequest: inputBody as Json,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        const success =
          outcome === "PASS" ||
          outcome === "NOT_APPLICABLE" ||
          outcome === "PHYSICAL_DESTRUCTION_REQUIRED";
        const state = success ? "COMPLETED" : "FAILED";
        const changed = await tx.query(
          "UPDATE asset.data_wipe_jobs SET state=$1,result=$2,verification_result=$3,evidence_document_id=$4,evidence_storage_ref=$5,evidence_checksum=$6,report_key=$7,failure_code=$8,completed_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$9 AND id=$10 AND state='CLAIMED' RETURNING version",
          [
            state,
            outcome,
            inputBody.verification_result ?? outcome,
            evidence?.document ?? null,
            evidence?.storageRef ?? null,
            evidence?.checksum ?? null,
            key,
            outcome === "FAIL"
              ? String(inputBody.error_code ?? "WIPE_FAILED")
              : null,
            tx.tenantId,
            jobId,
          ],
        );
        if (!changed.rowCount)
          throw new ApplicationError(
            "VERSION_CONFLICT",
            "Wipe job was concurrently changed.",
          );
        const after: { [key: string]: Json } = {
          job_id: jobId,
          asset_id: String(job.rows[0]!.asset_id),
          result: String(outcome),
          state,
          version: Number(changed.rows[0]!.version),
          evidence_document_id: evidence?.document ?? null,
          evidence_checksum: evidence?.checksum ?? null,
        };
        const now = new Date().toISOString();
        const event =
          outcome === "PASS" ||
          outcome === "NOT_APPLICABLE" ||
          outcome === "PHYSICAL_DESTRUCTION_REQUIRED"
            ? "DATA_WIPE.COMPLETED"
            : "DATA_WIPE.FAILED";
        await new PostgresOutboxWriter(tx).append({
          event_id: randomUUID(),
          event_type: event,
          schema_version: 1,
          occurred_at: now,
          producer: { service: config.serviceName, instance: "agent-gateway" },
          aggregate: {
            type: "DATA_WIPE_JOB",
            id: jobId,
            version: Number(changed.rows[0]!.version),
          },
          actor: { type: principal.actor_type, id: principal.id },
          correlation_id: context.correlation_id,
          causation_id: context.causation_id,
          tenant_id: principal.tenant_id,
          organization_id: principal.tenant_id,
          idempotency_key: key,
          payload: after,
        });
        await new PostgresAudit(tx).append({
          id: randomUUID(),
          tenant_id: principal.tenant_id,
          event_type: event,
          occurred_at: now,
          actor: { type: principal.actor_type, id: principal.id },
          action: { command_type: "DATA_WIPE.REPORT" },
          subject: { entity_type: "DATA_WIPE_JOB", entity_id: jobId },
          correlation_id: context.correlation_id,
          causation_id: context.causation_id,
          reason: { code: String(outcome), text: reportReason },
          before: { state: "CLAIMED", version: job.rows[0]!.version },
          after: after as { [key: string]: Json },
          outcome: { status: success ? "SUCCESS" : "FAILURE" },
          classification: "INTERNAL",
          relations: [
            {
              entity_type: "ASSET",
              entity_id: String(job.rows[0]!.asset_id),
              relation: "SUBJECT",
            },
          ],
          evidence: evidence
            ? [
                {
                  type: "ARTIFACT",
                  id: evidence.document,
                  checksum: evidence.checksum,
                  relation: "WIPE_EVIDENCE",
                },
              ]
            : [],
        });
        const operation = await tx.query(
          "SELECT state,version FROM platform.operations WHERE tenant_id=$1 AND operation_id=$2",
          [tx.tenantId, jobId],
        );
        if (!operation.rowCount || operation.rows[0]!.state !== "RUNNING")
          throw new ApplicationError(
            "VERSION_CONFLICT",
            "Wipe operation state is not RUNNING.",
          );
        await new OperationRegistry(tx).transition({
          operationId: jobId,
          expectedVersion: Number(operation.rows[0]!.version),
          from: "RUNNING",
          to: success ? "SUCCEEDED" : "FAILED",
          ...(!success ? { errorCode: "WIPE_FAILED" } : {}),
        });
        await tx.query(
          "INSERT INTO asset.lifecycle_evidence_history(id,tenant_id,asset_id,related_id,evidence_type,payload,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            randomUUID(),
            tx.tenantId,
            job.rows[0]!.asset_id,
            jobId,
            event,
            JSON.stringify(after),
            principal.id,
            reportReason,
          ],
        );
        await upsertAssetLifecycleWorkItem({
          tx,
          sourceId: jobId,
          title: success
            ? "Wipe evidence recorded; disposition review required"
            : "Wipe failed; reconcile before retry or disposition",
        });
        await recordAssetLifecycleTimelineEvent({
          tx,
          assetId: String(job.rows[0]!.asset_id),
          eventType: event,
          summary: success ? "Data wipe verified" : "Data wipe failed",
          payload: after,
        });
        const requesterId = String(job.rows[0]!.created_by);
        if (
          !success &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            requesterId,
          )
        )
          await tx.query(
            "INSERT INTO communication.notifications(id,tenant_id,recipient_user_id,event_type,subject,body,dedupe_key) SELECT $1,$2,u.id,'DATA_WIPE.FAILED','Data wipe failed','The wipe failed and the asset remains blocked. Reconcile the operation before retry or disposition.',$3 FROM identity.users u WHERE u.tenant_id=$2 AND u.id=$4 ON CONFLICT(tenant_id,dedupe_key) DO NOTHING",
            [
              randomUUID(),
              tx.tenantId,
              `wipe-failed:${jobId}:${changed.rows[0]!.version}`,
              requesterId,
            ],
          );
        return { status: 200, body: after as { [key: string]: Json } };
      },
    );
    return { status: replay.status, body: replay.body };
  });
  if (result.status === 204) {
    res.statusCode = 204;
    res.end();
  } else json(res, result.status, { data: result.body, meta: context });
  return true;
}
