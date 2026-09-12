CREATE UNIQUE INDEX approval_requests_invoice_source_uq
  ON control.approval_requests(tenant_id,source_type,source_id)
  WHERE source_type IN ('INVOICE_APPROVAL','INVOICE_MATCH_EXCEPTION');
