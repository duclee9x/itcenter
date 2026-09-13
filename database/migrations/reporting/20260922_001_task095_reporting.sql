CREATE SCHEMA reporting;
CREATE TABLE reporting.kpi_definitions (
  kpi_id text NOT NULL,
  version integer NOT NULL CHECK(version>0),
  semantic_name text NOT NULL,
  mode text NOT NULL CHECK(mode IN ('LIVE_COUNT','PERIOD_COUNT','PERIOD_RATIO','PERIOD_SUM')),
  definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
  effective_from timestamptz NOT NULL,
  superseded_by_version integer,
  PRIMARY KEY(kpi_id,version)
);
CREATE TABLE reporting.kpi_result_snapshots (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  kpi_id text NOT NULL,
  kpi_version integer NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  snapshot_type text NOT NULL CHECK(snapshot_type IN ('DAILY_POINT_IN_TIME','PERIOD')),
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(dimensions)='object'),
  dimension_fingerprint char(64) NOT NULL,
  numerator bigint,
  denominator bigint,
  value jsonb NOT NULL CHECK(jsonb_typeof(value) IN ('number','null','object','array')),
  unit text NOT NULL,
  status text NOT NULL CHECK(status IN ('COMPLETE','COMPLETE_EMPTY','PARTIAL','STALE','UNAVAILABLE')),
  completeness integer NOT NULL CHECK(completeness BETWEEN 0 AND 100),
  source_lineage jsonb NOT NULL CHECK(jsonb_typeof(source_lineage)='object'),
  as_of timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL CHECK(revision>0),
  UNIQUE(tenant_id,kpi_id,kpi_version,period_start,period_end,snapshot_type,dimension_fingerprint,revision),
  FOREIGN KEY(kpi_id,kpi_version) REFERENCES reporting.kpi_definitions(kpi_id,version),
  CHECK(period_start < period_end)
);
CREATE INDEX reporting_kpi_snapshot_latest ON reporting.kpi_result_snapshots(tenant_id,kpi_id,kpi_version,period_start,period_end,dimension_fingerprint,revision DESC);
CREATE TABLE reporting.source_watermarks (
  tenant_id text NOT NULL,
  source_name text NOT NULL,
  watermark_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,source_name)
);
INSERT INTO identity.permissions(id,code,resource_type,action) VALUES
 ('a0950000-0000-4000-8000-000000000001','metric.read','reporting_metric','read'),
 ('a0950000-0000-4000-8000-000000000002','report.read','reporting','read'),
 ('a0950000-0000-4000-8000-000000000003','report.export','reporting','export'),
 ('a0950000-0000-4000-8000-000000000004','procurement.cost.read','procurement_cost','read'),
 ('a0950000-0000-4000-8000-000000000005','work_item.read','work_item','read'),
 ('a0950000-0000-4000-8000-000000000006','knowledge.recommendation.read','knowledge_recommendation','read')
ON CONFLICT(code) DO UPDATE SET resource_type=EXCLUDED.resource_type,action=EXCLUDED.action;

