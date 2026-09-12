import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

const gracePeriodMs = 72 * 60 * 60 * 1000;
const classifications = [
  "APPROVED",
  "RESTRICTED",
  "PROHIBITED",
  "UNKNOWN",
  "DEPRECATED",
  "RETIRED",
] as const;

export type SoftwareInventoryItem = {
  name: string;
  publisher?: string;
  version?: string;
  install_date?: string;
  install_scope?: string;
  package_identifier?: string;
  product_code?: string;
};

function requiredText(value: unknown, field: string, max = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  return value.trim();
}

function optionalText(value: unknown, field: string, max = 256) {
  if (value === undefined || value === null || value === "") return "";
  return requiredText(value, field, max);
}

export function normalizeSoftwareName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeItems(
  items: unknown,
): Array<Required<SoftwareInventoryItem>> {
  if (!Array.isArray(items) || items.length > 10000)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "software inventory must be an array of at most 10000 entries.",
    );
  return items.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `software inventory entry ${index} must be an object.`,
      );
    const item = raw as Record<string, unknown>;
    const allowed = [
      "name",
      "product_name",
      "publisher",
      "version",
      "install_date",
      "installed_at",
      "install_scope",
      "package_identifier",
      "product_code",
    ];
    if (Object.keys(item).some((key) => !allowed.includes(key)))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `software inventory entry ${index} has unsupported fields.`,
      );
    const name = requiredText(item.name ?? item.product_name, "name", 256);
    const installDate = optionalText(
      item.install_date ?? item.installed_at,
      "install_date",
      64,
    );
    if (installDate && !Number.isFinite(Date.parse(installDate)))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `software inventory entry ${index} has an invalid install_date.`,
      );
    return {
      name,
      publisher: optionalText(item.publisher, "publisher", 256),
      version: optionalText(item.version, "version", 128),
      install_date: installDate,
      install_scope:
        optionalText(item.install_scope, "install_scope", 32) || "DEVICE",
      package_identifier: optionalText(
        item.package_identifier,
        "package_identifier",
        256,
      ),
      product_code: optionalText(item.product_code, "product_code", 128),
    };
  });
}

type Product = {
  id: string;
  product_code: string;
  name: string;
  vendor: string;
  classification: (typeof classifications)[number];
  owner_id: string;
};

async function loadProducts(tx: Transaction) {
  const result = await tx.query(
    `SELECT p.id,p.product_code,p.name,p.vendor,p.classification,p.owner_id,
            a.normalized_alias
       FROM software.software_products p
       LEFT JOIN software.product_aliases a
         ON a.tenant_id=p.tenant_id AND a.product_id=p.id
      WHERE p.tenant_id=$1`,
    [tx.tenantId],
  );
  const names = new Map<string, Product[]>();
  for (const row of result.rows) {
    const product: Product = {
      id: String(row.id),
      product_code: String(row.product_code),
      name: String(row.name),
      vendor: String(row.vendor),
      classification: String(row.classification) as Product["classification"],
      owner_id: String(row.owner_id),
    };
    for (const candidate of [
      normalizeSoftwareName(product.name),
      normalizeSoftwareName(product.product_code),
      ...(row.normalized_alias ? [String(row.normalized_alias)] : []),
    ]) {
      const existing = names.get(candidate) ?? [];
      if (!existing.some((item) => item.id === product.id))
        names.set(candidate, [...existing, product]);
    }
  }
  return names;
}

