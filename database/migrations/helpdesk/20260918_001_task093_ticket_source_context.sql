ALTER TABLE helpdesk.tickets
  ADD COLUMN source_context_type text,
  ADD COLUMN source_context_reference_id uuid,
  ADD CONSTRAINT ticket_source_context_pair CHECK (
    (source_context_type IS NULL AND source_context_reference_id IS NULL)
    OR (source_context_type='KNOWLEDGE_RECOMMENDATION' AND source_context_reference_id IS NOT NULL)
  );

CREATE INDEX helpdesk_ticket_source_context_lookup
  ON helpdesk.tickets(tenant_id,source_context_type,source_context_reference_id)
  WHERE source_context_type IS NOT NULL;

CREATE FUNCTION helpdesk.reject_ticket_source_context_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.source_context_type,OLD.source_context_reference_id)
     IS DISTINCT FROM ROW(NEW.source_context_type,NEW.source_context_reference_id) THEN
    RAISE EXCEPTION 'ticket source context is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ticket_source_context_immutable
  BEFORE UPDATE OF source_context_type,source_context_reference_id ON helpdesk.tickets
  FOR EACH ROW EXECUTE FUNCTION helpdesk.reject_ticket_source_context_rewrite();
