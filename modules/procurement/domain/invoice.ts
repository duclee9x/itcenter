export type InvoiceLifecycle =
  "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED";
export type InvoiceMatchStatus =
  "NOT_EVALUATED" | "PENDING_RECEIPT" | "MATCHED" | "MISMATCHED";
export type CreditNoteLifecycle =
  "DRAFT" | "SUBMITTED" | "APPLIED" | "REJECTED" | "CANCELLED";

/** Stable, conservative identity for supplier-issued document numbers. */
export function normalizeSupplierDocumentNumber(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase();
}
