import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { apiServer } from "../../apps/api/src/server.js";
import type { SoftwareArtifactAdapters } from "../../apps/api/src/software-artifact-routes.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("software catalog and artifact lifecycle enforce validation, approvals and tenant ownership", async () => {
  const db = await testDatabase();
  const uploader = randomUUID();
  const reviewer = randomUUID();
  const checksum = "a".repeat(64);
  const reviewChecksum = "b".repeat(64);
  let principalId = uploader;
  let tenant = "tenant-a";
  let allowed = true;
  let reviewScanner = false;
  let scanCalls = 0;
  const adapters: SoftwareArtifactAdapters = {
    storage: {
      async inspect(ref) {
        return {
          checksumSha256:
            ref === "artifact/review"
              ? reviewChecksum
              : ref === "artifact/signature-missing"
                ? "d".repeat(64)
                : ref === "artifact/editor-replacement"
                  ? "c".repeat(64)
                  : checksum,
          sizeBytes: 2048,
          mediaType: "application/octet-stream",
        };
      },
    },
    scanner: {
      async scan({ checksumSha256 }) {
        scanCalls++;
        return {
          status:
            reviewScanner && checksumSha256 === reviewChecksum
              ? "NEEDS_REVIEW"
              : "PASSED",
          scanner: "test-scanner",
          reason: "Synthetic test result",
          evidenceRef: "scan-result:123",
        };
      },
    },
    signatureVerifier: {
      async verify() {
        return {
          status: "VALID",
          verifier: "test-signature-verifier",
          reason: "Synthetic verified signature",
          evidenceRef: "signature-result:123",
        };
      },
    },
  };
  const server = apiServer(
    loadConfig({
      DATABASE_SECRET_REF: "env:TEST",
      APP_ENV: "test",
      LOG_LEVEL: "error",
    }),
    async () => true,
    {
      async authenticate() {
        return { id: principalId, tenant_id: tenant, actor_type: "USER" };
      },
    },
    {
      async evaluate() {
        return { result: allowed ? "ALLOW" : "DENY", reason: "test policy" };
      },
    },
    db.uow,
    adapters,
  );
  const url = await listen(server);
  const post = (path: string, key: string, body: object) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
  const get = (path: string) =>
    fetch(url + path, { headers: { authorization: "Bearer test" } });
  try {
    const unapprovedVisibility = await post(
      "/api/v1/software/products",
      "unapproved-visible-product",
      {
        product_code: "EDITOR-UNAPPROVED",
        name: "Unapproved Editor",
        vendor: "Example Vendor",
        category: "DEVELOPMENT",
        owner_id: "team-platform",
        support_team: "service-desk",
        supported_os: ["linux"],
        supported_asset_classes: ["LAPTOP"],
        visibility: "END_USER",
      },
    );
    assert.equal(unapprovedVisibility.status, 422);
    const createdProduct = await post(
      "/api/v1/software/products",
      "product-create",
      {
        product_code: "EDITOR-01",
        name: "Managed Editor",
        vendor: "Example Vendor",
        category: "DEVELOPMENT",
        owner_id: "team-platform",
        support_team: "service-desk",
        supported_os: ["linux", "macos"],
        supported_asset_classes: ["LAPTOP"],
        visibility: "IT_ONLY",
        license_required: false,
      },
    );
    assert.equal(createdProduct.status, 201);
    const product = ((await createdProduct.json()) as { data: { id: string } })
      .data;
    const replay = await post("/api/v1/software/products", "product-create", {
      product_code: "EDITOR-01",
      name: "Managed Editor",
      vendor: "Example Vendor",
      category: "DEVELOPMENT",
      owner_id: "team-platform",
      support_team: "service-desk",
      supported_os: ["linux", "macos"],
      supported_asset_classes: ["LAPTOP"],
      visibility: "IT_ONLY",
      license_required: false,
    });
    assert.equal(replay.status, 201);
    assert.equal(
      ((await replay.json()) as { data: { id: string } }).data.id,
      product.id,
    );
    const reusedKey = await post(
      "/api/v1/software/products",
      "product-create",
      {
        product_code: "EDITOR-01",
        name: "Changed request",
        vendor: "Example Vendor",
        category: "DEVELOPMENT",
        owner_id: "team-platform",
        support_team: "service-desk",
        supported_os: ["linux", "macos"],
        supported_asset_classes: ["LAPTOP"],
        visibility: "IT_ONLY",
        license_required: false,
      },
    );
    assert.equal(reusedKey.status, 409);

    const versionResponse = await post(
      `/api/v1/software/products/${product.id}/versions`,
      "version-create",
      { version: "1.4.2", release_notes: "Security update" },
    );
    assert.equal(versionResponse.status, 201);
    const softwareVersion = (
      (await versionResponse.json()) as { data: { id: string } }
    ).data;

    const noStorageServer = apiServer(
      loadConfig({
        DATABASE_SECRET_REF: "env:TEST",
        APP_ENV: "test",
        LOG_LEVEL: "error",
      }),
      async () => true,
      {
        async authenticate() {
          return { id: uploader, tenant_id: tenant, actor_type: "USER" };
        },
      },
      {
        async evaluate() {
          return { result: "ALLOW", reason: "test" };
        },
      },
      db.uow,
    );
    const noStorageUrl = await listen(noStorageServer);
    try {
      const binaryRejected = await fetch(`${noStorageUrl}/api/v1/artifacts`, {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
          "idempotency-key": "binary-rejected",
        },
        body: JSON.stringify({
          software_version_id: softwareVersion.id,
          filename: "editor.pkg",
          media_type: "application/octet-stream",
          size_bytes: 2048,
          source_type: "VENDOR_OFFICIAL",
          checksum_sha256: checksum,
          storage_ref: "artifact/editor-no-storage",
          binary: "bm90LWEtcGFja2FnZQ==",
        }),
      });
      assert.equal(binaryRejected.status, 400);
      const unavailable = await fetch(`${noStorageUrl}/api/v1/artifacts`, {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
          "idempotency-key": "storage-absent",
        },
        body: JSON.stringify({
          software_version_id: softwareVersion.id,
          filename: "editor.pkg",
          media_type: "application/octet-stream",
          size_bytes: 2048,
          source_type: "VENDOR_OFFICIAL",
          checksum_sha256: checksum,
          storage_ref: "artifact/editor-no-storage",
        }),
      });
      assert.equal(unavailable.status, 503);
    } finally {
      await new Promise<void>((resolve, reject) =>
        noStorageServer.close((error) => (error ? reject(error) : resolve())),
      );
    }

    const intake = (key: string, ref: string, digest: string) =>
      post("/api/v1/artifacts", key, {
        software_version_id: softwareVersion.id,
        filename: "editor.pkg",
        media_type: "application/octet-stream",
        size_bytes: 2048,
        source_type: "VENDOR_OFFICIAL",
        checksum_sha256: digest,
        storage_ref: ref,
      });
    const uploaded = await intake(
      "artifact-intake",
      "artifact/editor-1.4.2",
      checksum,
    );
    assert.equal(
      uploaded.status,
      201,
      JSON.stringify(await uploaded.clone().json()),
    );
    const artifact = (
      (await uploaded.json()) as { data: Record<string, unknown> }
    ).data;
    assert.equal(artifact.scan_status, "PENDING");
    assert.equal(artifact.signature_status, "PENDING");
    assert.equal("storage_ref" in artifact, false);

    const differentChecksum = await intake(
      "checksum-conflict",
      "artifact/editor-replacement",
      "c".repeat(64),
    );
    assert.equal(differentChecksum.status, 409);

    const selfApproval = await post(
      `/api/v1/artifacts/${artifact.id}/commands/review`,
      "self-approval",
      {
        expected_version: 1,
        decision: "APPROVE",
        reason: "Uploader cannot approve their own artifact",
      },
    );
    assert.equal(selfApproval.status, 403);

    const missingScannerServer = apiServer(
      loadConfig({
        DATABASE_SECRET_REF: "env:TEST",
        APP_ENV: "test",
        LOG_LEVEL: "error",
      }),
      async () => true,
      {
        async authenticate() {
          return { id: reviewer, tenant_id: tenant, actor_type: "USER" };
        },
      },
      {
        async evaluate() {
          return { result: "ALLOW", reason: "test" };
        },
      },
      db.uow,
      { storage: adapters.storage! },
    );
    const missingScannerUrl = await listen(missingScannerServer);
    try {
      const unavailable = await fetch(
        `${missingScannerUrl}/api/v1/artifacts/${artifact.id}/commands/scan`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer test",
            "content-type": "application/json",
            "idempotency-key": "scanner-absent",
          },
          body: JSON.stringify({ expected_version: 1 }),
        },
      );
      assert.equal(unavailable.status, 503);
    } finally {
      await new Promise<void>((resolve, reject) =>
        missingScannerServer.close((error) =>
          error ? reject(error) : resolve(),
        ),
      );
    }

    principalId = reviewer;
    const unscannedApproval = await post(
      `/api/v1/artifacts/${artifact.id}/commands/review`,
      "unscanned-approval",
      {
        expected_version: 1,
        decision: "APPROVE",
        reason: "Pending scan must block approval",
      },
    );
    assert.equal(unscannedApproval.status, 422);
    const invalidReviewDecision = await post(
      `/api/v1/artifacts/${artifact.id}/commands/review`,
      "invalid-review-decision",
      {
        expected_version: 1,
        decision: "TRUST_ME",
        reason: "Invalid decision must be rejected",
      },
    );
    assert.equal(invalidReviewDecision.status, 400);
    const scanned = await post(
      `/api/v1/artifacts/${artifact.id}/commands/scan`,
      "artifact-scan",
      { expected_version: 1 },
    );
    assert.equal(
      scanned.status,
      200,
      JSON.stringify(await scanned.clone().json()),
    );
    const scanResult = (
      (await scanned.json()) as {
        data: {
          version: number;
          scan_status: string;
          signature_status: string;
        };
      }
    ).data;
    assert.equal(scanResult.scan_status, "PASSED");
    assert.equal(scanResult.signature_status, "VALID");
    assert.equal(scanCalls, 1);
    const scanReplay = await post(
      `/api/v1/artifacts/${artifact.id}/commands/scan`,
      "artifact-scan",
      { expected_version: 1 },
    );
    assert.equal(scanReplay.status, 200);
    assert.equal(scanCalls, 1);
    const staleScan = await post(
      `/api/v1/artifacts/${artifact.id}/commands/scan`,
      "stale-scan",
      { expected_version: 1 },
    );
    assert.equal(staleScan.status, 409);
    assert.equal(scanCalls, 1);

    allowed = false;
    const denied = await post(
      `/api/v1/artifacts/${artifact.id}/commands/review`,
      "denied-review",
      {
        expected_version: 2,
        decision: "APPROVE",
        reason: "Not permitted",
      },
    );
    assert.equal(denied.status, 403);
    allowed = true;

    const approved = await post(
      `/api/v1/artifacts/${artifact.id}/commands/review`,
      "artifact-review",
      {
        expected_version: 2,
        decision: "APPROVE",
        reason: "Security review passed",
      },
    );
    assert.equal(approved.status, 200);
    const approval = (
      (await approved.json()) as { data: { version: number; state: string } }
    ).data;
    assert.equal(approval.state, "APPROVED");
    const activated = await post(
      `/api/v1/artifacts/${artifact.id}/commands/activate`,
      "artifact-activate",
      {
        expected_version: approval.version,
        reason: "Approved package is ready for catalog publication",
      },
    );
    assert.equal(activated.status, 200);
    const active = ((await activated.json()) as { data: { version: number } })
      .data;

    const published = await post(
      `/api/v1/software/products/${product.id}/versions/${softwareVersion.id}/commands/publish`,
      "catalog-publish",
      {
        expected_version: 1,
        artifact_version_id: artifact.id,
        reason: "Approved version published",
      },
    );
    assert.equal(
      published.status,
      200,
      JSON.stringify(await published.clone().json()),
    );
    const visible = await post(
      `/api/v1/software/products/${product.id}/commands/visibility`,
      "catalog-visible",
      {
        expected_version: 2,
        visibility: "END_USER",
        self_service_allowed: true,
        reason: "Approved release is available for self-service",
      },
    );
    assert.equal(visible.status, 200);
    const productRead = await get("/api/v1/software/products");
    assert.equal(productRead.status, 200);
    const products = (
      (await productRead.json()) as {
        data: Array<{
          id: string;
          classification: string;
          published_version_id: string;
          self_service_allowed: boolean;
        }>;
      }
    ).data;
    assert.equal(products[0]!.classification, "APPROVED");
    assert.equal(products[0]!.published_version_id, softwareVersion.id);
    assert.equal(products[0]!.self_service_allowed, true);

    const restricted = await post(
      `/api/v1/artifacts/${artifact.id}/commands/restrict`,
      "artifact-restrict",
      {
        expected_version: active.version,
        reason: "Security policy changed",
      },
    );
    assert.equal(restricted.status, 200);
    const restrictedVersion = (
      (await restricted.json()) as { data: { version: number } }
    ).data.version;
    const revoked = await post(
      `/api/v1/artifacts/${artifact.id}/commands/revoke`,
      "artifact-revoke",
      {
        expected_version: restrictedVersion,
        reason: "Publisher withdrew this binary",
      },
    );
    assert.equal(revoked.status, 200);
    const afterRevoke = await get("/api/v1/software/products");
    const withdrawnProducts = (
      (await afterRevoke.json()) as {
        data: Array<{
          id: string;
          classification: string;
          published_version_id: string | null;
        }>;
      }
    ).data;
    assert.equal(withdrawnProducts[0]!.classification, "RESTRICTED");
    assert.equal(withdrawnProducts[0]!.published_version_id, null);
    const republishRevoked = await post(
      `/api/v1/software/products/${product.id}/versions/${softwareVersion.id}/commands/publish`,
      "republish-revoked",
      {
        expected_version: 4,
        artifact_version_id: artifact.id,
        reason: "Revoked artifacts cannot be republished",
      },
    );
    assert.equal(republishRevoked.status, 422);

    reviewScanner = true;
    const secondVersionResponse = await post(
      `/api/v1/software/products/${product.id}/versions`,
      "version-create-review",
      { version: "1.4.3", release_notes: "Requires manual scan review" },
    );
    assert.equal(secondVersionResponse.status, 201);
    const secondVersion = (
      (await secondVersionResponse.json()) as { data: { id: string } }
    ).data;
    principalId = uploader;
    const reviewArtifactResponse = await post(
      "/api/v1/artifacts",
      "review-intake",
      {
        software_version_id: secondVersion.id,
        filename: "editor-1.4.3.pkg",
        media_type: "application/octet-stream",
        size_bytes: 2048,
        source_type: "VENDOR_OFFICIAL",
        checksum_sha256: reviewChecksum,
        storage_ref: "artifact/review",
      },
    );
    assert.equal(reviewArtifactResponse.status, 201);
    principalId = reviewer;
    const reviewArtifact = (
      (await reviewArtifactResponse.json()) as { data: { id: string } }
    ).data;
    const needsReview = await post(
      `/api/v1/artifacts/${reviewArtifact.id}/commands/scan`,
      "manual-scan",
      { expected_version: 1 },
    );
    assert.equal(needsReview.status, 200);
    const scanReviewVersion = (
      (await needsReview.json()) as {
        data: { version: number; scan_status: string };
      }
    ).data;
    assert.equal(scanReviewVersion.scan_status, "NEEDS_REVIEW");
    const waiverMissingExpiry = await post(
      `/api/v1/artifacts/${reviewArtifact.id}/commands/review`,
      "waiver-no-expiry",
      {
        expected_version: scanReviewVersion.version,
        decision: "WAIVE",
        reason: "Documented temporary exception",
      },
    );
    assert.equal(
      waiverMissingExpiry.status,
      400,
      JSON.stringify(await waiverMissingExpiry.clone().json()),
    );
    const waived = await post(
      `/api/v1/artifacts/${reviewArtifact.id}/commands/review`,
      "waiver-valid",
      {
        expected_version: scanReviewVersion.version,
        decision: "WAIVE",
        reason: "Temporary approved exception",
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
    );
    assert.equal(
      waived.status,
      200,
      JSON.stringify(await waived.clone().json()),
    );
    const waivedData = ((await waived.json()) as { data: { version: number } })
      .data;
    const waiverActivated = await post(
      `/api/v1/artifacts/${reviewArtifact.id}/commands/activate`,
      "waiver-activate",
      {
        expected_version: waivedData.version,
        reason: "Activate time-limited approved waiver",
      },
    );
    assert.equal(waiverActivated.status, 200);
    const waiverPublish = await post(
      `/api/v1/software/products/${product.id}/versions/${secondVersion.id}/commands/publish`,
      "waiver-publish",
      {
        expected_version: 4,
        artifact_version_id: reviewArtifact.id,
        reason: "Publish waived version",
      },
    );
    assert.equal(waiverPublish.status, 200);

    const thirdVersionResponse = await post(
      `/api/v1/software/products/${product.id}/versions`,
      "version-create-signature-pending",
      { version: "1.4.4", release_notes: "Signature provider unavailable" },
    );
    assert.equal(thirdVersionResponse.status, 201);
    const thirdVersion = (
      (await thirdVersionResponse.json()) as { data: { id: string } }
    ).data;
    principalId = uploader;
    const signaturePendingIntake = await post(
      "/api/v1/artifacts",
      "signature-pending-intake",
      {
        software_version_id: thirdVersion.id,
        filename: "editor-1.4.4.pkg",
        media_type: "application/octet-stream",
        size_bytes: 2048,
        source_type: "VENDOR_OFFICIAL",
        checksum_sha256: "d".repeat(64),
        storage_ref: "artifact/signature-missing",
      },
    );
    assert.equal(signaturePendingIntake.status, 201);
    const signaturePendingArtifact = (
      (await signaturePendingIntake.json()) as { data: { id: string } }
    ).data;
    principalId = reviewer;
    delete adapters.signatureVerifier;
    const signaturePendingScan = await post(
      `/api/v1/artifacts/${signaturePendingArtifact.id}/commands/scan`,
      "signature-provider-absent-scan",
      { expected_version: 1 },
    );
    assert.equal(signaturePendingScan.status, 200);
    const signaturePendingState = (
      (await signaturePendingScan.json()) as {
        data: { version: number; signature_status: string };
      }
    ).data;
    assert.equal(signaturePendingState.signature_status, "PENDING");
    const signaturePendingApproval = await post(
      `/api/v1/artifacts/${signaturePendingArtifact.id}/commands/review`,
      "signature-provider-absent-review",
      {
        expected_version: signaturePendingState.version,
        decision: "APPROVE",
        reason: "Missing signature verification must block approval",
      },
    );
    assert.equal(signaturePendingApproval.status, 422);
    const prohibitProduct = await post(
      `/api/v1/software/products/${product.id}/commands/classification`,
      "product-prohibit",
      {
        expected_version: 5,
        classification: "PROHIBITED",
        reason: "Policy forbids further use of this software",
      },
    );
    assert.equal(prohibitProduct.status, 200);
    const prohibited = (
      (await prohibitProduct.json()) as {
        data: { classification: string };
      }
    ).data;
    assert.equal(prohibited.classification, "PROHIBITED");

    tenant = "tenant-b";
    const foreignArtifact = await get(`/api/v1/artifacts/${artifact.id}`);
    assert.equal(foreignArtifact.status, 404);
    tenant = "tenant-a";

    const evidence = await db.pool.query(
      "SELECT result_type FROM artifact.artifact_scan_results WHERE tenant_id='tenant-a' AND artifact_version_id=$1 ORDER BY created_at,id",
      [reviewArtifact.id],
    );
    assert.deepEqual(
      evidence.rows.map((row) => row.result_type).sort(),
      ["SCAN", "SIGNATURE", "WAIVER"].sort(),
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE artifact.artifact_versions SET checksum_sha256=$1 WHERE tenant_id='tenant-a' AND id=$2",
        ["d".repeat(64), artifact.id],
      ),
      /immutable/i,
    );
    await assert.rejects(
      db.pool.query(
        "DELETE FROM artifact.artifact_versions WHERE tenant_id='tenant-a' AND id=$1",
        [artifact.id],
      ),
      /cannot be deleted/i,
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE artifact.artifact_scan_results SET reason='changed' WHERE tenant_id='tenant-a' AND artifact_version_id=$1",
        [reviewArtifact.id],
      ),
      /append-only/i,
    );
    const emitted = await db.pool.query(
      "SELECT event_type FROM platform.outbox_events WHERE tenant_id='tenant-a' ORDER BY created_at,event_id",
    );
    const eventTypes = emitted.rows.map((row) => row.event_type);
    for (const event of [
      "SOFTWARE.CATALOG_ITEM_CREATED",
      "SOFTWARE.VERSION_CREATED",
      "SOFTWARE.CATALOG_VERSION_PUBLISHED",
      "SOFTWARE.CATALOG_VISIBILITY_CHANGED",
      "SOFTWARE.CLASSIFICATION_CHANGED",
      "SOFTWARE.CATALOG_VERSION_WITHDRAWN",
      "ARTIFACT.UPLOADED",
      "ARTIFACT.INTEGRITY_MISMATCH",
      "ARTIFACT.SCAN_PASSED",
      "ARTIFACT.SIGNATURE_VALIDATED",
      "ARTIFACT.APPROVED",
      "ARTIFACT.ACTIVATED",
      "ARTIFACT.RESTRICTED",
      "ARTIFACT.REVOKED",
      "ARTIFACT.SCAN_REVIEW_REQUIRED",
    ])
      assert.ok(eventTypes.includes(event), `missing event ${event}`);
    const audits = await db.pool.query(
      "SELECT count(*)::int AS count FROM audit.audit_events WHERE tenant_id='tenant-a' AND subject->>'entity_id' IN ($1,$2,$3)",
      [product.id, artifact.id, reviewArtifact.id],
    );
    assert.ok(Number(audits.rows[0]!.count) >= 10);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
