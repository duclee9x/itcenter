export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type PolicyDecision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export interface Predicate {
  path: string;
  op: string;
  value?: JsonValue;
}
export type Condition =
  { all: Condition[] } | { any: Condition[] } | { not: Condition } | Predicate;

export interface ActionDescriptor {
  target_type: string;
  target_id: string;
  action_domain: string;
  action_type: string;
  parameters: Record<string, JsonValue>;
  exclusivity_group: string;
  desired_state?: string;
}

export interface EventTrigger {
  type: "EVENT";
  event_type: string;
  attributes?: Record<string, JsonValue>;
}

export const SAFETY_LEVELS = [
  "SAFE",
  "LOW_RISK",
  "CONTROLLED",
  "HIGH_RISK",
  "PROHIBITED_AUTO",
] as const;

const ALLOWED_OPERATORS = new Set([
  "equals",
  "not_equals",
  "contains",
  "in",
  "not_in",
  "exists",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "matches_regex",
]);
const ALLOWED_ACTIONS = new Set([
  "UPDATE_FIELD",
  "CREATE_RECORD",
  "LINK_RECORD",
  "SEND_NOTIFICATION",
  "CREATE_TICKET",
  "CREATE_INCIDENT",
  "CREATE_APPROVAL",
  "ASSIGN_TEAM",
  "START_WORKFLOW",
  "PAUSE_WORKFLOW",
  "RESTART_AGENT",
]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function validateRuleDefinition(input: {
  trigger: unknown;
  condition: unknown;
  action: unknown;
  safetyLevel: string;
}): asserts input is {
  trigger: EventTrigger;
  condition: Condition;
  action: ActionDescriptor;
  safetyLevel: (typeof SAFETY_LEVELS)[number];
} {
  if (
    !SAFETY_LEVELS.includes(input.safetyLevel as (typeof SAFETY_LEVELS)[number])
  )
    throw new Error("AUTOMATION_RULE_INVALID: unsupported safety level");
  validateTrigger(input.trigger);
  let nodes = 0;
  validateCondition(input.condition, 0, { count: 0 });
  nodes = countNodes(input.condition);
  if (nodes > 100)
    throw new Error("AUTOMATION_RULE_INVALID: condition too large");
  validateAction(input.action);
}

export function validateTrigger(value: unknown): asserts value is EventTrigger {
  if (
    !isRecord(value) ||
    value.type !== "EVENT" ||
    typeof value.event_type !== "string" ||
    !/^[A-Z][A-Z0-9_.]{1,127}$/.test(value.event_type)
  )
    throw new Error(
      "AUTOMATION_RULE_INVALID: only canonical EVENT triggers are supported",
    );
  if (value.event_type.startsWith("AUTOMATION."))
    throw new Error(
      "AUTOMATION_RULE_INVALID: Automation decision events cannot trigger Automation rules",
    );
  const keys = Object.keys(value);
  if (keys.some((key) => !["type", "event_type", "attributes"].includes(key)))
    throw new Error("AUTOMATION_RULE_INVALID: unsupported trigger semantics");
  if (value.attributes !== undefined && !isRecord(value.attributes))
    throw new Error(
      "AUTOMATION_RULE_INVALID: trigger attributes must be an object",
    );
  if (value.attributes !== undefined) {
    if (JSON.stringify(value.attributes).length > 4096)
      throw new Error(
        "AUTOMATION_RULE_INVALID: trigger attributes exceed size limit",
      );
    if (
      Object.keys(value.attributes).some((key) =>
        /password|secret|token|credential|private.?key|bank|tax/i.test(key),
      )
    )
      throw new Error(
        "AUTOMATION_RULE_INVALID: sensitive trigger attributes are not allowed",
      );
  }
}

function validateCondition(
  value: unknown,
  depth: number,
  state: { count: number },
): asserts value is Condition {
  state.count++;
  if (state.count > 100 || depth > 8 || !isRecord(value))
    throw new Error("AUTOMATION_RULE_INVALID: condition exceeds safe bounds");
  if ("all" in value || "any" in value) {
    const key = "all" in value ? "all" : "any";
    const children = value[key];
    if (
      !Array.isArray(children) ||
      children.length < 1 ||
      children.length > 32 ||
      Object.keys(value).length !== 1
    )
      throw new Error("AUTOMATION_RULE_INVALID: invalid compound condition");
    for (const child of children) validateCondition(child, depth + 1, state);
    return;
  }
  if ("not" in value) {
    if (Object.keys(value).length !== 1)
      throw new Error("AUTOMATION_RULE_INVALID: invalid NOT condition");
    validateCondition(value.not, depth + 1, state);
    return;
  }
  if (
    typeof value.path !== "string" ||
    value.path.length > 256 ||
    !/^(event|context)(\.[A-Za-z0-9_-]{1,64})+$/.test(value.path) ||
    value.path.split(".").some((part) => FORBIDDEN_KEYS.has(part))
  )
    throw new Error("AUTOMATION_RULE_INVALID: invalid condition path");
  if (
    value.path
      .split(".")
      .some((part) =>
        /password|secret|token|credential|private.?key|bank|tax/i.test(part),
      )
  )
    throw new Error(
      "AUTOMATION_RULE_INVALID: sensitive event/context paths are not allowed",
    );
  if (typeof value.op !== "string" || !ALLOWED_OPERATORS.has(value.op))
    throw new Error("AUTOMATION_RULE_INVALID: unsupported condition operator");
  if (Object.keys(value).some((key) => !["path", "op", "value"].includes(key)))
    throw new Error(
      "AUTOMATION_RULE_INVALID: condition contains unsupported fields",
    );
  if (value.op !== "exists" && !("value" in value))
    throw new Error("AUTOMATION_RULE_INVALID: predicate value is required");
  if (
    value.op === "exists" &&
    value.value !== undefined &&
    typeof value.value !== "boolean"
  )
    throw new Error("AUTOMATION_RULE_INVALID: exists requires a boolean value");
  if (
    [
      "greater_than",
      "greater_than_or_equal",
      "less_than",
      "less_than_or_equal",
    ].includes(value.op) &&
    (typeof value.value !== "number" || !Number.isFinite(value.value))
  )
    throw new Error(
      "AUTOMATION_RULE_INVALID: numeric comparison requires a finite number",
    );
  if (
    ["in", "not_in"].includes(value.op) &&
    (!Array.isArray(value.value) || value.value.length > 50)
  )
    throw new Error(
      "AUTOMATION_RULE_INVALID: set comparison requires a bounded array",
    );
  if (
    value.op === "matches_regex" &&
    (typeof value.value !== "string" ||
      value.value.length > 128 ||
      !isSafeRegex(value.value))
  )
    throw new Error(
      "AUTOMATION_RULE_INVALID: regex is not in the bounded safe subset",
    );
  if (value.op === "matches_regex") {
    try {
      new RegExp(value.value as string, "u");
    } catch {
      throw new Error("AUTOMATION_RULE_INVALID: regex syntax is invalid");
    }
  }
}

function countNodes(value: unknown): number {
  if (!isRecord(value)) return 1;
  if (Array.isArray(value.all))
    return 1 + value.all.reduce((sum, child) => sum + countNodes(child), 0);
  if (Array.isArray(value.any))
    return 1 + value.any.reduce((sum, child) => sum + countNodes(child), 0);
  if ("not" in value) return 1 + countNodes(value.not);
  return 1;
}

function isSafeRegex(value: string): boolean {
  // Intentionally accepts a small linear-time subset: no groups, backrefs,
  // alternation, lookarounds, or adjacent/nested quantifiers.
  const quantifiers = (value.match(/\*|\+|\{\d+(?:,\d*)?\}/g) ?? []).length;
  return !/[()|\\]/.test(value) && quantifiers <= 1;
}

export function validateAction(
  value: unknown,
): asserts value is ActionDescriptor {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "target_type",
          "target_id",
          "action_domain",
          "action_type",
          "parameters",
          "exclusivity_group",
          "desired_state",
        ].includes(key),
    )
  )
    throw new Error("AUTOMATION_ACTION_UNSUPPORTED: invalid action descriptor");
  for (const key of [
    "target_type",
    "target_id",
    "action_domain",
    "action_type",
    "exclusivity_group",
  ])
    if (
      typeof value[key] !== "string" ||
      !(value[key] as string).trim() ||
      (value[key] as string).length > 128
    )
      throw new Error(
        "AUTOMATION_ACTION_UNSUPPORTED: action reference is invalid",
      );
  if (!ALLOWED_ACTIONS.has(value.action_type as string))
    throw new Error(
      "AUTOMATION_ACTION_UNSUPPORTED: action type is not allow-listed for TASK-090",
    );
  if (
    !isRecord(value.parameters) ||
    JSON.stringify(value.parameters).length > 8192
  )
    throw new Error(
      "AUTOMATION_ACTION_UNSUPPORTED: parameters must be bounded JSON",
    );
  validateSafeParameters(value.parameters, 0);
  if (value.action_type === "RESTART_AGENT") {
    if (
      value.target_type !== "AGENT" ||
      value.action_domain !== "agent" ||
      value.exclusivity_group !== "AGENT_SERVICE_CONTROL" ||
      Object.keys(value.parameters).length !== 0 ||
      value.desired_state !== undefined
    )
      throw new Error(
        "AUTOMATION_ACTION_UNSUPPORTED: RESTART_AGENT must use the registered AGENT capability schema",
      );
  }
  if (
    value.desired_state !== undefined &&
    (typeof value.desired_state !== "string" ||
      value.desired_state.length > 128)
  )
    throw new Error("AUTOMATION_ACTION_UNSUPPORTED: invalid desired state");
  if (
    ["UPDATE_FIELD", "LINK_RECORD", "ASSIGN_TEAM", "PAUSE_WORKFLOW"].includes(
      value.action_type as string,
    ) &&
    typeof value.desired_state !== "string"
  )
    throw new Error(
      "AUTOMATION_ACTION_UNSUPPORTED: mutating action requires declared desired_state",
    );
}

