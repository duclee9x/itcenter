export {
  executeCommercialDocumentCommand,
  readCommercialDocument,
  isFinalSignedDocument,
  type DocumentCommand,
} from "./application/commercial-documents.js";
export const permissions = [
  {
    code: "commercial_document.read",
    resource_type: "commercial_document",
    action: "read",
  },
  {
    code: "commercial_document.write",
    resource_type: "commercial_document",
    action: "write",
  },
  {
    code: "commercial_document.finalize",
    resource_type: "commercial_document",
    action: "finalize",
  },
] as const;
