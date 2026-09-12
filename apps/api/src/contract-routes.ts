import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../../../packages/config/src/index.js";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  resolveRenewalWorkItem,
  upsertRenewalWorkItem,
} from "../../../modules/work-queue/index.js";
import {
  executeContractCommand,
  listContracts,
  listContractVersions,
  readContract,
  readRenewalCase,
  type ContractCommand,
} from "../../../modules/contract/index.js";
import {
  executeCommercialDocumentCommand,
  isFinalSignedDocument,
  readCommercialDocument,
  type DocumentCommand,
} from "../../../modules/document/index.js";
import { readSupplier } from "../../../modules/procurement/index.js";
import { readApprovalRequestsForSource } from "../../../modules/control-plane/index.js";
import type {
  ObjectReference,
  ObjectStore,
} from "../../../packages/object-storage/src/index.js";
import { json } from "../../../packages/observability/src/index.js";

type Body = Record<string, unknown>;
type Context = CorrelationContext;
function send(res: ServerResponse, status: number, value: unknown) {
  json(res, status, value as never);
}
async function readBody(req: IncomingMessage): Promise<Body> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 1_000_000)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
  }
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    if (!v || typeof v !== "object" || Array.isArray(v)) throw 0;
    return v as Body;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
}
function expected(body: Body) {
  if (
    !Number.isSafeInteger(body.expected_version) ||
    Number(body.expected_version) < 1
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version must be a positive integer.",
    );
  return Number(body.expected_version);
}
function key(req: IncomingMessage) {
  const v = req.headers["idempotency-key"];
  if (typeof v !== "string" || !v.trim() || v.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  return v.trim();
}
function codeFor(command: string): string {
  const map: Record<string, string> = {
    "CONTRACT.CREATE": "contract.create",
    "CONTRACT.UPDATE_DRAFT": "contract.update",
    "CONTRACT.SUBMIT_FOR_SIGNATURE": "contract.update",
    "CONTRACT.RECALL_SIGNATURE": "contract.update",
    "CONTRACT.CANCEL": "contract.update",
    "CONTRACT.RECORD_EXECUTION": "contract.execute",
    "CONTRACT.ACTIVATE": "contract.lifecycle",
    "CONTRACT.EXPIRE": "contract.lifecycle",
    "CONTRACT.HOLD": "contract.lifecycle",
    "CONTRACT.RESUME": "contract.lifecycle",
    "CONTRACT.AMEND": "contract.amend",
    "CONTRACT.TERMINATE": "contract.terminate",
    "RENEWAL.OPEN": "contract.renew",
    "RENEWAL.UPDATE_PROPOSAL": "contract.renew",
    "RENEWAL.COMPLETE": "contract.renew",
    "RENEWAL.MARK_NOT_RENEWED": "contract.renew",
    "RENEWAL.CANCEL": "contract.renew",
    "DOCUMENT.CREATE": "commercial_document.write",
    "DOCUMENT.ADD_VERSION": "commercial_document.write",
    "DOCUMENT.FINALIZE": "commercial_document.finalize",
    "DOCUMENT.SUPERSEDE": "commercial_document.finalize",
    "DOCUMENT.VOID": "commercial_document.write",
  };
  return map[command] ?? "contract.read";
}
async function appendEffects(input: {
  tx: Transaction;
  config: Config;
  principal: Principal;
  context: Context;
  key: string;
  command: string;
  reason: unknown;
  events: Array<{
    type: string;
    aggregateType: string;
    aggregateId: string;
    version: number;
    before: unknown;
    after: Record<string, unknown>;
    payload: Record<string, unknown>;
  }>;
}) {
  for (const event of input.events) {
    const id = randomUUID(),
      at = new Date().toISOString();
    await new PostgresOutboxWriter(input.tx).append({
      event_id: id,
      event_type: event.type,
      schema_version: 1,
      occurred_at: at,
      producer: { service: input.config.serviceName, instance: "api" },
      aggregate: {
        type: event.aggregateType,
        id: event.aggregateId,
        version: event.version,
      },
      actor: { type: input.principal.actor_type, id: input.principal.id },
      correlation_id: input.context.correlation_id,
      causation_id: input.context.causation_id,
      tenant_id: input.principal.tenant_id,
      organization_id: input.principal.tenant_id,
      idempotency_key: input.key,
      payload: event.payload as never,
    });
    const summary = event.type.replaceAll(".", " ").toLowerCase();
    await input.tx.query(
      "INSERT INTO operations.timeline_events(id,tenant_id,entity_type,entity_id,event_type,summary,payload,source_event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        input.principal.tenant_id,
        event.aggregateType,
        event.aggregateId,
        event.type,
        summary,
        JSON.stringify({ id: event.aggregateId, version: event.version }),
        id,
      ],
    );
    if (event.type === "CONTRACT.RENEWAL_OPENED")
      await upsertRenewalWorkItem({
        tx: input.tx,
        renewalCaseId: event.aggregateId,
      });
    if (
      [
        "CONTRACT.RENEWAL_COMPLETED",
        "CONTRACT.RENEWAL_NOT_RENEWED",
        "CONTRACT.RENEWAL_CANCELLED",
      ].includes(event.type)
    )
      await resolveRenewalWorkItem({
        tx: input.tx,
        renewalCaseId: event.aggregateId,
      });
    await new PostgresAudit(input.tx).append({
      id: randomUUID(),
      tenant_id: input.principal.tenant_id,
      event_type: event.type,
      occurred_at: at,
      actor: { type: input.principal.actor_type, id: input.principal.id },
      action: { command_type: input.command, idempotency_key: input.key },
      subject: {
        entity_type: event.aggregateType,
        entity_id: event.aggregateId,
      },
      correlation_id: input.context.correlation_id,
      causation_id: input.context.causation_id,
      reason: {
        code: input.command,
        text: typeof input.reason === "string" ? input.reason : input.command,
      },
      before: event.before as never,
      after: event.after as never,
      outcome: { status: "SUCCESS" },
      classification: "CONFIDENTIAL",
      relations: [],
      evidence: [],
    });
  }
}
const unavailableStorage: ObjectStore = { head: async () => null };
export async function handleContractRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: Context;
  config: Config;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
  objectStore?: ObjectStore;
}): Promise<boolean> {
  const { req, res, context, config, authentication, authorization, uow } =
      input,
    method = req.method ?? "",
    url = new URL(req.url ?? "/", "http://localhost"),
    path = url.pathname;
  const parts = path.split("/").filter(Boolean);
  const contractCollection = path === "/api/v1/contracts",
    contractDetail =
      parts[0] === "api" &&
      parts[1] === "v1" &&
      parts[2] === "contracts" &&
      parts.length === 4
        ? ["", parts[3]]
        : null,
    contractVersions =
      parts[0] === "api" &&
      parts[1] === "v1" &&
      parts[2] === "contracts" &&
      parts[4] === "versions" &&
      parts.length === 5
        ? ["", parts[3]]
        : null,
    contractCmd =
      parts[0] === "api" &&
      parts[1] === "v1" &&
      parts[2] === "contracts" &&
      parts[4] === "commands" &&
      parts.length === 6
        ? ["", parts[3], parts[5]]
        : null,
    renewalCollection = path === "/api/v1/renewal-cases",
    renewalDetail =
      parts[0] === "api" &&
      parts[1] === "v1" &&
      parts[2] === "renewal-cases" &&
      parts.length === 4
        ? ["", parts[3]]
        : null,
    renewalCmd =
      parts[0] === "api" &&
      parts[1] === "v1" &&
      parts[2] === "renewal-cases" &&
      parts[4] === "commands" &&
      parts.length === 6
        ? ["", parts[3], parts[5]]
        : null,
    documentCollection = path === "/api/v1/commercial-documents",
    documentDetail =
      parts[0] === "api" &&
      parts[1] === "v1" &&
      parts[2] === "commercial-documents" &&
      parts.length === 4
        ? ["", parts[3]]
        : null,
    documentCmd =
      parts[0] === "api" &&
      parts[1] === "v1" &&
      parts[2] === "commercial-documents" &&
      parts[4] === "commands" &&
      parts.length === 6
        ? ["", parts[3], parts[5]]
        : null;
  if (!(
    contractCollection ||
    contractDetail ||
    contractVersions ||
    contractCmd ||
    renewalCollection ||
    renewalDetail ||
    renewalCmd ||
    documentCollection ||
    documentDetail ||
    documentCmd
  ))
    return false;
  const principal = await authenticate(
      authentication,
      req.headers.authorization,
    ),
    body = method === "POST" ? await readBody(req) : {};
  if (method === "GET" && contractCollection) {
    await authorize(authorization, {
      principal,
      action: "contract.read",
      resource: {
        type: "contract",
        id: "collection",
        tenant_id: principal.tenant_id,
      },
      scope: {},
      context: { ...context },
    });
    const rows = await uow.run(principal.tenant_id, (tx) =>
      listContracts(
        tx,
        Math.min(Number(url.searchParams.get("limit") ?? 50), 200),
        Math.max(Number(url.searchParams.get("offset") ?? 0), 0),
      ),
    );
    send(res, 200, { data: rows, meta: context });
    return true;
  }
  if (method === "GET" && contractDetail) {
    await authorize(authorization, {
      principal,
      action: "contract.read",
      resource: {
        type: "contract",
        id: contractDetail[1]!,
        tenant_id: principal.tenant_id,
      },
      scope: {},
      context: { ...context },
    });
    const value = await uow.run(principal.tenant_id, (tx) =>
      readContract(tx, contractDetail[1]!),
    );
    send(res, 200, { data: value, meta: context });
    return true;
  }
  if (method === "GET" && contractVersions) {
    await authorize(authorization, {
      principal,
      action: "contract.read",
      resource: {
        type: "contract",
        id: contractVersions[1]!,
        tenant_id: principal.tenant_id,
      },
      scope: {},
      context: { ...context },
    });
    const versions = await uow.run(principal.tenant_id, (tx) =>
      listContractVersions(tx, contractVersions[1]!),
    );
    send(res, 200, { data: versions, meta: context });
    return true;
  }
  if (method === "GET" && renewalDetail) {
    await authorize(authorization, {
      principal,
      action: "contract.read",
      resource: {
        type: "renewal_case",
        id: renewalDetail[1]!,
        tenant_id: principal.tenant_id,
      },
      scope: {},
      context: { ...context },
    });
    const renewal = await uow.run(principal.tenant_id, (tx) =>
      readRenewalCase(tx, renewalDetail[1]!),
    );
    send(res, 200, { data: renewal, meta: context });
    return true;
  }
  if (method === "GET" && documentDetail) {
    await authorize(authorization, {
      principal,
      action: "commercial_document.read",
      resource: {
        type: "commercial_document",
        id: documentDetail[1]!,
        tenant_id: principal.tenant_id,
      },
      scope: {},
      context: { ...context },
    });
    const doc = await uow.run(principal.tenant_id, (tx) =>
      readCommercialDocument(tx, documentDetail[1]!),
    );
    if (!doc)
      throw new ApplicationError(
        "NOT_FOUND",
        "Commercial document was not found.",
      );
    send(res, 200, { data: doc, meta: context });
    return true;
  }
  if (method !== "POST") return false;
  let command: string,
    id: string | undefined,
    resourceType = "contract",
    resourceId = "new",
    expectedVersion: number | undefined;
  if (contractCollection) {
    command = "CONTRACT.CREATE";
  } else if (contractCmd) {
    id = contractCmd[1]!;
    resourceId = id;
    const action = contractCmd[2]!.toUpperCase().replaceAll("-", "_");
    command = `CONTRACT.${action}`;
  } else if (renewalCollection) {
    command = "RENEWAL.OPEN";
    id = String(body.predecessor_contract_id ?? "");
    resourceId = id;
  } else if (renewalCmd) {
    id = renewalCmd[1]!;
    resourceId = id;
    command = `RENEWAL.${renewalCmd[2]!.toUpperCase().replaceAll("-", "_")}`;
    resourceType = "renewal_case";
  } else if (documentCollection) {
    command = "DOCUMENT.CREATE";
    resourceType = "commercial_document";
  } else if (documentCmd) {
    id = documentCmd[1]!;
    resourceId = id;
    resourceType = "commercial_document";
    command = `DOCUMENT.${documentCmd[2]!.toUpperCase().replaceAll("-", "_")}`;
  } else return false;
  if (!["CONTRACT.CREATE", "DOCUMENT.CREATE"].includes(command))
    expectedVersion = expected(body);
  const idem = key(req),
    permission = codeFor(command),
    type = command.startsWith("DOCUMENT.")
      ? "commercial_document"
      : resourceType;
  let verifiedObject: ObjectReference | null | undefined;
  if (command === "DOCUMENT.FINALIZE") {
    const preflight = await uow.run(principal.tenant_id, async (tx) => {
      await authorize(authorization, {
        principal,
        action: permission,
        resource: { type, id: resourceId, tenant_id: principal.tenant_id },
        scope: {},
        context: { ...context },
      });
      const prior = await new PostgresIdempotencyStore(tx).findPrevious({
        principalId: principal.id,
        operation: command,
        businessScope: resourceId,
        key: idem,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      });
      if (prior) return { prior };
      const document = await readCommercialDocument(tx, id!);
      if (!document)
        throw new ApplicationError(
          "NOT_FOUND",
          "Commercial document was not found.",
        );
      return { document };
    });
    if ("prior" in preflight) {
      send(res, preflight.prior.status, {
        data: preflight.prior.body,
        meta: context,
      });
      return true;
    }
    try {
      verifiedObject = await (input.objectStore ?? unavailableStorage).head(
        String(preflight.document.storage_ref),
      );
    } catch {
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "Object storage metadata could not be verified.",
      );
    }
    if (!verifiedObject)
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "The referenced commercial document object is not available.",
      );
  }
  const response = await uow.run(principal.tenant_id, async (tx) => {
    await authorize(authorization, {
      principal,
      action: permission,
      resource: { type, id: resourceId, tenant_id: principal.tenant_id },
      scope: {},
      context: { ...context },
    });
    return new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation: command,
        businessScope: resourceId,
        key: idem,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        let value: {
          data: Record<string, unknown>;
          status: number;
          events?: Array<{
            type: string;
            aggregateType: string;
            aggregateId: string;
            version: number;
            before: unknown;
            after: Record<string, unknown>;
            payload: Record<string, unknown>;
          }>;
        };
        if (command.startsWith("DOCUMENT.")) {
          const docCommand = command as DocumentCommand;
          const outcome = await executeCommercialDocumentCommand({
            tx,
            command: docCommand,
            ...(id ? { id } : {}),
            ...(expectedVersion === undefined ? {} : { expectedVersion }),
            body,
            actorId: principal.id,
            correlationId: context.correlation_id,
            ...(verifiedObject !== undefined ? { verifiedObject } : {}),
          });
          const row = outcome.data;
          value = {
            data: row,
            status: outcome.status,
            events: [
              {
                type: outcome.event,
                aggregateType: "COMMERCIAL_DOCUMENT",
                aggregateId: String(row.id),
                version: Number(row.version),
                before: null,
                after: {
                  id: row.id,
                  governance_status: row.governance_status,
                  signature_status: row.signature_status,
                },
                payload: {
                  id: row.id,
                  document_type: row.document_type,
                  governance_status: row.governance_status,
                  signature_status: row.signature_status,
                  resource_type: row.resource_type,
                  resource_id: row.resource_id,
                  superseded_by_document_id: row.superseded_by_document_id,
                },
              },
            ],
          };
        } else {
          const contractCommand = command as ContractCommand;
          value = await executeContractCommand({
            tx,
            command: contractCommand,
            ...(id ? { id } : {}),
            ...(expectedVersion === undefined ? {} : { expectedVersion }),
            body,
            actorId: principal.id,
            correlationId: context.correlation_id,
            supplierEligibility: async (t, supplierId) =>
              String((await readSupplier(t, supplierId)).state),
            approvalForSource: async (t, sourceType, sourceId) =>
              (await readApprovalRequestsForSource({
                tx: t,
                sourceType,
                sourceId,
              })) as Record<string, unknown>[],
            finalDocument: async (t, documentId, versionId, contractId) =>
              isFinalSignedDocument(t, documentId, versionId, contractId),
          });
        }
        await appendEffects({
          tx,
          config,
          principal,
          context,
          key: idem,
          command,
          reason: body.reason,
          events: value.events ?? [],
        });
        return { status: value.status, body: value.data as never };
      },
    );
  });
  send(res, response.status, { data: response.body, meta: context });
  return true;
}
