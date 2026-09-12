import { isIP } from "node:net";
import type { Transaction } from "../../../packages/persistence/src/index.js";

export const SEARCH_ENTITY_TYPES = [
  "ASSET",
  "USER",
  "TICKET",
  "INCIDENT",
  "NETWORK_DEVICE",
  "SOFTWARE_PRODUCT",
  "LICENSE_ENTITLEMENT",
] as const;

export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export interface SearchDocument {
  entity_type: SearchEntityType;
  entity_id: string;
  display_code: string;
  title: string;
  subtitle: string | null;
  highlights: string[];
  score: number;
  updated_at: string;
  authorization_resource_type: string;
  authorization_action: string;
  security_scope: Record<string, unknown>;
  filter_fields: Record<string, unknown>;
}

interface CanonicalRow {
  id: string;
  display_code: string;
  title: string;
  subtitle: string | null;
  exact_terms: string[];
  filter_fields: Record<string, unknown>;
  security_scope: Record<string, unknown>;
  source_version: string | number;
  source_updated_at: string;
}

const sources: Record<
  SearchEntityType,
  { table: string; permission: string; resource: string; query: string }
> = {
  ASSET: {
    table: "asset.assets",
    permission: "asset.read",
    resource: "asset",
    query: `SELECT a.id, a.asset_code AS display_code,
        concat_ws(' ',m.manufacturer,m.model_name) AS title,
        concat_ws(' · ',a.lifecycle_state,a.operational_state,l.name) AS subtitle,
        ARRAY[a.asset_code,a.asset_tag,a.serial_number,m.manufacturer,m.model_name]::text[] AS exact_terms,
        jsonb_build_object('state',a.lifecycle_state,'assignment_state',a.assignment_state,
          'health_state',a.health_state,'location_id',a.current_location_id) AS filter_fields,
        jsonb_strip_nulls(jsonb_build_object('location_id',a.current_location_id,
          'site_id',site.site_id)) AS security_scope,
        a.version AS source_version,a.updated_at AS source_updated_at
      FROM asset.assets a JOIN asset.models m ON m.tenant_id=a.tenant_id AND m.id=a.asset_model_id
      LEFT JOIN asset.locations l ON l.tenant_id=a.tenant_id AND l.id=a.current_location_id
      LEFT JOIN LATERAL (
        WITH RECURSIVE ancestors AS (
          SELECT loc.id,loc.parent_id,loc.type,ARRAY[loc.id] AS path,0 AS depth
          FROM asset.locations loc
          WHERE loc.tenant_id=a.tenant_id AND loc.id=a.current_location_id
          UNION ALL
          SELECT parent.id,parent.parent_id,parent.type,
            ancestors.path||parent.id,ancestors.depth+1
          FROM ancestors JOIN asset.locations parent
            ON parent.tenant_id=a.tenant_id AND parent.id=ancestors.parent_id
          WHERE NOT parent.id=ANY(ancestors.path)
        )
        SELECT id AS site_id FROM ancestors WHERE upper(type)='SITE'
        ORDER BY depth DESC LIMIT 1
      ) site ON true
      WHERE a.tenant_id=$1 AND a.id=$2`,
  },
  USER: {
    table: "identity.users",
    permission: "user.read",
    resource: "user",
    query: `SELECT u.id,u.display_code AS display_code,u.display_name AS title,
        concat_ws(' · ',u.username,u.primary_email,u.employment_status) AS subtitle,
        ARRAY[u.display_code,u.display_name,u.username,u.primary_email]::text[] AS exact_terms,
        jsonb_build_object('state',u.employment_status) AS filter_fields,
        jsonb_build_object('self',u.id) AS security_scope,
        u.version AS source_version,u.updated_at AS source_updated_at
      FROM identity.users u WHERE u.tenant_id=$1 AND u.id=$2 AND u.archived_at IS NULL`,
  },
  TICKET: {
    table: "helpdesk.tickets",
    permission: "ticket.read",
    resource: "ticket",
    query: `SELECT t.id,t.ticket_code AS display_code,t.title,
        concat_ws(' · ',t.priority,t.state) AS subtitle,
        ARRAY[t.ticket_code]::text[] AS exact_terms,
        jsonb_build_object('state',t.state,'priority',t.priority) AS filter_fields,
        jsonb_build_object('self_user_ids',jsonb_build_array(t.requester_user_id,t.assignee_user_id)) AS security_scope,
        t.version AS source_version,t.updated_at AS source_updated_at
      FROM helpdesk.tickets t WHERE t.tenant_id=$1 AND t.id=$2`,
  },
  INCIDENT: {
    table: "incident.incidents",
    permission: "incident.read",
    resource: "incident",
    query: `SELECT i.id,i.incident_code AS display_code,i.title,
        concat_ws(' · ',i.priority,i.state) AS subtitle,
        ARRAY[i.incident_code]::text[] AS exact_terms,
        jsonb_build_object('state',i.state,'priority',i.priority,'service_id',i.service_id) AS filter_fields,
        jsonb_strip_nulls(jsonb_build_object('service_id',i.service_id)) AS security_scope,
        i.version AS source_version,i.updated_at AS source_updated_at
      FROM incident.incidents i WHERE i.tenant_id=$1 AND i.id=$2`,
  },
  NETWORK_DEVICE: {
    table: "network.observations",
    permission: "network.topology.read",
    resource: "network_topology",
    query: `SELECT n.id,
        coalesce(n.hostname,host(n.ip),n.mac::text,n.id::text) AS display_code,
        coalesce(n.hostname,concat_ws(' ',n.vendor,n.model),host(n.ip),n.mac::text) AS title,
        concat_ws(' · ',host(n.ip),n.mac::text,n.vlan,n.switch_name,n.port_name) AS subtitle,
        ARRAY[n.hostname,host(n.ip),n.mac::text,n.vendor,n.model,n.switch_name]::text[] AS exact_terms,
        jsonb_build_object('state','OBSERVED','confidence',n.confidence,'vlan',n.vlan,
          'observed_at',n.observed_at) AS filter_fields,
        jsonb_strip_nulls(jsonb_build_object('asset_id',n.asset_id,
          'location_id',a.current_location_id,'site_id',site.site_id)) AS security_scope,
        floor(extract(epoch from n.observed_at)*1000)::bigint AS source_version,
        n.observed_at AS source_updated_at
      FROM network.observations n LEFT JOIN asset.assets a
        ON a.tenant_id=n.tenant_id AND a.id=n.asset_id
      LEFT JOIN LATERAL (
        WITH RECURSIVE ancestors AS (
          SELECT loc.id,loc.parent_id,loc.type,ARRAY[loc.id] AS path,0 AS depth
          FROM asset.locations loc
          WHERE loc.tenant_id=a.tenant_id AND loc.id=a.current_location_id
          UNION ALL
          SELECT parent.id,parent.parent_id,parent.type,
            ancestors.path||parent.id,ancestors.depth+1
          FROM ancestors JOIN asset.locations parent
            ON parent.tenant_id=a.tenant_id AND parent.id=ancestors.parent_id
          WHERE NOT parent.id=ANY(ancestors.path)
        )
        SELECT id AS site_id FROM ancestors WHERE upper(type)='SITE'
        ORDER BY depth DESC LIMIT 1
      ) site ON true
      WHERE n.tenant_id=$1 AND n.id=$2`,
  },
  SOFTWARE_PRODUCT: {
    table: "software.software_products",
    permission: "software.read",
    resource: "software",
    query: `SELECT p.id,p.product_code AS display_code,p.name AS title,
        concat_ws(' · ',p.vendor,p.category,p.classification) AS subtitle,
        ARRAY[p.product_code,p.name,p.vendor]::text[] ||
          coalesce((SELECT array_agg(pa.alias) FROM software.product_aliases pa
            WHERE pa.tenant_id=p.tenant_id AND pa.product_id=p.id),'{}'::text[]) AS exact_terms,
        jsonb_build_object('state',p.classification,'visibility',p.visibility) AS filter_fields,
        jsonb_build_object('visibility',p.visibility) AS security_scope,
        p.version AS source_version,p.updated_at AS source_updated_at
      FROM software.software_products p
      WHERE p.tenant_id=$1 AND p.id=$2 AND p.visibility<>'HIDDEN'`,
  },
  LICENSE_ENTITLEMENT: {
    table: "license.license_entitlements",
    permission: "license.read",
    resource: "license",
    query: `SELECT e.id,coalesce(p.product_code,'LIC-'||left(e.id::text,8)) AS display_code,
        p.name AS title,concat_ws(' · ',p.vendor,e.license_type) AS subtitle,
        ARRAY[p.product_code,p.name,p.vendor,e.license_type]::text[] AS exact_terms,
        jsonb_build_object('state',CASE WHEN t.valid_until IS NULL OR t.valid_until > now()
          THEN 'ACTIVE' ELSE 'EXPIRED' END,
          'license_type',e.license_type) AS filter_fields,
        '{}'::jsonb AS security_scope,
        e.version AS source_version,e.updated_at AS source_updated_at
      FROM license.license_entitlements e
      JOIN software.software_products p ON p.tenant_id=e.tenant_id AND p.id=e.software_product_id
      LEFT JOIN license.entitlement_terms t ON t.tenant_id=e.tenant_id AND t.entitlement_id=e.id
        AND t.term_version=e.current_term_version
      WHERE e.tenant_id=$1 AND e.id=$2 AND p.visibility<>'HIDDEN'`,
  },
};

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeExactTerm(value: string): string {
  const normalized = normalizeSearchText(value);
  if (/^[\da-f:.-]+$/i.test(value) && value.replace(/\D/g, "").length >= 4)
    return value.toLowerCase().replace(/[^a-f0-9]/g, "");
  return normalized;
}

