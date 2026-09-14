import type { ServerOptions } from "node:https";
import { constants } from "node:crypto";
import {
  EnvironmentSecretProvider,
  loadConfig,
  type Config,
} from "../../../packages/config/src/index.js";

export interface AgentGatewayRuntimeConfig {
  config: Config;
  authenticationMode: "mtls" | "unavailable";
  tlsOptions?: ServerOptions;
  trustAnchorPem?: string;
  certificateAuthority?: {
    certificatePem: string;
    privateKeyPem: string;
    passphrase?: string;
  };
}

const secretReference = /^file:\/[^\n]+$/;

export function loadAgentGatewayRuntimeConfig(
  env: NodeJS.ProcessEnv,
): AgentGatewayRuntimeConfig {
  const config = loadConfig(env, "agent-gateway", 3001);
  const authenticationMode = env.AGENT_AUTH_MODE ?? "unavailable";
  if (authenticationMode !== "mtls" && authenticationMode !== "unavailable")
    throw new Error("Invalid AGENT_AUTH_MODE");
  if (config.environment === "production" && authenticationMode !== "mtls")
    throw new Error("Production requires AGENT_AUTH_MODE=mtls");

  if (authenticationMode === "unavailable") {
    if (
      env.AGENT_TLS_CERT_REF !== undefined ||
      env.AGENT_TLS_KEY_REF !== undefined ||
      env.AGENT_CA_CERT_REF !== undefined ||
      env.AGENT_CA_SIGNING_KEY_REF !== undefined ||
      env.AGENT_CA_SIGNING_PASSPHRASE_REF !== undefined
    )
      throw new Error("Agent TLS settings require AGENT_AUTH_MODE=mtls");
    return { config, authenticationMode };
  }

  const certRef = env.AGENT_TLS_CERT_REF;
  const keyRef = env.AGENT_TLS_KEY_REF;
  const caRef = env.AGENT_CA_CERT_REF;
  const caKeyRef = env.AGENT_CA_SIGNING_KEY_REF;
  const caPassphraseRef = env.AGENT_CA_SIGNING_PASSPHRASE_REF;
  if (
    !certRef ||
    !keyRef ||
    !caRef ||
    !caKeyRef ||
    !secretReference.test(certRef) ||
    !secretReference.test(keyRef) ||
    !secretReference.test(caRef) ||
    !secretReference.test(caKeyRef) ||
    (caPassphraseRef !== undefined && !secretReference.test(caPassphraseRef))
  )
    throw new Error(
      "mTLS requires file-backed server certificate, private key and Agent CA references",
    );

  const provider = new EnvironmentSecretProvider(env);
  const cert = provider.resolve(certRef);
  const key = provider.resolve(keyRef);
  const ca = provider.resolve(caRef);
  const caPrivateKey = provider.resolve(caKeyRef);
  const caPassphrase = caPassphraseRef
    ? provider.resolve(caPassphraseRef)
    : undefined;
  if (!cert.includes("BEGIN CERTIFICATE") || !key.includes("PRIVATE KEY"))
    throw new Error("Invalid Agent Gateway TLS material");
  if (!ca.includes("BEGIN CERTIFICATE"))
    throw new Error("Invalid Agent CA trust anchor");

  return {
    config,
    authenticationMode,
    trustAnchorPem: ca,
    certificateAuthority: {
      certificatePem: ca,
      privateKeyPem: caPrivateKey,
      ...(caPassphrase ? { passphrase: caPassphrase } : {}),
    },
    tlsOptions: {
      cert,
      key,
      ca,
      requestCert: true,
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
      secureOptions: constants.SSL_OP_NO_TICKET,
    },
  };
}
