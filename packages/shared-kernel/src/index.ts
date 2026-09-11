import { randomUUID } from "node:crypto";
export interface Clock {
  now(): Date;
}
export interface IdGenerator {
  next(): string;
}
export const systemClock: Clock = { now: () => new Date() };
export const uuidGenerator: IdGenerator = { next: () => randomUUID() };
export interface CorrelationContext {
  request_id: string;
  correlation_id: string;
  causation_id: string;
}
export interface ActorContext {
  type: string;
  id: string | null;
}
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
