import { readFileSync } from "node:fs";
export interface Config {
  environment: "local" | "test" | "staging" | "production";
  host: string;
  port: number;
  databaseSecretRef: string;
  logLevel: "debug" | "info" | "warn" | "error";
  serviceName: string;
  networkChangeRequiredAcr: string;
  networkChangeMaxAuthAgeSeconds: number;
  authMode: "oidc" | "unavailable";
  oidcIssuer?: string;
  oidcAudience?: string;
}
export function loadConfig(
  env: NodeJS.ProcessEnv,
  serviceName = "api",
  defaultPort = 3000,
): Config {
  const environment = env.APP_ENV ?? "local",
    port = Number(env.PORT ?? defaultPort),
    logLevel = env.LOG_LEVEL ?? "info",
    networkChangeRequiredAcr =
      env.NETWORK_CHANGE_REQUIRED_ACR ?? "urn:itcenter:acr:mfa",
    networkChangeMaxAuthAgeSeconds = Number(
      env.NETWORK_CHANGE_MAX_AUTH_AGE_SECONDS ?? 300,
    ),
    authMode =
      env.AUTH_MODE ?? (environment === "production" ? "" : "unavailable"),
    oidcIssuer = env.OIDC_ISSUER,
    oidcAudience = env.OIDC_AUDIENCE;
  if (!["local", "test", "staging", "production"].includes(environment))
    throw new Error("Invalid APP_ENV");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  if (!["debug", "info", "warn", "error"].includes(logLevel))
    throw new Error("Invalid LOG_LEVEL");
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(serviceName))
    throw new Error("Invalid service name");
  if (!/^[A-Za-z0-9:._-]{1,256}$/.test(networkChangeRequiredAcr))
    throw new Error("Invalid NETWORK_CHANGE_REQUIRED_ACR");
  if (
    !Number.isInteger(networkChangeMaxAuthAgeSeconds) ||
    networkChangeMaxAuthAgeSeconds < 60 ||
    networkChangeMaxAuthAgeSeconds > 900
  )
    throw new Error("Invalid NETWORK_CHANGE_MAX_AUTH_AGE_SECONDS");
  const databaseSecretRef = env.DATABASE_SECRET_REF;
  if (
    !databaseSecretRef ||
    !/^(env:[A-Z][A-Z0-9_]*|file:\/[^\n]+)$/.test(databaseSecretRef)
  )
    throw new Error("DATABASE_SECRET_REF is required");
  if (
    environment === "production" &&
    (env.DEBUG_AUTH_BYPASS !== undefined ||
      env.UNSAFE_MIGRATIONS !== undefined ||
      logLevel === "debug" ||
      !databaseSecretRef.startsWith("file:"))
  )
    throw new Error("Unsafe production configuration");
  if (environment === "production" && !env.AUTH_MODE)
    throw new Error("Production requires AUTH_MODE=oidc");
  if (!(authMode === "oidc" || authMode === "unavailable"))
    throw new Error("Invalid AUTH_MODE");
  if (environment === "production" && authMode !== "oidc")
    throw new Error("Production requires AUTH_MODE=oidc");
  if (authMode === "oidc") {
    let issuer: URL;
    try {
      issuer = new URL(oidcIssuer ?? "");
    } catch {
      throw new Error("OIDC_ISSUER must be a valid HTTPS issuer URL");
    }
    if (
      issuer.protocol !== "https:" ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash ||
      !oidcAudience?.trim() ||
      oidcAudience.length > 256
    )
      throw new Error("OIDC_ISSUER and OIDC_AUDIENCE are required and valid");
  } else if (oidcIssuer !== undefined || oidcAudience !== undefined) {
    throw new Error("OIDC settings require AUTH_MODE=oidc");
  }
  return {
    environment: environment as Config["environment"],
    host: env.HOST ?? "127.0.0.1",
    port,
    databaseSecretRef,
    logLevel: logLevel as Config["logLevel"],
    serviceName,
    networkChangeRequiredAcr,
    networkChangeMaxAuthAgeSeconds,
    authMode: authMode as Config["authMode"],
    ...(oidcIssuer ? { oidcIssuer } : {}),
    ...(oidcAudience ? { oidcAudience } : {}),
  };
}
export interface SecretProvider {
  resolve(reference: string): string;
}
// Production file refs must point to secrets mounted by the deployment's secret manager.
export class EnvironmentSecretProvider implements SecretProvider {
  constructor(private readonly env: NodeJS.ProcessEnv) {}
  resolve(reference: string): string {
    let value: string | undefined;
    if (/^env:[A-Z][A-Z0-9_]*$/.test(reference))
      value = this.env[reference.slice(4)];
    else if (reference.startsWith("file:/")) {
      try {
        value = readFileSync(reference.slice(5), "utf8").trim();
      } catch {
        throw new Error("Secret is unavailable");
      }
    }
    if (!value) throw new Error("Secret is unavailable");
    return value;
  }
}
export function databaseUrl(config: Config, provider: SecretProvider): string {
  const value = provider.resolve(config.databaseSecretRef);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid database connection");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("PostgreSQL is required");
  if (
    config.environment === "production" &&
    (url.searchParams.get("sslmode") !== "verify-full" ||
      ["postgres", "password", "changeme"].includes(
        decodeURIComponent(url.password),
      ))
  )
    throw new Error(
      "Production requires verified TLS and non-default credentials",
    );
  return value;
}
