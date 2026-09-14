import {
  aggregateReadiness,
  type ComponentCriticality,
  type ReadinessComponent,
  type ReadinessSnapshot,
} from "../../../packages/observability/src/readiness.js";

export interface WorkerTask {
  name: string;
  run(signal: AbortSignal): Promise<void>;
}

export interface WorkerDefinition {
  name: string;
  criticality: ComponentCriticality;
  replicaMode: "CONCURRENT_SAFE" | "SINGLE_REPLICA";
  coordination: string;
}

export const WORKER_DEFINITIONS: readonly WorkerDefinition[] = [
  {
    name: "license-entitlement-expiry",
    criticality: "DEGRADABLE",
    replicaMode: "CONCURRENT_SAFE",
    coordination: "unique entitlement expiry fact and conflict-safe insert",
  },
  {
    name: "search-indexer",
    criticality: "DEGRADABLE",
    replicaMode: "CONCURRENT_SAFE",
    coordination: "transactional inbox uniqueness and projection upsert",
  },
  {
    name: "goods-receipt-assetizer",
    criticality: "MANDATORY",
    replicaMode: "CONCURRENT_SAFE",
    coordination:
      "per-unit inbox, receipt state primary key, unique Asset registration",
  },
  {
    name: "contract-alert-expiry",
    criticality: "MANDATORY",
    replicaMode: "CONCURRENT_SAFE",
    coordination: "contract row lock and unique alert fact identities",
  },
  {
    name: "cost-provenance-linker",
    criticality: "DEGRADABLE",
    replicaMode: "CONCURRENT_SAFE",
    coordination: "transactional inbox and idempotent provenance identity",
  },
  {
    name: "automation-rule-evaluator",
    criticality: "DEGRADABLE",
    replicaMode: "CONCURRENT_SAFE",
    coordination: "transactional inbox and unique evaluation/intent identities",
  },
  {
    name: "automation-conflict-work-items",
    criticality: "DEGRADABLE",
    replicaMode: "CONCURRENT_SAFE",
    coordination: "transactional inbox and idempotent Work Queue projection",
  },
  {
    name: "automation-action-executions",
    criticality: "MANDATORY",
    replicaMode: "CONCURRENT_SAFE",
    coordination:
      "SKIP LOCKED claims, guarded execution transitions and durable attempt uniqueness",
  },
  {
    name: "incident-correlation",
    criticality: "DEGRADABLE",
    replicaMode: "CONCURRENT_SAFE",
    coordination:
      "transactional inbox, unique evaluation identity and row locks",
  },
  {
    name: "asset-warranty-state-projection",
    criticality: "DEGRADABLE",
    replicaMode: "CONCURRENT_SAFE",
    coordination: "Asset row lock and deterministic projection comparison",
  },
  {
    name: "asset-risk-replacement-scoring",
    criticality: "DEGRADABLE",
    replicaMode: "CONCURRENT_SAFE",
    coordination: "Asset row lock and unique assessment evidence identity",
  },
  {
    name: "reporting-governed-kpi-snapshots",
    criticality: "DEGRADABLE",
    replicaMode: "CONCURRENT_SAFE",
    coordination:
      "snapshot-scoped transaction advisory lock and revision row lock",
  },
  {
    name: "recommendation-source-reconciliation",
    criticality: "DEGRADABLE",
    replicaMode: "CONCURRENT_SAFE",
    coordination:
      "serializable tenant transaction, advisory lock and source generation uniqueness",
  },
];

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_STALE_MS = 45_000;
const STARTUP_DEADLINE_MS = 60_000;
const RESTART_DELAY_MS = 1000;

interface WorkerRecord {
  definition: WorkerDefinition;
  state: "STARTING" | "READY" | "NOT_READY" | "STOPPING";
  registered: boolean;
  everReady: boolean;
  generation: number;
  restartCount: number;
  generationStartedAt: number;
  startedAt?: number;
  lastHeartbeatAt?: number;
  lastStateChangeAt: number;
  lastFailureReason?: string;
}

export class WorkerRegistry {
  private readonly records = new Map<string, WorkerRecord>();
  private stopping = false;
  private readonly createdAt: number;

