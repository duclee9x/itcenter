export interface ContractAlertTerms {
  effective_at: string;
  end_at: string;
  renewal_notice_date?: unknown;
  renewal_notice_period_days?: unknown;
}

export type ContractAlertTrigger = {
  triggerAt: string;
  source: "EXPLICIT_DATE" | "NOTICE_PERIOD";
};

export type ContractAlertConfiguration =
  | { valid: true; trigger: ContractAlertTrigger | null }
  | { valid: false; errorCode: string; field: string };

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveContractAlertConfiguration(
  terms: ContractAlertTerms,
): ContractAlertConfiguration {
  const effective = parseTimestamp(terms.effective_at);
  const end = parseTimestamp(terms.end_at);
  if (effective === null || end === null || effective >= end)
    return { valid: false, errorCode: "INVALID_CONTRACT_TERM", field: "term" };

  const hasDate =
    terms.renewal_notice_date !== undefined &&
    terms.renewal_notice_date !== null &&
    terms.renewal_notice_date !== "";
  const hasPeriod =
    terms.renewal_notice_period_days !== undefined &&
    terms.renewal_notice_period_days !== null;
  let period: number | null = null;
  if (hasPeriod) {
    if (
      !Number.isSafeInteger(terms.renewal_notice_period_days) ||
      Number(terms.renewal_notice_period_days) < 0
    )
      return {
        valid: false,
        errorCode: "INVALID_RENEWAL_NOTICE_PERIOD",
        field: "renewal_notice_period_days",
      };
    period = Number(terms.renewal_notice_period_days);
  }
  if (hasDate) {
    const explicit = parseTimestamp(terms.renewal_notice_date);
    if (explicit === null || explicit < effective || explicit > end)
      return {
        valid: false,
        errorCode: "INVALID_RENEWAL_NOTICE_DATE",
        field: "renewal_notice_date",
      };
    return {
      valid: true,
      trigger: {
        triggerAt: new Date(explicit).toISOString(),
        source: "EXPLICIT_DATE",
      },
    };
  }
  if (period === null) return { valid: true, trigger: null };
  const derived = end - period * 86_400_000;
  if (!Number.isFinite(derived) || derived < effective || derived > end)
    return {
      valid: false,
      errorCode: "IMPOSSIBLE_RENEWAL_NOTICE_PERIOD",
      field: "renewal_notice_period_days",
    };
  return {
    valid: true,
    trigger: {
      triggerAt: new Date(derived).toISOString(),
      source: "NOTICE_PERIOD",
    },
  };
}
