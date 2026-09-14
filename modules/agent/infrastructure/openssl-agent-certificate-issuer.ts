import {
  createHash,
  createPrivateKey,
  createPublicKey,
  X509Certificate,
} from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import type {
  AgentCertificateIssueRequest,
  AgentCertificateIssuerPort,
  IssuedAgentCertificate,
} from "../application/certificate-issuer.js";

interface OpenSslIssuerOptions {
  caCertificatePem: string;
  caPrivateKeyPem: string;
  caPassphrase?: string;
  command?: string;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedHex(value: string): string {
  return value.replaceAll(":", "").toLowerCase();
}

function normalizedSerialHex(value: string): string {
  return normalizedHex(value).replace(/^0+/, "");
}

function runOpenSsl(
  command: string,
  args: string[],
  input?: { privateKey: string; passphrase?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: input?.passphrase
        ? ["pipe", "pipe", "ignore", "pipe"]
        : ["pipe", "pipe", "ignore"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      windowsHide: true,
    });
    const output: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk));
    child.once("error", () =>
      reject(new Error("Certificate issuer unavailable")),
    );
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(output).toString("utf8"));
      else reject(new Error("Certificate signing failed"));
    });
    if (input) {
      child.stdin?.end(input.privateKey);
      if (input.passphrase) {
        const passphraseStream = child.stdio[3] as Writable | null;
        passphraseStream?.end(input.passphrase);
      }
    } else {
      child.stdin?.end();
    }
  });
}

function validateCsrKey(publicKeyPem: string): void {
  const key = createPublicKey(publicKeyPem);
  const details = key.asymmetricKeyDetails;
  if (
    (key.asymmetricKeyType === "rsa" &&
      (details?.modulusLength ?? 0) >= 2048) ||
    (key.asymmetricKeyType === "ec" &&
      ["prime256v1", "secp384r1"].includes(details?.namedCurve ?? ""))
  )
    return;
  throw new Error("CSR key profile is not allowed");
}

export class OpenSslAgentCertificateIssuer implements AgentCertificateIssuerPort {
  private readonly ca: X509Certificate;
  private readonly command: string;

  constructor(private readonly options: OpenSslIssuerOptions) {
    this.ca = new X509Certificate(options.caCertificatePem);
    if (!this.ca.ca)
      throw new Error("Agent trust anchor is not a CA certificate");
    this.command = options.command ?? "openssl";
    const privateKey = createPrivateKey({
      key: options.caPrivateKeyPem,
      ...(options.caPassphrase ? { passphrase: options.caPassphrase } : {}),
    });
    const certificatePublicKey = this.ca.publicKey.export({
      type: "spki",
      format: "der",
    });
    const privateKeyPublic = createPublicKey(privateKey).export({
      type: "spki",
      format: "der",
    });
    if (!certificatePublicKey.equals(privateKeyPublic))
      throw new Error("Agent CA certificate and signing key do not match");
  }

  async isReady(): Promise<boolean> {
    try {
      await runOpenSsl(this.command, ["version"]);
      return true;
    } catch {
      return false;
    }
  }

  async issue(
    request: AgentCertificateIssueRequest,
  ): Promise<IssuedAgentCertificate> {
    if (
      !/^[0-9a-f-]{36}$/i.test(request.credentialId) ||
      !/^[0-9a-f]{1,40}$/i.test(request.serialNumber) ||
      request.csrPem.length > 16_384 ||
      request.expiresAt.getTime() <= request.notBefore.getTime() ||
      request.expiresAt.getTime() - request.notBefore.getTime() >
        30 * 24 * 60 * 60 * 1000
    )
      throw new Error("Invalid certificate signing request");

    const directory = await mkdtemp(join(tmpdir(), "itcenter-agent-ca-"));
    try {
      const csrPath = join(directory, "request.csr");
      const caPath = join(directory, "agent-ca.pem");
      const extensionPath = join(directory, "extensions.cnf");
      const certificatePath = join(directory, "issued.pem");
      await Promise.all([
        writeFile(csrPath, request.csrPem, { mode: 0o600, flag: "wx" }),
        writeFile(caPath, this.options.caCertificatePem, {
          mode: 0o600,
          flag: "wx",
        }),
        writeFile(
          extensionPath,
          `[agent_client]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\nsubjectAltName=URI:urn:itcenter:agent-credential:${request.credentialId}\n`,
          { mode: 0o600, flag: "wx" },
        ),
      ]);
      await runOpenSsl(this.command, [
        "req",
        "-verify",
        "-noout",
        "-in",
        csrPath,
      ]);
      const csrDescription = await runOpenSsl(this.command, [
        "req",
        "-in",
        csrPath,
        "-noout",
        "-text",
      ]);
      if (
        !/Signature Algorithm:\s*(?:sha256WithRSAEncryption|sha384WithRSAEncryption|sha512WithRSAEncryption|ecdsa-with-SHA256|ecdsa-with-SHA384|ecdsa-with-SHA512)/i.test(
          csrDescription,
        )
      )
        throw new Error("CSR signature algorithm is not allowed");
      const publicKeyPem = await runOpenSsl(this.command, [
        "req",
        "-in",
        csrPath,
        "-noout",
        "-pubkey",
      ]);
      validateCsrKey(publicKeyPem);
      const opensslTime = (value: Date) =>
        `${value.toISOString().slice(0, 19).replace(/[-:T]/g, "")}Z`;
      await runOpenSsl(
        this.command,
        [
          "x509",
          "-req",
          "-in",
          csrPath,
          "-CA",
          caPath,
          "-CAkey",
          "/dev/stdin",
          ...(this.options.caPassphrase ? ["-passin", "fd:3"] : []),
          "-set_serial",
          `0x${request.serialNumber}`,
          "-not_before",
          opensslTime(request.notBefore),
          "-not_after",
          opensslTime(request.expiresAt),
          "-sha256",
          "-extfile",
          extensionPath,
          "-extensions",
          "agent_client",
          "-out",
          certificatePath,
        ],
        {
          privateKey: this.options.caPrivateKeyPem,
          ...(this.options.caPassphrase
            ? { passphrase: this.options.caPassphrase }
            : {}),
        },
      );
      const certificatePem = await readFile(certificatePath, "utf8");
      const certificate = new X509Certificate(certificatePem);
      const spkiSha256 = sha256(
        certificate.publicKey.export({ type: "spki", format: "der" }),
      );
      const expectedSan = `URI:urn:itcenter:agent-credential:${request.credentialId}`;
      if (
        certificate.subjectAltName !== expectedSan ||
        normalizedSerialHex(certificate.serialNumber) !==
          normalizedSerialHex(request.serialNumber)
      )
        throw new Error("Issued certificate identity did not match request");
      return {
        certificatePem,
        serialNumber: normalizedSerialHex(certificate.serialNumber),
        fingerprintSha256: normalizedHex(certificate.fingerprint256),
        spkiSha256,
        issuerFingerprintSha256: normalizedHex(this.ca.fingerprint256),
        notBefore: new Date(certificate.validFrom),
        expiresAt: new Date(certificate.validTo),
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