  constructor(
    definitions: readonly WorkerDefinition[] = WORKER_DEFINITIONS,
    private readonly now: () => number = Date.now,
    private readonly heartbeatStaleMs = HEARTBEAT_STALE_MS,
    private readonly startupDeadlineMs = STARTUP_DEADLINE_MS,
    private readonly onTransition: (worker: ReadinessComponent) => void = () =>
      undefined,
  ) {
    if (
      new Set(definitions.map((definition) => definition.name)).size !==
      definitions.length
    )
      throw new Error("Duplicate worker definition");
    this.createdAt = now();
    for (const definition of definitions)
      this.records.set(definition.name, {
        definition,
        state: "STARTING",
        registered: false,
        everReady: false,
        generation: 0,
        restartCount: 0,
        generationStartedAt: this.createdAt,
        lastStateChangeAt: this.createdAt,
      });
  }

  get expectedNames(): readonly string[] {
    return [...this.records.keys()];
  }

  register(name: string, generation: number): void {
    const record = this.require(name);
    if (this.stopping) throw new Error("Worker registry is stopping");
    const previousState = record.state;
    const previousReason = record.lastFailureReason;
    record.registered = true;
    record.generation = generation;
    record.generationStartedAt = this.now();
    record.startedAt ??= record.generationStartedAt;
    delete record.lastHeartbeatAt;
    record.state = "STARTING";
    if (record.everReady) record.lastFailureReason = "WORKER_RESTARTING";
    else delete record.lastFailureReason;
    if (
      previousState !== record.state ||
      previousReason !== record.lastFailureReason
    )
      this.transition(record);
  }

  heartbeat(name: string, generation: number): void {
    const record = this.require(name);
    if (this.stopping || record.generation !== generation) return;
    const stateChanged =
      record.state !== "READY" || record.lastFailureReason !== undefined;
    record.lastHeartbeatAt = this.now();
    record.everReady = true;
    record.state = "READY";
    delete record.lastFailureReason;
    if (stateChanged) this.transition(record);
  }

  fail(name: string, generation: number, reasonCode: string): void {
    const record = this.require(name);
    if (record.generation !== generation || this.stopping) return;
    if (record.state === "NOT_READY" && record.lastFailureReason === reasonCode)
      return;
    record.state = "NOT_READY";
    record.lastFailureReason = reasonCode;
    record.restartCount += 1;
    this.transition(record);
  }

  stop(): void {
    if (this.stopping) return;
    this.stopping = true;
    for (const record of this.records.values()) {
      record.state = "STOPPING";
      delete record.lastFailureReason;
      this.transition(record);
    }
  }

  snapshot(
    baseComponents: readonly ReadinessComponent[] = [],
  ): ReadinessSnapshot {
    const now = this.now();
    const workers = [...this.records.values()].map((record) => {
      if (
        !this.stopping &&
        record.state === "READY" &&
        record.lastHeartbeatAt !== undefined &&
        now - record.lastHeartbeatAt > this.heartbeatStaleMs
      ) {
        record.state = "NOT_READY";
        record.lastFailureReason = "WORKER_HEARTBEAT_STALE";
        this.transition(record);
      } else if (
        !this.stopping &&
        (!record.registered || record.state === "STARTING") &&
        now - record.generationStartedAt > this.startupDeadlineMs
      ) {
        record.state = "NOT_READY";
        record.lastFailureReason = "WORKER_STARTUP_TIMEOUT";
        this.transition(record);
      }
      const state = this.stopping ? "STOPPING" : record.state;
      const reasonCode = this.stopping ? undefined : record.lastFailureReason;
      return {
        id: record.definition.name,
        state,
        criticality: record.definition.criticality,
        ...(reasonCode ? { reasonCode } : {}),
        ...(record.startedAt !== undefined
          ? { startedAt: new Date(record.startedAt).toISOString() }
          : {}),
        ...(record.lastHeartbeatAt !== undefined
          ? { lastHeartbeatAt: new Date(record.lastHeartbeatAt).toISOString() }
          : {}),
        lastStateChangeAt: new Date(record.lastStateChangeAt).toISOString(),
        generation: record.generation,
        restartCount: record.restartCount,
      } satisfies ReadinessComponent;
    });
    return aggregateReadiness(
      "WORKER",
      [...baseComponents, ...workers],
      this.stopping,
    );
  }

