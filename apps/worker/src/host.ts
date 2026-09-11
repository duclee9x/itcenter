export interface WorkerTask {
  name: string;
  run(signal: AbortSignal): Promise<void>;
}
// Hosts outbox, consumers and job handlers when their adapters are configured.
export class WorkerHost {
  private readonly controller = new AbortController();
  private tasks: Promise<void>[] = [];
  private started = false;
  start(tasks: readonly WorkerTask[]): void {
    if (this.started) throw new Error("Worker already started");
    if (new Set(tasks.map((t) => t.name)).size !== tasks.length)
      throw new Error("Duplicate worker task");
    this.started = true;
    this.tasks = tasks.map((t) => t.run(this.controller.signal));
  }
  async stop(): Promise<void> {
    this.controller.abort();
    await Promise.all(this.tasks);
  }
}
