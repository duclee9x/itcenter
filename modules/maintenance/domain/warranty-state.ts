export const warrantyStatePolicy = {
  id: "WARRANTY_STATE_V1",
  version: 1,
  expiring_within_days: 90,
  date_basis: "UTC_CALENDAR_DATE",
} as const;

export type CanonicalWarrantyState =
  "VALID" | "EXPIRING" | "EXPIRED" | "UNKNOWN";

export type WarrantyEvidence = {
  id: string;
  starts_at: string;
  ends_at: string;
};

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function daysBetween(startDate: string, endDate: string) {
  return (
    (Date.parse(`${endDate}T00:00:00.000Z`) -
      Date.parse(`${startDate}T00:00:00.000Z`)) /
    86_400_000
  );
}

/** Pure, versioned Warranty policy. All inputs and boundaries use UTC dates. */
export function evaluateWarrantyState(input: {
  records: readonly WarrantyEvidence[];
  asOf: string;
}) {
  const asOfTime = Date.parse(input.asOf);
  if (!Number.isFinite(asOfTime))
    return {
      state: "UNKNOWN" as const,
      reason_code: "INVALID_AS_OF",
      warranty_id: null,
      ends_at: null,
      remaining_days: null,
    };
  const asOfDate = new Date(asOfTime).toISOString().slice(0, 10);
  if (!input.records.length)
    return {
      state: "UNKNOWN" as const,
      reason_code: "NO_WARRANTY",
      warranty_id: null,
      ends_at: null,
      remaining_days: null,
    };
  if (
    input.records.some(
      (record) =>
        !validDate(record.starts_at) ||
        !validDate(record.ends_at) ||
        record.ends_at < record.starts_at,
    )
  )
    return {
      state: "UNKNOWN" as const,
      reason_code: "INVALID_WARRANTY_EVIDENCE",
      warranty_id: null,
      ends_at: null,
      remaining_days: null,
    };

  const started = input.records.filter(
    (record) => record.starts_at <= asOfDate,
  );
  const unexpired = started.filter((record) => record.ends_at > asOfDate);
  let effective: WarrantyEvidence | undefined;
  if (unexpired.length === 1) effective = unexpired[0];
  else if (unexpired.length > 1)
    return {
      state: "UNKNOWN" as const,
      reason_code: "AMBIGUOUS_WARRANTY_EVIDENCE",
      warranty_id: null,
      ends_at: null,
      remaining_days: null,
    };
  else if (started.length === 1) effective = started[0];
  else if (started.length > 1)
    return {
      state: "UNKNOWN" as const,
      reason_code: "AMBIGUOUS_WARRANTY_EVIDENCE",
      warranty_id: null,
      ends_at: null,
      remaining_days: null,
    };
  else
    return {
      state: "UNKNOWN" as const,
      reason_code: "NO_EFFECTIVE_WARRANTY",
      warranty_id: null,
      ends_at: null,
      remaining_days: null,
    };

  if (!effective)
    return {
      state: "UNKNOWN" as const,
      reason_code: "NO_EFFECTIVE_WARRANTY",
      warranty_id: null,
      ends_at: null,
      remaining_days: null,
    };

  const remainingDays = daysBetween(asOfDate, effective.ends_at);
  const state: CanonicalWarrantyState =
    effective.ends_at <= asOfDate
      ? "EXPIRED"
      : remainingDays <= warrantyStatePolicy.expiring_within_days
        ? "EXPIRING"
        : "VALID";
  return {
    state,
    reason_code: null,
    warranty_id: effective.id,
    ends_at: effective.ends_at,
    remaining_days: remainingDays,
  };
}
