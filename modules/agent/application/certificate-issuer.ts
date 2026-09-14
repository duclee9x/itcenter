export interface AgentCertificateIssueRequest {
  operationId: string;
  credentialId: string;
  serialNumber: string;
  csrPem: string;
  notBefore: Date;
  expiresAt: Date;
}

export interface IssuedAgentCertificate {
  certificatePem: string;
  serialNumber: string;
  fingerprintSha256: string;
  spkiSha256: string;
  issuerFingerprintSha256: string;
  notBefore: Date;
  expiresAt: Date;
}

export interface AgentCertificateIssuerPort {
  isReady(): Promise<boolean>;
  issue(request: AgentCertificateIssueRequest): Promise<IssuedAgentCertificate>;
}