async function appendExceptionHistory(input: {
  tx: Transaction;
  exceptionId: string;
  fromState: string | null;
  toState: string;
  actorId: string;
  reason: string;
  evidence?: Record<string, unknown>;
  version: number;
}) {
  await input.tx.query(
    `INSERT INTO software.software_exception_history
       (id,tenant_id,exception_id,from_state,to_state,actor_id,reason,evidence,version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.exceptionId,
      input.fromState,
      input.toState,
      input.actorId,
      input.reason,
      JSON.stringify(input.evidence ?? {}),
      input.version,
    ],
  );
}

async function recordDetection(input: {
  tx: Transaction;
  installationId: string;
  generation: number;
  classification: Product["classification"] | "UNKNOWN";
  ownerId: string;
  actorId: string;
  now: Date;
  explicitReview?: boolean;
}) {
  const installation = await input.tx.query(
    "SELECT first_seen_at FROM software.inventory_installations WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.installationId],
  );
  if (!installation.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Software installation was not found.",
    );
  const shouldDetect =
    input.classification === "PROHIBITED" ||
    input.classification === "RESTRICTED" ||
    (input.classification === "UNKNOWN" &&
      (input.explicitReview === true ||
        input.now.getTime() -
          new Date(installation.rows[0]!.first_seen_at as Date).getTime() >=
          gracePeriodMs));
  if (!shouldDetect) return null;
  const active = await input.tx.query(
    `SELECT id,state,approved_until,approval_request_id,version FROM software.software_exceptions
      WHERE tenant_id=$1 AND installation_id=$2 AND installation_generation=$3
        AND state NOT IN ('RESOLVED','FALSE_POSITIVE') FOR UPDATE`,
    [input.tx.tenantId, input.installationId, input.generation],
  );
  if (active.rowCount) {
    const row = active.rows[0]!;
    if (row.state === "WAITING_APPROVAL" && row.approval_request_id) {
      const approval = await input.tx.query(
        `SELECT state FROM control.approval_requests
          WHERE tenant_id=$1 AND id=$2`,
        [input.tx.tenantId, row.approval_request_id],
      );
      if (!approval.rowCount || approval.rows[0]!.state !== "PENDING") {
        const version = Number(row.version) + 1;
        await input.tx.query(
          `UPDATE software.software_exceptions
              SET state='OPEN',approval_request_id=NULL,approved_until=NULL,
                  reason='Approval did not grant the requested exception.',
                  last_detected_at=$1,version=$2,updated_at=now()
            WHERE tenant_id=$3 AND id=$4`,
          [input.now.toISOString(), version, input.tx.tenantId, row.id],
        );
        await appendExceptionHistory({
          tx: input.tx,
          exceptionId: String(row.id),
          fromState: "WAITING_APPROVAL",
          toState: "OPEN",
          actorId: input.actorId,
          reason: "Approval did not grant the requested exception.",
          evidence: { approval_state: approval.rows[0]?.state ?? "MISSING" },
          version,
        });
        return {
          kind: "REOPENED" as const,
          exception_id: String(row.id),
          version,
          reason: "Approval did not grant the requested exception.",
        };
      }
    }
    if (
      row.state === "APPROVED_TEMPORARY" &&
      new Date(row.approved_until as Date).getTime() <= input.now.getTime()
    ) {
      const version = Number(row.version) + 1;
      await input.tx.query(
        `UPDATE software.software_exceptions
            SET state='OPEN',approved_until=NULL,approval_request_id=NULL,
                reason='Temporary exception expired while installation remains present.',
                last_detected_at=$1,version=$2,updated_at=now()
          WHERE tenant_id=$3 AND id=$4`,
        [input.now.toISOString(), version, input.tx.tenantId, row.id],
      );
      await appendExceptionHistory({
        tx: input.tx,
        exceptionId: String(row.id),
        fromState: "APPROVED_TEMPORARY",
        toState: "OPEN",
        actorId: input.actorId,
        reason: "Temporary exception expired; installation remains detected.",
        evidence: { previous_approval_expired: true },
        version,
      });
      return {
        kind: "REOPENED" as const,
        exception_id: String(row.id),
        version,
        reason:
          "Temporary exception expired while installation remains present.",
      };
    }
    return null;
  }
  const terminal = await input.tx.query(
    `SELECT state FROM software.software_exceptions
      WHERE tenant_id=$1 AND installation_id=$2 AND installation_generation=$3
        AND state IN ('RESOLVED','FALSE_POSITIVE')
      ORDER BY updated_at DESC LIMIT 1`,
    [input.tx.tenantId, input.installationId, input.generation],
  );
  if (terminal.rowCount) return null;
  const id = randomUUID();
  const version = 1;
  const reason = `Unauthorized installation detected: ${input.classification}.`;
  await input.tx.query(
    `INSERT INTO software.software_exceptions
       (id,tenant_id,installation_id,installation_generation,state,owner_id,reason,risk)
     VALUES($1,$2,$3,$4,'OPEN',$5,$6,$7)`,
    [
      id,
      input.tx.tenantId,
      input.installationId,
      input.generation,
      input.ownerId,
      reason,
      input.classification === "PROHIBITED" ? "HIGH" : "MEDIUM",
    ],
  );
  await appendExceptionHistory({
    tx: input.tx,
    exceptionId: id,
    fromState: null,
    toState: "OPEN",
    actorId: input.actorId,
    reason,
    evidence: { classification: input.classification },
    version,
  });
  return {
    kind: "CREATED" as const,
    exception_id: id,
    version,
    reason,
  };
}

export async function ingestSoftwareInventory(input: {
  tx: Transaction;
  agentId: string;
  items: unknown;
  inventoryComplete: boolean;
  observedAt: string;
}) {
  if (typeof input.inventoryComplete !== "boolean")
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "inventory_complete must be boolean.",
    );
  const observedMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedMs) || observedMs > Date.now() + 300_000)
    throw new ApplicationError("VALIDATION_ERROR", "observed_at is invalid.");
  const items = normalizeItems(input.items);
  const agent = await input.tx.query(
    `SELECT id,asset_id FROM agent.agents
      WHERE tenant_id=$1 AND id=$2 AND status IN ('ONLINE','DEGRADED') FOR UPDATE`,
    [input.tx.tenantId, input.agentId],
  );
  if (!agent.rowCount)
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Inventory agent is not enrolled in this tenant or is not active.",
    );
  const agentRow = agent.rows[0]!;
  const now = new Date();
  const latestReport = await input.tx.query(
    `SELECT max(observed_at) AS observed_at FROM software.inventory_reports
      WHERE tenant_id=$1 AND asset_id=$2`,
    [input.tx.tenantId, agentRow.asset_id],
  );
  if (
    latestReport.rows[0]!.observed_at &&
    observedMs < new Date(latestReport.rows[0]!.observed_at as Date).getTime()
  )
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Inventory report is older than the last complete report for this asset.",
    );
  const products = await loadProducts(input.tx);
  const reportId = randomUUID();
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(items))
    .digest("hex");
  await input.tx.query(
    `INSERT INTO software.inventory_reports
       (id,tenant_id,agent_id,asset_id,observed_at,inventory_complete,item_count,payload_sha256)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      reportId,
      input.tx.tenantId,
      input.agentId,
      agentRow.asset_id,
      new Date(observedMs).toISOString(),
      input.inventoryComplete,
      items.length,
      payloadHash,
    ],
  );

  const seenIds: string[] = [];
  const facts: Array<Record<string, unknown>> = [];
  const exceptionChanges: Array<Record<string, unknown>> = [];
  const resolvedExceptionIds: string[] = [];
  const identities = new Set<string>();
  facts.push({
    type: "SOFTWARE.INVENTORY_NORMALIZED",
    aggregate_type: "SOFTWARE_INVENTORY_REPORT",
    aggregate_id: reportId,
    version: 1,
    payload: {
      inventory_report_id: reportId,
      asset_id: String(agentRow.asset_id),
      agent_id: input.agentId,
      inventory_complete: input.inventoryComplete,
      item_count: items.length,
      payload_sha256: payloadHash,
    },
  });
  for (const item of items) {
    const normalizedName = normalizeSoftwareName(item.name);
    const productCode = normalizeSoftwareName(item.product_code);
    const candidates = [
      ...(products.get(normalizedName) ?? []),
      ...(productCode ? (products.get(productCode) ?? []) : []),
    ].filter(
      (product, index, all) =>
        all.findIndex((p) => p.id === product.id) === index,
    );
    const publisher = item.publisher.trim();
    const vendorMatches = publisher
      ? candidates.filter(
          (product) =>
            normalizeSoftwareName(product.vendor) ===
            normalizeSoftwareName(publisher),
        )
      : candidates;
    const product =
      vendorMatches.length === 1
        ? vendorMatches[0]!
        : candidates.length === 1 && !publisher
          ? candidates[0]!
          : null;
    const classification = product?.classification ?? "UNKNOWN";
    const installScope = item.install_scope.toUpperCase();
    if (!/^[A-Z][A-Z0-9_-]{0,31}$/.test(installScope))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "install_scope contains unsupported characters.",
      );
    const identity = [
      product?.id ?? normalizedName,
      item.version.toLowerCase(),
      item.package_identifier.toLowerCase(),
      installScope,
    ].join("\u001f");
    if (identities.has(identity))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Inventory contains duplicate installation identities.",
      );
    identities.add(identity);
    const normalizedKey = createHash("sha256").update(identity).digest("hex");
    const installedAt = item.install_date
      ? new Date(item.install_date).toISOString()
      : null;
    const result = await input.tx.query(
      `INSERT INTO software.inventory_installations
         (id,tenant_id,asset_id,product_id,normalized_key,normalized_name,publisher,
          version_label,installed_at,install_scope,package_identifier,classification,
          state,first_seen_at,last_seen_at,last_report_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PRESENT',$13,$14,$15)
       ON CONFLICT(tenant_id,asset_id,normalized_key) DO UPDATE SET
         product_id=EXCLUDED.product_id,normalized_name=EXCLUDED.normalized_name,
         publisher=EXCLUDED.publisher,version_label=EXCLUDED.version_label,
         installed_at=EXCLUDED.installed_at,install_scope=EXCLUDED.install_scope,
         package_identifier=EXCLUDED.package_identifier,
         classification=EXCLUDED.classification,state='PRESENT',
         detection_generation=software.inventory_installations.detection_generation+
           CASE WHEN software.inventory_installations.state='REMOVED' THEN 1 ELSE 0 END,
         first_seen_at=CASE WHEN software.inventory_installations.state='REMOVED'
           THEN EXCLUDED.first_seen_at ELSE software.inventory_installations.first_seen_at END,
         last_seen_at=EXCLUDED.last_seen_at,last_report_id=EXCLUDED.last_report_id,
         version=software.inventory_installations.version+1,updated_at=now()
       RETURNING id,detection_generation,first_seen_at,classification`,
      [
        randomUUID(),
        input.tx.tenantId,
        agentRow.asset_id,
        product?.id ?? null,
        normalizedKey,
        product?.name ?? item.name,
        publisher,
        item.version,
        installedAt,
        installScope,
        item.package_identifier,
        classification,
        now.toISOString(),
        new Date(observedMs).toISOString(),
        reportId,
      ],
    );
    const installation = result.rows[0]!;
    const installationId = String(installation.id);
    seenIds.push(installationId);
    await input.tx.query(
      `INSERT INTO software.inventory_observations
         (id,tenant_id,report_id,installation_id,observed_name,observed_version,classification)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        input.tx.tenantId,
        reportId,
        installationId,
        item.name,
        item.version,
        classification,
      ],
    );
    const detection = await recordDetection({
      tx: input.tx,
      installationId,
      generation: Number(installation.detection_generation),
      classification,
      ownerId: product?.owner_id ?? "SOFTWARE_SECURITY",
      actorId: input.agentId,
      now,
    });
    if (detection?.kind === "CREATED") {
      exceptionChanges.push(detection);
      facts.push({
        type: "SOFTWARE.UNAUTHORIZED_DETECTED",
        aggregate_type: "SOFTWARE_EXCEPTION",
        aggregate_id: detection.exception_id,
        version: detection.version,
        payload: {
          software_exception_id: detection.exception_id,
          asset_id: String(agentRow.asset_id),
          software_product_id: product?.id ?? null,
          detected_version: item.version,
          classification,
          installation_id: installationId,
        },
      });
    } else if (detection?.kind === "REOPENED") {
      exceptionChanges.push(detection);
      facts.push({
        type: "SOFTWARE.EXCEPTION_UPDATED",
        aggregate_type: "SOFTWARE_EXCEPTION",
        aggregate_id: detection.exception_id,
        version: detection.version,
        payload: {
          software_exception_id: detection.exception_id,
          state: "OPEN",
          version: detection.version,
          reason: detection.reason,
          approval_request_id: null,
          approved_until: null,
        },
      });
    }
  }

  if (input.inventoryComplete) {
    const removed = await input.tx.query(
      `UPDATE software.inventory_installations
          SET state='REMOVED',version=version+1,updated_at=now()
        WHERE tenant_id=$1 AND asset_id=$2 AND state='PRESENT'
          AND NOT (id=ANY($3::uuid[]))
        RETURNING id,normalized_name,product_id`,
      [input.tx.tenantId, agentRow.asset_id, seenIds],
    );
    for (const installation of removed.rows) {
      const pending = await input.tx.query(
        `SELECT id,version,state FROM software.software_exceptions
          WHERE tenant_id=$1 AND installation_id=$2
            AND state NOT IN ('RESOLVED','FALSE_POSITIVE')
          FOR UPDATE`,
        [input.tx.tenantId, installation.id],
      );
      for (const exception of pending.rows) {
        const version = Number(exception.version) + 1;
        await input.tx.query(
          `UPDATE software.software_exceptions SET state='RESOLVED',approved_until=NULL,
             version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3`,
          [version, input.tx.tenantId, exception.id],
        );
        await appendExceptionHistory({
          tx: input.tx,
          exceptionId: String(exception.id),
          fromState: String(exception.state),
          toState: "RESOLVED",
          actorId: input.agentId,
          reason:
            "Complete inventory confirms software is no longer installed.",
          evidence: { inventory_report_id: reportId },
          version,
        });
        resolvedExceptionIds.push(String(exception.id));
        facts.push({
          type: "SOFTWARE.REMOVED",
          aggregate_type: "SOFTWARE_EXCEPTION",
          aggregate_id: String(exception.id),
          version,
          payload: {
            asset_id: String(agentRow.asset_id),
            software_product_id: installation.product_id,
            installation_id: String(installation.id),
            reason: "Verified absent in complete inventory.",
          },
        });
      }
    }
  }

  return {
    report_id: reportId,
    asset_id: String(agentRow.asset_id),
    dataset: "software",
    observed_at: new Date(observedMs).toISOString(),
    inventory_complete: input.inventoryComplete,
    item_count: items.length,
    payload_sha256: payloadHash,
    exception_changes: exceptionChanges,
    resolved_exception_ids: resolvedExceptionIds,
    facts,
  };
}

export async function createProductAlias(input: {
  tx: Transaction;
  productId: string;
  alias: string;
  actorId: string;
  reason: string;
}) {
  const alias = requiredText(input.alias, "alias");
  const normalized = normalizeSoftwareName(alias);
  if (!normalized)
    throw new ApplicationError("VALIDATION_ERROR", "alias is invalid.");
  const product = await input.tx.query(
    "SELECT id FROM software.software_products WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.productId],
  );
  if (!product.rowCount)
    throw new ApplicationError("NOT_FOUND", "Software product was not found.");
  try {
    const result = await input.tx.query(
      `INSERT INTO software.product_aliases
         (id,tenant_id,product_id,alias,normalized_alias,created_by,reason)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,product_id,alias,normalized_alias`,
      [
        randomUUID(),
        input.tx.tenantId,
        input.productId,
        alias,
        normalized,
        input.actorId,
        requiredText(input.reason, "reason", 2000),
      ],
    );
    return result.rows[0];
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "VERSION_CONFLICT",
        "This normalized software alias is already assigned.",
      );
    throw error;
  }
}

export async function createUninstallProfile(input: {
  tx: Transaction;
  productId: string;
  symbolicMethod: "MSI_PRODUCT_CODE" | "PACKAGE_IDENTIFIER" | "MANAGED_PACKAGE";
  autoRemovalAllowed: boolean;
  noBusinessDependencyAttested: boolean;
  ownerId: string;
  reason: string;
}) {
  if (input.autoRemovalAllowed && !input.noBusinessDependencyAttested)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Automatic removal requires an explicit no-business-dependency attestation.",
    );
  if (
    !["MSI_PRODUCT_CODE", "PACKAGE_IDENTIFIER", "MANAGED_PACKAGE"].includes(
      input.symbolicMethod,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "symbolic_method is invalid.",
    );
  const product = await input.tx.query(
    "SELECT id FROM software.software_products WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.productId],
  );
  if (!product.rowCount)
    throw new ApplicationError("NOT_FOUND", "Software product was not found.");
  const id = randomUUID();
  await input.tx.query(
    `INSERT INTO software.uninstall_profiles
       (id,tenant_id,product_id,symbolic_method,auto_removal_allowed,
        no_business_dependency_attested,owner_id,reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      input.tx.tenantId,
      input.productId,
      input.symbolicMethod,
      input.autoRemovalAllowed,
      input.noBusinessDependencyAttested,
      requiredText(input.ownerId, "owner_id", 256),
      requiredText(input.reason, "reason", 2000),
    ],
  );
  return { id, product_id: input.productId, state: "DRAFT", version: 1 };
}

