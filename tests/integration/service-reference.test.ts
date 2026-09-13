import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "../helpers.js";
import {
  createPlatform,
  createService,
  createServiceEnvironment,
  deactivateCatalog,
  readPlatform,
  readService,
  readServiceEnvironment,
  resolveObservedPlatform,
  serviceQueryPort,
  platformQueryPort,
  serviceEnvironmentQueryPort,
  updateCatalog,
} from "../../modules/service/index.js";
import { createIncident } from "../../modules/incident/index.js";
import { permissions, seedPermissions } from "../../modules/identity/index.js";

test("canonical Service, Platform and Environment are tenant-owned references", async () => {
  const db = await testDatabase();
  const tenant = `service-${randomUUID()}`;
  try {
    const service = await db.uow.run(tenant, (tx) =>
      createService({ tx, key: "ERP", name: "Enterprise Resource Planning" }),
    );
    assert.equal(service.state, "ACTIVE");
    const scopedService = await db.uow.run(tenant, (tx) =>
      serviceQueryPort(tx).get(tenant, service.id),
    );
    assert.equal(scopedService?.state, "ACTIVE");
    const crossTenantService = await db.uow.run(tenant, (tx) =>
      serviceQueryPort(tx).get(`${tenant}-other`, service.id),
    );
    assert.equal(crossTenantService, null);
    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        createService({ tx, key: "ERP", name: "Duplicate key" }),
      ),
      (error: { code?: string }) => error.code === "BUSINESS_RULE_VIOLATION",
    );
    await assert.rejects(
      db.uow.run(`${tenant}-other`, (tx) => readService(tx, service.id)),
      (error: { code?: string }) => error.code === "NOT_FOUND",
    );

    const environment = await db.uow.run(tenant, (tx) =>
      createServiceEnvironment({
        tx,
        serviceId: service.id,
        key: "PRODUCTION",
        name: "Production",
      }),
    );
    assert.equal(environment.service_id, service.id);
    assert.equal(
      (
        await db.uow.run(tenant, (tx) =>
          serviceEnvironmentQueryPort(tx).get(tenant, environment.id),
        )
      )?.service_id,
      service.id,
    );
    const environmentUpdate = await db.uow.run(tenant, (tx) =>
      updateCatalog({
        tx,
        kind: "SERVICE_ENVIRONMENT",
        id: environment.id,
        expectedVersion: 1,
        changes: { name: "Production EU" },
      }),
    );
    assert.equal(environmentUpdate.version, 2);
    assert.equal(
      (
        await db.uow.run(tenant, (tx) =>
          readServiceEnvironment(tx, environment.id),
        )
      ).name,
      "Production EU",
    );
    const inactiveEnvironment = await db.uow.run(tenant, (tx) =>
      deactivateCatalog({
        tx,
        kind: "SERVICE_ENVIRONMENT",
        id: environment.id,
        expectedVersion: 2,
      }),
    );
    assert.equal(inactiveEnvironment.after.state, "INACTIVE");
    await assert.rejects(
      db.uow.run(`${tenant}-other`, (tx) =>
        createServiceEnvironment({
          tx,
          serviceId: service.id,
          key: "PRODUCTION",
          name: "Production",
        }),
      ),
      (error: { code?: string }) => error.code === "NOT_FOUND",
    );
    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        createServiceEnvironment({
          tx,
          serviceId: "unvalidated-service-name",
          key: "STAGING",
          name: "Staging",
        }),
      ),
      (error: { code?: string }) => error.code === "VALIDATION_ERROR",
    );

    const platform = await db.uow.run(tenant, (tx) =>
      createPlatform({
        tx,
        key: "WINDOWS_SERVER_2025",
        family: "WINDOWS",
        name: "Windows Server 2025",
        majorVersion: "2025",
      }),
    );
    const resolved = await db.uow.run(tenant, (tx) =>
      resolveObservedPlatform({ tx, observed: " Windows   Server 2025 " }),
    );
    assert.equal(resolved.status, "RESOLVED");
    if (resolved.status === "RESOLVED")
      assert.equal(resolved.platform.id, platform.id);
    assert.equal(
      (
        await db.uow.run(tenant, (tx) =>
          platformQueryPort(tx).get(tenant, platform.id),
        )
      )?.state,
      "ACTIVE",
    );
    const unknown = await db.uow.run(tenant, (tx) =>
      resolveObservedPlatform({
        tx,
        observed: "Ubuntu 99 (unconfigured build)",
      }),
    );
    assert.deepEqual(unknown, { status: "UNRESOLVED" });
    const ambiguousPlatform = await db.uow.run(tenant, (tx) =>
      createPlatform({
        tx,
        key: "WIN-SRV-ALIAS",
        family: "WINDOWS",
        name: "Windows Server 2025",
        majorVersion: "2025",
      }),
    );
    const ambiguousResolution = await db.uow.run(tenant, (tx) =>
      resolveObservedPlatform({ tx, observed: "Windows Server 2025" }),
    );
    assert.deepEqual(ambiguousResolution, { status: "UNRESOLVED" });
    const platformUpdate = await db.uow.run(tenant, (tx) =>
      updateCatalog({
        tx,
        kind: "PLATFORM",
        id: platform.id,
        expectedVersion: 1,
        changes: { major_version: "2025-LTS" },
      }),
    );
    assert.equal(platformUpdate.version, 2);
    assert.equal(
      (await db.uow.run(tenant, (tx) => readPlatform(tx, platform.id))).name,
      "Windows Server 2025",
    );
    const inactivePlatform = await db.uow.run(tenant, (tx) =>
      deactivateCatalog({
        tx,
        kind: "PLATFORM",
        id: platform.id,
        expectedVersion: 2,
      }),
    );
    assert.equal(inactivePlatform.after.state, "INACTIVE");
    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        createPlatform({
          tx,
          key: "BAD-FAMILY",
          family: "MYSTERY" as "WINDOWS",
          name: "Bad Platform",
        }),
      ),
      (error: { code?: string }) => error.code === "VALIDATION_ERROR",
    );
    assert.ok(ambiguousPlatform.id);

    const updated = await db.uow.run(tenant, (tx) =>
      updateCatalog({
        tx,
        kind: "SERVICE",
        id: service.id,
        expectedVersion: 1,
        changes: { name: "ERP Service" },
      }),
    );
    assert.equal(updated.version, 2);
    const deactivated = await db.uow.run(tenant, (tx) =>
      deactivateCatalog({
        tx,
        kind: "SERVICE",
        id: service.id,
        expectedVersion: 2,
      }),
    );
    assert.equal(deactivated.after.state, "INACTIVE");
    assert.equal(deactivated.after.version, 3);
    const history = await db.uow.run(tenant, (tx) =>
      readService(tx, service.id),
    );
    assert.equal(history.state, "INACTIVE");
  } finally {
    await db.close();
  }
});

