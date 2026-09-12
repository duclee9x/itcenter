import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import { mayTransition } from "../domain/lifecycle.js";

type JsonRecord = Record<string, unknown>;
export type ContractCommand =
  | "CONTRACT.CREATE"
  | "CONTRACT.UPDATE_DRAFT"
  | "CONTRACT.SUBMIT_FOR_SIGNATURE"
  | "CONTRACT.RECALL_SIGNATURE"
  | "CONTRACT.RECORD_EXECUTION"
  | "CONTRACT.ACTIVATE"
  | "CONTRACT.HOLD"
  | "CONTRACT.RESUME"
  | "CONTRACT.AMEND"
  | "CONTRACT.EXPIRE"
  | "CONTRACT.TERMINATE"
  | "CONTRACT.CANCEL"
  | "RENEWAL.OPEN"
  | "RENEWAL.UPDATE_PROPOSAL"
  | "RENEWAL.COMPLETE"
  | "RENEWAL.MARK_NOT_RENEWED"
  | "RENEWAL.CANCEL";

function fail(message: string): never {
  throw new ApplicationError("BUSINESS_RULE_VIOLATION", message);
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as JsonRecord;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
function hash(v: unknown) {
  return createHash("sha256").update(canonical(v)).digest("hex");
}
function approvalList(
  value: Record<string, unknown> | Record<string, unknown>[] | null | undefined,
) {
  return !value ? [] : Array.isArray(value) ? value : [value];
}
function obj(v: unknown, name: string): JsonRecord {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${name} must be an object.`,
    );
  return v as JsonRecord;
}
function text(v: unknown, name: string, max = 2000): string {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    throw new ApplicationError("VALIDATION_ERROR", `${name} is required.`);
  return v.trim();
}
function date(v: unknown, name: string): string {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${name} must be an ISO date/time.`,
    );
  return new Date(v).toISOString();
}
function newEvent(
  type: string,
  aggregateType: string,
  id: string,
  version: number,
  before: unknown,
  after: JsonRecord,
) {
  return {
    type,
    aggregateType,
    aggregateId: id,
    version,
    before: before ?? null,
    after,
    payload: {
      id,
      lifecycle_state: after.lifecycle_state,
      usage_status: after.usage_status,
      version: after.version,
      current_version_number: after.current_version_number,
      predecessor_contract_id: after.predecessor_contract_id,
      successor_contract_id: after.successor_contract_id,
    },
  };
}
async function contractRow(tx: Transaction, id: string, lock = false) {
  const r = await tx.query(
    `SELECT * FROM contract.contracts WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [tx.tenantId, id],
  );
  if (!r.rowCount)
    throw new ApplicationError("NOT_FOUND", "Contract was not found.");
  return r.rows[0]!;
}
async function recordHistory(
  tx: Transaction,
  row: Record<string, unknown>,
  event: string,
  actor: string,
  reason: string | null,
  correlation: string,
  before: unknown,
  after: JsonRecord,
) {
  await tx.query(
    "INSERT INTO contract.history(id,tenant_id,contract_id,event_type,before_state,after_state,actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      randomUUID(),
      tx.tenantId,
      row.id,
      event,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      actor,
      reason,
      correlation,
    ],
  );
}
async function addVersion(
  tx: Transaction,
  row: Record<string, unknown>,
  snapshot: JsonRecord,
  source: string,
  actor: string,
  reason: string | null,
  evidence?: { documentId: string; documentVersionId: string },
) {
  const version = Number(row.current_version_number) + 1,
    id = randomUUID();
  await tx.query(
    "INSERT INTO contract.contract_versions(id,tenant_id,contract_id,version_number,commercial_snapshot,fingerprint,source,reason,created_by,evidence_document_id,evidence_document_version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      id,
      tx.tenantId,
      row.id,
      version,
      JSON.stringify(snapshot),
      hash(snapshot),
      source,
      reason,
      actor,
      evidence?.documentId ?? null,
      evidence?.documentVersionId ?? null,
    ],
  );
  return { id, version, fingerprint: hash(snapshot) };
}

export async function executeContractCommand(input: {
  tx: Transaction;
  command: ContractCommand;
  id?: string;
  expectedVersion?: number;
  body: JsonRecord;
  actorId: string;
  correlationId: string;
  supplierEligibility?: (
    tx: Transaction,
    supplierId: string,
  ) => Promise<string>;
  approvalForSource?: (
    tx: Transaction,
    type: string,
    id: string,
  ) => Promise<Record<string, unknown> | Record<string, unknown>[] | null>;
  finalDocument?: (
    tx: Transaction,
    documentId: string,
    versionId: string,
    contractId: string,
  ) => Promise<boolean>;
}) {
  const { tx, command, body } = input;
  let row: Record<string, unknown> | null = null;
  let before: JsonRecord | null = null;
  let eventType = "";
  let result: JsonRecord = {};
  const reason = body.reason == null ? null : text(body.reason, "reason");
  if (command === "CONTRACT.CREATE") {
    const supplierId = text(body.supplier_id, "supplier_id"),
      code = text(body.contract_code, "contract_code", 80),
      supplierName = text(
        body.supplier_display_snapshot,
        "supplier_display_snapshot",
        240,
      );
    if (input.supplierEligibility)
      await input.supplierEligibility(tx, supplierId);
    const effective = date(body.effective_at, "effective_at"),
      end = date(body.end_at, "end_at");
    if (effective >= end) fail("effective_at must precede end_at.");
    const snapshot = obj(body.commercial_snapshot ?? {}, "commercial_snapshot");
    const id = randomUUID(),
      versionId = randomUUID();
    await tx.query(
      "INSERT INTO contract.contracts(id,tenant_id,contract_code,supplier_id,supplier_display_snapshot,lifecycle_state,effective_at,end_at,current_version_id,created_by,correlation_id,auto_renew_clause) VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9,$10,$11)",
      [
        id,
        tx.tenantId,
        code,
        supplierId,
        supplierName,
        effective,
        end,
        versionId,
        input.actorId,
        input.correlationId,
        body.auto_renew_clause ? JSON.stringify(body.auto_renew_clause) : null,
      ],
    );
    const snap = {
      ...snapshot,
      supplier_id: supplierId,
      supplier_display_snapshot: supplierName,
      effective_at: effective,
      end_at: end,
      auto_renew_clause: body.auto_renew_clause ?? null,
    };
    await tx.query(
      "INSERT INTO contract.contract_versions(id,tenant_id,contract_id,version_number,commercial_snapshot,fingerprint,source,created_by) VALUES($1,$2,$3,1,$4,$5,'CREATE',$6)",
      [
        versionId,
        tx.tenantId,
        id,
        JSON.stringify(snap),
        hash(snap),
        input.actorId,
      ],
    );
    row = await contractRow(tx, id);
    result = { ...row };
    eventType = "CONTRACT.CREATED";
    before = null;
  } else if (command.startsWith("RENEWAL.")) {
    if (!input.id)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "renewal case id is required.",
      );
    if (command === "RENEWAL.OPEN") {
      const predecessor = await contractRow(tx, input.id, true);
      assertVersion(Number(predecessor.version), input.expectedVersion!);
      const openCase = await tx.query(
        "SELECT id FROM contract.renewal_cases WHERE tenant_id=$1 AND predecessor_contract_id=$2 AND lifecycle_state='OPEN'",
        [tx.tenantId, predecessor.id],
      );
      if (openCase.rowCount)
        throw new ApplicationError(
          "RENEWAL_ALREADY_OPEN",
          "An open Renewal Case already exists for this predecessor Contract.",
        );
      if (
        !["EXECUTED", "ACTIVE", "EXPIRED"].includes(
          String(predecessor.lifecycle_state),
        )
      )
        fail("Contract is not eligible for renewal.");
      const proposal = obj(body.successor_snapshot, "successor_snapshot"),
        effective = date(
          proposal.effective_at,
          "successor_snapshot.effective_at",
        ),
        end = date(proposal.end_at, "successor_snapshot.end_at");
      if (
        effective >= end ||
        new Date(effective).getTime() <
          new Date(predecessor.end_at as string).getTime()
      )
        fail("Renewal successor term must start at or after predecessor end.");
      const supplierId = String(
        proposal.supplier_id ?? predecessor.supplier_id,
      );
      if (supplierId !== String(predecessor.supplier_id))
        fail("Renewal successor must retain the predecessor Supplier.");
      if (input.supplierEligibility) {
        const state = await input.supplierEligibility(tx, supplierId);
        if (!["APPROVED", "PREFERRED"].includes(state))
          fail("Supplier is not eligible for Contract renewal.");
      }
      const caseId = randomUUID(),
        successorId = randomUUID(),
        versionId = randomUUID();
      const code = text(
          proposal.contract_code,
          "successor_snapshot.contract_code",
          80,
        ),
        display = text(
          proposal.supplier_display_snapshot ??
            predecessor.supplier_display_snapshot,
          "successor_snapshot.supplier_display_snapshot",
          240,
        );
      await tx.query(
        "INSERT INTO contract.contracts(id,tenant_id,contract_code,supplier_id,supplier_display_snapshot,lifecycle_state,effective_at,end_at,current_version_id,renewed_from_contract_id,created_by,correlation_id) VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9,$10,$11)",
        [
          successorId,
          tx.tenantId,
          code,
          supplierId,
          display,
          effective,
          end,
          versionId,
          predecessor.id,
          input.actorId,
          input.correlationId,
        ],
      );
      const snap = {
        ...proposal,
        supplier_id: supplierId,
        supplier_display_snapshot: display,
        effective_at: effective,
        end_at: end,
        auto_renew_clause: proposal.auto_renew_clause ?? null,
      };
      const fingerprint = hash(snap);
      await tx.query(
        "INSERT INTO contract.contract_versions(id,tenant_id,contract_id,version_number,commercial_snapshot,fingerprint,source,created_by) VALUES($1,$2,$3,1,$4,$5,'RENEWAL',$6)",
        [
          versionId,
          tx.tenantId,
          successorId,
          JSON.stringify(snap),
          hash(snap),
          input.actorId,
        ],
      );
      await tx.query(
        "INSERT INTO contract.renewal_cases(id,tenant_id,predecessor_contract_id,successor_contract_id,lifecycle_state,proposal_snapshot,proposal_fingerprint,created_by,reason,correlation_id) VALUES($1,$2,$3,$4,'OPEN',$5,$6,$7,$8,$9)",
        [
          caseId,
          tx.tenantId,
          predecessor.id,
          successorId,
          JSON.stringify(snap),
          fingerprint,
          input.actorId,
          reason,
          input.correlationId,
        ],
      );
      const successorRow = await contractRow(tx, successorId);
      await recordHistory(
        tx,
        successorRow,
        "CONTRACT.CREATED",
        input.actorId,
        reason,
        input.correlationId,
        null,
        {
          id: successorId,
          lifecycle_state: "DRAFT",
          current_version_number: 1,
        },
      );
      await tx.query(
        "INSERT INTO contract.renewal_history(id,tenant_id,renewal_case_id,event_type,after_state,actor_id,reason,correlation_id) VALUES($1,$2,$3,'CONTRACT.RENEWAL_OPENED',$4,$5,$6,$7)",
        [
          randomUUID(),
          tx.tenantId,
          caseId,
          JSON.stringify({
            lifecycle_state: "OPEN",
            successor_contract_id: successorId,
          }),
          input.actorId,
          reason,
          input.correlationId,
        ],
      );
      result = {
        id: caseId,
        tenant_id: tx.tenantId,
        predecessor_contract_id: predecessor.id,
        successor_contract_id: successorId,
        lifecycle_state: "OPEN",
        proposal_snapshot: snap,
        version: 1,
      };
      eventType = "CONTRACT.RENEWAL_OPENED";
    } else {
      const found = await tx.query(
        "SELECT * FROM contract.renewal_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [tx.tenantId, input.id],
      );
      if (!found.rowCount)
        throw new ApplicationError("NOT_FOUND", "Renewal Case was not found.");
      const renewal = found.rows[0] as Record<string, unknown>;
      assertVersion(Number(renewal.version), input.expectedVersion!);
      if (renewal.lifecycle_state !== "OPEN") fail("Renewal Case is not open.");
      before = {
        lifecycle_state: renewal.lifecycle_state,
        version: Number(renewal.version),
      };
      if (command === "RENEWAL.UPDATE_PROPOSAL") {
        if (!reason) fail("Renewal proposal updates require a reason.");
        const proposal = obj(body.proposal_snapshot, "proposal_snapshot");
        const successor = await contractRow(
          tx,
          String(renewal.successor_contract_id),
          true,
        );
        if (successor.lifecycle_state !== "DRAFT")
          fail(
            "Renewal proposal is editable only while the successor Contract is DRAFT.",
          );
        const effective = date(
            proposal.effective_at,
            "proposal_snapshot.effective_at",
          ),
          end = date(proposal.end_at, "proposal_snapshot.end_at");
        if (
          effective >= end ||
          new Date(effective).getTime() <
            new Date(
              (await contractRow(tx, String(renewal.predecessor_contract_id)))
                .end_at as string,
            ).getTime()
        )
          fail(
            "Renewal successor term must start at or after predecessor end.",
          );
        const supplierId = String(
          proposal.supplier_id ?? successor.supplier_id,
        );
        if (supplierId !== String(successor.supplier_id))
          fail("Renewal successor must retain the predecessor Supplier.");
        const snapshot = {
          ...proposal,
          supplier_id: supplierId,
          supplier_display_snapshot:
            proposal.supplier_display_snapshot ??
            successor.supplier_display_snapshot,
          effective_at: effective,
          end_at: end,
        };
        const fp = hash(snapshot),
          version = await addVersion(
            tx,
            successor,
            snapshot,
            "RENEWAL",
            input.actorId,
            reason,
          );
        await tx.query(
          "UPDATE contract.contracts SET current_version_id=$3,current_version_number=$4,effective_at=$5,end_at=$6,supplier_display_snapshot=$7,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$8",
          [
            tx.tenantId,
            successor.id,
            version.id,
            version.version,
            effective,
            end,
            snapshot.supplier_display_snapshot,
            successor.version,
          ],
        );
        const updatedSuccessor = await contractRow(tx, String(successor.id));
        await recordHistory(
          tx,
          updatedSuccessor,
          "CONTRACT.UPDATED",
          input.actorId,
          reason,
          input.correlationId,
          { lifecycle_state: "DRAFT", version: Number(successor.version) },
          {
            id: successor.id,
            lifecycle_state: "DRAFT",
            current_version_number: version.version,
          },
        );
        await tx.query(
          "UPDATE contract.renewal_cases SET proposal_snapshot=$3,proposal_fingerprint=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$5",
          [
            tx.tenantId,
            input.id,
            JSON.stringify(snapshot),
            fp,
            input.expectedVersion,
          ],
        );
        result = {
          ...renewal,
          proposal_snapshot: snapshot,
          proposal_fingerprint: fp,
          successor_contract_id: successor.id,
          successor_contract_version: Number(successor.version) + 1,
          successor_current_version_number: version.version,
          version: Number(renewal.version) + 1,
        };
        eventType = "CONTRACT.RENEWAL_UPDATED";
      } else if (command === "RENEWAL.COMPLETE") {
        const successor = await contractRow(
          tx,
          String(renewal.successor_contract_id),
        );
        if (!["EXECUTED", "ACTIVE"].includes(String(successor.lifecycle_state)))
          fail("Renewal completion requires an executed successor Contract.");
        const approval = await input.approvalForSource?.(
          tx,
          "CONTRACT_RENEWAL",
          String(renewal.id),
        );
        if (
          !approvalList(approval).every(
            (item) =>
              item.state === "APPROVED" &&
              (item.context as JsonRecord)?.proposal_fingerprint ===
                renewal.proposal_fingerprint,
          )
        )
          throw new ApplicationError(
            "CONTRACT_APPROVAL_STALE",
            "Linked renewal approval is not approved for the current proposal.",
          );
        await tx.query(
          "UPDATE contract.renewal_cases SET lifecycle_state='COMPLETED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3",
          [tx.tenantId, input.id, input.expectedVersion],
        );
        result = {
          ...renewal,
          lifecycle_state: "COMPLETED",
          version: Number(renewal.version) + 1,
        };
        eventType = "CONTRACT.RENEWAL_COMPLETED";
      } else {
        const state =
          command === "RENEWAL.CANCEL" ? "CANCELLED" : "NOT_RENEWED";
        if (!reason)
          fail("Renewal cancellation/not-renewed decision requires a reason.");
        await tx.query(
          "UPDATE contract.renewal_cases SET lifecycle_state=$3,reason=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$5",
          [tx.tenantId, input.id, state, reason, input.expectedVersion],
        );
        result = {
          ...renewal,
          lifecycle_state: state,
          version: Number(renewal.version) + 1,
        };
        eventType =
          state === "CANCELLED"
            ? "CONTRACT.RENEWAL_CANCELLED"
            : "CONTRACT.RENEWAL_NOT_RENEWED";
      }
      await tx.query(
        "INSERT INTO contract.renewal_history(id,tenant_id,renewal_case_id,event_type,before_state,after_state,actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          randomUUID(),
          tx.tenantId,
          renewal.id,
          eventType,
          before ? JSON.stringify(before) : null,
          JSON.stringify(result),
          input.actorId,
          reason,
          input.correlationId,
        ],
      );
    }
    const renewalEvents =
      command === "RENEWAL.OPEN"
        ? [
            newEvent(
              "CONTRACT.CREATED",
              "CONTRACT",
              String(result.successor_contract_id),
              1,
              null,
              {
                id: result.successor_contract_id,
                lifecycle_state: "DRAFT",
                current_version_number: 1,
              },
            ),
            newEvent(
              eventType,
              "RENEWAL_CASE",
              String(result.id),
              Number(result.version),
              before,
              result,
            ),
          ]
        : command === "RENEWAL.UPDATE_PROPOSAL"
          ? [
              newEvent(
                "CONTRACT.UPDATED",
                "CONTRACT",
                String(result.successor_contract_id),
                Number(result.successor_contract_version),
                null,
                {
                  id: result.successor_contract_id,
                  lifecycle_state: "DRAFT",
                  current_version_number:
                    result.successor_current_version_number,
                },
              ),
              newEvent(
                eventType,
                "RENEWAL_CASE",
                String(result.id),
                Number(result.version),
                before,
                result,
              ),
            ]
          : [
              newEvent(
                eventType,
                "RENEWAL_CASE",
                String(result.id),
                Number(result.version),
                before,
                result,
              ),
            ];
    return {
      data: result,
      status: command === "RENEWAL.OPEN" ? 201 : 200,
      events: renewalEvents,
    };
  } else {
    if (!input.id)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "contract id is required.",
      );
    row = await contractRow(tx, input.id, true);
    assertVersion(Number(row.version), input.expectedVersion!);
    if (command === "CONTRACT.EXPIRE" && row.lifecycle_state === "EXPIRED")
      return { data: row, status: 200, events: [] };
    before = {
      lifecycle_state: row.lifecycle_state,
      usage_status: row.usage_status,
      version: Number(row.version),
      current_version_number: Number(row.current_version_number),
    };
    const state = String(row.lifecycle_state);
    if (command === "CONTRACT.UPDATE_DRAFT" || command === "CONTRACT.AMEND") {
      if (!mayTransition(state as never, command))
        fail(
          "Contract cannot be commercially modified in its current lifecycle state.",
        );
      if (command === "CONTRACT.AMEND" && !reason)
        fail("Contract amendment requires reason.");
      let amendmentEvidence:
        { documentId: string; documentVersionId: string } | undefined;
      if (command === "CONTRACT.AMEND") {
        const documentId = text(
          body.evidence_document_id,
          "evidence_document_id",
        );
        const documentVersionId = text(
          body.evidence_document_version_id,
          "evidence_document_version_id",
        );
        if (
          !input.finalDocument ||
          !(await input.finalDocument(
            tx,
            documentId,
            documentVersionId,
            String(row.id),
          ))
        )
          fail(
            "A FINAL signed amendment evidence document linked to this Contract is required.",
          );
        amendmentEvidence = { documentId, documentVersionId };
      }
      const snapshot = obj(body.commercial_snapshot, "commercial_snapshot");
      if (
        snapshot.supplier_id !== undefined &&
        String(snapshot.supplier_id) !== String(row.supplier_id)
      )
        fail("Supplier is immutable in an amendment.");
      if (
        command === "CONTRACT.AMEND" &&
        ((snapshot.end_at !== undefined &&
          new Date(String(snapshot.end_at)).getTime() !==
            new Date(String(row.end_at)).getTime()) ||
          (snapshot.effective_at !== undefined &&
            new Date(String(snapshot.effective_at)).getTime() !==
              new Date(String(row.effective_at)).getTime()))
      )
        fail(
          "Contract amendment cannot change the contractual term; use Renewal for an extension.",
        );
      const nextSupplier =
        command === "CONTRACT.UPDATE_DRAFT" &&
        snapshot.supplier_id !== undefined
          ? String(snapshot.supplier_id)
          : String(row.supplier_id);
      const nextSupplierName =
        command === "CONTRACT.UPDATE_DRAFT" &&
        snapshot.supplier_display_snapshot !== undefined
          ? text(
              snapshot.supplier_display_snapshot,
              "supplier_display_snapshot",
              240,
            )
          : String(row.supplier_display_snapshot);
      const nextEffective =
        command === "CONTRACT.UPDATE_DRAFT" &&
        snapshot.effective_at !== undefined
          ? date(snapshot.effective_at, "effective_at")
          : new Date(row.effective_at as string).toISOString();
      const nextEnd =
        command === "CONTRACT.UPDATE_DRAFT" && snapshot.end_at !== undefined
          ? date(snapshot.end_at, "end_at")
          : new Date(row.end_at as string).toISOString();
      if (nextEffective >= nextEnd) fail("effective_at must precede end_at.");
      if (command === "CONTRACT.UPDATE_DRAFT" && input.supplierEligibility)
        await input.supplierEligibility(tx, nextSupplier);
      if (command === "CONTRACT.AMEND") {
        const approval = await input.approvalForSource?.(
          tx,
          "CONTRACT_AMENDMENT",
          String(row.id),
        );
        if (
          !approvalList(approval).every(
            (item) =>
              item.state === "APPROVED" &&
              (item.context as JsonRecord)?.base_version ===
                Number(row!.current_version_number) &&
              (item.context as JsonRecord)?.proposal_fingerprint ===
                hash(snapshot),
          )
        )
          throw new ApplicationError(
            "CONTRACT_APPROVAL_STALE",
            "Linked amendment approval is stale or not approved.",
          );
      }
      const priorSnapshot =
        ((
          await tx.query(
            "SELECT commercial_snapshot FROM contract.contract_versions WHERE tenant_id=$1 AND id=$2",
            [tx.tenantId, row.current_version_id],
          )
        ).rows[0]?.commercial_snapshot as JsonRecord) ?? {};
      const nextSnapshot: JsonRecord = {
        ...snapshot,
        supplier_id: nextSupplier,
        supplier_display_snapshot: nextSupplierName,
        effective_at: nextEffective,
        end_at: nextEnd,
        auto_renew_clause:
          snapshot.auto_renew_clause !== undefined
            ? snapshot.auto_renew_clause
            : (priorSnapshot.auto_renew_clause ??
              row.auto_renew_clause ??
              null),
      };
      const version = await addVersion(
        tx,
        row,
        nextSnapshot,
        command === "CONTRACT.AMEND" ? "AMENDMENT" : "DRAFT_UPDATE",
        input.actorId,
        reason,
        amendmentEvidence,
      );
      const updated = await tx.query(
        "UPDATE contract.contracts SET current_version_id=$3,current_version_number=$4,supplier_id=$5,supplier_display_snapshot=$6,effective_at=$7,end_at=$8,auto_renew_clause=$9,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$10 RETURNING *",
        [
          tx.tenantId,
          row.id,
          version.id,
          version.version,
          nextSupplier,
          nextSupplierName,
          nextEffective,
          nextEnd,
          nextSnapshot.auto_renew_clause == null
            ? null
            : JSON.stringify(nextSnapshot.auto_renew_clause),
          input.expectedVersion,
        ],
      );
      row = updated.rows[0] as Record<string, unknown>;
      if (command === "CONTRACT.AMEND") {
        const changedFields = [
          ...new Set([
            ...Object.keys(priorSnapshot),
            ...Object.keys(nextSnapshot),
          ]),
        ]
          .filter(
            (field) =>
              canonical(priorSnapshot[field]) !==
              canonical(nextSnapshot[field]),
          )
          .sort();
        await tx.query(
          "INSERT INTO contract.amendment_changes(id,tenant_id,contract_id,base_version,amended_version,changed_fields,proposal_fingerprint,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            randomUUID(),
            tx.tenantId,
            row.id,
            Number(row.current_version_number) - 1,
            version.version,
            JSON.stringify(changedFields),
            version.fingerprint,
            reason,
            input.actorId,
          ],
        );
      }
      result = { ...row, commercial_fingerprint: version.fingerprint };
      eventType =
        command === "CONTRACT.AMEND" ? "CONTRACT.AMENDED" : "CONTRACT.UPDATED";
    } else if (command === "CONTRACT.HOLD" || command === "CONTRACT.RESUME") {
      if (command === "CONTRACT.HOLD" && !reason)
        fail("Contract hold requires a reason.");
      if (!["EXECUTED", "ACTIVE"].includes(state))
        fail("Only executed or active Contracts may be held or resumed.");
      const wanted = command === "CONTRACT.HOLD" ? "ENABLED" : "ON_HOLD";
      if (row.usage_status !== wanted)
        fail("Contract usage status does not allow this command.");
      row = (
        await tx.query(
          "UPDATE contract.contracts SET usage_status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$4 RETURNING *",
          [
            tx.tenantId,
            row.id,
            command === "CONTRACT.HOLD" ? "ON_HOLD" : "ENABLED",
            input.expectedVersion,
          ],
        )
      ).rows[0] as Record<string, unknown>;
      result = { ...row };
      eventType =
        command === "CONTRACT.HOLD" ? "CONTRACT.HELD" : "CONTRACT.RESUMED";
    } else {
      const allowed = mayTransition(state as never, command);
      if (!allowed)
        fail("Contract command is not allowed in its current lifecycle state.");
      if (command === "CONTRACT.SUBMIT_FOR_SIGNATURE") {
        row = (
          await tx.query(
            "UPDATE contract.contracts SET lifecycle_state='PENDING_SIGNATURE',submitted_version_id=current_version_id,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *",
            [tx.tenantId, row.id, input.expectedVersion],
          )
        ).rows[0] as Record<string, unknown>;
        eventType = "CONTRACT.SUBMITTED_FOR_SIGNATURE";
      } else if (command === "CONTRACT.RECALL_SIGNATURE") {
        const evidence = await tx.query(
          "SELECT 1 FROM contract.execution_evidence WHERE tenant_id=$1 AND contract_id=$2",
          [tx.tenantId, row.id],
        );
        if (evidence.rowCount)
          fail("Final execution evidence prevents signature recall.");
        row = (
          await tx.query(
            "UPDATE contract.contracts SET lifecycle_state='DRAFT',submitted_version_id=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *",
            [tx.tenantId, row.id, input.expectedVersion],
          )
        ).rows[0] as Record<string, unknown>;
        eventType = "CONTRACT.SIGNATURE_RECALLED";
      } else if (command === "CONTRACT.RECORD_EXECUTION") {
        const supplier = String(row.supplier_id);
        if (
          input.supplierEligibility &&
          !["APPROVED", "PREFERRED"].includes(
            await input.supplierEligibility(tx, supplier),
          )
        )
          fail("Supplier is not eligible for Contract execution.");
        const approval = await input.approvalForSource?.(
          tx,
          "CONTRACT_EXECUTION",
          String(row.id),
        );
        if (
          !approvalList(approval).every(
            (item) =>
              item.state === "APPROVED" &&
              (item.context as JsonRecord)?.contract_version_id ===
                String(row!.submitted_version_id),
          )
        )
          throw new ApplicationError(
            "CONTRACT_APPROVAL_STALE",
            "Linked execution approval is not approved for the submitted Contract version.",
          );
        let evidenceType = "EXTERNAL_REFERENCE",
          documentId: string | null = null,
          docVersionId: string | null = null,
          external: string | null =
            body.external_reference == null
              ? null
              : text(body.external_reference, "external_reference", 512);
        if (body.document_id || body.document_version_id) {
          documentId = text(body.document_id, "document_id");
          docVersionId = text(body.document_version_id, "document_version_id");
          if (
            !input.finalDocument ||
            !(await input.finalDocument(
              tx,
              documentId,
              docVersionId,
              String(row.id),
            ))
          )
            fail("Execution evidence document must be FINAL and SIGNED.");
          evidenceType = "FINAL_DOCUMENT";
          external = null;
        }
        if (evidenceType === "EXTERNAL_REFERENCE" && !external)
          fail("Execution evidence is required.");
        await tx.query(
          "INSERT INTO contract.execution_evidence(id,tenant_id,contract_id,contract_version_id,evidence_type,document_id,document_version_id,external_reference,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            randomUUID(),
            tx.tenantId,
            row.id,
            row.submitted_version_id,
            evidenceType,
            documentId,
            docVersionId,
            external,
            input.actorId,
          ],
        );
        row = (
          await tx.query(
            "UPDATE contract.contracts SET lifecycle_state='EXECUTED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *",
            [tx.tenantId, row.id, input.expectedVersion],
          )
        ).rows[0] as Record<string, unknown>;
        eventType = "CONTRACT.EXECUTED";
      } else if (command === "CONTRACT.ACTIVATE") {
        if (
          Date.now() < new Date(row.effective_at as string).getTime() ||
          Date.now() >= new Date(row.end_at as string).getTime()
        )
          fail("Contract is outside its effective term.");
        const evidence = await tx.query(
          "SELECT 1 FROM contract.execution_evidence WHERE tenant_id=$1 AND contract_id=$2 AND contract_version_id=$3",
          [tx.tenantId, row.id, row.submitted_version_id],
        );
        if (!evidence.rowCount)
          fail(
            "Valid execution evidence for the current submitted version is required.",
          );
        if (
          input.supplierEligibility &&
          !["APPROVED", "PREFERRED"].includes(
            await input.supplierEligibility(tx, String(row.supplier_id)),
          )
        )
          fail("Supplier is not eligible for Contract activation.");
        row = (
          await tx.query(
            "UPDATE contract.contracts SET lifecycle_state='ACTIVE',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *",
            [tx.tenantId, row.id, input.expectedVersion],
          )
        ).rows[0] as Record<string, unknown>;
        eventType = "CONTRACT.ACTIVATED";
      } else if (command === "CONTRACT.TERMINATE") {
        if (!reason) fail("Contract termination requires reason.");
        const effective = date(body.effective_at, "effective_at");
        row = (
          await tx.query(
            "UPDATE contract.contracts SET lifecycle_state='TERMINATED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *",
            [tx.tenantId, row.id, input.expectedVersion],
          )
        ).rows[0] as Record<string, unknown>;
        eventType = "CONTRACT.TERMINATED";
        result = { ...row, termination_effective_at: effective };
      } else if (command === "CONTRACT.EXPIRE") {
        if (Date.now() < new Date(row.end_at as string).getTime())
          fail("Contract term has not ended.");
        row = (
          await tx.query(
            "UPDATE contract.contracts SET lifecycle_state='EXPIRED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *",
            [tx.tenantId, row.id, input.expectedVersion],
          )
        ).rows[0] as Record<string, unknown>;
        eventType = "CONTRACT.EXPIRED";
      } else {
        if (!reason) fail("Contract cancellation requires reason.");
        row = (
          await tx.query(
            "UPDATE contract.contracts SET lifecycle_state='CANCELLED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING *",
            [tx.tenantId, row.id, input.expectedVersion],
          )
        ).rows[0] as Record<string, unknown>;
        eventType = "CONTRACT.CANCELLED";
      }
      if (Object.keys(result).length === 0) result = { ...row };
    }
  }
  if (row)
    await recordHistory(
      tx,
      row,
      eventType,
      input.actorId,
      reason,
      input.correlationId,
      before,
      result,
    );
  return {
    data: result!,
    status: command === "CONTRACT.CREATE" ? 201 : 200,
    events: [
      newEvent(
        eventType,
        command.startsWith("RENEWAL.") ? "RENEWAL_CASE" : "CONTRACT",
        String(result!.id),
        Number(result!.version ?? 1),
        before,
        result!,
      ),
    ],
  };
}

export async function readContract(tx: Transaction, id: string) {
  return contractRow(tx, id);
}
export async function listContracts(tx: Transaction, limit = 50, offset = 0) {
  return (
    await tx.query(
      "SELECT id,contract_code,supplier_id,supplier_display_snapshot,lifecycle_state,usage_status,effective_at,end_at,current_version_number,version,renewed_from_contract_id,created_at FROM contract.contracts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [tx.tenantId, limit, offset],
    )
  ).rows;
}
export async function listContractVersions(
  tx: Transaction,
  contractId: string,
) {
  await contractRow(tx, contractId);
  return (
    await tx.query(
      "SELECT id,contract_id,version_number,commercial_snapshot,fingerprint,source,reason,created_by,created_at,evidence_document_id,evidence_document_version_id FROM contract.contract_versions WHERE tenant_id=$1 AND contract_id=$2 ORDER BY version_number",
      [tx.tenantId, contractId],
    )
  ).rows;
}
export async function readRenewalCase(tx: Transaction, id: string) {
  const r = await tx.query(
    "SELECT * FROM contract.renewal_cases WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, id],
  );
  if (!r.rowCount)
    throw new ApplicationError("NOT_FOUND", "Renewal Case was not found.");
  return r.rows[0];
}