INSERT INTO reporting.kpi_definitions(kpi_id,version,semantic_name,mode,definition,effective_from)
VALUES
 ('OPS_OPEN_TICKETS_COUNT',1,'Open tickets','LIVE_COUNT',
  '{"formula":"count unique canonical non-terminal Tickets at as_of","sources":["TicketReportingQuery"],"inclusion":["tenant scoped","created by as_of","domain lifecycle non-terminal"],"exclusion":["canonical terminal state"],"time":"UTC point-in-time","dimensions":["priority"],"unit":"COUNT","snapshot":"DAILY_POINT_IN_TIME"}',now()),
 ('OPS_ACTIVE_INCIDENT_EPISODES_COUNT',1,'Active incident episodes','LIVE_COUNT',
  '{"formula":"distinct active Root episode id or standalone Incident id at as_of","sources":["IncidentStateAtQuery","RootRelationshipHistory"],"inclusion":["active at as_of"],"exclusion":["terminal Incident","duplicate Root children"],"time":"UTC point-in-time","dimensions":[],"unit":"COUNT","snapshot":"DAILY_POINT_IN_TIME"}',now()),
 ('OPS_ACTIONABLE_WORK_QUEUE_COUNT',1,'Actionable work queue','LIVE_COUNT',
  '{"formula":"count unique actionable Work Items at as_of","sources":["WorkQueueStateAtQuery"],"inclusion":["existed at as_of","domain state actionable"],"exclusion":["canonical terminal state"],"time":"UTC point-in-time","dimensions":["priority","source_type"],"unit":"COUNT","snapshot":"DAILY_POINT_IN_TIME"}',now()),
 ('HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT',1,'Resolution SLA compliance','PERIOD_RATIO',
  '{"formula":"MET / (MET + BREACHED) * 100","sources":["SLAReportingQuery","TicketReportingQuery"],"inclusion":["final evaluable RESOLUTION MET or BREACHED","completed_at in [start,end)"],"exclusion":["pending","no SLA","not applicable","cancelled/non-evaluable","non-RESOLUTION target purpose"],"time":"UTC [start,end), canonical finalization timestamp","dimensions":["priority"],"unit":"PERCENT","zero_denominator":"null/COMPLETE_EMPTY"}',now()),
 ('KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT',1,'Confirmed self-service resolution','PERIOD_RATIO',
  '{"formula":"confirmed USER_RESOLVED KNOWLEDGE_RESOLUTION / eligible pre-Ticket terminal sessions * 100","sources":["TASK-093 RecommendationSession"],"inclusion":["presented item","USER_RESOLVED","NOT_HELPFUL","ESCALATED","outcome in [start,end)"],"exclusion":["KNOWN_INCIDENT_DEFLECTION","presentation","open","selection","HELPFUL alone"],"time":"UTC [start,end), canonical outcome timestamp","dimensions":[],"unit":"PERCENT","zero_denominator":"null/COMPLETE_EMPTY"}',now()),
 ('KNOWLEDGE_KNOWN_INCIDENT_DEFLECTION_COUNT',1,'Known incident deflection','PERIOD_COUNT',
  '{"formula":"count confirmed KNOWN_INCIDENT_DEFLECTION sessions","sources":["TASK-093 RecommendationSession"],"inclusion":["confirmed USER_RESOLVED","confirmation in [start,end)"],"exclusion":["Root context","presentation","click"],"time":"UTC [start,end)","dimensions":[],"unit":"COUNT"}',now()),
 ('ASSET_CRITICAL_RISK_COUNT',1,'Critical asset risk','LIVE_COUNT',
  '{"formula":"count eligible Assets with latest valid non-stale CRITICAL Risk assessment","sources":["AssetScoringReportingQuery"],"inclusion":["ASSIGNED","IN_USE","REPAIR","valid_until > as_of"],"dimensions":["category_id"],"unit":"COUNT","snapshot":"DAILY_POINT_IN_TIME"}',now()),
 ('ASSET_REPLACEMENT_PLAN_PRIORITY_COUNT',1,'Replacement plan or priority','LIVE_COUNT',
  '{"formula":"count eligible Assets with latest valid non-stale PLAN or PRIORITY assessment","sources":["AssetScoringReportingQuery"],"inclusion":["ASSIGNED","IN_USE","REPAIR","valid_until > as_of"],"dimensions":["band","category_id"],"unit":"COUNT","snapshot":"DAILY_POINT_IN_TIME","approval":"not implied"}',now()),
 ('PROCUREMENT_NET_ACTUAL_SPEND_BY_CURRENCY',1,'Net actual spend by currency','PERIOD_SUM',
  '{"formula":"ACTUAL + signed ADJUSTMENT grouped by currency","sources":["CostProvenanceReportingQuery"],"inclusion":["ACTUAL","ADJUSTMENT","effective_from in [start,end)"],"exclusion":["COMMITTED","FX","cross-currency sum"],"dimensions":["currency"],"unit":"MONEY_MICRO","money":"integer minor units"}',now());