export async function approveUninstallProfile(input: {
  tx: Transaction;
  profileId: string;
  expectedVersion: number;
  approvalRequestId: string;
  reason: string;
}) {
  const row = await input.tx.query(
    "SELECT id,state,version FROM software.uninstall_profiles WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.profileId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Uninstall profile was not found.");
  assertVersion(Number(row.rows[0]!.version), input.expectedVersion);
  const approval = await input.tx.query(
    `SELECT id FROM control.approval_requests
      WHERE tenant_id=$1 AND id=$2 AND source_type='SOFTWARE_UNINSTALL_PROFILE'
        AND source_id=$3 AND state='APPROVED'`,
    [input.tx.tenantId, input.approvalRequestId, input.profileId],
  );
  if (!approval.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "An approved, profile-bound approval request is required.",
    );
  if (row.rows[0]!.state !== "DRAFT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a draft uninstall profile can be approved.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    `UPDATE software.uninstall_profiles
        SET state='APPROVED',approval_request_id=$1,version=$2,updated_at=now()
      WHERE tenant_id=$3 AND id=$4`,
    [input.approvalRequestId, version, input.tx.tenantId, input.profileId],
  );
  return {
    id: input.profileId,
    state: "APPROVED",
    version,
    reason: requiredText(input.reason, "reason", 2000),
  };
}

export async function listSoftwareInventory(
  tx: Transaction,
  filters: {
    assetId?: string;
    state?: string;
  },
) {
  const result = await tx.query(
    `SELECT i.id,i.asset_id,i.product_id,i.normalized_name,i.publisher,
            i.version_label,i.installed_at,i.install_scope,i.package_identifier,
            i.classification,i.state,i.first_seen_at,i.last_seen_at,i.version,
            a.asset_code
       FROM software.inventory_installations i
       JOIN asset.assets a ON a.tenant_id=i.tenant_id AND a.id=i.asset_id
      WHERE i.tenant_id=$1 AND ($2::uuid IS NULL OR i.asset_id=$2)
        AND ($3::text IS NULL OR i.state=$3)
      ORDER BY i.last_seen_at DESC,i.id LIMIT 500`,
    [tx.tenantId, filters.assetId ?? null, filters.state ?? null],
  );
  return result.rows;
}

export async function listSoftwareExceptions(tx: Transaction, state?: string) {
  const result = await tx.query(
    `SELECT e.id,e.installation_id,e.state,e.owner_id,e.reason,e.risk,
            e.approval_request_id,e.approved_until,e.first_detected_at,
            e.last_detected_at,e.version,i.asset_id,i.product_id,i.normalized_name,
            i.version_label,i.classification,a.asset_code
       FROM software.software_exceptions e
       JOIN software.inventory_installations i
         ON i.tenant_id=e.tenant_id AND i.id=e.installation_id
       JOIN asset.assets a ON a.tenant_id=i.tenant_id AND a.id=i.asset_id
      WHERE e.tenant_id=$1 AND ($2::text IS NULL OR e.state=$2)
      ORDER BY e.last_detected_at DESC,e.id LIMIT 500`,
    [tx.tenantId, state ?? null],
  );
  return result.rows;
}

export async function readSoftwareException(
  tx: Transaction,
  exceptionId: string,
) {
  const result = await tx.query(
    `SELECT e.*,i.asset_id,i.product_id,i.normalized_name,i.version_label,
            i.classification,i.package_identifier,i.state AS installation_state,
            a.asset_code
       FROM software.software_exceptions e
       JOIN software.inventory_installations i
         ON i.tenant_id=e.tenant_id AND i.id=e.installation_id
       JOIN asset.assets a ON a.tenant_id=i.tenant_id AND a.id=i.asset_id
      WHERE e.tenant_id=$1 AND e.id=$2`,
    [tx.tenantId, exceptionId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Software exception was not found.",
    );
  const history = await tx.query(
    `SELECT from_state,to_state,actor_id,reason,evidence,version,created_at
       FROM software.software_exception_history
      WHERE tenant_id=$1 AND exception_id=$2 ORDER BY version`,
    [tx.tenantId, exceptionId],
  );
  const workItem = await tx.query(
    `SELECT id,state,version FROM operations.work_items
      WHERE tenant_id=$1 AND source_type='SOFTWARE_EXCEPTION' AND source_id=$2`,
    [tx.tenantId, exceptionId],
  );
  return {
    ...result.rows[0],
    history: history.rows,
    work_item: workItem.rows[0] ?? null,
  };
}

async function transitionException(input: {
  tx: Transaction;
  exceptionId: string;
  expectedVersion: number;
  allowedStates: readonly string[];
  toState: string;
  actorId: string;
  reason: string;
  evidence?: Record<string, unknown>;
  approvalRequestId?: string;
  approvedUntil?: string;
}) {
  const reason = requiredText(input.reason, "reason", 2000);
  const result = await input.tx.query(
    "SELECT id,state,version FROM software.software_exceptions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.exceptionId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Software exception was not found.",
    );
  const row = result.rows[0]!;
  assertVersion(Number(row.version), input.expectedVersion);
  if (!input.allowedStates.includes(String(row.state)))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      `Software exception cannot move from ${row.state} to ${input.toState}.`,
    );
  const approvedUntil = input.approvedUntil
    ? new Date(input.approvedUntil)
    : null;
  if (
    input.toState === "APPROVED_TEMPORARY" &&
    (!approvedUntil ||
      !Number.isFinite(approvedUntil.getTime()) ||
      approvedUntil <= new Date())
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "approved_until must be a future timestamp.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    `UPDATE software.software_exceptions
        SET state=$1,reason=$2,
            approval_request_id=$3,approved_until=$4,version=$5,updated_at=now()
      WHERE tenant_id=$6 AND id=$7`,
    [
      input.toState,
      reason,
      input.approvalRequestId ?? null,
      approvedUntil?.toISOString() ?? null,
      version,
      input.tx.tenantId,
      input.exceptionId,
    ],
  );
  await appendExceptionHistory({
    tx: input.tx,
    exceptionId: input.exceptionId,
    fromState: String(row.state),
    toState: input.toState,
    actorId: input.actorId,
    reason,
    evidence: {
      ...(input.evidence ?? {}),
      ...(input.approvalRequestId
        ? { approval_request_id: input.approvalRequestId }
        : {}),
      ...(approvedUntil ? { approved_until: approvedUntil.toISOString() } : {}),
    },
    version,
  });
  return {
    id: input.exceptionId,
    from_state: String(row.state),
    state: input.toState,
    version,
    reason,
    approval_request_id: input.approvalRequestId ?? null,
    approved_until: approvedUntil?.toISOString() ?? null,
  };
}

export async function requestExceptionApproval(input: {
  tx: Transaction;
  exceptionId: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
  approvalRequestId: string;
}) {
  const current = await input.tx.query(
    `SELECT state,version,approval_request_id FROM software.software_exceptions
      WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [input.tx.tenantId, input.exceptionId],
  );
  if (!current.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Software exception was not found.",
    );
  assertVersion(Number(current.rows[0]!.version), input.expectedVersion);
  const currentState = String(current.rows[0]!.state);
  if (!["OPEN", "WAITING_APPROVAL"].includes(currentState))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only an open exception can request approval.",
    );
  if (
    currentState === "WAITING_APPROVAL" &&
    current.rows[0]!.approval_request_id
  ) {
    const previous = await input.tx.query(
      "SELECT state FROM control.approval_requests WHERE tenant_id=$1 AND id=$2",
      [input.tx.tenantId, current.rows[0]!.approval_request_id],
    );
    if (
      previous.rows[0]?.state === "PENDING" ||
      previous.rows[0]?.state === "APPROVED"
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "A pending or approved exception request cannot be replaced.",
      );
  }
  const approval = await input.tx.query(
    `SELECT id,state,source_type,source_id FROM control.approval_requests
      WHERE tenant_id=$1 AND id=$2`,
    [input.tx.tenantId, input.approvalRequestId],
  );
  if (
    !approval.rowCount ||
    approval.rows[0]!.source_type !== "SOFTWARE_EXCEPTION" ||
    approval.rows[0]!.source_id !== input.exceptionId ||
    approval.rows[0]!.state !== "PENDING"
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "A pending approval request bound to this exception is required.",
    );
  return transitionException({
    tx: input.tx,
    exceptionId: input.exceptionId,
    expectedVersion: input.expectedVersion,
    allowedStates: [currentState],
    toState: "WAITING_APPROVAL",
    actorId: input.actorId,
    reason: input.reason,
    approvalRequestId: input.approvalRequestId,
  });
}

