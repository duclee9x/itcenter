import { createHash } from "node:crypto";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "currency must be a supported ISO 4217 currency code.",
    );
  }
}

export function roundCurrency(value: number, currency: string): number {
  const scale = 10 ** currencyDigits(currency);
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function validDecimal(
  value: unknown,
  name: string,
  options: { min?: number; maxScale?: number } = {},
): number {
  const min = options.min ?? 0;
  const scale = options.maxScale ?? 4;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    !Number.isInteger(value * 10 ** scale)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${name} must be a finite number >= ${min} with at most ${scale} decimal places.`,
    );
  return value;
}

export function validIsoDate(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${name} must be an ISO calendar date.`,
    );
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${name} must be an ISO calendar date.`,
    );
  return value;
}
