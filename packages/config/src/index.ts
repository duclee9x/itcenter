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
    );
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
  return {
    environment: environment as Config["environment"],
    host: env.HOST ?? "127.0.0.1",
    port,
    databaseSecretRef,
    logLevel: logLevel as Config["logLevel"],
    serviceName,
    networkChangeRequiredAcr,
    networkChangeMaxAuthAgeSeconds,
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