export async function approveTemporaryException(input: {
  tx: Transaction;
  exceptionId: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
  approvalRequestId: string;
  approvedUntil: string;
}) {
  const approval = await input.tx.query(
    `SELECT r.id,r.state,r.source_type,r.source_id,
            EXISTS (SELECT 1 FROM control.approval_decisions d
              WHERE d.tenant_id=r.tenant_id AND d.request_id=r.id
                AND d.decision='APPROVED' AND d.actor_id::text<>r.requested_by::text) AS distinct_approval
       FROM control.approval_requests r
      WHERE r.tenant_id=$1 AND r.id=$2`,
    [input.tx.tenantId, input.approvalRequestId],
  );
  if (
    !approval.rowCount ||
    approval.rows[0]!.state !== "APPROVED" ||
    approval.rows[0]!.source_type !== "SOFTWARE_EXCEPTION" ||
    approval.rows[0]!.source_id !== input.exceptionId ||
    !approval.rows[0]!.distinct_approval
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "A distinct authorized approval decision for this exception is required.",
    );
  return transitionException({
    tx: input.tx,
    exceptionId: input.exceptionId,
    expectedVersion: input.expectedVersion,
    allowedStates: ["WAITING_APPROVAL"],
    toState: "APPROVED_TEMPORARY",
    actorId: input.actorId,
    reason: input.reason,
    approvalRequestId: input.approvalRequestId,
    approvedUntil: input.approvedUntil,
  });
}