function validateSafeParameters(value: unknown, depth: number): void {
  if (depth > 6)
    throw new Error(
      "AUTOMATION_ACTION_UNSUPPORTED: parameters exceed nesting limit",
    );
  if (Array.isArray(value)) {
    if (value.length > 100)
      throw new Error(
        "AUTOMATION_ACTION_UNSUPPORTED: parameter list exceeds size limit",
      );
    for (const child of value) validateSafeParameters(child, depth + 1);
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (
        /password|secret|token|credential|private.?key|api.?key|license.?key|bank|tax/i.test(
          key,
        )
      )
        throw new Error(
          "AUTOMATION_ACTION_UNSUPPORTED: sensitive values cannot be embedded in action parameters",
        );
      validateSafeParameters(child, depth + 1);
    }
    return;
  }
  if (typeof value === "string" && value.length > 2048)
    throw new Error(
      "AUTOMATION_ACTION_UNSUPPORTED: string parameter exceeds size limit",
    );
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error(
      "AUTOMATION_ACTION_UNSUPPORTED: numeric parameter must be finite",
    );
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  )
    throw new Error(
      "AUTOMATION_ACTION_UNSUPPORTED: parameters must be JSON values",
    );
}

export function evaluateCondition(
  condition: Condition,
  event: Record<string, unknown>,
  context: Record<string, unknown>,
): { matched: boolean; evidence: unknown[] } {
  const evidence: unknown[] = [];
  const evaluate = (node: Condition): boolean => {
    if ("all" in node) {
      const values = node.all.map(evaluate);
      const matched = values.every(Boolean);
      evidence.push({ operator: "all", matched, children: values });
      return matched;
    }
    if ("any" in node) {
      const values = node.any.map(evaluate);
      const matched = values.some(Boolean);
      evidence.push({ operator: "any", matched, children: values });
      return matched;
    }
    if ("not" in node) {
      const child = evaluate(node.not);
      const matched = !child;
      evidence.push({ operator: "not", matched, child });
      return matched;
    }
    const actual = readPath(node.path, { event, context });
    const expected = node.value;
    const matched = compare(actual, node.op, expected);
    evidence.push({
      path: node.path,
      operator: node.op,
      matched,
      actual: safeEvidence(actual),
      expected: safeEvidence(expected),
    });
    return matched;
  };
  return { matched: evaluate(condition), evidence };
}

