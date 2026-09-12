import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("TASK-075 executes versioned Contract lifecycle, guarded Renewal, and finalized commercial evidence", async () => {
  const db = await testDatabase();
  const tenant = "tenant-contract-lifecycle";
  const supplier = randomUUID();
  const operator = randomUUID();
  await db.pool.query(
    "INSERT INTO procurement.suppliers(id,tenant_id,code,legal_name,state,created_by) VALUES($1,$2,'CTR-SUP-1','Contract Supplier','APPROVED','test')",
    [supplier, tenant],
  );
  const server = apiServer(
    loadConfig({
      DATABASE_SECRET_REF: "env:TEST",
      APP_ENV: "test",
      LOG_LEVEL: "error",
    }),
    async () => true,
    {
      async authenticate() {
        return { id: operator, tenant_id: tenant, actor_type: "USER" };
      },
    },
    {
      async evaluate() {
        return { result: "ALLOW" as const, reason: "test" };
      },
    },
    db.uow,
    undefined,
    {
      async head(key) {
        return {
          key,
          checksum: "a".repeat(64),
          content_type: "application/pdf",
          size_bytes: 3,
        };
      },
    },
  );
  const base = await listen(server);
  const post = (path: string, key: string, body: object) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
  const get = (path: string) =>
    fetch(base + path, { headers: { authorization: "Bearer test" } });
  const now = Date.now();
  const start = new Date(now - 60_000).toISOString();
  const end = new Date(now + 2 * 86_400_000).toISOString();
  const code = `CTR-${randomUUID().slice(0, 8)}`;
  try {
    const created = await post("/api/v1/contracts", "contract-create-1", {
      contract_code: code,
      supplier_id: supplier,
      supplier_display_snapshot: "Contract Supplier",
      effective_at: start,
      end_at: end,
      commercial_snapshot: { price: 20, currency: "USD" },
    });
    assert.equal(created.status, 201, await created.clone().text());
    const contractId = ((await created.json()) as { data: { id: string } }).data
      .id;
    const submitted = await post(
      `/api/v1/contracts/${contractId}/commands/submit-for-signature`,
      "contract-submit-1",
      { expected_version: 1 },
    );
    assert.equal(submitted.status, 200, await submitted.clone().text());
    const executed = await post(
      `/api/v1/contracts/${contractId}/commands/record-execution`,
      "contract-execute-1",
      { expected_version: 2, external_reference: "offline-signature:ref-91" },
    );
    assert.equal(executed.status, 200, await executed.clone().text());
    const activated = await post(
      `/api/v1/contracts/${contractId}/commands/activate`,
      "contract-activate-1",
      { expected_version: 3 },
    );
    assert.equal(activated.status, 200, await activated.clone().text());
    const held = await post(
      `/api/v1/contracts/${contractId}/commands/hold`,
      "contract-hold-1",
      { expected_version: 4, reason: "Supplier review" },
    );
    assert.equal(held.status, 200, await held.clone().text());
    assert.equal((await get(`/api/v1/contracts/${contractId}`)).status, 200);
    const resumed = await post(
      `/api/v1/contracts/${contractId}/commands/resume`,
      "contract-resume-1",
      { expected_version: 5 },
    );
    assert.equal(resumed.status, 200, await resumed.clone().text());
    const amendmentDocument = await post(
      "/api/v1/commercial-documents",
      "amendment-document-create",
      {
        document_code: `DOC-${randomUUID().slice(0, 8)}`,
        document_type: "AMENDMENT",
        resource_type: "CONTRACT",
        resource_id: contractId,
        storage_ref: "object://contract/amendment.pdf",
        content_hash: "a".repeat(64),
        content_type: "application/pdf",
        size_bytes: 3,
        signature_status: "SIGNED",
        classification: "CONFIDENTIAL",
      },
    );
    assert.equal(
      amendmentDocument.status,
      201,
      await amendmentDocument.clone().text(),
    );
    const amendmentDocumentData = (await amendmentDocument.json()) as {
      data: { id: string; current_version_id: string };
    };
    const amendmentDocumentFinalized = await post(
      `/api/v1/commercial-documents/${amendmentDocumentData.data.id}/commands/finalize`,
      "amendment-document-finalize",
      { expected_version: 1 },
    );
    assert.equal(
      amendmentDocumentFinalized.status,
      200,
      await amendmentDocumentFinalized.clone().text(),
    );
    const amendment = post(
      `/api/v1/contracts/${contractId}/commands/amend`,
      "contract-amend-1",
      {
        expected_version: 6,
        reason: "Updated SLA",
        evidence_document_id: amendmentDocumentData.data.id,
        evidence_document_version_id:
          amendmentDocumentData.data.current_version_id,
        commercial_snapshot: { price: 20, currency: "USD", sla: "P1 4h" },
      },
    );
    const termination = post(
      `/api/v1/contracts/${contractId}/commands/terminate`,
      "contract-terminate-1",
      {
        expected_version: 6,
        reason: "Terminate test",
        effective_at: new Date().toISOString(),
      },
    );
    const competing = await Promise.all([amendment, termination]);
    assert.equal(
      competing.filter((r) => r.status === 200).length,
      1,
      (await Promise.all(competing.map((r) => r.clone().text()))).join(" | "),
    );
    assert.equal(
      competing.filter((r) => r.status === 409).length,
      1,
      String(competing.map((r) => r.status)),
    );

    const renewalPredecessor = `CTR-${randomUUID().slice(0, 8)}`;
    const renewalContract = await post(
      "/api/v1/contracts",
      "contract-create-renewal",
      {
        contract_code: renewalPredecessor,
        supplier_id: supplier,
        supplier_display_snapshot: "Contract Supplier",
        effective_at: start,
        end_at: end,
        commercial_snapshot: { scope: "support" },
      },
    );
    assert.equal(
      renewalContract.status,
      201,
      await renewalContract.clone().text(),
    );
    const predecessorId = (
      (await renewalContract.json()) as { data: { id: string } }
    ).data.id;
    await post(
      `/api/v1/contracts/${predecessorId}/commands/submit-for-signature`,
      "contract-submit-renewal",
      { expected_version: 1 },
    );
    await post(
      `/api/v1/contracts/${predecessorId}/commands/record-execution`,
      "contract-execute-renewal",
      { expected_version: 2, external_reference: "offline-signature:renewal" },
    );
    const successorStart = new Date(
      new Date(end).getTime() + 1000,
    ).toISOString();
    const openBody = {
      predecessor_contract_id: predecessorId,
      expected_version: 3,
      successor_snapshot: {
        contract_code: `CTR-${randomUUID().slice(0, 8)}`,
        supplier_id: supplier,
        supplier_display_snapshot: "Contract Supplier",
        effective_at: successorStart,
        end_at: new Date(
          new Date(end).getTime() + 365 * 86_400_000,
        ).toISOString(),
        commercial_snapshot: { scope: "support-renewed" },
      },
    };
    const opened = await post(
      "/api/v1/renewal-cases",
      "renewal-open-1",
      openBody,
    );
    assert.equal(opened.status, 201, await opened.clone().text());
    const race = await Promise.all([
      post("/api/v1/renewal-cases", "renewal-open-2", openBody),
      post("/api/v1/renewal-cases", "renewal-open-3", openBody),
    ]);
    assert.ok(
      race.every((r) => r.status === 409),
      (await Promise.all(race.map((r) => r.clone().text()))).join(" | "),
    );

    const document = await post(
      "/api/v1/commercial-documents",
      "document-create-1",
      {
        document_code: `DOC-${randomUUID().slice(0, 8)}`,
        document_type: "EXECUTION_EVIDENCE",
        resource_type: "CONTRACT",
        resource_id: contractId,
        storage_ref: "object://contract/evidence.pdf",
        content_hash: "a".repeat(64),
        content_type: "application/pdf",
        size_bytes: 3,
        signature_status: "SIGNED",
        classification: "CONFIDENTIAL",
      },
    );
    assert.equal(document.status, 201, await document.clone().text());
    const documentId = ((await document.json()) as { data: { id: string } })
      .data.id;
    const finalized = await post(
      `/api/v1/commercial-documents/${documentId}/commands/finalize`,
      "document-finalize-1",
      { expected_version: 1 },
    );
    assert.equal(finalized.status, 200, await finalized.clone().text());
    const version = await db.pool.query(
      "SELECT governance_status,signature_status FROM document.document_versions WHERE tenant_id=$1 AND document_id=$2",
      [tenant, documentId],
    );
    assert.deepEqual(version.rows[0], {
      governance_status: "FINAL",
      signature_status: "SIGNED",
    });
    const outbox = await db.pool.query(
      "SELECT count(*)::int AS n FROM platform.outbox_events WHERE tenant_id=$1 AND event_type LIKE 'CONTRACT.%'",
      [tenant],
    );
    assert.ok(outbox.rows[0]!.n >= 8);
    const history = await db.pool.query(
      "SELECT count(*)::int AS n FROM contract.history WHERE tenant_id=$1 AND contract_id=$2",
      [tenant, contractId],
    );
    assert.ok(history.rows[0]!.n >= 6);
  } finally {
    server.close();
    await db.close();
  }
});