test("Incident accepts canonical same-tenant Service IDs and rejects unchecked or cross-tenant IDs", async () => {
  const db = await testDatabase();
  const tenant = `incident-service-${randomUUID()}`;
  try {
    const service = await db.uow.run(tenant, (tx) =>
      createService({ tx, key: "VPN", name: "VPN" }),
    );
    const incident = await db.uow.run(tenant, (tx) =>
      createIncident({
        tx,
        incidentCode: "INC-SVC-1",
        title: "VPN unavailable",
        source: "TEST",
        priority: "P2",
        serviceId: service.id,
      }),
    );
    const reference = await db.uow.run(tenant, async (tx) =>
      tx.query(
        "SELECT service_id,legacy_service_id FROM incident.incidents WHERE tenant_id=$1 AND id=$2",
        [tenant, incident.id],
      ),
    );
    assert.equal(reference.rows[0]!.service_id, service.id);
    assert.equal(reference.rows[0]!.legacy_service_id, null);

    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        createIncident({
          tx,
          incidentCode: "INC-SVC-2",
          title: "Unknown Service",
          source: "TEST",
          priority: "P2",
          serviceId: randomUUID(),
        }),
      ),
      (error: { code?: string }) => error.code === "VALIDATION_ERROR",
    );
  } finally {
    await db.close();
  }
});

test("reference and Knowledge read permission codes seed without granting roles", async () => {
  const db = await testDatabase();
  const tenant = `service-permissions-${randomUUID()}`;
  try {
    await db.uow.run(tenant, (tx) => seedPermissions(tx, permissions));
    const result = await db.pool.query(
      `SELECT p.code, count(rp.role_id)::int AS grants
       FROM identity.permissions p
       LEFT JOIN identity.role_permissions rp ON rp.permission_id=p.id
       WHERE p.code = ANY($1::text[])
       GROUP BY p.code ORDER BY p.code`,
      [
        [
          "knowledge.read",
          "knowledge.read.operator",
          "service.read",
          "service.manage",
          "platform.read",
          "platform.manage",
          "service_environment.read",
          "service_environment.manage",
        ],
      ],
    );
    assert.equal(result.rowCount, 8);
    assert.ok(result.rows.every((row) => row.grants === 0));
  } finally {
    await db.close();
  }
});