  private require(name: string): WorkerRecord {
    const record = this.records.get(name);
    if (!record) throw new Error(`Unexpected worker: ${name}`);
    return record;
  }

  private transition(record: WorkerRecord): void {
    record.lastStateChangeAt = this.now();
    this.onTransition({
      id: record.definition.name,
      state: record.state,
      criticality: record.definition.criticality,
      ...(record.lastFailureReason
        ? { reasonCode: record.lastFailureReason }
        : {}),
      ...(record.startedAt !== undefined
        ? { startedAt: new Date(record.startedAt).toISOString() }
        : {}),
      ...(record.lastHeartbeatAt !== undefined
        ? { lastHeartbeatAt: new Date(record.lastHeartbeatAt).toISOString() }
        : {}),
      lastStateChangeAt: new Date(record.lastStateChangeAt).toISOString(),
      generation: record.generation,
      restartCount: record.restartCount,
    });
  }
}

export class WorkerHost {
  private readonly controller = new AbortController();
  private tasks: Promise<void>[] = [];
  private started = false;
  private stopping = false;

  constructor(
    readonly registry = new WorkerRegistry(),
    private readonly options: {
      heartbeatIntervalMs?: number;
      restartDelayMs?: number;
    } = {},
  ) {}

  get isStopping(): boolean {
    return this.stopping;
  }

  start(tasks: readonly WorkerTask[]): void {
    if (this.started) throw new Error("Worker already started");
    const names = tasks.map((task) => task.name).sort();
    if (new Set(names).size !== tasks.length)
      throw new Error("Duplicate worker task");
    if (
      names.length !== this.registry.expectedNames.length ||
      names.some(
        (name, index) =>
          name !== [...this.registry.expectedNames].sort()[index],
      )
    )
      throw new Error(
        "Worker task inventory does not match readiness registry",
      );
    this.started = true;
    this.tasks = tasks.map((task) => this.supervise(task));
  }

  beginStop(): void {
    if (this.stopping) return;
    this.stopping = true;
    this.registry.stop();
    this.controller.abort();
  }

  snapshot(
    baseComponents: readonly ReadinessComponent[] = [],
  ): ReadinessSnapshot {
    const host: ReadinessComponent = {
      id: "worker-host",
      state: this.stopping ? "STOPPING" : this.started ? "READY" : "STARTING",
      criticality: "MANDATORY",
      ...(!this.started && !this.stopping
        ? { reasonCode: "WORKER_HOST_STARTING" }
        : {}),
    };
    const registry: ReadinessComponent = {
      id: "worker-registry",
      state: this.stopping ? "STOPPING" : this.started ? "READY" : "STARTING",
      criticality: "MANDATORY",
      ...(!this.started && !this.stopping
        ? { reasonCode: "WORKER_REGISTRY_STARTING" }
        : {}),
    };
    return this.registry.snapshot([...baseComponents, host, registry]);
  }

  async stop(): Promise<void> {
    this.beginStop();
    await Promise.allSettled(this.tasks);
  }

  private async supervise(task: WorkerTask): Promise<void> {
    let generation = 0;
    while (!this.controller.signal.aborted) {
      generation += 1;
      this.registry.register(task.name, generation);
      let heartbeatTimer: NodeJS.Timeout | undefined;
      try {
        const running = task.run(this.controller.signal);
        this.registry.heartbeat(task.name, generation);
        heartbeatTimer = setInterval(
          () => this.registry.heartbeat(task.name, generation),
          this.options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
        );
        heartbeatTimer.unref();
        await running;
        if (!this.controller.signal.aborted)
          throw new Error("Worker task exited unexpectedly");
      } catch {
        if (!this.controller.signal.aborted) {
          this.registry.fail(
            task.name,
            generation,
            "WORKER_EXITED_UNEXPECTEDLY",
          );
          await this.waitForRestart();
        }
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      }
    }
  }

  private async waitForRestart(): Promise<void> {
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.controller.signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(
        finish,
        this.options.restartDelayMs ?? RESTART_DELAY_MS,
      );
      this.controller.signal.addEventListener("abort", finish, { once: true });
    });
  }
}
