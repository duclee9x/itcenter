import type { Clock } from "../../shared-kernel/src/index.js";
export class FakeClock implements Clock {
  constructor(private instant = new Date("2026-09-11T00:00:00Z")) {}
  now(): Date {
    return new Date(this.instant);
  }
  advance(ms: number): void {
    this.instant = new Date(this.instant.getTime() + ms);
  }
}