function readPath(path: string, root: Record<string, unknown>): unknown {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (FORBIDDEN_KEYS.has(part) || !isRecord(current) || !(part in current))
      return MISSING;
    current = current[part];
  }
  return current;
}
const MISSING = Symbol("missing");
function compare(actual: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case "exists":
      return expected === false ? actual === MISSING : actual !== MISSING;
    case "equals":
      return actual !== MISSING && deepEqual(actual, expected);
    case "not_equals":
      return actual === MISSING || !deepEqual(actual, expected);
    case "contains":
      return (
        actual !== MISSING &&
        (typeof actual === "string" && typeof expected === "string"
          ? actual.includes(expected)
          : Array.isArray(actual) &&
            actual.some((item) => deepEqual(item, expected)))
      );
    case "in":
      return (
        actual !== MISSING &&
        Array.isArray(expected) &&
        expected.some((item) => deepEqual(item, actual))
      );
    case "not_in":
      return (
        actual !== MISSING &&
        Array.isArray(expected) &&
        !expected.some((item) => deepEqual(item, actual))
      );
    case "greater_than":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        Number.isFinite(actual) &&
        actual > expected
      );
    case "greater_than_or_equal":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        Number.isFinite(actual) &&
        actual >= expected
      );
    case "less_than":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        Number.isFinite(actual) &&
        actual < expected
      );
    case "less_than_or_equal":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        Number.isFinite(actual) &&
        actual <= expected
      );
    case "matches_regex":
      return (
        typeof actual === "string" &&
        typeof expected === "string" &&
        actual.length <= 1024 &&
        new RegExp(expected, "u").test(actual)
      );
    default:
      return false;
  }
}
function deepEqual(left: unknown, right: unknown): boolean {
  return stable(left) === stable(right);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => JSON.stringify(key) + ":" + stable(child))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function safeEvidence(value: unknown): unknown {
  if (value === MISSING) return { missing: true };
  if (typeof value === "string")
    return { value_type: "string", length: value.length };
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  return { value_type: Array.isArray(value) ? "array" : typeof value };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
