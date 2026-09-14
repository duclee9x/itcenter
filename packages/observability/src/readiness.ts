export type ReadinessState = "READY" | "DEGRADED" | "NOT_READY";
export type ComponentReadinessState =
  "STARTING" | "READY" | "DEGRADED" | "NOT_READY" | "STOPPING";
export type ComponentCriticality = "MANDATORY" | "DEGRADABLE";

export interface ReadinessComponent {
  id: string;
  state: ComponentReadinessState;
  criticality: ComponentCriticality;
  reasonCode?: string;
  startedAt?: string;
  lastHeartbeatAt?: string;
  lastSuccessfulCheckAt?: string;
  lastStateChangeAt?: string;
  generation?: number;
  restartCount?: number;
}

export interface ReadinessSnapshot {
  profile: string;
  status: ReadinessState;
  components: ReadinessComponent[];
}

export class ReadinessCheckCache {
  private readonly values = new Map<
    string,
    { value: boolean; expiresAt: number }
  >();

  constructor(
    private readonly ttlMs = 5000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 0 || ttlMs > 30000)
      throw new Error("Readiness cache TTL must be between 0 and 30000ms");
  }

  async check(key: string, probe: () => Promise<boolean>): Promise<boolean> {
    const cached = this.values.get(key);
    if (cached && this.now() < cached.expiresAt) return cached.value;
    let value = false;
    try {
      value = await probe();
    } catch {
      value = false;
    }
    this.values.set(key, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }
}

const safeCode = /^[A-Z][A-Z0-9_]{0,63}$/;

export function aggregateReadiness(
  profile: string,
  components: readonly ReadinessComponent[],
  stopping = false,
): ReadinessSnapshot {
  if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(profile))
    throw new Error("Invalid readiness profile");
  for (const component of components) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(component.id))
      throw new Error("Invalid readiness component id");
    if (component.reasonCode && !safeCode.test(component.reasonCode))
      throw new Error("Invalid readiness reason code");
  }
  const status: ReadinessState = stopping
    ? "NOT_READY"
    : components.some(
          (component) =>
            component.criticality === "MANDATORY" &&
            component.state !== "READY",
        )
      ? "NOT_READY"
      : components.some(
            (component) =>
              component.criticality === "DEGRADABLE" &&
              component.state !== "READY" &&
              component.state !== "STARTING",
          )
        ? "DEGRADED"
        : "READY";
  return { profile, status, components: [...components] };
}

export function addReadinessComponent(
  snapshot: ReadinessSnapshot,
  component: ReadinessComponent,
): ReadinessSnapshot {
  return aggregateReadiness(snapshot.profile, [
    ...snapshot.components,
    component,
  ]);
}

export function asReadinessSnapshot(
  value: boolean | ReadinessSnapshot,
  fallbackProfile = "APPLICATION",
): ReadinessSnapshot {
  if (typeof value !== "boolean") return value;
  return aggregateReadiness(fallbackProfile, [
    {
      id: "runtime",
      state: value ? "READY" : "NOT_READY",
      criticality: "MANDATORY",
      ...(!value ? { reasonCode: "DEPENDENCY_UNAVAILABLE" } : {}),
    },
  ]);
}

export function publicReadiness(snapshot: ReadinessSnapshot) {
  return {
    profile: snapshot.profile,
    status: snapshot.status,
    components: snapshot.components.map(({ id, state, reasonCode }) => ({
      id,
      state,
      ...(reasonCode ? { reason_code: reasonCode } : {}),
    })),
  };
}
