import type { HumanDecision, LabSnapshot, OperationResult } from './core.js';
import { CompanionLabService } from './core.js';
import { CodexCompanionLabService } from './codex-service.js';

export type Awaitable<T> = T | Promise<T>;

/** The HTTP UI and MCP transport share one implementation through this interface. */
export interface CompanionLabServiceLike {
  start(expectedGeneration: number): Awaitable<OperationResult>;
  advance(expectedGeneration: number): Awaitable<OperationResult>;
  hold(): Awaitable<OperationResult>;
  stop(): Awaitable<OperationResult>;
  decideFromHuman(input: {
    sessionId: string;
    approvalId: string;
    expectedGeneration: number;
    decision: HumanDecision;
  }): Awaitable<OperationResult>;
  snapshot(): LabSnapshot;
  explain(detail?: boolean): Awaitable<unknown>;
  summarize(): Awaitable<unknown>;
  close?(): Promise<void>;
}

export function createCompanionLabService(source = process.env.COMPANION_LAB_SOURCE): CompanionLabServiceLike {
  if (source === undefined || source === 'simulation') return new CompanionLabService();
  if (source === 'codex') return new CodexCompanionLabService();
  throw new Error(`Invalid COMPANION_LAB_SOURCE: ${source}`);
}
