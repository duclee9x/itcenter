CREATE TABLE contract.alert_facts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  contract_id uuid NOT NULL,
  contract_version_id uuid NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('RENEWAL_NOTICE','EXPIRY_ACTION')),
  trigger_source text NOT NULL CHECK (trigger_source IN ('EXPLICIT_DATE','NOTICE_PERIOD')),
  trigger_at timestamptz NOT NULL,
  event_id uuid NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,contract_id,contract_version_id,trigger_type,trigger_at),
  UNIQUE (event_id),
  FOREIGN KEY (tenant_id,contract_id,contract_version_id)
    REFERENCES contract.contract_versions(tenant_id,contract_id,id) ON DELETE RESTRICT
);
CREATE INDEX contract_alert_due_idx ON contract.alert_facts(tenant_id,trigger_at);

CREATE TABLE contract.alert_configuration_exceptions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  contract_id uuid NOT NULL,
  contract_version_id uuid NOT NULL,
  configuration_fingerprint char(64) NOT NULL CHECK (configuration_fingerprint ~ '^[0-9a-f]{64}$'),
  error_code text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details)='object'),
  event_id uuid NOT NULL UNIQUE,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,contract_id,contract_version_id,configuration_fingerprint),
  FOREIGN KEY (tenant_id,contract_id,contract_version_id)
    REFERENCES contract.contract_versions(tenant_id,contract_id,id) ON DELETE RESTRICT
);

CREATE FUNCTION contract.reject_alert_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Contract alert facts and configuration exceptions are append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER contract_alert_facts_append_only BEFORE UPDATE OR DELETE ON contract.alert_facts FOR EACH ROW EXECUTE FUNCTION contract.reject_alert_history_mutation();
CREATE TRIGGER contract_alert_exceptions_append_only BEFORE UPDATE OR DELETE ON contract.alert_configuration_exceptions FOR EACH ROW EXECUTE FUNCTION contract.reject_alert_history_mutation();

CREATE FUNCTION contract.reject_alert_history_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Contract alert history is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER contract_alert_facts_no_truncate BEFORE TRUNCATE ON contract.alert_facts FOR EACH STATEMENT EXECUTE FUNCTION contract.reject_alert_history_truncate();
CREATE TRIGGER contract_alert_exceptions_no_truncate BEFORE TRUNCATE ON contract.alert_configuration_exceptions FOR EACH STATEMENT EXECUTE FUNCTION contract.reject_alert_history_truncate();