export async function markFalsePositive(input: {
  tx: Transaction;
  exceptionId: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
  evidenceReference: string;
}) {
  const evidenceReference = requiredText(
    input.evidenceReference,
    "evidence_reference",
    512,
  );
  return transitionException({
    tx: input.tx,
    exceptionId: input.exceptionId,
    expectedVersion: input.expectedVersion,
    allowedStates: ["OPEN", "WAITING_APPROVAL"],
    toState: "FALSE_POSITIVE",
    actorId: input.actorId,
    reason: input.reason,
    evidence: { evidence_reference: evidenceReference },
  });
}

export async function ignoreExceptionByPolicy(input: {
  tx: Transaction;
  exceptionId: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
  policyReference: string;
}) {
  const policyReference = requiredText(
    input.policyReference,
    "policy_reference",
    256,
  );
  return transitionException({
    tx: input.tx,
    exceptionId: input.exceptionId,
    expectedVersion: input.expectedVersion,
    allowedStates: ["OPEN", "WAITING_APPROVAL"],
    toState: "RESOLVED",
    actorId: input.actorId,
    reason: input.reason,
    evidence: { policy_reference: policyReference },
  });
}

export async function requestExceptionInvestigation(input: {
  tx: Transaction;
  exceptionId: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
}) {
  const result = await input.tx.query(
    `SELECT id,state,version FROM software.software_exceptions
      WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [input.tx.tenantId, input.exceptionId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Software exception was not found.",
    );
  assertVersion(Number(result.rows[0]!.version), input.expectedVersion);
  if (!["OPEN", "WAITING_APPROVAL"].includes(String(result.rows[0]!.state)))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only an open exception can be sent for investigation.",
    );
  const reason = requiredText(input.reason, "reason", 2000);
  const version = input.expectedVersion + 1;
  await input.tx.query(
    `UPDATE software.software_exceptions SET reason=$1,version=$2,updated_at=now()
      WHERE tenant_id=$3 AND id=$4`,
    [reason, version, input.tx.tenantId, input.exceptionId],
  );
  await appendExceptionHistory({
    tx: input.tx,
    exceptionId: input.exceptionId,
    fromState: String(result.rows[0]!.state),
    toState: String(result.rows[0]!.state),
    actorId: input.actorId,
    reason,
    evidence: { investigation_requested: true },
    version,
  });
  return {
    id: input.exceptionId,
    state: String(result.rows[0]!.state),
    version,
    reason,
  };
}

export async function requestExceptionRemoval(input: {
  tx: Transaction;
  exceptionId: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
}) {
  const result = await input.tx.query(
    `SELECT e.id,e.state,e.version,e.approval_request_id,e.installation_id,i.asset_id,i.product_id,
            i.classification,i.state AS installation_state,i.package_identifier,
            c.name AS asset_class,a.id AS agent_id,a.status AS agent_status,
            a.last_seen_at
       FROM software.software_exceptions e
       JOIN software.inventory_installations i ON i.tenant_id=e.tenant_id AND i.id=e.installation_id
       JOIN asset.assets x ON x.tenant_id=i.tenant_id AND x.id=i.asset_id
       JOIN asset.models m ON m.tenant_id=x.tenant_id AND m.id=x.asset_model_id
       JOIN asset.categories c ON c.tenant_id=m.tenant_id AND c.id=m.category_id
       LEFT JOIN agent.agents a ON a.tenant_id=i.tenant_id AND a.asset_id=i.asset_id
      WHERE e.tenant_id=$1 AND e.id=$2 FOR UPDATE OF e,i`,
    [input.tx.tenantId, input.exceptionId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Software exception was not found.",
    );
  const row = result.rows[0]!;
  assertVersion(Number(row.version), input.expectedVersion);
  if (!["OPEN", "WAITING_APPROVAL"].includes(String(row.state)))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only an open exception can request removal.",
    );
  if (row.installation_state !== "PRESENT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Software is no longer present on the asset.",
    );
  const reason = requiredText(input.reason, "reason", 2000);
  const profile = row.product_id
    ? await input.tx.query(
        `SELECT p.id,p.symbolic_method,p.auto_removal_allowed,p.no_business_dependency_attested
           FROM software.uninstall_profiles p
           JOIN control.approval_requests a
             ON a.tenant_id=p.tenant_id AND a.id=p.approval_request_id
          WHERE p.tenant_id=$1 AND p.product_id=$2 AND p.state='APPROVED'
            AND a.state='APPROVED' AND a.source_type='SOFTWARE_UNINSTALL_PROFILE'
            AND a.source_id=p.id`,
        [input.tx.tenantId, row.product_id],
      )
    : { rows: [], rowCount: 0 };
  const highRisk = [
    "server",
    "network",
    "security appliance",
    "infrastructure",
  ].includes(String(row.asset_class).toLowerCase());
  const online =
    row.agent_id &&
    row.agent_status === "ONLINE" &&
    row.last_seen_at &&
    Date.now() - new Date(row.last_seen_at as Date).getTime() <= 300_000;
  const canAutomate =
    row.classification === "PROHIBITED" &&
    profile.rowCount &&
    profile.rows[0]!.auto_removal_allowed &&
    profile.rows[0]!.no_business_dependency_attested &&
    !highRisk &&
    online;
  const version = input.expectedVersion + 1;
  await input.tx.query(
    `UPDATE software.software_exceptions SET state='REMOVAL_PENDING',reason=$1,
       approval_request_id=NULL,approved_until=NULL,version=$2,updated_at=now()
      WHERE tenant_id=$3 AND id=$4`,
    [reason, version, input.tx.tenantId, input.exceptionId],
  );
  await appendExceptionHistory({
    tx: input.tx,
    exceptionId: input.exceptionId,
    fromState: String(row.state),
    toState: "REMOVAL_PENDING",
    actorId: input.actorId,
    reason,
    evidence: {
      automatic_dispatch_eligible: Boolean(canAutomate),
      ...(row.approval_request_id
        ? { previous_approval_request_id: String(row.approval_request_id) }
        : {}),
    },
    version,
  });
  let jobId: string | null = null;
  if (canAutomate) {
    jobId = randomUUID();
    await input.tx.query(
      `INSERT INTO software.removal_jobs
         (id,tenant_id,exception_id,installation_id,asset_id,agent_id,
          uninstall_profile_id,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(tenant_id,exception_id) DO UPDATE SET
         installation_id=EXCLUDED.installation_id,asset_id=EXCLUDED.asset_id,
         agent_id=EXCLUDED.agent_id,uninstall_profile_id=EXCLUDED.uninstall_profile_id,
         state='QUEUED',lease_id=NULL,lease_expires_at=NULL,attempt_count=0,
         version=software.removal_jobs.version+1,updated_at=now()
       WHERE software.removal_jobs.state IN ('FAILED','CANCELLED')`,
      [
        jobId,
        input.tx.tenantId,
        input.exceptionId,
        row.installation_id,
        row.asset_id,
        row.agent_id,
        profile.rows[0]!.id,
        input.actorId,
      ],
    );
  }
  return {
    id: input.exceptionId,
    asset_id: String(row.asset_id),
    state: "REMOVAL_PENDING",
    version,
    reason,
    removal_job_id: jobId,
    automatic_dispatch: Boolean(canAutomate),
  };
}

export async function claimRemovalJob(input: {
  tx: Transaction;
  agentId: string;
  supportedMethods: string[];
  leaseId: string;
  leaseExpiresAt: string;
  now: string;
}) {
  const expiredExceptions: Array<Record<string, unknown>> = [];
  const exhausted = await input.tx.query(
    `UPDATE software.removal_jobs SET state='FAILED',lease_id=NULL,
       lease_expires_at=NULL,version=version+1,updated_at=now()
      WHERE tenant_id=$1 AND agent_id=$2 AND state='CLAIMED'
        AND lease_expires_at<=now() AND attempt_count>=3
      RETURNING id,exception_id,lease_id,attempt_count`,
    [input.tx.tenantId, input.agentId],
  );
  for (const item of exhausted.rows) {
    const exception = await input.tx.query(
      `SELECT state,version FROM software.software_exceptions
        WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [input.tx.tenantId, item.exception_id],
    );
    if (!exception.rowCount || exception.rows[0]!.state !== "REMOVAL_PENDING")
      continue;
    const version = Number(exception.rows[0]!.version) + 1;
    await input.tx.query(
      `UPDATE software.software_exceptions SET state='OPEN',version=$1,
         reason='Automatic removal lease expired after the retry limit.',updated_at=now()
        WHERE tenant_id=$2 AND id=$3`,
      [version, input.tx.tenantId, item.exception_id],
    );
    await appendExceptionHistory({
      tx: input.tx,
      exceptionId: String(item.exception_id),
      fromState: "REMOVAL_PENDING",
      toState: "OPEN",
      actorId: input.agentId,
      reason: "Automatic removal lease expired after the retry limit.",
      evidence: { retry_limit_reached: true },
      version,
    });
    await input.tx.query(
      `INSERT INTO software.removal_attempts
         (id,tenant_id,job_id,attempt_number,lease_id,outcome,actor_id)
       VALUES($1,$2,$3,$4,$5,'STALE',$6)`,
      [
        randomUUID(),
        input.tx.tenantId,
        item.id,
        item.attempt_count,
        item.lease_id,
        input.agentId,
      ],
    );
    expiredExceptions.push({
      id: String(item.exception_id),
      version,
      reason: "Automatic removal lease expired after the retry limit.",
    });
  }
  const candidate = await input.tx.query(
    `SELECT j.id,j.exception_id,j.installation_id,j.asset_id,j.uninstall_profile_id,
            j.version,j.state,j.lease_id,j.attempt_count,
            p.symbolic_method,i.normalized_name,i.version_label,
            i.package_identifier
       FROM software.removal_jobs j
       JOIN software.uninstall_profiles p ON p.tenant_id=j.tenant_id AND p.id=j.uninstall_profile_id
       JOIN software.inventory_installations i ON i.tenant_id=j.tenant_id AND i.id=j.installation_id
       JOIN software.software_exceptions e ON e.tenant_id=j.tenant_id AND e.id=j.exception_id
       JOIN agent.agents a ON a.tenant_id=j.tenant_id AND a.id=j.agent_id
      WHERE j.tenant_id=$1 AND j.agent_id=$2
        AND (j.state='QUEUED' OR
          (j.state='CLAIMED' AND j.lease_expires_at<=now() AND j.attempt_count<3))
        AND e.state='REMOVAL_PENDING' AND i.state='PRESENT'
        AND i.classification='PROHIBITED'
        AND p.state='APPROVED' AND p.auto_removal_allowed
        AND p.no_business_dependency_attested
        AND p.symbolic_method=ANY($3::text[])
        AND EXISTS (SELECT 1 FROM control.approval_requests ar
          WHERE ar.tenant_id=p.tenant_id AND ar.id=p.approval_request_id
            AND ar.state='APPROVED' AND ar.source_type='SOFTWARE_UNINSTALL_PROFILE'
            AND ar.source_id=p.id)
        AND lower((SELECT c.name FROM asset.assets x
          JOIN asset.models m ON m.tenant_id=x.tenant_id AND m.id=x.asset_model_id
          JOIN asset.categories c ON c.tenant_id=m.tenant_id AND c.id=m.category_id
          WHERE x.tenant_id=j.tenant_id AND x.id=j.asset_id))
          NOT IN ('server','network','security appliance','infrastructure')
        AND a.status='ONLINE' AND a.last_seen_at > now()-interval '5 minutes'
      ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
    [input.tx.tenantId, input.agentId, input.supportedMethods],
  );
  if (!candidate.rowCount)
    return { job: null, expired_exceptions: expiredExceptions };
  const job = candidate.rows[0]!;
  if (job.state === "CLAIMED")
    await input.tx.query(
      `INSERT INTO software.removal_attempts
         (id,tenant_id,job_id,attempt_number,lease_id,outcome,actor_id)
       VALUES($1,$2,$3,$4,$5,'STALE',$6)`,
      [
        randomUUID(),
        input.tx.tenantId,
        job.id,
        job.attempt_count,
        job.lease_id,
        input.agentId,
      ],
    );
  const version = Number(job.version) + 1;
  await input.tx.query(
    `UPDATE software.removal_jobs SET state='CLAIMED',lease_id=$1,
       lease_expires_at=$2,attempt_count=attempt_count+1,version=$3,updated_at=now()
      WHERE tenant_id=$4 AND id=$5`,
    [input.leaseId, input.leaseExpiresAt, version, input.tx.tenantId, job.id],
  );
  const attempt = Number(
    (
      await input.tx.query(
        "SELECT attempt_count FROM software.removal_jobs WHERE tenant_id=$1 AND id=$2",
        [input.tx.tenantId, job.id],
      )
    ).rows[0]!.attempt_count,
  );
  await input.tx.query(
    `INSERT INTO software.removal_attempts
       (id,tenant_id,job_id,attempt_number,lease_id,outcome,actor_id)
     VALUES($1,$2,$3,$4,$5,'CLAIMED',$6)`,
    [
      randomUUID(),
      input.tx.tenantId,
      job.id,
      attempt,
      input.leaseId,
      input.agentId,
    ],
  );
  return {
    expired_exceptions: expiredExceptions,
    job: {
      id: String(job.id),
      exception_id: String(job.exception_id),
      installation_id: String(job.installation_id),
      asset_id: String(job.asset_id),
      symbolic_method: String(job.symbolic_method),
      product_name: String(job.normalized_name),
      version_label: String(job.version_label),
      package_identifier: String(job.package_identifier),
      lease_id: input.leaseId,
      lease_expires_at: input.leaseExpiresAt,
      attempt_number: attempt,
      version,
    },
  };
}

export async function reportRemovalResult(input: {
  tx: Transaction;
  agentId: string;
  jobId: string;
  leaseId: string;
  outcome: "REMOVAL_REPORTED" | "FAILED";
  retryable: boolean;
  errorCode?: string;
  summary?: string;
}) {
  const result = await input.tx.query(
    `SELECT j.id,j.state,j.lease_id,j.lease_expires_at,j.attempt_count,j.version,
            j.exception_id
       FROM software.removal_jobs j
      WHERE j.tenant_id=$1 AND j.id=$2 AND j.agent_id=$3 FOR UPDATE`,
    [input.tx.tenantId, input.jobId, input.agentId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Software removal job was not found.",
    );
  const row = result.rows[0]!;
  if (
    row.state !== "CLAIMED" ||
    row.lease_id !== input.leaseId ||
    new Date(row.lease_expires_at as Date).getTime() <= Date.now()
  )
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Software removal lease is stale or no longer owned by this agent.",
    );
  const summary = optionalText(input.summary, "summary", 500).replace(
    /((?:password|token|secret|api[_-]?key|license[_-]?key)\s*[:=]\s*)\S+/gi,
    "$1[REDACTED]",
  );
  let finalState: string;
  let exceptionUpdate: Record<string, unknown> | null = null;
  if (
    input.outcome === "FAILED" &&
    input.retryable &&
    Number(row.attempt_count) < 3
  ) {
    finalState = "QUEUED";
    await input.tx.query(
      `UPDATE software.removal_jobs SET state='QUEUED',lease_id=NULL,
         lease_expires_at=NULL,version=version+1,updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [input.tx.tenantId, input.jobId],
    );
  } else {
    finalState = input.outcome === "FAILED" ? "FAILED" : "SUCCEEDED";
    await input.tx.query(
      `UPDATE software.removal_jobs SET state=$1,lease_id=NULL,
         lease_expires_at=NULL,version=version+1,updated_at=now()
        WHERE tenant_id=$2 AND id=$3`,
      [finalState, input.tx.tenantId, input.jobId],
    );
    if (input.outcome === "FAILED") {
      const exception = await input.tx.query(
        `SELECT state,version FROM software.software_exceptions
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [input.tx.tenantId, row.exception_id],
      );
      if (
        exception.rowCount &&
        exception.rows[0]!.state === "REMOVAL_PENDING"
      ) {
        const exceptionVersion = Number(exception.rows[0]!.version) + 1;
        const exceptionReason =
          "Automatic removal failed and requires operator action.";
        await input.tx.query(
          `UPDATE software.software_exceptions SET state='OPEN',version=$1,
             reason=$2,updated_at=now()
            WHERE tenant_id=$3 AND id=$4`,
          [
            exceptionVersion,
            exceptionReason,
            input.tx.tenantId,
            row.exception_id,
          ],
        );
        await appendExceptionHistory({
          tx: input.tx,
          exceptionId: String(row.exception_id),
          fromState: "REMOVAL_PENDING",
          toState: "OPEN",
          actorId: input.agentId,
          reason: exceptionReason,
          evidence: {
            removal_job_id: input.jobId,
            error_code: input.errorCode ?? null,
          },
          version: exceptionVersion,
        });
        exceptionUpdate = {
          id: String(row.exception_id),
          version: exceptionVersion,
          state: "OPEN",
          reason: exceptionReason,
        };
      }
    }
  }
  await input.tx.query(
    `INSERT INTO software.removal_attempts
       (id,tenant_id,job_id,attempt_number,lease_id,outcome,error_code,summary,actor_id,retryable)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.jobId,
      row.attempt_count,
      input.leaseId,
      input.outcome,
      input.errorCode ?? null,
      summary,
      input.agentId,
      input.retryable,
    ],
  );
  return {
    id: input.jobId,
    exception_id: String(row.exception_id),
    state: finalState,
    outcome: input.outcome,
    retryable: input.retryable,
    exception_update: exceptionUpdate,
    version: Number(row.version) + 1,
    requires_inventory_verification: input.outcome === "REMOVAL_REPORTED",
  };
}

