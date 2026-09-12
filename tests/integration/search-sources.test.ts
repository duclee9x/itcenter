import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  findSearchCandidates,
  reindexSearchPage,
  type SearchEntityType,
} from "../../modules/search/index.js";
import { testDatabase } from "../helpers.js";

test("search projection reads implemented P3 canonical sources and site scopes", async () => {
  const db = await testDatabase();
  const tenant = "tenant-search-sources";
  const userId = randomUUID();
  const assetId = randomUUID();
  const incidentId = randomUUID();
  const discoveryId = randomUUID();
  const observationId = randomUUID();
  const productId = randomUUID();
  const entitlementId = randomUUID();
  const siteId = randomUUID();
  const locationId = randomUUID();
  try {
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
         VALUES($1,$2,'USR-P3','p3-user','P3 Search User','ACTIVE')`,
        [userId, tenant],
      );
      const categoryId = randomUUID();
      const modelId = randomUUID();
      await tx.query(
        "INSERT INTO asset.locations(id,tenant_id,code,name,type) VALUES($1,$2,'SITE-P3','P3 Site','SITE')",
        [siteId, tenant],
      );
      await tx.query(
        `INSERT INTO asset.locations(id,tenant_id,code,name,type,parent_id)
         VALUES($1,$2,'ROOM-P3','P3 Room','ROOM',$3)`,
        [locationId, tenant, siteId],
      );
      await tx.query(
        "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Compute')",
        [categoryId, tenant],
      );
      await tx.query(
        `INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id)
         VALUES($1,$2,'Acme','Node 4',$3)`,
        [modelId, tenant, categoryId],
      );
      await tx.query(
        `INSERT INTO asset.assets(id,tenant_id,asset_code,serial_number,asset_model_id,current_location_id)
         VALUES($1,$2,'AST-P3-0042','SN-123-45',$3,$4)`,
        [assetId, tenant, modelId, locationId],
      );
      await tx.query(
        `INSERT INTO incident.incidents(id,tenant_id,incident_code,title,source,priority)
         VALUES($1,$2,'INC-P3-0042','P3 database unavailable','MONITORING','P2')`,
        [incidentId, tenant],
      );
      await tx.query(
        "INSERT INTO network.discovery_jobs(id,tenant_id,source_type) VALUES($1,$2,'SNMP')",
        [discoveryId, tenant],
      );
      await tx.query(
        `INSERT INTO network.observations(id,tenant_id,discovery_job_id,source_type,source,
           source_event_id,observed_at,asset_id,ip,mac,hostname,vendor,model,confidence)
         VALUES($1,$2,$3,'SNMP','fixture',$4,now(),$5,'10.20.30.40','00:1B:44:11:3A:B7',
           'db-node-p3','Acme','Switch 8','HIGH')`,
        [observationId, tenant, discoveryId, randomUUID(), assetId],
      );
      await tx.query(
        `INSERT INTO software.software_products(id,tenant_id,product_code,name,vendor,category,owner_id,support_team)
         VALUES($1,$2,'SW-P3-DB','Database Client','Acme','DATABASE','it-owner','it-support')`,
        [productId, tenant],
      );
      await tx.query(
        `INSERT INTO license.license_entitlements(id,tenant_id,software_product_id,license_type,
           quantity,created_by)
         VALUES($1,$2,$3,'SUBSCRIPTION',25,'fixture')`,
        [entitlementId, tenant, productId],
      );
      await tx.query(
        `INSERT INTO license.entitlement_terms(id,tenant_id,entitlement_id,term_version,
           valid_from,valid_until,recorded_by,reason)
         VALUES($1,$2,$3,1,now()-interval '1 day',now()+interval '30 days','fixture','Search fixture')`,
        [randomUUID(), tenant, entitlementId],
      );
    });

    const types: SearchEntityType[] = [
      "ASSET",
      "USER",
      "INCIDENT",
      "NETWORK_DEVICE",
      "SOFTWARE_PRODUCT",
      "LICENSE_ENTITLEMENT",
    ];
    await db.uow.run(tenant, async (tx) => {
      for (const type of types) {
        const page = await reindexSearchPage({ tx, type, limit: 20 });
        assert.equal(page.indexed, 1, type);
        assert.equal(page.next_id, null, type);
      }

      const checks: [string, SearchEntityType, string][] = [
        ["SN-123-45", "ASSET", assetId],
        ["USR-P3", "USER", userId],
        ["INC-P3-0042", "INCIDENT", incidentId],
        ["10.20.30.40", "NETWORK_DEVICE", observationId],
        ["Database Client", "SOFTWARE_PRODUCT", productId],
        ["SW-P3-DB", "LICENSE_ENTITLEMENT", entitlementId],
      ];
      for (const [q, type, entityId] of checks) {
        const rows = await findSearchCandidates({
          tx,
          q,
          types: [type],
          limit: 10,
          ...(type === "ASSET" || type === "NETWORK_DEVICE" ? { siteId } : {}),
        });
        assert.ok(
          rows.some((row) => row.entity_id === entityId),
          `${type}: ${q}`,
        );
      }
    });
  } finally {
    await db.close();
  }
});