function stringValues(values: string[]): string[] {
  return [
    ...new Set(
      values
        .flatMap((value) =>
          value ? [normalizeSearchText(value), normalizeExactTerm(value)] : [],
        )
        .filter(Boolean),
    ),
  ];
}

async function upsertRow(
  tx: Transaction,
  type: SearchEntityType,
  row: CanonicalRow,
) {
  const source = sources[type];
  const searchable = [
    row.display_code,
    row.title,
    row.subtitle ?? "",
    ...row.exact_terms,
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedTerms = stringValues(row.exact_terms);
  await tx.query(
    `INSERT INTO operations.search_documents(
       id,tenant_id,entity_type,entity_id,exact_key,searchable_text,
       display_code,title,subtitle,exact_terms,exact_key_normalized,
       searchable_normalized,display_code_normalized,title_normalized,
       filter_fields,security_scope,source_version,
       source_updated_at,indexed_at,is_tombstone,authorization_resource_type,
       authorization_action
     ) VALUES($1,$2,$3,$4,$5,$6,$5,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now(),false,$18,$19)
     ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET
       exact_key=EXCLUDED.exact_key,searchable_text=EXCLUDED.searchable_text,
       display_code=EXCLUDED.display_code,title=EXCLUDED.title,subtitle=EXCLUDED.subtitle,
       exact_terms=EXCLUDED.exact_terms,exact_key_normalized=EXCLUDED.exact_key_normalized,
       searchable_normalized=EXCLUDED.searchable_normalized,filter_fields=EXCLUDED.filter_fields,
       display_code_normalized=EXCLUDED.display_code_normalized,
       title_normalized=EXCLUDED.title_normalized,
       security_scope=EXCLUDED.security_scope,source_version=EXCLUDED.source_version,
       source_updated_at=EXCLUDED.source_updated_at,indexed_at=now(),is_tombstone=false,
       authorization_resource_type=EXCLUDED.authorization_resource_type,
       authorization_action=EXCLUDED.authorization_action
     WHERE operations.search_documents.source_version <= EXCLUDED.source_version`,
    [
      row.id,
      tx.tenantId,
      type,
      row.id,
      row.display_code,
      searchable,
      row.title,
      row.subtitle,
      normalizedTerms,
      normalizeExactTerm(row.display_code),
      normalizeSearchText(searchable),
      normalizeSearchText(row.display_code),
      normalizeSearchText(row.title),
      JSON.stringify(row.filter_fields),
      JSON.stringify(row.security_scope),
      Number(row.source_version),
      row.source_updated_at,
      source.resource,
      source.permission,
    ],
  );
  await tx.query(
    `INSERT INTO operations.search_index_state(tenant_id,index_state,last_event_at,indexed_at,updated_at)
     VALUES($1,'CURRENT',$2,now(),now())
     ON CONFLICT(tenant_id) DO UPDATE SET index_state=CASE
       WHEN operations.search_index_state.index_state='REBUILDING' THEN 'REBUILDING' ELSE 'CURRENT' END,
       last_event_at=GREATEST(
       operations.search_index_state.last_event_at,EXCLUDED.last_event_at),indexed_at=now(),
       failure_code=NULL,updated_at=now()`,
    [tx.tenantId, row.source_updated_at],
  );
}

export async function refreshSearchEntity(
  tx: Transaction,
  type: SearchEntityType,
  id: string,
  missingVersion = 1,
): Promise<boolean> {
  const result = await tx.query<CanonicalRow>(sources[type].query, [
    tx.tenantId,
    id,
  ]);
  if (result.rowCount) {
    await upsertRow(tx, type, result.rows[0]!);
    return true;
  }
  const source = sources[type];
  await tx.query(
    `INSERT INTO operations.search_documents(
       id,tenant_id,entity_type,entity_id,exact_key,searchable_text,
       source_version,indexed_at,is_tombstone,authorization_resource_type,
       authorization_action
     ) VALUES($1,$2,$3,$1,'','',$4,now(),true,$5,$6)
     ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET
       source_version=GREATEST(operations.search_documents.source_version,EXCLUDED.source_version),
       indexed_at=now(),is_tombstone=true
     WHERE operations.search_documents.source_version <= EXCLUDED.source_version`,
    [id, tx.tenantId, type, missingVersion, source.resource, source.permission],
  );
  await tx.query(
    `INSERT INTO operations.search_index_state(tenant_id,index_state,indexed_at,updated_at)
     VALUES($1,'CURRENT',now(),now())
     ON CONFLICT(tenant_id) DO UPDATE SET index_state=CASE
       WHEN operations.search_index_state.index_state='REBUILDING' THEN 'REBUILDING' ELSE 'CURRENT' END,
       indexed_at=now(),
       failure_code=NULL,updated_at=now()`,
    [tx.tenantId],
  );
  return false;
}

export function searchTypeForAggregate(type: string): SearchEntityType | null {
  const map: Record<string, SearchEntityType> = {
    ASSET: "ASSET",
    USER: "USER",
    IDENTITY_USER: "USER",
    TICKET: "TICKET",
    INCIDENT: "INCIDENT",
    NETWORK_OBSERVATION: "NETWORK_DEVICE",
    SOFTWARE_PRODUCT: "SOFTWARE_PRODUCT",
    LICENSE_ENTITLEMENT: "LICENSE_ENTITLEMENT",
  };
  return map[type] ?? null;
}

export async function reindexSearchPage(input: {
  tx: Transaction;
  type: SearchEntityType;
  afterId?: string;
  limit: number;
}): Promise<{ indexed: number; next_id: string | null }> {
  const source = sources[input.type];
  const rows = await input.tx.query<{ id: string }>(
    `SELECT id FROM ${source.table} WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid)
       ORDER BY id LIMIT $3`,
    [input.tx.tenantId, input.afterId ?? null, input.limit + 1],
  );
  const hasMore = rows.rows.length > input.limit;
  const page = rows.rows.slice(0, input.limit);
  for (const row of page)
    await refreshSearchEntity(input.tx, input.type, row.id);
  return {
    indexed: page.length,
    next_id: hasMore ? page.at(-1)!.id : null,
  };
}

export interface SearchCandidate {
  entity_type: SearchEntityType;
  entity_id: string;
  display_code: string;
  title: string;
  subtitle: string | null;
  score: number;
  updated_at: string;
  authorization_resource_type: string;
  authorization_action: string;
  security_scope: Record<string, unknown>;
  filter_fields: Record<string, unknown>;
}

export async function findSearchCandidates(input: {
  tx: Transaction;
  q: string;
  types: SearchEntityType[];
  state?: string;
  siteId?: string;
  after?: { score: number; entity_type: string; entity_id: string };
  limit: number;
  prefixOnly?: boolean;
}): Promise<SearchCandidate[]> {
  const q = normalizeSearchText(input.q);
  const exact = normalizeExactTerm(input.q);
  const result = await input.tx.query<SearchCandidate>(
    `WITH ranked AS (
      SELECT entity_type,entity_id,display_code,title,subtitle,updated_at,
         authorization_resource_type,authorization_action,security_scope,filter_fields,
         CASE
           WHEN exact_key_normalized=$2 THEN 100
           WHEN $3=ANY(exact_terms) THEN 98
           WHEN display_code_normalized LIKE $4 THEN 85
           WHEN title_normalized LIKE $4 THEN 75
           WHEN $15::boolean AND similarity(searchable_normalized,$2)>=0.35 THEN
             50 + round(similarity(searchable_normalized,$2)*10)::integer
           WHEN to_tsvector('simple',searchable_normalized) @@ plainto_tsquery('simple',$1) THEN 40
           WHEN $15::boolean AND searchable_normalized LIKE $5 THEN 25
           ELSE 0
         END AS score
       FROM operations.search_documents
       WHERE tenant_id=$6 AND NOT is_tombstone
         AND ($7::text[] IS NULL OR entity_type=ANY($7))
         AND ($8::text IS NULL OR filter_fields @> jsonb_build_object('state',$8))
         AND ($9::uuid IS NULL OR security_scope @> jsonb_build_object('site_id',$9::text))
         AND (NOT $14::boolean OR display_code_normalized LIKE $4
           OR title_normalized LIKE $4 OR searchable_normalized LIKE $4)
         AND (exact_key_normalized=$2 OR $3=ANY(exact_terms)
           OR display_code_normalized LIKE $4 OR title_normalized LIKE $4
           OR ($15::boolean AND searchable_normalized LIKE $5)
           OR ($15::boolean AND similarity(searchable_normalized,$2)>=0.35)
           OR to_tsvector('simple',searchable_normalized) @@ plainto_tsquery('simple',$1))
     )
     SELECT * FROM ranked
     WHERE score>0 AND ($10::integer IS NULL OR score<$10
       OR (score=$10 AND (entity_type>$11 OR (entity_type=$11 AND entity_id::text>$12))))
     ORDER BY score DESC,entity_type ASC,entity_id ASC LIMIT $13`,
    [
      q,
      exact,
      exact,
      `${escapeLike(q)}%`,
      `%${escapeLike(q)}%`,
      input.tx.tenantId,
      input.types.length ? input.types : null,
      input.state ?? null,
      input.siteId ?? null,
      input.after?.score ?? null,
      input.after?.entity_type ?? null,
      input.after?.entity_id ?? null,
      input.limit,
      input.prefixOnly ?? false,
      q.length >= 3,
    ],
  );
  return result.rows;
}

export async function exactCanonicalFallback(input: {
  tx: Transaction;
  q: string;
  types: SearchEntityType[];
}): Promise<SearchCandidate[]> {
  const q = input.q.trim();
  const compact = q.toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidates: SearchCandidate[] = [];
  for (const type of input.types) {
    const source = sources[type];
    const exactQuery: Record<SearchEntityType, string> = {
      ASSET: `SELECT id FROM asset.assets WHERE tenant_id=$1 AND
        (lower(asset_code)=lower($2) OR lower(coalesce(asset_tag,''))=lower($2)
         OR regexp_replace(lower(coalesce(serial_number,'')),'[^[:alnum:]]','','g')=$3)`,
      USER: `SELECT id FROM identity.users WHERE tenant_id=$1 AND archived_at IS NULL AND
        (lower(display_code)=lower($2) OR lower(username)=lower($2) OR lower(coalesce(primary_email,''))=lower($2))`,
      TICKET: `SELECT id FROM helpdesk.tickets WHERE tenant_id=$1 AND lower(ticket_code)=lower($2)`,
      INCIDENT: `SELECT id FROM incident.incidents WHERE tenant_id=$1 AND lower(incident_code)=lower($2)`,
      NETWORK_DEVICE: `SELECT id FROM network.observations WHERE tenant_id=$1 AND
        (lower(coalesce(hostname,''))=lower($2) OR lower(host(ip))=lower($2)
         OR ($4::text IS NOT NULL AND ip=$4::inet)
         OR regexp_replace(lower(mac::text),'[^a-f0-9]','','g')=$3)`,
      SOFTWARE_PRODUCT: `SELECT p.id FROM software.software_products p WHERE p.tenant_id=$1 AND
        (lower(p.product_code)=lower($2) OR lower(p.name)=lower($2) OR EXISTS
          (SELECT 1 FROM software.product_aliases a WHERE a.tenant_id=p.tenant_id
            AND a.product_id=p.id AND lower(a.alias)=lower($2)))`,
      LICENSE_ENTITLEMENT: `SELECT e.id FROM license.license_entitlements e
        JOIN software.software_products p ON p.tenant_id=e.tenant_id AND p.id=e.software_product_id
        WHERE e.tenant_id=$1 AND (lower(p.product_code)=lower($2) OR lower(p.name)=lower($2))`,
    };
    const values: (string | null)[] = [input.tx.tenantId, q];
    if (type === "ASSET") values.push(compact);
    if (type === "NETWORK_DEVICE") values.push(compact, isIP(q) ? q : null);
    const rows = await input.tx.query<{ id: string }>(
      `${exactQuery[type]} ORDER BY id LIMIT 10`,
      values,
    );
    for (const row of rows.rows) {
      const canonical = await input.tx.query<CanonicalRow>(source.query, [
        input.tx.tenantId,
        row.id,
      ]);
      if (!canonical.rowCount) continue;
      const doc = canonical.rows[0]!;
      candidates.push({
        entity_type: type,
        entity_id: doc.id,
        display_code: doc.display_code,
        title: doc.title,
        subtitle: doc.subtitle,
        score: 100,
        updated_at: doc.source_updated_at,
        authorization_resource_type: source.resource,
        authorization_action: source.permission,
        security_scope: doc.security_scope,
        filter_fields: doc.filter_fields,
      });
    }
  }
  return candidates;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