export async function getRemovalJob(tx: Transaction, jobId: string) {
  const result = await tx.query(
    `SELECT j.id,j.exception_id,j.asset_id,j.state,j.lease_id,j.lease_expires_at,
            j.attempt_count,j.version,j.created_at,j.updated_at
       FROM software.removal_jobs j WHERE j.tenant_id=$1 AND j.id=$2`,
    [tx.tenantId, jobId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Software removal job was not found.",
    );
  return result.rows[0];
}

export async function getExceptionRemovalJob(
  tx: Transaction,
  exceptionId: string,
) {
  const result = await tx.query(
    `SELECT id FROM software.removal_jobs
      WHERE tenant_id=$1 AND exception_id=$2`,
    [tx.tenantId, exceptionId],
  );
  return result.rowCount ? getRemovalJob(tx, String(result.rows[0]!.id)) : null;
}

export async function inspectExceptionForReview(input: {
  tx: Transaction;
  installationId: string;
  actorId: string;
  now?: Date;
}) {
  const row = await input.tx.query(
    `SELECT i.id,i.detection_generation,i.classification,p.owner_id
       FROM software.inventory_installations i
       LEFT JOIN software.software_products p ON p.tenant_id=i.tenant_id AND p.id=i.product_id
      WHERE i.tenant_id=$1 AND i.id=$2 AND i.state='PRESENT'`,
    [input.tx.tenantId, input.installationId],
  );
  if (!row.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Current software installation was not found.",
    );
  const detection = await recordDetection({
    tx: input.tx,
    installationId: String(row.rows[0]!.id),
    generation: Number(row.rows[0]!.detection_generation),
    classification: String(
      row.rows[0]!.classification,
    ) as Product["classification"],
    ownerId: String(row.rows[0]!.owner_id ?? "SOFTWARE_SECURITY"),
    actorId: input.actorId,
    now: input.now ?? new Date(),
    explicitReview: true,
  });
  if (!detection)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "This installation does not meet the unauthorized-software policy.",
    );
  return detection;
}

export const softwareExceptionStates = classifications;
